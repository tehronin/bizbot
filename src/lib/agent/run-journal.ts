import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LLMProvider } from "@/lib/agent/kernel";
import { getWorkspacePath } from "@/lib/files/workspace";
import {
  getAgentProfileDescriptor,
  type AgentProfile,
} from "@/lib/agent/profiles";
import type { ChatMessage, JsonObject } from "@/lib/agent/tools";
import { normalizeFailure, type FailureEnvelope } from "@/lib/failures";
import { createToolCallResumeSignature, isToolExecutionResumeSafe } from "@/lib/agent/resume";

const RUNS_DIR = path.join(".bizbot", "agent-runs");
const RESULT_PREVIEW_MAX_CHARS = 1_200;

export type AgentRunStatus = "running" | "completed" | "failed" | "cancelled" | "max_tool_rounds";

export interface AgentRunToolEvent {
  timestamp: string;
  phase: "call" | "result";
  round: number;
  toolCallId: string;
  name: string;
  args?: JsonObject;
  resultPreview?: string;
  isError?: boolean;
  failure?: FailureEnvelope;
}

export interface AgentRunRetrievalDecision {
  included: boolean;
  reason: string;
  resultCount: number;
  chars: number;
}

export interface AgentRunPromptAssembly {
  capabilitySummaryChars: number;
  runtimeToolVisibilityChars: number;
  explicitMemoryChars: number;
  ontologyChars: number;
  attachmentContextChars: number;
  conversationSummaryChars: number;
  recentConversationChars: number;
  semanticRecallChars: number;
  graphChars: number;
  knowledgeDocsChars: number;
  contextChars: number;
  systemPromptChars: number;
  userMessageChars: number;
}

export interface AgentRunRoundUsage {
  round: number;
  provider: LLMProvider;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
}

export interface AgentRunUsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
  rounds: AgentRunRoundUsage[];
}

export interface AgentRunSwarmSourceSummary {
  id: string;
  sourceKind: string;
  title: string;
  chars: number;
}

export interface AgentRunSwarmPlanSummary {
  id: string;
  mode: string;
  reason: string;
  taskSummary: string;
  workerCount: number;
  aggregationStrategy: string;
  failurePolicy: string;
  plannerConfidence: number;
  createdAt: string;
}

export interface AgentRunSwarmWorkerSummary {
  workItemId: string;
  status: string;
  diagnostics: string[];
  durationMs: number;
}

export interface AgentRunSwarmRecord {
  activated: boolean;
  mode?: string;
  reason?: string;
  plannerConfidence?: number;
  sources?: AgentRunSwarmSourceSummary[];
  plan?: AgentRunSwarmPlanSummary;
  trace?: {
    planId: string;
    mode: string;
    workerCount: number;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
  };
  validation?: {
    valid: boolean;
    issues: string[];
    completedWorkItemIds: string[];
    failedWorkItemIds: string[];
    missingWorkItemIds: string[];
  };
  workerResults?: AgentRunSwarmWorkerSummary[];
  synthesis?: {
    sourceCoverage: Array<{ sourceId: string; sourceKind: string; claimCount: number; summaryPresent: boolean }>;
    contradictionCount: number;
    evidenceRefCount: number;
    gapCount: number;
    auditNeeded: boolean;
  };
  audit?: {
    passed: boolean;
    unsupportedSentences: string[];
    contradictionReminderMissing: boolean;
    evidenceCoverage: number;
    summary: string;
  };
}

export interface AgentRunRecord {
  runId: string;
  conversationId: string;
  profile: AgentProfile;
  profileLabel: string;
  profileMission: string;
  provider: LLMProvider;
  model: string;
  status: AgentRunStatus;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  userMessage: string;
  availableTools: string[];
  delegationTargets: AgentProfile[];
  parentRunId?: string;
  childRunIds: string[];
  delegationReason?: string;
  delegatedByProfile?: AgentProfile;
  toolPolicy: {
    allowedPrefixes: string[];
    allowedTools: string[];
    deniedTools: string[];
  };
  roundsCompleted: number;
  toolCallCount: number;
  toolEvents: AgentRunToolEvent[];
  promptAssembly?: AgentRunPromptAssembly;
  retrieval?: {
    conversationSummary: AgentRunRetrievalDecision;
    recentConversation: AgentRunRetrievalDecision;
    semanticRecall: AgentRunRetrievalDecision;
    graph: AgentRunRetrievalDecision;
    knowledgeDocs: AgentRunRetrievalDecision;
  };
  swarm?: AgentRunSwarmRecord;
  usage: AgentRunUsageTotals;
  reply?: string;
  error?: string;
  failure?: FailureEnvelope;
  snapshot: AgentRunResumeSnapshot;
  resumedFromRunId?: string;
}

export type AgentRunResumePendingStatus = "idle" | "awaiting_model" | "awaiting_tool_results" | "interrupted" | "completed";

export interface AgentRunSnapshotToolCall {
  signature: string;
  round: number;
  toolCallId: string;
  name: string;
  args: JsonObject;
  result: string;
  isError: boolean;
  failure?: FailureEnvelope;
  resumeSafe: boolean;
}

export interface AgentRunResumeSnapshot {
  version: 1;
  lastStableRound: number;
  pendingRound: number | null;
  pendingRoundStatus: AgentRunResumePendingStatus;
  stableMessages: ChatMessage[];
  completedToolCalls: AgentRunSnapshotToolCall[];
  resumeEligible: boolean;
  resumeBlockedReason: string | null;
  finalFailure?: FailureEnvelope;
  resumedFromRunId?: string;
}

export interface UsageLedgerEntry {
  id: string;
  day: string;
  provider: LLMProvider;
  model: string;
  runCount: number;
  requestCount: number;
  startedAt: string;
  updatedAt: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
  averageTokensPerRun: number;
  averageTokensPerRequest: number;
  averagePromptTokensPerRequest: number;
  averageCompletionTokensPerRequest: number;
  statusCounts: Partial<Record<AgentRunStatus, number>>;
}

export interface UsageLedgerRunSummary {
  runId: string;
  conversationId: string;
  profile: AgentProfile;
  profileLabel: string;
  provider: LLMProvider;
  model: string;
  status: AgentRunStatus;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
  averageTokensPerRequest: number;
}

export interface UsageLedgerTotals {
  entryCount: number;
  runCount: number;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
  averageTokensPerRun: number;
  averageTokensPerRequest: number;
}

export interface UsageLedgerSnapshot {
  totals: UsageLedgerTotals;
  entries: UsageLedgerEntry[];
}

export interface ConversationUsageSummary {
  conversationId: string | null;
  runId: string | null;
  profile: AgentProfile | null;
  profileLabel: string | null;
  provider: LLMProvider | null;
  model: string | null;
  startedAt: string | null;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
}

export interface StartAgentRunInput {
  conversationId: string;
  profile: AgentProfile;
  provider: LLMProvider;
  model: string;
  userMessage: string;
  availableTools: string[];
  parentRunId?: string;
  delegationReason?: string;
  delegatedByProfile?: AgentProfile;
  resumedFromRunId?: string;
}

function normalizeSnapshotToolCall(value: unknown): AgentRunSnapshotToolCall | null {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

  if (!candidate || typeof candidate.name !== "string" || typeof candidate.toolCallId !== "string") {
    return null;
  }

  const args = candidate.args && typeof candidate.args === "object" && !Array.isArray(candidate.args)
    ? candidate.args as JsonObject
    : {};
  const failure = candidate.failure;

  return {
    signature: typeof candidate.signature === "string"
      ? candidate.signature
      : createToolCallResumeSignature(candidate.name, args),
    round: typeof candidate.round === "number" && Number.isFinite(candidate.round) ? candidate.round : 0,
    toolCallId: candidate.toolCallId,
    name: candidate.name,
    args,
    result: typeof candidate.result === "string" ? candidate.result : "",
    isError: candidate.isError === true,
    ...(failure ? { failure: failure as FailureEnvelope } : {}),
    resumeSafe: typeof candidate.resumeSafe === "boolean"
      ? candidate.resumeSafe
      : isToolExecutionResumeSafe(candidate.name, failure as FailureEnvelope | undefined),
  };
}

function buildResumeBlockedReason(snapshot: AgentRunResumeSnapshot): string | null {
  if (snapshot.pendingRoundStatus === "completed") {
    return "Run already completed; resume is not needed.";
  }

  if (snapshot.finalFailure?.kind === "max_rounds") {
    return "Run exhausted the maximum tool rounds and cannot auto-resume safely.";
  }

  if (snapshot.stableMessages.length === 0) {
    return "Run has no stable checkpointed message state.";
  }

  const unsafeTool = snapshot.completedToolCalls.find((entry) => !entry.resumeSafe);
  if (unsafeTool) {
    return `Completed tool '${unsafeTool.name}' is not marked resume-safe.`;
  }

  return null;
}

function normalizeResumeSnapshot(record: AgentRunRecord): AgentRunResumeSnapshot {
  const candidate = record.snapshot && typeof record.snapshot === "object" && !Array.isArray(record.snapshot)
    ? record.snapshot as Partial<AgentRunResumeSnapshot>
    : {};
  const completedToolCalls = Array.isArray(candidate.completedToolCalls)
    ? candidate.completedToolCalls.map((entry) => normalizeSnapshotToolCall(entry)).filter((entry): entry is AgentRunSnapshotToolCall => Boolean(entry))
    : [];
  const stableMessages = Array.isArray(candidate.stableMessages)
    ? candidate.stableMessages as ChatMessage[]
    : [];

  const snapshot: AgentRunResumeSnapshot = {
    version: 1,
    lastStableRound: typeof candidate.lastStableRound === "number" && Number.isFinite(candidate.lastStableRound)
      ? candidate.lastStableRound
      : 0,
    pendingRound: typeof candidate.pendingRound === "number" && Number.isFinite(candidate.pendingRound)
      ? candidate.pendingRound
      : null,
    pendingRoundStatus: candidate.pendingRoundStatus === "awaiting_model"
      || candidate.pendingRoundStatus === "awaiting_tool_results"
      || candidate.pendingRoundStatus === "interrupted"
      || candidate.pendingRoundStatus === "completed"
      || candidate.pendingRoundStatus === "idle"
      ? candidate.pendingRoundStatus
      : record.status === "completed"
        ? "completed"
        : "idle",
    stableMessages,
    completedToolCalls,
    resumeEligible: false,
    resumeBlockedReason: null,
    ...(record.failure ? { finalFailure: record.failure } : {}),
    ...(typeof candidate.resumedFromRunId === "string" ? { resumedFromRunId: candidate.resumedFromRunId } : {}),
  };

  const blockedReason = buildResumeBlockedReason(snapshot);
  return {
    ...snapshot,
    resumeEligible: blockedReason === null,
    resumeBlockedReason: blockedReason,
  };
}

function truncate(text: string): string {
  if (text.length <= RESULT_PREVIEW_MAX_CHARS) {
    return text;
  }

  return `${text.slice(0, RESULT_PREVIEW_MAX_CHARS)}\n[truncated ${text.length - RESULT_PREVIEW_MAX_CHARS} chars]`;
}

function getRunsRoot(): string {
  const root = path.join(getWorkspacePath(), RUNS_DIR);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function getRunFilePath(runId: string): string {
  return path.join(getRunsRoot(), `${runId}.json`);
}

function getRunLedgerDay(record: AgentRunRecord): string {
  return (record.finishedAt ?? record.updatedAt ?? record.startedAt).slice(0, 10);
}

function getRecordTimestamp(record: AgentRunRecord): number {
  return Date.parse(record.updatedAt || record.startedAt);
}

function listRunFiles(): string[] {
  const root = getRunsRoot();
  return fs.readdirSync(root)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(root, entry));
}

function normalizeUsageTotals(record: AgentRunRecord): AgentRunUsageTotals {
  const usage = record.usage;
  const promptTokens = usage?.promptTokens ?? 0;
  const completionTokens = usage?.completionTokens ?? 0;
  const totalTokens = usage?.totalTokens ?? (promptTokens + completionTokens);
  const cachedPromptTokens = usage?.cachedPromptTokens ?? 0;

  if (Array.isArray(usage?.rounds)) {
    return {
      promptTokens,
      completionTokens,
      totalTokens,
      cachedPromptTokens,
      rounds: usage.rounds,
    };
  }

  // Older journal files stored aggregate usage totals without per-round detail.
  if (totalTokens > 0 || promptTokens > 0 || completionTokens > 0 || cachedPromptTokens > 0) {
    return {
      promptTokens,
      completionTokens,
      totalTokens,
      cachedPromptTokens,
      rounds: [{
        round: 1,
        provider: record.provider,
        model: record.model,
        promptTokens,
        completionTokens,
        totalTokens,
        cachedPromptTokens,
      }],
    };
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cachedPromptTokens,
    rounds: [],
  };
}

function normalizeRunRecord(record: AgentRunRecord): AgentRunRecord {
  const normalizedToolEvents = record.toolEvents.map((event) => {
    if (event.failure || event.phase !== "result" || !event.isError || !event.resultPreview) {
      return event;
    }

    return {
      ...event,
      failure: normalizeFailure(event.resultPreview, {
        component: "agent_run_journal",
        operation: "tool_result",
        toolName: event.name,
        layer: "tool",
      }),
    };
  });

  return {
    ...record,
    toolEvents: normalizedToolEvents,
    usage: normalizeUsageTotals(record),
    snapshot: normalizeResumeSnapshot(record),
    ...(record.failure || !record.error ? {} : {
      failure: normalizeFailure(record.error, {
        component: "agent_run_journal",
        operation: record.status === "cancelled" ? "run_cancelled" : record.status === "max_tool_rounds" ? "max_tool_rounds" : "run_failed",
        layer: record.status === "max_tool_rounds" ? "semantic" : record.status === "cancelled" ? "infra" : "unknown",
        ...(record.status === "max_tool_rounds" ? { kind: "max_rounds" as const } : {}),
      }),
    }),
  };
}

function readAllRuns(): AgentRunRecord[] {
  return listRunFiles().map((filePath) => normalizeRunRecord(JSON.parse(fs.readFileSync(filePath, "utf8")) as AgentRunRecord));
}

function createUsageLedgerEntryId(day: string, provider: LLMProvider, model: string): string {
  return new URLSearchParams({ day, provider, model }).toString();
}

function parseUsageLedgerEntryId(entryId: string): { day: string; provider: LLMProvider; model: string } {
  const params = new URLSearchParams(entryId);
  const day = params.get("day")?.trim();
  const provider = params.get("provider")?.trim() as LLMProvider | null;
  const model = params.get("model")?.trim();

  if (!day || !provider || !model) {
    throw new Error(`Invalid usage ledger entry id: ${entryId}`);
  }

  return { day, provider, model };
}

function matchesUsageLedgerEntry(
  record: AgentRunRecord,
  target: { day: string; provider: LLMProvider; model: string },
): boolean {
  return getRunLedgerDay(record) === target.day
    && record.provider === target.provider
    && record.model === target.model;
}

function toUsageLedgerRunSummary(record: AgentRunRecord): UsageLedgerRunSummary {
  const requestCount = record.usage.rounds.length;
  return {
    runId: record.runId,
    conversationId: record.conversationId,
    profile: record.profile,
    profileLabel: record.profileLabel,
    provider: record.provider,
    model: record.model,
    status: record.status,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
    requestCount,
    promptTokens: record.usage.promptTokens,
    completionTokens: record.usage.completionTokens,
    totalTokens: record.usage.totalTokens,
    cachedPromptTokens: record.usage.cachedPromptTokens,
    averageTokensPerRequest: requestCount > 0 ? record.usage.totalTokens / requestCount : 0,
  };
}

function writeRun(record: AgentRunRecord): void {
  fs.writeFileSync(getRunFilePath(record.runId), JSON.stringify(record, null, 2), "utf8");
}

function readRun(runId: string): AgentRunRecord {
  const filePath = getRunFilePath(runId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Agent run not found: ${runId}`);
  }

  return normalizeRunRecord(JSON.parse(fs.readFileSync(filePath, "utf8")) as AgentRunRecord);
}

function readRunOrNull(runId: string): AgentRunRecord | null {
  try {
    return readRun(runId);
  } catch {
    return null;
  }
}

function mutateRun(runId: string, mutate: (record: AgentRunRecord) => AgentRunRecord): AgentRunRecord {
  const next = mutate(readRun(runId));
  writeRun(next);
  return next;
}

export function startAgentRun(input: StartAgentRunInput): AgentRunRecord {
  const descriptor = getAgentProfileDescriptor(input.profile);
  const now = new Date().toISOString();
  const record: AgentRunRecord = {
    runId: crypto.randomUUID(),
    conversationId: input.conversationId,
    profile: input.profile,
    profileLabel: descriptor.label,
    profileMission: descriptor.mission,
    provider: input.provider,
    model: input.model,
    status: "running",
    startedAt: now,
    updatedAt: now,
    userMessage: input.userMessage,
    availableTools: input.availableTools,
    delegationTargets: descriptor.delegationTargets,
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
    childRunIds: [],
    ...(input.delegationReason ? { delegationReason: input.delegationReason } : {}),
    ...(input.delegatedByProfile ? { delegatedByProfile: input.delegatedByProfile } : {}),
    toolPolicy: {
      allowedPrefixes: [...descriptor.toolPolicy.allowedPrefixes],
      allowedTools: [...(descriptor.toolPolicy.allowedTools ?? [])],
      deniedTools: [...(descriptor.toolPolicy.deniedTools ?? [])],
    },
    roundsCompleted: 0,
    toolCallCount: 0,
    toolEvents: [],
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedPromptTokens: 0,
      rounds: [],
    },
    snapshot: {
      version: 1,
      lastStableRound: 0,
      pendingRound: null,
      pendingRoundStatus: "idle",
      stableMessages: [],
      completedToolCalls: [],
      resumeEligible: false,
      resumeBlockedReason: "Run has no stable checkpointed message state.",
      ...(input.resumedFromRunId ? { resumedFromRunId: input.resumedFromRunId } : {}),
    },
    ...(input.resumedFromRunId ? { resumedFromRunId: input.resumedFromRunId } : {}),
  };

  writeRun(record);

  if (input.parentRunId) {
    linkChildAgentRun(input.parentRunId, record.runId);
  }

  return record;
}

export function linkChildAgentRun(parentRunId: string, childRunId: string): AgentRunRecord {
  return mutateRun(parentRunId, (record) => ({
    ...record,
    updatedAt: new Date().toISOString(),
    childRunIds: record.childRunIds.includes(childRunId)
      ? record.childRunIds
      : [...record.childRunIds, childRunId],
  }));
}

export function recordAgentRunToolCall(
  runId: string,
  params: { round: number; toolCallId: string; name: string; args: JsonObject },
): AgentRunRecord {
  return mutateRun(runId, (record) => ({
    ...record,
    updatedAt: new Date().toISOString(),
    roundsCompleted: Math.max(record.roundsCompleted, params.round),
    toolCallCount: record.toolCallCount + 1,
    toolEvents: [
      ...record.toolEvents,
      {
        timestamp: new Date().toISOString(),
        phase: "call",
        round: params.round,
        toolCallId: params.toolCallId,
        name: params.name,
        args: params.args,
      },
    ],
  }));
}

export function recordAgentRunToolResult(
  runId: string,
  params: { round: number; toolCallId: string; name: string; result: string; isError?: boolean; failure?: FailureEnvelope },
): AgentRunRecord {
  return mutateRun(runId, (record) => ({
    ...record,
    updatedAt: new Date().toISOString(),
    roundsCompleted: Math.max(record.roundsCompleted, params.round),
    toolEvents: [
      ...record.toolEvents,
      {
        timestamp: new Date().toISOString(),
        phase: "result",
        round: params.round,
        toolCallId: params.toolCallId,
        name: params.name,
        resultPreview: truncate(params.result),
        isError: params.isError ?? false,
        ...(params.failure ? { failure: params.failure } : {}),
      },
    ],
  }));
}

export function recordAgentRunPromptAssembly(
  runId: string,
  params: {
    promptAssembly: AgentRunPromptAssembly;
    retrieval: AgentRunRecord["retrieval"];
  },
): AgentRunRecord {
  return mutateRun(runId, (record) => ({
    ...record,
    updatedAt: new Date().toISOString(),
    promptAssembly: params.promptAssembly,
    retrieval: params.retrieval,
  }));
}

export function recordAgentRunRoundUsage(
  runId: string,
  params: AgentRunRoundUsage,
): AgentRunRecord {
  return mutateRun(runId, (record) => {
    const existingRoundIndex = record.usage.rounds.findIndex((round) => round.round === params.round);
    const rounds = [...record.usage.rounds];

    if (existingRoundIndex >= 0) {
      rounds[existingRoundIndex] = params;
    } else {
      rounds.push(params);
    }

    const totals = rounds.reduce((accumulator, round) => ({
      promptTokens: accumulator.promptTokens + round.promptTokens,
      completionTokens: accumulator.completionTokens + round.completionTokens,
      totalTokens: accumulator.totalTokens + round.totalTokens,
      cachedPromptTokens: accumulator.cachedPromptTokens + round.cachedPromptTokens,
    }), {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedPromptTokens: 0,
    });

    return {
      ...record,
      updatedAt: new Date().toISOString(),
      usage: {
        ...totals,
        rounds,
      },
    };
  });
}

export function recordAgentRunSwarm(
  runId: string,
  swarm: Partial<AgentRunSwarmRecord>,
): AgentRunRecord {
  return mutateRun(runId, (record) => ({
    ...record,
    updatedAt: new Date().toISOString(),
    swarm: {
      ...(record.swarm ?? { activated: false }),
      ...swarm,
      plan: swarm.plan ?? record.swarm?.plan,
      trace: swarm.trace ?? record.swarm?.trace,
      validation: swarm.validation ?? record.swarm?.validation,
      workerResults: swarm.workerResults ?? record.swarm?.workerResults,
      synthesis: swarm.synthesis ?? record.swarm?.synthesis,
      audit: swarm.audit ?? record.swarm?.audit,
    },
  }));
}

export function recordAgentRunResumeSnapshot(
  runId: string,
  params: {
    lastStableRound: number;
    pendingRound: number | null;
    pendingRoundStatus: AgentRunResumePendingStatus;
    stableMessages: ChatMessage[];
    completedToolCalls: AgentRunSnapshotToolCall[];
    finalFailure?: FailureEnvelope | null;
    resumedFromRunId?: string | null;
  },
): AgentRunRecord {
  return mutateRun(runId, (record) => {
    const snapshot = normalizeResumeSnapshot({
      ...record,
      snapshot: {
        version: 1,
        lastStableRound: params.lastStableRound,
        pendingRound: params.pendingRound,
        pendingRoundStatus: params.pendingRoundStatus,
        stableMessages: params.stableMessages,
        completedToolCalls: params.completedToolCalls,
        resumeEligible: false,
        resumeBlockedReason: null,
        ...(params.finalFailure ? { finalFailure: params.finalFailure } : {}),
        ...(params.resumedFromRunId ? { resumedFromRunId: params.resumedFromRunId } : {}),
      },
      ...(params.finalFailure ? { failure: params.finalFailure } : {}),
    });

    return {
      ...record,
      updatedAt: new Date().toISOString(),
      snapshot,
      ...(params.resumedFromRunId ? { resumedFromRunId: params.resumedFromRunId } : {}),
    };
  });
}

export function completeAgentRun(
  runId: string,
  params: { status: Exclude<AgentRunStatus, "running">; reply?: string; error?: string; roundsCompleted: number; failure?: FailureEnvelope },
): AgentRunRecord {
  const finishedAt = new Date().toISOString();
  return mutateRun(runId, (record) => ({
    ...record,
    status: params.status,
    updatedAt: finishedAt,
    finishedAt,
    roundsCompleted: Math.max(record.roundsCompleted, params.roundsCompleted),
    ...(params.reply !== undefined ? { reply: truncate(params.reply) } : {}),
    ...(params.error !== undefined ? { error: truncate(params.error) } : {}),
    ...(params.failure !== undefined ? { failure: params.failure } : {}),
  }));
}

export function getAgentRun(runId: string): AgentRunRecord {
  return readRun(runId);
}

export function getAgentRunResumeSnapshot(runId: string): AgentRunResumeSnapshot {
  return readRun(runId).snapshot;
}

export function listAgentRuns(): AgentRunRecord[] {
  return readAllRuns().sort((left, right) => getRecordTimestamp(right) - getRecordTimestamp(left));
}

export function getConversationUsageSummary(conversationId: string | null | undefined): ConversationUsageSummary {
  if (!conversationId) {
    return {
      conversationId: null,
      runId: null,
      profile: null,
      profileLabel: null,
      provider: null,
      model: null,
      startedAt: null,
      requestCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedPromptTokens: 0,
    };
  }

  const runs = listAgentRuns().filter((record) => record.conversationId === conversationId);
  const latestRun = runs[0];

  if (!latestRun) {
    return {
      conversationId,
      runId: null,
      profile: null,
      profileLabel: null,
      provider: null,
      model: null,
      startedAt: null,
      requestCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedPromptTokens: 0,
    };
  }

  const totals = runs.reduce((accumulator, record) => ({
    requestCount: accumulator.requestCount + record.usage.rounds.length,
    promptTokens: accumulator.promptTokens + record.usage.promptTokens,
    completionTokens: accumulator.completionTokens + record.usage.completionTokens,
    totalTokens: accumulator.totalTokens + record.usage.totalTokens,
    cachedPromptTokens: accumulator.cachedPromptTokens + record.usage.cachedPromptTokens,
  }), {
    requestCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedPromptTokens: 0,
  });

  return {
    conversationId,
    runId: latestRun.runId,
    profile: latestRun.profile,
    profileLabel: latestRun.profileLabel,
    provider: latestRun.provider,
    model: latestRun.model,
    startedAt: latestRun.startedAt,
    ...totals,
  };
}

export function getUsageLedgerSnapshot(): UsageLedgerSnapshot {
  const byEntry = new Map<string, UsageLedgerEntry>();

  for (const record of listAgentRuns()) {
    const day = getRunLedgerDay(record);
    const entryId = createUsageLedgerEntryId(day, record.provider, record.model);
    const current = byEntry.get(entryId);
    const requestCount = record.usage.rounds.length;

    if (!current) {
      byEntry.set(entryId, {
        id: entryId,
        day,
        provider: record.provider,
        model: record.model,
        runCount: 1,
        requestCount,
        startedAt: record.startedAt,
        updatedAt: record.updatedAt,
        promptTokens: record.usage.promptTokens,
        completionTokens: record.usage.completionTokens,
        totalTokens: record.usage.totalTokens,
        cachedPromptTokens: record.usage.cachedPromptTokens,
        averageTokensPerRun: record.usage.totalTokens,
        averageTokensPerRequest: requestCount > 0 ? record.usage.totalTokens / requestCount : 0,
        averagePromptTokensPerRequest: requestCount > 0 ? record.usage.promptTokens / requestCount : 0,
        averageCompletionTokensPerRequest: requestCount > 0 ? record.usage.completionTokens / requestCount : 0,
        statusCounts: {
          [record.status]: 1,
        },
      });
      continue;
    }

    current.runCount += 1;
    current.requestCount += requestCount;
    current.startedAt = current.startedAt < record.startedAt ? current.startedAt : record.startedAt;
    current.updatedAt = current.updatedAt > record.updatedAt ? current.updatedAt : record.updatedAt;
    current.promptTokens += record.usage.promptTokens;
    current.completionTokens += record.usage.completionTokens;
    current.totalTokens += record.usage.totalTokens;
    current.cachedPromptTokens += record.usage.cachedPromptTokens;
    current.statusCounts[record.status] = (current.statusCounts[record.status] ?? 0) + 1;
  }

  for (const entry of byEntry.values()) {
    entry.averageTokensPerRun = entry.runCount > 0 ? entry.totalTokens / entry.runCount : 0;
    entry.averageTokensPerRequest = entry.requestCount > 0 ? entry.totalTokens / entry.requestCount : 0;
    entry.averagePromptTokensPerRequest = entry.requestCount > 0 ? entry.promptTokens / entry.requestCount : 0;
    entry.averageCompletionTokensPerRequest = entry.requestCount > 0 ? entry.completionTokens / entry.requestCount : 0;
  }

  const entries = [...byEntry.values()].sort((left, right) => {
    if (left.day !== right.day) {
      return right.day.localeCompare(left.day);
    }
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt.localeCompare(left.updatedAt);
    }
    if (left.totalTokens !== right.totalTokens) {
      return right.totalTokens - left.totalTokens;
    }
    return left.model.localeCompare(right.model);
  });

  const totals = entries.reduce<UsageLedgerTotals>((accumulator, entry) => ({
    entryCount: accumulator.entryCount + 1,
    runCount: accumulator.runCount + entry.runCount,
    requestCount: accumulator.requestCount + entry.requestCount,
    promptTokens: accumulator.promptTokens + entry.promptTokens,
    completionTokens: accumulator.completionTokens + entry.completionTokens,
    totalTokens: accumulator.totalTokens + entry.totalTokens,
    cachedPromptTokens: accumulator.cachedPromptTokens + entry.cachedPromptTokens,
    averageTokensPerRun: 0,
    averageTokensPerRequest: 0,
  }), {
    entryCount: 0,
    runCount: 0,
    requestCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedPromptTokens: 0,
    averageTokensPerRun: 0,
    averageTokensPerRequest: 0,
  });

  totals.averageTokensPerRun = totals.runCount > 0 ? totals.totalTokens / totals.runCount : 0;
  totals.averageTokensPerRequest = totals.requestCount > 0 ? totals.totalTokens / totals.requestCount : 0;

  return { totals, entries };
}

export function listUsageLedgerRuns(entryId: string): UsageLedgerRunSummary[] {
  const target = parseUsageLedgerEntryId(entryId);

  return listAgentRuns()
    .filter((record) => matchesUsageLedgerEntry(record, target))
    .map((record) => toUsageLedgerRunSummary(record));
}

export function deleteAgentRun(runId: string): AgentRunRecord {
  const record = readRun(runId);
  fs.unlinkSync(getRunFilePath(runId));
  return record;
}

export function deleteUsageLedgerEntry(entryId: string): { entryId: string; deletedRunIds: string[]; deletedCount: number } {
  const deletedRuns = listUsageLedgerRuns(entryId);

  for (const run of deletedRuns) {
    fs.unlinkSync(getRunFilePath(run.runId));
  }

  return {
    entryId,
    deletedRunIds: deletedRuns.map((run) => run.runId),
    deletedCount: deletedRuns.length,
  };
}

export function countDelegationDepth(runId: string): number {
  let depth = 0;
  let current = readRunOrNull(runId);
  const seen = new Set<string>();

  while (current?.parentRunId && !seen.has(current.runId)) {
    seen.add(current.runId);
    depth += 1;
    current = readRunOrNull(current.parentRunId);
  }

  return depth;
}

export function getDelegationChain(runId: string): AgentProfile[] {
  const chain: AgentProfile[] = [];
  let current = readRunOrNull(runId);
  const seen = new Set<string>();

  while (current && !seen.has(current.runId)) {
    seen.add(current.runId);
    chain.unshift(current.profile);
    current = current.parentRunId ? readRunOrNull(current.parentRunId) : null;
  }

  return chain;
}

export function listRecentAgentRuns(limit = 20): AgentRunRecord[] {
  return listAgentRuns().slice(0, Math.max(1, limit));
}