import { db } from "@/lib/db";
import { updateConversationCompanyProfile } from "@/lib/agent/memory";
import { approveCreeperPlan, getCreeperPlan, startCreeperIngestionRun, updateCreeperPlan, type PlannedTableSelection } from "@/lib/creeper/plans";
import type { JsonValue } from "@/lib/agent/tools";
import { registerSidecarInteractionHandler } from "@/lib/sidecar/router";
import { applySidecarContextPatchForConversation } from "@/lib/sidecar/state";
import { createValidatedSidecarPanel } from "@/lib/sidecar/validation";
import type { SidecarSelectionContent, SidecarToolResult } from "@/lib/sidecar/types";
import { buildMaskedConnectionSummary } from "@/lib/creeper/sources";
import { getCreeperCompanyProfile, listCreeperCompanyProfiles } from "@/lib/creeper/profiles";

function cloneSelectionContent(content: SidecarSelectionContent, selectedItemIds: string[]): SidecarSelectionContent {
  return {
    ...content,
    items: content.items.map((item) => ({ ...item })),
    actions: content.actions.map((action) => ({ ...action })),
    interaction: { ...content.interaction },
    selectedItemIds,
  };
}

function toSidecarJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function parsePlannedTableSelections(value: unknown): PlannedTableSelection[] {
  return Array.isArray(value) ? value as unknown as PlannedTableSelection[] : [];
}

const CREEPER_PLAN_CONTEXT_ID = "creeper.plan.review";
const CREEPER_PLAN_CONTEXT_KEYS = [
  "selectedTableIds",
  "selectedTableCount",
  "selectedTableSummary",
  "companyName",
  "sourceLabel",
  "planVersion",
  "planStatus",
  "ingestionRunId",
] as const;

function formatSelectedTableSummary(selectedTables: PlannedTableSelection[]): string {
  if (selectedTables.length === 0) {
    return "No tables selected";
  }

  if (selectedTables.length <= 3) {
    return selectedTables.map((table) => table.id).join(", ");
  }

  return `${selectedTables.slice(0, 3).map((table) => table.id).join(", ")} +${selectedTables.length - 3} more`;
}

function buildPlanContextValues(input: {
  companyName: string;
  sourceLabel: string;
  planVersion: number;
  planStatus: string;
  selectedTables: PlannedTableSelection[];
  ingestionRunId?: string;
}): Record<string, JsonValue> {
  return {
    selectedTableIds: input.selectedTables.map((table) => table.id),
    selectedTableCount: input.selectedTables.length,
    selectedTableSummary: formatSelectedTableSummary(input.selectedTables),
    companyName: input.companyName,
    sourceLabel: input.sourceLabel,
    planVersion: input.planVersion,
    planStatus: input.planStatus,
    ...(input.ingestionRunId ? { ingestionRunId: input.ingestionRunId } : {}),
  };
}

function buildCreeperIngestionQueuedSidecar(): SidecarToolResult {
  return {
    ok: true,
    action: "open",
    panel: createValidatedSidecarPanel({
      title: "Creeper ingestion queued",
      persistence: "ephemeral",
      context: {
        contextId: CREEPER_PLAN_CONTEXT_ID,
        readKeys: [...CREEPER_PLAN_CONTEXT_KEYS],
      },
      content: {
        type: "markdown",
        markdown: "## Ingestion queued for {{companyName}}\n\n- Run: {{ingestionRunId}}\n- Plan version: {{planVersion}}\n- Status: {{planStatus}}\n- Source: {{sourceLabel}}\n- Selected tables: {{selectedTableCount}}\n- Table summary: {{selectedTableSummary}}",
      },
    }),
  };
}

function formatOverviewMarkdown(input: {
  companyName: string;
  sourceLabel: string;
  status: string;
  connectionSummary: ReturnType<typeof buildMaskedConnectionSummary>;
  lastTestedAt: Date | null;
  lastProfiledAt: Date | null;
  latestScanSummary: unknown;
}): string {
  const lines: string[] = [
    `## ${input.companyName}`,
    "",
    `**Source:** ${input.sourceLabel}`,
    `**Status:** ${input.status}`,
    `**Database:** ${input.connectionSummary.host}:${input.connectionSummary.port}/${input.connectionSummary.database}`,
    `**User:** ${input.connectionSummary.username}`,
    `**SSL:** ${input.connectionSummary.sslMode} · rejectUnauthorized=${input.connectionSummary.sslRejectUnauthorized ? "true" : "false"}`,
    `**Allowed schemas:** ${input.connectionSummary.allowedSchemas.length > 0 ? input.connectionSummary.allowedSchemas.join(", ") : "all non-system schemas"}`,
    `**Last tested:** ${input.lastTestedAt ? input.lastTestedAt.toISOString() : "Never"}`,
    `**Last profiled:** ${input.lastProfiledAt ? input.lastProfiledAt.toISOString() : "Never"}`,
  ];

  if (input.latestScanSummary && typeof input.latestScanSummary === "object") {
    const summary = input.latestScanSummary as Record<string, unknown>;
    lines.push("", "### Latest scan");
    if (typeof summary.schemaCount === "number") {
      lines.push(`- Schemas: ${summary.schemaCount}`);
    }
    if (typeof summary.tableCount === "number") {
      lines.push(`- Tables: ${summary.tableCount}`);
    }
    if (typeof summary.columnCount === "number") {
      lines.push(`- Columns: ${summary.columnCount}`);
    }
    if (typeof summary.flaggedTableCount === "number") {
      lines.push(`- Flagged tables: ${summary.flaggedTableCount}`);
    }
  }

  return lines.join("\n");
}

export async function buildCreeperSourceOverviewSidecar(sourceId: string): Promise<SidecarToolResult> {
  const source = await db.externalDataSource.findUnique({
    where: { id: sourceId },
    include: {
      companyProfiles: {
        include: {
          companyProfile: true,
        },
        orderBy: { createdAt: "asc" },
      },
      scans: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!source) {
    throw new Error(`Unknown source '${sourceId}'.`);
  }

  const primaryBinding = source.companyProfiles.find((entry) => entry.isPrimary) ?? source.companyProfiles[0];
  const companyName = primaryBinding?.companyProfile.name ?? "Unbound company";
  const connectionSummary = buildMaskedConnectionSummary(source);

  return {
    ok: true,
    action: "open",
    panel: createValidatedSidecarPanel({
      panelId: `creeper-source-${source.id}`,
      title: `${companyName} source overview`,
      persistence: "sticky",
      content: {
        type: "markdown",
        markdown: formatOverviewMarkdown({
          companyName,
          sourceLabel: source.label,
          status: source.status,
          connectionSummary,
          lastTestedAt: source.lastTestedAt,
          lastProfiledAt: source.lastProfiledAt,
          latestScanSummary: source.scans[0]?.summary ?? null,
        }),
      },
    }),
  };
}

export async function buildCreeperSchemaCatalogSidecar(sourceId: string): Promise<SidecarToolResult> {
  const latestScan = await db.sourceScan.findFirst({
    where: { sourceId },
    orderBy: { createdAt: "desc" },
    include: {
      tableProfiles: {
        orderBy: [
          { ingestionScore: "desc" },
          { schemaName: "asc" },
          { tableName: "asc" },
        ],
        take: 24,
      },
    },
  });

  if (!latestScan) {
    throw new Error("No stored scan is available for this source yet.");
  }

  return {
    ok: true,
    action: "open",
    panel: createValidatedSidecarPanel({
      panelId: `creeper-schema-${sourceId}`,
      title: "Creeper schema catalog",
      persistence: "sticky",
      content: {
        type: "json",
        value: toSidecarJsonValue({
          scanId: latestScan.id,
          tables: latestScan.tableProfiles.map((table) => ({
            schemaName: table.schemaName,
            tableName: table.tableName,
            tableType: table.tableType,
            estimatedRowCount: table.estimatedRowCount,
            ingestionScore: table.ingestionScore,
            classification: table.classification,
          })),
        }),
      },
    }),
  };
}

function formatCompanyBriefMarkdown(profile: Awaited<ReturnType<typeof getCreeperCompanyProfile>>): string {
  const retrievalConfig = profile.retrievalConfig && typeof profile.retrievalConfig === "object" && !Array.isArray(profile.retrievalConfig)
    ? profile.retrievalConfig as {
      desiredOutcomes?: unknown;
      includeDomains?: unknown;
      excludeDomains?: unknown;
      timeHorizon?: unknown;
      notes?: unknown;
      onboardingStatus?: unknown;
    }
    : {};
  const ontologyConfig = profile.ontologyConfig && typeof profile.ontologyConfig === "object" && !Array.isArray(profile.ontologyConfig)
    ? profile.ontologyConfig as {
      importantConcepts?: unknown;
    }
    : {};

  const desiredOutcomes = Array.isArray(retrievalConfig.desiredOutcomes) ? retrievalConfig.desiredOutcomes as string[] : [];
  const includeDomains = Array.isArray(retrievalConfig.includeDomains) ? retrievalConfig.includeDomains as string[] : [];
  const excludeDomains = Array.isArray(retrievalConfig.excludeDomains) ? retrievalConfig.excludeDomains as string[] : [];
  const importantConcepts = Array.isArray(ontologyConfig.importantConcepts) ? ontologyConfig.importantConcepts as string[] : [];

  const lines: string[] = [
    `## ${profile.name}`,
    "",
    `**Status:** ${profile.status}`,
    `**Description:** ${profile.description ?? "Not provided yet."}`,
    `**Onboarding:** ${typeof retrievalConfig.onboardingStatus === "string" ? retrievalConfig.onboardingStatus : "not started"}`,
    `**Time horizon:** ${typeof retrievalConfig.timeHorizon === "string" && retrievalConfig.timeHorizon.trim() ? retrievalConfig.timeHorizon : "Open-ended"}`,
    `**Sources:** ${profile.sources.length}`,
    `**Plans:** ${profile.ingestionPlans.length}`,
  ];

  if (desiredOutcomes.length > 0) {
    lines.push("", "### Desired outcomes");
    for (const item of desiredOutcomes) {
      lines.push(`- ${item}`);
    }
  }

  if (includeDomains.length > 0) {
    lines.push("", "### Include domains");
    for (const item of includeDomains) {
      lines.push(`- ${item}`);
    }
  }

  if (excludeDomains.length > 0) {
    lines.push("", "### Exclude domains");
    for (const item of excludeDomains) {
      lines.push(`- ${item}`);
    }
  }

  if (importantConcepts.length > 0) {
    lines.push("", "### Important concepts");
    for (const item of importantConcepts) {
      lines.push(`- ${item}`);
    }
  }

  if (typeof retrievalConfig.notes === "string" && retrievalConfig.notes.trim()) {
    lines.push("", "### Notes", retrievalConfig.notes.trim());
  }

  return lines.join("\n");
}

export async function buildCreeperCompanyProfileSelectorSidecar(): Promise<SidecarToolResult> {
  const profiles = await listCreeperCompanyProfiles(24);

  if (profiles.length === 0) {
    return {
      ok: true,
      action: "open",
      panel: createValidatedSidecarPanel({
        panelId: "creeper-company-selector-empty",
        title: "Creeper company profiles",
        persistence: "workflow",
        content: {
          type: "markdown",
          markdown: "## No company profiles yet\n\nStart a new company in chat by telling Creeper the company name, what the business does, and what you want to learn from the data.",
        },
      }),
    };
  }

  return {
    ok: true,
    action: "open",
    panel: createValidatedSidecarPanel({
      panelId: "creeper-company-selector",
      title: "Creeper company profiles",
      persistence: "workflow",
      content: {
        type: "selection",
        title: "Open an existing company or start a new one",
        description: "Choose an existing company profile to continue building, or close this panel and start a new company in chat.",
        selectionMode: "single",
        items: profiles.map((profile) => ({
          id: profile.id,
          title: profile.name,
          description: `${profile.sourceCount} sources · ${profile.planCount} plans · ${profile.status}`,
        })),
        actions: [
          { id: "creeper_company_toggle", label: "Choose", kind: "toggle" },
          { id: "creeper_company_apply", label: "Review selected", kind: "apply" },
          { id: "creeper_company_clear", label: "Clear", kind: "clear" },
          { id: "creeper_company_close", label: "Close", kind: "close" },
        ],
        interaction: { routeKey: "creeper.company-profile.select" },
      },
    }),
  };
}

export async function buildCreeperCompanyBriefReviewSidecar(companyProfileId: string): Promise<SidecarToolResult> {
  const profile = await getCreeperCompanyProfile(companyProfileId);

  return {
    ok: true,
    action: "open",
    panel: createValidatedSidecarPanel({
      panelId: `creeper-company-${profile.id}`,
      title: `${profile.name} brief review`,
      persistence: "sticky",
      content: {
        type: "markdown",
        markdown: formatCompanyBriefMarkdown(profile),
      },
    }),
  };
}

function parsePlanPanelId(panelId: string): string {
  const prefix = "creeper-plan-";
  if (!panelId.startsWith(prefix)) {
    throw new Error("Invalid Creeper plan panel id.");
  }

  return panelId.slice(prefix.length);
}

function formatPlanDescription(table: PlannedTableSelection): string {
  return [
    table.estimatedRowCount !== null ? `${table.estimatedRowCount} rows est.` : "row count unknown",
    table.ingestionScore !== null ? `score ${table.ingestionScore}` : null,
    `${table.selectedColumns.length} columns`,
  ].filter(Boolean).join(" · ");
}

export async function buildCreeperPlanReviewSidecar(planId: string): Promise<SidecarToolResult> {
  const plan = await getCreeperPlan(planId);
  const selectedTables = parsePlannedTableSelections(plan.selectedTables);

  return {
    ok: true,
    action: "open",
    panel: createValidatedSidecarPanel({
      panelId: `creeper-plan-${plan.id}`,
      title: `${plan.companyProfile.name} ingestion plan v${plan.version}`,
      persistence: "workflow",
      context: {
        contextId: CREEPER_PLAN_CONTEXT_ID,
        readKeys: [...CREEPER_PLAN_CONTEXT_KEYS],
        writeKeys: [...CREEPER_PLAN_CONTEXT_KEYS],
        selectionKey: "selectedTableIds",
      },
      content: {
        type: "selection",
        title: `${plan.companyProfile.name} ingestion plan`,
        description: `Status ${plan.status} · source ${plan.source.label}${plan.businessGoal ? ` · goal ${plan.businessGoal}` : ""}`,
        selectionMode: "multiple",
        items: selectedTables.map((table) => ({
          id: table.id,
          title: table.id,
          description: formatPlanDescription(table),
        })),
        selectedItemIds: selectedTables.map((table) => table.id),
        actions: [
          { id: "creeper_plan_toggle", label: "Choose tables", kind: "toggle" },
          { id: "creeper_plan_save", label: "Save plan", kind: "apply" },
          { id: "creeper_plan_approve", label: "Approve", kind: "apply" },
          { id: "creeper_plan_start", label: "Start ingestion", kind: "apply" },
          { id: "creeper_plan_clear", label: "Clear", kind: "clear" },
          { id: "creeper_plan_close", label: "Close", kind: "close" },
        ],
        interaction: { routeKey: "creeper.plan.review" },
      },
    }),
  };
}

registerSidecarInteractionHandler("creeper.company-profile.select", async (context) => {
  if (context.action.kind === "toggle") {
    return {
      ok: true,
      action: "update",
      panel: createValidatedSidecarPanel({
        panelId: context.panel.panelId,
        title: context.panel.title,
        content: cloneSelectionContent(context.panel.content as SidecarSelectionContent, context.selectedItemIds),
      }),
    };
  }

  if (context.action.kind === "clear") {
    return {
      ok: true,
      action: "update",
      panel: createValidatedSidecarPanel({
        panelId: context.panel.panelId,
        title: context.panel.title,
        content: cloneSelectionContent(context.panel.content as SidecarSelectionContent, []),
      }),
    };
  }

  if (context.action.kind === "close") {
    return { ok: true, action: "close", panel: null };
  }

  const companyProfileId = context.selectedItemIds[0];
  if (!companyProfileId) {
    throw new Error("Choose a company profile before continuing.");
  }

  await updateConversationCompanyProfile(context.conversationId, companyProfileId);

  const sidecar = await buildCreeperCompanyBriefReviewSidecar(companyProfileId);
  return {
    ok: true,
    action: "update",
    panel: sidecar.panel,
  };
});

registerSidecarInteractionHandler("creeper.plan.review", async (context) => {
  if (context.action.kind === "toggle") {
    return {
      ok: true,
      action: "update",
      panel: createValidatedSidecarPanel({
        panelId: context.panel.panelId,
        title: context.panel.title,
        ...(context.panel.persistence ? { persistence: context.panel.persistence } : {}),
        ...(context.panel.context ? { context: context.panel.context } : {}),
        content: cloneSelectionContent(context.panel.content as SidecarSelectionContent, []),
      }),
    };
  }

  if (context.action.kind === "clear") {
    return {
      ok: true,
      action: "update",
      panel: createValidatedSidecarPanel({
        panelId: context.panel.panelId,
        title: context.panel.title,
        ...(context.panel.persistence ? { persistence: context.panel.persistence } : {}),
        ...(context.panel.context ? { context: context.panel.context } : {}),
        content: cloneSelectionContent(context.panel.content as SidecarSelectionContent, []),
      }),
    };
  }

  if (context.action.kind === "close") {
    return { ok: true, action: "close", panel: null };
  }

  const planId = parsePlanPanelId(context.panel.panelId);
  const selectedTableIds = [...context.selectedItemIds];
  const updatedPlan = await updateCreeperPlan({ planId, selectedTableIds });
  const updatedSelectedTables = parsePlannedTableSelections(updatedPlan.selectedTables);

  if (context.action.id === "creeper_plan_save") {
    applySidecarContextPatchForConversation({
      conversationId: context.conversationId,
      panel: context.panel,
      contextPatch: {
        contextId: CREEPER_PLAN_CONTEXT_ID,
        values: buildPlanContextValues({
          companyName: updatedPlan.companyProfile.name,
          sourceLabel: updatedPlan.source.label,
          planVersion: updatedPlan.version,
          planStatus: String(updatedPlan.status),
          selectedTables: updatedSelectedTables,
        }),
      },
    });
    const sidecar = await buildCreeperPlanReviewSidecar(updatedPlan.id);
    return { ok: true, action: "update", panel: sidecar.panel };
  }

  if (context.action.id === "creeper_plan_approve") {
    const approvedPlan = await approveCreeperPlan(updatedPlan.id);
    applySidecarContextPatchForConversation({
      conversationId: context.conversationId,
      panel: context.panel,
      contextPatch: {
        contextId: CREEPER_PLAN_CONTEXT_ID,
        values: buildPlanContextValues({
          companyName: approvedPlan.companyProfile.name,
          sourceLabel: approvedPlan.source.label,
          planVersion: approvedPlan.version,
          planStatus: String(approvedPlan.status),
          selectedTables: parsePlannedTableSelections(approvedPlan.selectedTables),
        }),
      },
    });
    const sidecar = await buildCreeperPlanReviewSidecar(approvedPlan.id);
    return { ok: true, action: "update", panel: sidecar.panel };
  }

  if (context.action.id === "creeper_plan_start") {
    const planToRun = updatedPlan.status === "APPROVED" ? updatedPlan : await approveCreeperPlan(updatedPlan.id);
    const run = await startCreeperIngestionRun(planToRun.id);
    applySidecarContextPatchForConversation({
      conversationId: context.conversationId,
      panel: context.panel,
      contextPatch: {
        contextId: CREEPER_PLAN_CONTEXT_ID,
        values: buildPlanContextValues({
          companyName: planToRun.companyProfile.name,
          sourceLabel: planToRun.source.label,
          planVersion: planToRun.version,
          planStatus: String(planToRun.status),
          selectedTables: parsePlannedTableSelections(planToRun.selectedTables),
          ingestionRunId: run.id,
        }),
      },
    });
    return buildCreeperIngestionQueuedSidecar();
  }

  throw new Error(`Unsupported Creeper plan action '${context.action.id}'.`);
});
