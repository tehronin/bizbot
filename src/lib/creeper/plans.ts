import crypto from "node:crypto";
import { CompanyIngestionPlanStatus, CompanyIngestionRunStatus, Prisma, SourceScanStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getEmbeddingConfig } from "@/lib/embeddings/embed";
import { requireConversationCompanyProfileId } from "@/lib/creeper/conversations";
import { enqueueCreeperIngestionJob } from "@/lib/creeper/jobs";

interface ResolveCompanyProfileOptions {
  companyProfileId?: string;
  conversationId?: string;
}

export interface DraftCreeperPlanInput extends ResolveCompanyProfileOptions {
  sourceId?: string;
  businessGoal?: string;
  maxTables?: number;
}

export interface UpdateCreeperPlanInput {
  planId: string;
  selectedTableIds?: string[];
  businessGoal?: string;
}

export interface PlannedTableSelection {
  id: string;
  schemaName: string;
  tableName: string;
  estimatedRowCount: number | null;
  ingestionScore: number | null;
  selectedColumns: string[];
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function parsePlannedTableSelections(value: unknown): PlannedTableSelection[] {
  return Array.isArray(value) ? value as unknown as PlannedTableSelection[] : [];
}

function normalizeOptionalText(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}

function normalizeMaxTables(value: number | undefined): number {
  if (value === undefined) {
    return 12;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("maxTables must be a positive integer.");
  }

  return Math.min(value, 24);
}

async function resolveCompanyProfileId(options: ResolveCompanyProfileOptions): Promise<string> {
  if (options.companyProfileId?.trim()) {
    return options.companyProfileId.trim();
  }

  return requireConversationCompanyProfileId(options.conversationId);
}

async function resolvePlanSource(companyProfileId: string, sourceId?: string) {
  const profile = await db.companyProfile.findUnique({
    where: { id: companyProfileId },
    include: {
      sources: {
        include: {
          source: true,
        },
        orderBy: [
          { isPrimary: "desc" },
          { createdAt: "asc" },
        ],
      },
    },
  });

  if (!profile) {
    throw new Error(`Unknown company profile '${companyProfileId}'.`);
  }

  const binding = sourceId
    ? profile.sources.find((entry) => entry.sourceId === sourceId)
    : profile.sources.find((entry) => entry.isPrimary) ?? profile.sources[0];

  if (!binding) {
    throw new Error(`Company profile '${profile.name}' does not have a registered source yet.`);
  }

  return {
    profile,
    source: binding.source,
  };
}

function isHighSensitivity(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return (value as { level?: unknown }).level === "high";
}

async function loadLatestSuccessfulScan(sourceId: string) {
  const scan = await db.sourceScan.findFirst({
    where: {
      sourceId,
      status: SourceScanStatus.SUCCEEDED,
    },
    orderBy: { createdAt: "desc" },
    include: {
      tableProfiles: {
        include: {
          columns: {
            orderBy: { columnName: "asc" },
          },
        },
        orderBy: [
          { ingestionScore: "desc" },
          { schemaName: "asc" },
          { tableName: "asc" },
        ],
      },
    },
  });

  if (!scan) {
    throw new Error("Run Creeper source profiling before drafting an ingestion plan.");
  }

  return scan;
}

function buildTableId(schemaName: string, tableName: string): string {
  return `${schemaName}.${tableName}`;
}

function buildTableSelections(
  scan: Awaited<ReturnType<typeof loadLatestSuccessfulScan>>,
  maxTables: number,
  selectedTableIds?: string[],
): PlannedTableSelection[] {
  const requestedTableIds = selectedTableIds ? new Set(selectedTableIds) : null;
  const candidates = scan.tableProfiles.filter((table) => table.tableType === "BASE TABLE" || table.tableType === "VIEW");
  const chosen = requestedTableIds
    ? candidates.filter((table) => requestedTableIds.has(buildTableId(table.schemaName, table.tableName)))
    : candidates.slice(0, maxTables);

  return chosen.map((table) => ({
    id: buildTableId(table.schemaName, table.tableName),
    schemaName: table.schemaName,
    tableName: table.tableName,
    estimatedRowCount: table.estimatedRowCount,
    ingestionScore: table.ingestionScore,
    selectedColumns: table.columns
      .filter((column) => !isHighSensitivity(column.sensitivity))
      .map((column) => column.columnName),
  }));
}

async function nextPlanVersion(companyProfileId: string): Promise<number> {
  const latest = await db.companyIngestionPlan.findFirst({
    where: { companyProfileId },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  return (latest?.version ?? 0) + 1;
}

export async function createDraftCreeperPlan(input: DraftCreeperPlanInput) {
  const companyProfileId = await resolveCompanyProfileId(input);
  const { profile, source } = await resolvePlanSource(companyProfileId, input.sourceId);
  const scan = await loadLatestSuccessfulScan(source.id);
  const maxTables = normalizeMaxTables(input.maxTables);
  const selectedTables = buildTableSelections(scan, maxTables);
  const selectedColumns = Object.fromEntries(selectedTables.map((table) => [table.id, table.selectedColumns]));
  const flaggedTables = scan.tableProfiles
    .filter((table) => table.columns.some((column) => isHighSensitivity(column.sensitivity)))
    .map((table) => buildTableId(table.schemaName, table.tableName));
  const embeddingConfig = getEmbeddingConfig();
  const version = await nextPlanVersion(companyProfileId);

  const plan = await db.companyIngestionPlan.create({
    data: {
      companyProfileId,
      sourceId: source.id,
      status: CompanyIngestionPlanStatus.DRAFT,
      version,
      businessGoal: normalizeOptionalText(input.businessGoal),
      selectedTables: toJsonInput(selectedTables),
      selectedColumns: toJsonInput(selectedColumns),
      redactionPolicy: toJsonInput({
        excludedSensitiveColumns: scan.tableProfiles.flatMap((table) => table.columns
          .filter((column) => isHighSensitivity(column.sensitivity))
          .map((column) => ({
            tableId: buildTableId(table.schemaName, table.tableName),
            columnName: column.columnName,
          }))),
      }),
      chunkingPolicy: toJsonInput({
        mode: "catalog_table_summary_v1",
        maxTables,
      }),
      embeddingPolicy: toJsonInput({
        provider: embeddingConfig.provider,
        model: embeddingConfig.model,
        dimensions: embeddingConfig.dimensions,
      }),
      ontologyPolicy: toJsonInput(profile.ontologyConfig ?? {}),
      graphPolicy: toJsonInput({
        mode: "profile_metadata_only",
        useForeignKeys: true,
      }),
      retrievalPolicy: toJsonInput(profile.retrievalConfig ?? {}),
      plannerNotes: toJsonInput({
        scanId: scan.id,
        sourceLabel: source.label,
        flaggedTables,
        draftedAt: new Date().toISOString(),
      }),
    },
  });

  return getCreeperPlan(plan.id);
}

export async function getCreeperPlan(planId: string) {
  const plan = await db.companyIngestionPlan.findUnique({
    where: { id: planId },
    include: {
      companyProfile: {
        select: {
          id: true,
          name: true,
        },
      },
      source: {
        select: {
          id: true,
          label: true,
        },
      },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });

  if (!plan) {
    throw new Error(`Unknown ingestion plan '${planId}'.`);
  }

  return plan;
}

export async function updateCreeperPlan(input: UpdateCreeperPlanInput) {
  const existing = await getCreeperPlan(input.planId);
  const selectedTables = parsePlannedTableSelections(existing.selectedTables);
  const selectedTableIds = input.selectedTableIds;
  const nextSelectedTables = selectedTableIds
    ? selectedTables.filter((table) => selectedTableIds.includes(table.id))
    : selectedTables;
  const nextSelectedColumns = Object.fromEntries(nextSelectedTables.map((table) => [table.id, table.selectedColumns]));

  await db.companyIngestionPlan.update({
    where: { id: input.planId },
    data: {
      selectedTables: toJsonInput(nextSelectedTables),
      selectedColumns: toJsonInput(nextSelectedColumns),
      ...(input.businessGoal !== undefined ? { businessGoal: normalizeOptionalText(input.businessGoal) } : {}),
    },
  });

  return getCreeperPlan(input.planId);
}

export async function approveCreeperPlan(planId: string) {
  const plan = await getCreeperPlan(planId);

  await db.$transaction(async (tx) => {
    await tx.companyIngestionPlan.updateMany({
      where: {
        companyProfileId: plan.companyProfileId,
        id: { not: plan.id },
        status: CompanyIngestionPlanStatus.APPROVED,
      },
      data: {
        status: CompanyIngestionPlanStatus.SUPERSEDED,
      },
    });

    await tx.companyIngestionPlan.update({
      where: { id: plan.id },
      data: {
        status: CompanyIngestionPlanStatus.APPROVED,
      },
    });
  });

  return getCreeperPlan(planId);
}

export async function startCreeperIngestionRun(planId: string) {
  const plan = await getCreeperPlan(planId);
  if (plan.status !== CompanyIngestionPlanStatus.APPROVED) {
    throw new Error("Approve the plan before starting ingestion.");
  }

  const run = await db.companyIngestionRun.create({
    data: {
      planId,
      status: CompanyIngestionRunStatus.QUEUED,
      mode: "catalog_profile",
      stage: "queued",
      counters: toJsonInput({
        chunksCreated: 0,
        embeddingsCreated: 0,
        selectedTableCount: Array.isArray(plan.selectedTables) ? plan.selectedTables.length : 0,
      }),
    },
  });

  await enqueueCreeperIngestionJob({
    runId: run.id,
    planId,
    companyProfileId: plan.companyProfileId,
    sourceId: plan.sourceId,
    requestedAt: new Date().toISOString(),
  });

  return run;
}

export async function listCreeperPlans(companyProfileId: string) {
  return db.companyIngestionPlan.findMany({
    where: { companyProfileId },
    include: {
      source: {
        select: { id: true, label: true },
      },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
    orderBy: [
      { updatedAt: "desc" },
      { createdAt: "desc" },
    ],
  });
}

export function buildCompanyChunkHash(parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("\n\n")).digest("hex");
}