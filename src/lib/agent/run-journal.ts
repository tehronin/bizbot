import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LLMProvider } from "@/lib/agent/kernel";
import { getWorkspacePath } from "@/lib/files/workspace";
import {
  getAgentProfileDescriptor,
  type AgentProfile,
} from "@/lib/agent/profiles";
import type { JsonObject } from "@/lib/agent/tools";

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
}

export interface AgentRunRetrievalDecision {
  included: boolean;
  reason: string;
  resultCount: number;
  chars: number;
}

export interface AgentRunPromptAssembly {
  explicitMemoryChars: number;
  ontologyChars: number;
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
  usage: AgentRunUsageTotals;
  reply?: string;
  error?: string;
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

function writeRun(record: AgentRunRecord): void {
  fs.writeFileSync(getRunFilePath(record.runId), JSON.stringify(record, null, 2), "utf8");
}

function readRun(runId: string): AgentRunRecord {
  const filePath = getRunFilePath(runId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Agent run not found: ${runId}`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8")) as AgentRunRecord;
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
  params: { round: number; toolCallId: string; name: string; result: string; isError?: boolean },
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

export function completeAgentRun(
  runId: string,
  params: { status: Exclude<AgentRunStatus, "running">; reply?: string; error?: string; roundsCompleted: number },
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
  }));
}

export function getAgentRun(runId: string): AgentRunRecord {
  return readRun(runId);
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
  const root = getRunsRoot();
  const files = fs.readdirSync(root)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(root, entry));

  return files
    .map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")) as AgentRunRecord)
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || left.startedAt);
      const rightTime = Date.parse(right.updatedAt || right.startedAt);
      return rightTime - leftTime;
    })
    .slice(0, Math.max(1, limit));
}