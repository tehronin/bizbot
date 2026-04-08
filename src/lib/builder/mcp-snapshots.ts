import { createHash } from "node:crypto";
import type { BuilderMcpSnapshot, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAgentCapabilities, getAgentRuntimeConfig } from "@/lib/agent/runtime";
import { embed, formatEmbedding } from "@/lib/embeddings/embed";
import { getMcpClientPrompts, getMcpClientResources } from "@/lib/mcp/client";
import { MCP_EMBEDDING_FORMAT_VERSION } from "@/lib/mcp/embedding-document";
import { enqueueMcpCleanupJob, enqueueMcpEmbeddingJob, shouldEnqueueMcpSnapshotJobs } from "@/lib/mcp/jobs";
import { MCP_AGENT_PROFILE } from "@/lib/mcp/tool-presentation";
import {
  buildBizBotPlatformContractSnapshot,
  classifyBizBotContractDrift,
} from "@/lib/platform/contract";
import {
  listBizBotPromptDefinitions,
  listBizBotResourceDefinitions,
  listCurrentMcpToolDescriptors,
} from "@/lib/mcp/preview-catalog";
import type {
  BuilderMcpContractDriftSectionState,
  BuilderMcpContractDriftState,
  BuilderMcpContractSnapshotState,
  BuilderMcpMappingState,
  BuilderMcpPlanningContextState,
  BuilderMcpSemanticSearchMatchState,
  BuilderMcpSemanticState,
  BuilderMcpSnapshotOverviewState,
  BuilderMcpSnapshotRecordState,
  BuilderRelevantMcpContextState,
} from "@/lib/builder/types";

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function normalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonValue(entry));
  }
  if (!value || typeof value !== "object") {
    return value ?? null;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizeJsonValue(entry)]),
  );
}

function canonicalizeJsonValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizeJsonValue(entry)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeJsonValue(entry)}`).join(",")}}`;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readMappings(value: unknown): BuilderMcpMappingState[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
    .map((entry) => entry as BuilderMcpMappingState);
}

function mergeMetadataValue(current: unknown, patch: unknown): unknown {
  const currentObject = readObject(current);
  const patchObject = readObject(patch);
  if (currentObject && patchObject) {
    return Object.fromEntries(
      Array.from(new Set([...Object.keys(currentObject), ...Object.keys(patchObject)])).map((key) => [
        key,
        mergeMetadataValue(currentObject[key], patchObject[key]),
      ]),
    );
  }

  return patch ?? current ?? null;
}

function mergeSnapshotMetadata(
  current: Record<string, unknown> | null,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return mergeMetadataValue(current ?? {}, patch) as Record<string, unknown>;
}

function deriveSemanticState(record: BuilderMcpSnapshotRecordState | null): BuilderMcpSemanticState {
  const metadata = readObject(record?.metadata);
  const enrichment = readObject(metadata?.enrichment);
  const queue = readObject(enrichment?.queue);
  const semantic = readObject(enrichment?.semantic);
  const embedding = readObject(queue?.embedding);
  const ontology = readObject(queue?.ontology);
  const cleanup = readObject(queue?.cleanup);

  const queueState = (() => {
    if (ontology?.status === "completed" || typeof semantic?.ontologySyncedAt === "string") {
      return "ontology_synced" as const;
    }
    if (embedding?.status === "completed" || typeof semantic?.embeddedAt === "string") {
      return "embedded" as const;
    }
    if (embedding?.status === "queued" || ontology?.status === "queued" || cleanup?.status === "queued") {
      return "queued" as const;
    }
    if (embedding?.status === "failed" || ontology?.status === "failed" || cleanup?.status === "failed") {
      return "failed" as const;
    }
    return "idle" as const;
  })();

  return {
    queueState,
    embeddingFormatVersion: typeof semantic?.embeddingFormatVersion === "string" ? semantic.embeddingFormatVersion : null,
    embeddedAt: typeof semantic?.embeddedAt === "string" ? semantic.embeddedAt : null,
    ontologySyncVersion: typeof semantic?.ontologySyncVersion === "string" ? semantic.ontologySyncVersion : null,
    ontologySyncedAt: typeof semantic?.ontologySyncedAt === "string" ? semantic.ontologySyncedAt : null,
    cleanupProcessedAt: typeof semantic?.cleanupProcessedAt === "string" ? semantic.cleanupProcessedAt : null,
    mappingCount: typeof semantic?.mappingCount === "number" ? semantic.mappingCount : record?.mappings.length ?? 0,
    uniqueToolCount: typeof semantic?.uniqueToolCount === "number"
      ? semantic.uniqueToolCount
      : Array.from(new Set(record?.mappings.map((mapping) => mapping.toolName) ?? [])).length,
    validatorCount: typeof semantic?.validatorCount === "number"
      ? semantic.validatorCount
      : Array.from(new Set(record?.mappings.flatMap((mapping) => mapping.validatorContext) ?? [])).length,
    activeAdrDecisionKeys: Array.isArray(semantic?.activeAdrDecisionKeys)
      ? semantic.activeAdrDecisionKeys.filter((entry): entry is string => typeof entry === "string")
      : Array.from(new Set(record?.mappings.flatMap((mapping) => mapping.activeAdrDecisionKeys) ?? [])).sort(),
    ontologyHints: Array.isArray(semantic?.ontologyHints)
      ? semantic.ontologyHints.filter((entry): entry is string => typeof entry === "string")
      : Array.from(new Set(record?.mappings.flatMap((mapping) => mapping.ontologyHints) ?? [])).sort(),
  };
}

function hasMcpRelevantArchitectureKey(key: string): boolean {
  return /(mcp|contract|tool|ontology|runtime|integration|browser)/i.test(key);
}

function buildPlanningRecommendations(drift: BuilderMcpContractDriftState): string[] {
  const recommendations: string[] = [];
  if (drift.contractChanged) {
    recommendations.push("Platform contract metadata changed; review docs, changelog entries, and version-bump expectations before continuing.");
  }
  if (drift.tools.added.length > 0) {
    recommendations.push(`Review whether newly exposed tools supersede existing architecture assumptions: ${drift.tools.added.join(", ")}.`);
  }
  if (drift.tools.removed.length > 0) {
    recommendations.push(`Revalidate tasks and ADRs that may depend on removed tools: ${drift.tools.removed.join(", ")}.`);
  }
  if (drift.tools.changed.length > 0 || drift.prompts.changed.length > 0 || drift.resources.changed.length > 0) {
    recommendations.push("Schema or descriptive contract changes were detected; reconfirm execution and prompt assumptions before planning against them.");
  }
  if (drift.profileChanged) {
    recommendations.push("Operator capability or autonomy surface changed; review approval and routing assumptions.");
  }
  if (drift.impact.requiresVersionBump) {
    recommendations.push("This drift is classified as breaking; update the platform contract changelog and review whether the contract version should advance.");
  }
  if (recommendations.length === 0) {
    recommendations.push("No contract evolution action is required for the current MCP surface.");
  }
  return recommendations;
}

function normalizeSnapshotRecord(record: BuilderMcpSnapshot): BuilderMcpSnapshotRecordState {
  const metadata = record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
    ? record.metadata as Record<string, unknown>
    : null;
  const mappings = readMappings(record.mappingsJson);

  return {
    id: record.id,
    projectId: record.projectId,
    runId: record.runId,
    taskId: record.taskId ?? null,
    taskSpecId: record.taskSpecId ?? null,
    snapshotSequence: record.snapshotSequence,
    versionHash: record.versionHash,
    snapshot: record.snapshotJson as unknown as BuilderMcpContractSnapshotState,
    mappings,
    metadata,
    appliedAt: record.appliedAt.toISOString(),
  };
}

export async function mergeBuilderMcpSnapshotMetadata(snapshotId: string, patch: Record<string, unknown>): Promise<BuilderMcpSnapshotRecordState> {
  const existing = await db.builderMcpSnapshot.findUnique({ where: { id: snapshotId } });
  if (!existing) {
    throw new Error(`Builder MCP snapshot not found: ${snapshotId}`);
  }

  const updated = await db.builderMcpSnapshot.update({
    where: { id: snapshotId },
    data: {
      metadata: toInputJsonValue(mergeSnapshotMetadata(readObject(existing.metadata), patch)),
    },
  });

  return normalizeSnapshotRecord(updated);
}

async function queueBuilderMcpSnapshotEmbedding(record: BuilderMcpSnapshotRecordState, reason: "build_complete" | "snapshot_rollover"): Promise<void> {
  if (!shouldEnqueueMcpSnapshotJobs()) {
    return;
  }

  await mergeBuilderMcpSnapshotMetadata(record.id, {
    enrichment: {
      queue: {
        embedding: {
          status: "queued",
          requestedAt: new Date().toISOString(),
          reason,
          formatVersion: MCP_EMBEDDING_FORMAT_VERSION,
        },
      },
    },
  });

  await enqueueMcpEmbeddingJob({
    projectId: record.projectId,
    snapshotSequence: record.snapshotSequence,
    snapshotId: record.id,
    reason,
    requestedAt: new Date().toISOString(),
    embeddingFormatVersion: MCP_EMBEDDING_FORMAT_VERSION,
  });
}

export async function queueBuilderMcpSnapshotCleanup(args: {
  projectId: string;
  snapshotSequence?: number | null;
  snapshotId?: string | null;
  reason?: "post_build" | "manual";
}): Promise<void> {
  if (!shouldEnqueueMcpSnapshotJobs()) {
    return;
  }

  if (args.snapshotId) {
    await mergeBuilderMcpSnapshotMetadata(args.snapshotId, {
      enrichment: {
        queue: {
          cleanup: {
            status: "queued",
            requestedAt: new Date().toISOString(),
            reason: args.reason ?? "post_build",
          },
        },
      },
    });
  }

  await enqueueMcpCleanupJob({
    projectId: args.projectId,
    snapshotSequence: args.snapshotSequence ?? undefined,
    reason: args.reason ?? "post_build",
    requestedAt: new Date().toISOString(),
  });
}

function buildSectionDrift<T>(args: {
  previous: T[];
  current: T[];
  getKey: (entry: T) => string;
  serialize: (entry: T) => string;
}): BuilderMcpContractDriftSectionState {
  const previousMap = new Map(args.previous.map((entry) => [args.getKey(entry), args.serialize(entry)]));
  const currentMap = new Map(args.current.map((entry) => [args.getKey(entry), args.serialize(entry)]));
  const previousKeys = new Set(previousMap.keys());
  const currentKeys = new Set(currentMap.keys());

  const added = Array.from(currentKeys).filter((key) => !previousKeys.has(key)).sort();
  const removed = Array.from(previousKeys).filter((key) => !currentKeys.has(key)).sort();
  const changed = Array.from(currentKeys)
    .filter((key) => previousMap.has(key) && previousMap.get(key) !== currentMap.get(key))
    .sort();

  return { added, removed, changed };
}

function dedupeNames(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

export function buildCurrentBuilderMcpContractSnapshot(): BuilderMcpContractSnapshotState {
  const runtimeConfig = getAgentRuntimeConfig();
  const tools = listCurrentMcpToolDescriptors()
    .map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      ownerId: tool.ownerId,
      ownerKind: tool.ownerKind,
      annotations: normalizeJsonValue(tool.annotations),
      parameters: normalizeJsonValue(tool.parameters),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const prompts = [
    ...listBizBotPromptDefinitions().map((prompt) => ({
      sourceKind: "builtin" as const,
      serverName: null,
      name: prompt.name,
      title: prompt.title,
      description: prompt.description,
      ownerId: prompt.ownerId,
      group: prompt.group,
      arguments: prompt.arguments
        .map((argument) => ({
          name: argument.name,
          required: argument.required ?? false,
          description: argument.description,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    })),
    ...getMcpClientPrompts().map(({ serverName, prompt }) => ({
      sourceKind: "imported" as const,
      serverName,
      name: prompt.name,
      title: prompt.title ?? prompt.name,
      description: prompt.description ?? prompt.name,
      ownerId: `mcp:${serverName}`,
      group: "imported-mcp",
      arguments: (prompt.arguments ?? [])
        .map((argument) => ({
          name: argument.name,
          required: argument.required ?? false,
          description: argument.description ?? "",
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    })),
  ].sort((left, right) => `${left.sourceKind}:${left.serverName ?? ""}:${left.name}`.localeCompare(`${right.sourceKind}:${right.serverName ?? ""}:${right.name}`));
  const resources = [
    ...listBizBotResourceDefinitions().map((resource) => ({
      sourceKind: "builtin" as const,
      serverName: null,
      name: resource.name,
      uri: resource.uri,
      title: resource.title,
      description: resource.description,
      ownerId: resource.ownerId,
      group: resource.group,
      mimeType: resource.mimeType,
    })),
    ...getMcpClientResources().map(({ serverName, resource }) => ({
      sourceKind: "imported" as const,
      serverName,
      name: resource.name ?? resource.uri,
      uri: resource.uri,
      title: resource.title ?? resource.name ?? resource.uri,
      description: resource.description ?? resource.uri,
      ownerId: `mcp:${serverName}`,
      group: "imported-mcp",
      mimeType: resource.mimeType ?? "application/octet-stream",
    })),
  ].sort((left, right) => `${left.sourceKind}:${left.serverName ?? ""}:${left.uri}`.localeCompare(`${right.sourceKind}:${right.serverName ?? ""}:${right.uri}`));

  return {
    contract: buildBizBotPlatformContractSnapshot(),
    profile: {
      agentProfile: MCP_AGENT_PROFILE,
      autonomyPreset: runtimeConfig.autonomyPreset,
      capabilities: normalizeJsonValue(getAgentCapabilities()),
    },
    tools,
    prompts,
    resources,
  };
}

export function canonicalizeBuilderMcpContractSnapshot(snapshot: BuilderMcpContractSnapshotState): string {
  return canonicalizeJsonValue(normalizeJsonValue(snapshot));
}

export function hashBuilderMcpContractSnapshot(snapshot: BuilderMcpContractSnapshotState): string {
  return createHash("sha256")
    .update(canonicalizeBuilderMcpContractSnapshot(snapshot), "utf8")
    .digest("hex");
}

export function compareBuilderMcpContractSnapshots(
  previous: BuilderMcpContractSnapshotState | null,
  current: BuilderMcpContractSnapshotState,
): BuilderMcpContractDriftState {
  const currentHash = hashBuilderMcpContractSnapshot(current);
  if (!previous) {
    const draft = {
      previousHash: null,
      currentHash,
      changed: false,
      tools: { added: [], removed: [], changed: [] },
      prompts: { added: [], removed: [], changed: [] },
      resources: { added: [], removed: [], changed: [] },
      profileChanged: false,
      contractChanged: false,
    } satisfies Omit<BuilderMcpContractDriftState, "impact">;

    return {
      ...draft,
      impact: classifyBizBotContractDrift(draft),
    };
  }

  const previousHash = hashBuilderMcpContractSnapshot(previous);
  const tools = buildSectionDrift({
    previous: previous.tools,
    current: current.tools,
    getKey: (entry) => entry.name,
    serialize: (entry) => canonicalizeJsonValue(normalizeJsonValue(entry)),
  });
  const prompts = buildSectionDrift({
    previous: previous.prompts,
    current: current.prompts,
    getKey: (entry) => `${entry.sourceKind}:${entry.serverName ?? ""}:${entry.name}`,
    serialize: (entry) => canonicalizeJsonValue(normalizeJsonValue(entry)),
  });
  const resources = buildSectionDrift({
    previous: previous.resources,
    current: current.resources,
    getKey: (entry) => `${entry.sourceKind}:${entry.serverName ?? ""}:${entry.uri}`,
    serialize: (entry) => canonicalizeJsonValue(normalizeJsonValue(entry)),
  });
  const profileChanged = canonicalizeJsonValue(normalizeJsonValue(previous.profile)) !== canonicalizeJsonValue(normalizeJsonValue(current.profile));
  const contractChanged = canonicalizeJsonValue(normalizeJsonValue(previous.contract ?? null)) !== canonicalizeJsonValue(normalizeJsonValue(current.contract));

  const draft = {
    previousHash,
    currentHash,
    changed: previousHash !== currentHash,
    tools,
    prompts,
    resources,
    profileChanged,
    contractChanged,
  } satisfies Omit<BuilderMcpContractDriftState, "impact">;

  return {
    ...draft,
    impact: classifyBizBotContractDrift(draft),
  };
}

export class BuilderMcpContractDriftError extends Error {
  readonly drift: BuilderMcpContractDriftState;
  readonly runId: string;
  readonly projectId: string;

  constructor(args: { projectId: string; runId: string; drift: BuilderMcpContractDriftState }) {
    super(`Builder MCP contract drift detected for run ${args.runId}; operator approval is required before task execution can continue.`);
    this.name = "BuilderMcpContractDriftError";
    this.projectId = args.projectId;
    this.runId = args.runId;
    this.drift = args.drift;
  }
}

export async function listBuilderMcpSnapshotsForRun(runId: string): Promise<BuilderMcpSnapshotRecordState[]> {
  const records = await db.builderMcpSnapshot.findMany({
    where: { runId },
    orderBy: [{ snapshotSequence: "desc" }, { appliedAt: "desc" }],
  });

  return records.map(normalizeSnapshotRecord);
}

export async function getLatestBuilderMcpSnapshotForRun(runId: string): Promise<BuilderMcpSnapshotRecordState | null> {
  const record = await db.builderMcpSnapshot.findFirst({
    where: { runId },
    orderBy: [{ snapshotSequence: "desc" }, { appliedAt: "desc" }],
  });

  return record ? normalizeSnapshotRecord(record) : null;
}

export async function getLatestBuilderMcpSnapshotForProject(projectId: string): Promise<BuilderMcpSnapshotRecordState | null> {
  const record = await db.builderMcpSnapshot.findFirst({
    where: { projectId },
    orderBy: [{ appliedAt: "desc" }, { snapshotSequence: "desc" }],
  });

  return record ? normalizeSnapshotRecord(record) : null;
}

export async function createBuilderMcpSnapshot(args: {
  projectId: string;
  runId: string;
  taskId?: string | null;
  taskSpecId?: string | null;
  snapshot: BuilderMcpContractSnapshotState;
  snapshotSequence: number;
  versionHash?: string;
  metadata?: Record<string, unknown> | null;
}): Promise<BuilderMcpSnapshotRecordState> {
  const record = await db.builderMcpSnapshot.create({
    data: {
      projectId: args.projectId,
      runId: args.runId,
      taskId: args.taskId ?? null,
      taskSpecId: args.taskSpecId ?? null,
      snapshotSequence: args.snapshotSequence,
      versionHash: args.versionHash ?? hashBuilderMcpContractSnapshot(args.snapshot),
      snapshotJson: toInputJsonValue(args.snapshot),
      mappingsJson: toInputJsonValue([]),
      metadata: toInputJsonValue(args.metadata ?? null),
    },
  });
  const normalized = normalizeSnapshotRecord(record);

  await queueBuilderMcpSnapshotEmbedding(
    normalized,
    args.snapshotSequence > 1 ? "snapshot_rollover" : "build_complete",
  ).catch((error) => {
    console.warn("[builder mcp snapshot] failed to queue embedding job:", error);
  });

  return normalized;
}

export async function ensureBuilderRunMcpSnapshotPreflight(args: {
  projectId: string;
  runId: string;
  taskId?: string | null;
  taskSpecId?: string | null;
}): Promise<{
  status: "captured" | "aligned";
  snapshot: BuilderMcpSnapshotRecordState;
  drift: BuilderMcpContractDriftState;
}> {
  const currentSnapshot = buildCurrentBuilderMcpContractSnapshot();
  const currentHash = hashBuilderMcpContractSnapshot(currentSnapshot);
  const latestRunSnapshot = await getLatestBuilderMcpSnapshotForRun(args.runId);
  const baselineSnapshot = latestRunSnapshot ?? await getLatestBuilderMcpSnapshotForProject(args.projectId);
  const drift = compareBuilderMcpContractSnapshots(baselineSnapshot?.snapshot ?? null, currentSnapshot);

  if (!baselineSnapshot) {
    const snapshot = await createBuilderMcpSnapshot({
      projectId: args.projectId,
      runId: args.runId,
      taskId: args.taskId,
      taskSpecId: args.taskSpecId,
      snapshot: currentSnapshot,
      snapshotSequence: 1,
      versionHash: currentHash,
      metadata: {
        reason: "initial_capture",
        contractVersion: currentSnapshot.contract.version,
      },
    });

    return { status: "captured", snapshot, drift };
  }

  if (baselineSnapshot.versionHash !== currentHash) {
    throw new BuilderMcpContractDriftError({
      projectId: args.projectId,
      runId: args.runId,
      drift,
    });
  }

  if (!latestRunSnapshot) {
    const snapshot = await createBuilderMcpSnapshot({
      projectId: args.projectId,
      runId: args.runId,
      taskId: args.taskId,
      taskSpecId: args.taskSpecId,
      snapshot: currentSnapshot,
      snapshotSequence: 1,
      versionHash: currentHash,
      metadata: {
        reason: "run_capture",
        contractVersion: currentSnapshot.contract.version,
        carriedForwardFromSnapshotId: baselineSnapshot.id,
        carriedForwardFromRunId: baselineSnapshot.runId,
      },
    });

    return { status: "captured", snapshot, drift };
  }

  return {
    status: "aligned",
    snapshot: latestRunSnapshot,
    drift,
  };
}

export async function resolveBuilderRunMcpContractDrift(args: {
  projectId: string;
  runId: string;
  taskId?: string | null;
  taskSpecId?: string | null;
  decision: "approve" | "reject";
  reason?: string | null;
}): Promise<{
  status: "aligned" | "approved" | "rejected" | "captured";
  snapshot: BuilderMcpSnapshotRecordState | null;
  drift: BuilderMcpContractDriftState;
}> {
  const currentSnapshot = buildCurrentBuilderMcpContractSnapshot();
  const currentHash = hashBuilderMcpContractSnapshot(currentSnapshot);
  const latestRunSnapshot = await getLatestBuilderMcpSnapshotForRun(args.runId);
  const baselineSnapshot = latestRunSnapshot ?? await getLatestBuilderMcpSnapshotForProject(args.projectId);
  const drift = compareBuilderMcpContractSnapshots(baselineSnapshot?.snapshot ?? null, currentSnapshot);

  if (!baselineSnapshot) {
    const snapshot = await createBuilderMcpSnapshot({
      projectId: args.projectId,
      runId: args.runId,
      taskId: args.taskId,
      taskSpecId: args.taskSpecId,
      snapshot: currentSnapshot,
      snapshotSequence: 1,
      versionHash: currentHash,
      metadata: {
        reason: "manual_capture",
        contractVersion: currentSnapshot.contract.version,
        operatorDecision: args.decision,
        operatorReason: args.reason ?? null,
      },
    });
    return { status: "captured", snapshot, drift };
  }

  if (!drift.changed) {
    if (latestRunSnapshot) {
      return { status: "aligned", snapshot: latestRunSnapshot, drift };
    }

    const snapshot = await createBuilderMcpSnapshot({
      projectId: args.projectId,
      runId: args.runId,
      taskId: args.taskId,
      taskSpecId: args.taskSpecId,
      snapshot: currentSnapshot,
      snapshotSequence: 1,
      versionHash: currentHash,
      metadata: {
        reason: "run_capture",
        contractVersion: currentSnapshot.contract.version,
        operatorDecision: args.decision,
        operatorReason: args.reason ?? null,
        carriedForwardFromSnapshotId: baselineSnapshot.id,
        carriedForwardFromRunId: baselineSnapshot.runId,
      },
    });

    return { status: "captured", snapshot, drift };
  }

  if (args.decision === "reject") {
    return { status: "rejected", snapshot: latestRunSnapshot ?? baselineSnapshot, drift };
  }

  const snapshot = await createBuilderMcpSnapshot({
    projectId: args.projectId,
    runId: args.runId,
    taskId: args.taskId ?? latestRunSnapshot?.taskId ?? baselineSnapshot.taskId,
    taskSpecId: args.taskSpecId ?? latestRunSnapshot?.taskSpecId ?? baselineSnapshot.taskSpecId,
    snapshot: currentSnapshot,
    snapshotSequence: latestRunSnapshot ? latestRunSnapshot.snapshotSequence + 1 : 1,
    versionHash: currentHash,
    metadata: {
      reason: "approved_rollover",
        contractVersion: currentSnapshot.contract.version,
      previousSnapshotId: baselineSnapshot.id,
      previousHash: baselineSnapshot.versionHash,
      operatorDecision: args.decision,
      operatorReason: args.reason ?? null,
      drift,
    },
  });

  return { status: "approved", snapshot, drift };
}

export async function appendBuilderMcpSnapshotMapping(args: {
  runId: string;
  toolName: string;
  agentRunId?: string | null;
  taskId?: string | null;
  taskSpecId?: string | null;
  validatorContext?: string[];
  activeAdrDecisionKeys?: string[];
  ontologyHints?: string[];
}): Promise<BuilderMcpMappingState | null> {
  const latestSnapshot = await db.builderMcpSnapshot.findFirst({
    where: { runId: args.runId },
    orderBy: [{ snapshotSequence: "desc" }, { appliedAt: "desc" }],
  });
  if (!latestSnapshot) {
    return null;
  }

  const tool = listCurrentMcpToolDescriptors().find((entry) => entry.name === args.toolName);
  const nextMapping: BuilderMcpMappingState = {
    toolName: args.toolName,
    toolTitle: tool?.title ?? null,
    ownerId: tool?.ownerId ?? "unknown",
    ownerKind: tool?.ownerKind ?? "unknown",
    taskId: args.taskId ?? null,
    taskSpecId: args.taskSpecId ?? null,
    builderRunId: args.runId,
    agentRunId: args.agentRunId ?? null,
    validatorContext: dedupeNames(args.validatorContext ?? []),
    activeAdrDecisionKeys: dedupeNames(args.activeAdrDecisionKeys ?? []),
    ontologyHints: dedupeNames(args.ontologyHints ?? []),
    recordedAt: new Date().toISOString(),
  };
  const existingMappings = Array.isArray(latestSnapshot.mappingsJson)
    ? readMappings(latestSnapshot.mappingsJson)
    : [];
  const duplicate = existingMappings.some((entry) =>
    entry.toolName === nextMapping.toolName
    && entry.taskId === nextMapping.taskId
    && entry.taskSpecId === nextMapping.taskSpecId
    && entry.agentRunId === nextMapping.agentRunId,
  );
  if (duplicate) {
    return existingMappings.find((entry) =>
      entry.toolName === nextMapping.toolName
      && entry.taskId === nextMapping.taskId
      && entry.taskSpecId === nextMapping.taskSpecId
      && entry.agentRunId === nextMapping.agentRunId,
    ) ?? null;
  }

  await db.builderMcpSnapshot.update({
    where: { id: latestSnapshot.id },
    data: {
      mappingsJson: toInputJsonValue([...existingMappings, nextMapping]),
    },
  });

  return nextMapping;
}

export function selectRelevantBuilderMcpContext(args: {
  mode: "analysis_only" | "scaffold" | "implementation" | "verification";
  validators?: string[];
  template: string;
  architecturalDecisionKeys?: string[];
}): BuilderRelevantMcpContextState {
  const snapshot = buildCurrentBuilderMcpContractSnapshot();
  const currentHash = hashBuilderMcpContractSnapshot(snapshot);
  const decisionKeys = dedupeNames(args.architecturalDecisionKeys ?? []);
  const validators = dedupeNames(args.validators ?? []);
  const reasons = [
    `mode:${args.mode}`,
    `template:${args.template}`,
    ...validators.map((validator) => `validator:${validator.toLowerCase()}`),
    ...decisionKeys.map((key) => `adr:${key}`),
  ];

  const selectedToolNames = new Set<string>([
    "builder_get_project",
    "builder_list_files",
    "builder_read_file",
  ]);
  const selectedResourceUris = new Set<string>([
    "bizbot://builder/current-project",
    "bizbot://builder/current-plan",
  ]);
  const selectedPromptNames = new Set<string>();

  if (args.mode === "analysis_only") {
    selectedToolNames.add("builder_write_project_instructions");
    selectedToolNames.add("developer_preview_mcp_exposure");
    selectedToolNames.add("developer_preview_tool_descriptor");
  }
  if (args.mode === "scaffold" || args.mode === "implementation") {
    selectedToolNames.add("builder_write_file");
    selectedToolNames.add("builder_create_directory");
    selectedToolNames.add("builder_add_dependency");
    selectedToolNames.add("builder_run_script");
  }
  if (args.mode === "verification") {
    selectedToolNames.add("builder_run_script");
    selectedToolNames.add("builder_get_run");
    selectedPromptNames.add("debug-runtime");
    selectedResourceUris.add("bizbot://builder/current-review");
    selectedResourceUris.add("bizbot://builder/current-runs");
  }
  if (validators.some((validator) => ["build", "test", "lint", "typecheck"].includes(validator.toLowerCase()))) {
    selectedToolNames.add("builder_run_script");
    selectedResourceUris.add("bizbot://builder/current-runs");
  }
  if (decisionKeys.some((key) => /mcp|contract|ontology|architecture|adr/.test(key))) {
    selectedToolNames.add("developer_preview_mcp_exposure");
    selectedToolNames.add("developer_preview_prompt");
    selectedToolNames.add("developer_preview_resource");
    selectedResourceUris.add("bizbot://plugins/mcp-surface-preview");
    selectedResourceUris.add("bizbot://ontology/schema");
    selectedResourceUris.add("bizbot://ontology/runtime-context-policy");
  }
  if (args.template === "next-app" || args.template === "vite-app") {
    selectedToolNames.add("builder_add_dependency");
    selectedToolNames.add("builder_run_script");
  }

  return {
    currentHash,
    tools: snapshot.tools.filter((tool) => selectedToolNames.has(tool.name)),
    prompts: snapshot.prompts.filter((prompt) => selectedPromptNames.has(prompt.name)),
    resources: snapshot.resources.filter((resource) => selectedResourceUris.has(resource.uri)),
    reasons,
  };
}

export async function getBuilderMcpPlanningContext(args: {
  projectId: string;
  architectureDecisionKeys?: string[];
}): Promise<BuilderMcpPlanningContextState | null> {
  const baselineSnapshot = await getLatestBuilderMcpSnapshotForProject(args.projectId);
  if (!baselineSnapshot) {
    return null;
  }

  const currentSnapshot = buildCurrentBuilderMcpContractSnapshot();
  const currentHash = hashBuilderMcpContractSnapshot(currentSnapshot);
  const drift = compareBuilderMcpContractSnapshots(baselineSnapshot.snapshot, currentSnapshot);
  const relatedArchitectureDecisionKeys = dedupeNames([
    ...(args.architectureDecisionKeys ?? []),
    ...baselineSnapshot.mappings.flatMap((mapping) => mapping.activeAdrDecisionKeys),
  ]).filter(hasMcpRelevantArchitectureKey);

  return {
    baselineSnapshotId: baselineSnapshot.id,
    baselineSnapshotSequence: baselineSnapshot.snapshotSequence,
    baselineHash: baselineSnapshot.versionHash,
    currentHash,
    driftDetected: drift.changed,
    relatedArchitectureDecisionKeys,
    recommendations: buildPlanningRecommendations(drift),
    summary: drift.changed
      ? `MCP contract drift exists between accepted snapshot sequence ${baselineSnapshot.snapshotSequence} and the live contract.`
      : `Live MCP contract remains aligned with accepted snapshot sequence ${baselineSnapshot.snapshotSequence}.`,
    drift: drift.changed ? drift : null,
  };
}

export async function loadBuilderMcpSnapshotForJob(args: {
  projectId: string;
  snapshotSequence: number;
  snapshotId?: string;
}): Promise<BuilderMcpSnapshotRecordState | null> {
  const record = args.snapshotId
    ? await db.builderMcpSnapshot.findUnique({ where: { id: args.snapshotId } })
    : await db.builderMcpSnapshot.findFirst({
        where: {
          projectId: args.projectId,
          snapshotSequence: args.snapshotSequence,
        },
        orderBy: [{ appliedAt: "desc" }],
      });
  if (!record || record.projectId !== args.projectId || record.snapshotSequence !== args.snapshotSequence) {
    return null;
  }

  return normalizeSnapshotRecord(record);
}

export async function storeBuilderMcpSnapshotEmbedding(args: {
  snapshotId: string;
  embedding: number[];
  formatVersion: string;
}): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE "mcp_snapshots"
     SET "snapshotEmbedding" = $1::vector,
         "updatedAt" = NOW()
     WHERE id = $2`,
    formatEmbedding(args.embedding),
    args.snapshotId,
  );

  await mergeBuilderMcpSnapshotMetadata(args.snapshotId, {
    enrichment: {
      semantic: {
        embeddingFormatVersion: args.formatVersion,
        embeddedAt: new Date().toISOString(),
      },
      queue: {
        embedding: {
          status: "completed",
          formatVersion: args.formatVersion,
          finishedAt: new Date().toISOString(),
        },
      },
    },
  });
}

export async function searchBuilderMcpSnapshotHistory(args: {
  projectId: string;
  query: string;
  limit?: number;
}): Promise<BuilderMcpSemanticSearchMatchState[]> {
  const embedding = await embed(args.query, "query");
  const embeddingStr = formatEmbedding(embedding);
  const limit = Math.max(1, Math.min(Math.trunc(args.limit ?? 5), 20));

  try {
    return (await db.$queryRawUnsafe(
      `SELECT
         id AS "snapshotId",
         "runId" AS "runId",
         "snapshotSequence" AS "snapshotSequence",
         "versionHash" AS "versionHash",
         1 - ("snapshotEmbedding" <=> $1::vector) AS similarity,
         to_char("appliedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "appliedAt"
       FROM "mcp_snapshots"
       WHERE "projectId" = $2
         AND "snapshotEmbedding" IS NOT NULL
       ORDER BY "snapshotEmbedding" <=> $1::vector
       LIMIT $3`,
      embeddingStr,
      args.projectId,
      limit,
    )) as BuilderMcpSemanticSearchMatchState[];
  } catch {
    return [];
  }
}

export async function getBuilderMcpSnapshotOverview(args: {
  projectId: string;
  runId?: string | null;
}): Promise<BuilderMcpSnapshotOverviewState> {
  const targetRunId = args.runId ?? null;
  if (!targetRunId) {
    const projectBaseline = await getLatestBuilderMcpSnapshotForProject(args.projectId);
    const planning = await getBuilderMcpPlanningContext({ projectId: args.projectId });
    return {
      activeRunId: null,
      currentSnapshotId: projectBaseline?.id ?? null,
      currentSequence: projectBaseline?.snapshotSequence ?? null,
      currentHash: projectBaseline?.versionHash ?? null,
      state: projectBaseline ? "captured" : "pending_capture",
      history: projectBaseline ? [projectBaseline] : [],
      drift: null,
      semantic: deriveSemanticState(projectBaseline),
      semanticMatches: [],
      planning,
    };
  }

  const history = await listBuilderMcpSnapshotsForRun(targetRunId);
  const latestSnapshot = history[0] ?? null;
  if (!latestSnapshot) {
    const projectBaseline = await getLatestBuilderMcpSnapshotForProject(args.projectId);
    const drift = projectBaseline
      ? compareBuilderMcpContractSnapshots(projectBaseline.snapshot, buildCurrentBuilderMcpContractSnapshot())
      : null;
    const planning = await getBuilderMcpPlanningContext({ projectId: args.projectId });
    return {
      activeRunId: targetRunId,
      currentSnapshotId: null,
      currentSequence: projectBaseline?.snapshotSequence ?? null,
      currentHash: hashBuilderMcpContractSnapshot(buildCurrentBuilderMcpContractSnapshot()),
      state: drift?.changed ? "drifted" : projectBaseline ? "captured" : "pending_capture",
      history,
      drift: drift?.changed ? drift : null,
      semantic: deriveSemanticState(projectBaseline),
      semanticMatches: [],
      planning,
    };
  }

  const drift = compareBuilderMcpContractSnapshots(latestSnapshot.snapshot, buildCurrentBuilderMcpContractSnapshot());
  const planning = await getBuilderMcpPlanningContext({
    projectId: args.projectId,
    architectureDecisionKeys: latestSnapshot.mappings.flatMap((mapping) => mapping.activeAdrDecisionKeys),
  });
  const semanticMatches = deriveSemanticState(latestSnapshot).embeddedAt
    ? (await searchBuilderMcpSnapshotHistory({
        projectId: args.projectId,
        query: `${latestSnapshot.versionHash} ${latestSnapshot.snapshot.tools.map((tool) => tool.name).join(" ")}`,
        limit: 3,
      })).filter((match) => match.snapshotId !== latestSnapshot.id)
    : [];
  return {
    activeRunId: targetRunId,
    currentSnapshotId: latestSnapshot.id,
    currentSequence: latestSnapshot.snapshotSequence,
    currentHash: drift.currentHash,
    state: drift.changed ? "drifted" : history.length > 1 ? "aligned" : "captured",
    history,
    drift: drift.changed ? drift : null,
    semantic: deriveSemanticState(latestSnapshot),
    semanticMatches,
    planning,
  };
}