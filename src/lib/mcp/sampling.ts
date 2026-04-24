import type { ClientCapabilities, CreateMessageRequest, CreateMessageResult, CreateMessageResultWithTools } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpSamplingSession, ToolParametersSchema } from "@/lib/agent/tools";
import { getAllToolDefinitions } from "@/lib/agent/plugins";
import { getAgentRuntimeConfig } from "@/lib/agent/runtime";
import type { BuilderDevLoopContext } from "@/lib/mcp/devloop-context";
import {
  getMcpSamplingBlockReason,
  getMcpSamplingPolicy,
  isMcpSamplingIntentAllowed,
  runWithMcpSamplingFlow,
} from "@/lib/mcp/policy";
import { isSamplingSafeTool, MCP_AGENT_PROFILE } from "@/lib/mcp/tool-presentation";

const DEV_LOOP_SAMPLING_INTENT = "developer_devloop_status" as const;

const structuredSamplingResultSchema = z.object({
  summary: z.string().min(1),
  status: z.enum(["ok", "warning", "blocked", "unknown"]).catch("unknown"),
  tripletHealth: z.object({
    overall: z.enum(["aligned", "drifted", "pending", "not_available", "unknown"]).catch("unknown"),
    mcpSnapshot: z.string(),
    dependencyContract: z.string(),
    fileTopologyContract: z.string(),
  }),
  latestFailure: z.string().nullable(),
  likelyRootCause: z.string().nullable(),
  suggestedFix: z.string().nullable(),
  smallestNextFix: z.string().nullable().catch(null),
  recommendedNextProbe: z.string().nullable().catch(null),
  evidenceUsed: z.array(z.string()).catch([]),
  nextSteps: z.array(z.string()).catch([]),
  confidence: z.enum(["low", "medium", "high"]).catch("low"),
});

type StructuredSamplingResult = z.infer<typeof structuredSamplingResultSchema>;

type SamplingParseMode = "structured_json" | "plain_text_fallback" | "malformed_json_fallback";

interface DevLoopSamplingTelemetryState {
  totalAttempts: number;
  availableAttempts: number;
  unavailableAttempts: number;
  sampledSuccesses: number;
  deterministicFallbacks: number;
  structuredParseSuccesses: number;
  plainTextFallbacks: number;
  malformedPayloadCount: number;
  nestedBlockCount: number;
  transportCounts: Record<string, number>;
  unavailableReasonCounts: Record<string, number>;
  modelCounts: Record<string, number>;
  stopReasonCounts: Record<string, number>;
  sampledToolCount: number;
  sampledToolNames: string[];
  lastAttemptAt: string | null;
}

interface ParsedStructuredSamplingResult {
  result: StructuredSamplingResult;
  parseMode: SamplingParseMode;
}

const devLoopSamplingTelemetry: DevLoopSamplingTelemetryState = {
  totalAttempts: 0,
  availableAttempts: 0,
  unavailableAttempts: 0,
  sampledSuccesses: 0,
  deterministicFallbacks: 0,
  structuredParseSuccesses: 0,
  plainTextFallbacks: 0,
  malformedPayloadCount: 0,
  nestedBlockCount: 0,
  transportCounts: {},
  unavailableReasonCounts: {},
  modelCounts: {},
  stopReasonCounts: {},
  sampledToolCount: 0,
  sampledToolNames: [],
  lastAttemptAt: null,
};

function incrementCounter(target: Record<string, number>, key: string | null | undefined): void {
  if (!key) {
    return;
  }
  target[key] = (target[key] ?? 0) + 1;
}

function recordDevLoopSamplingAttempt(availability: DevLoopSamplingAvailability): void {
  devLoopSamplingTelemetry.totalAttempts += 1;
  devLoopSamplingTelemetry.lastAttemptAt = new Date().toISOString();
  incrementCounter(devLoopSamplingTelemetry.transportCounts, availability.transportKind);
  if (availability.available) {
    devLoopSamplingTelemetry.availableAttempts += 1;
    return;
  }

  devLoopSamplingTelemetry.unavailableAttempts += 1;
  devLoopSamplingTelemetry.deterministicFallbacks += 1;
  if (availability.nestedFlowBlocked) {
    devLoopSamplingTelemetry.nestedBlockCount += 1;
  }
  incrementCounter(devLoopSamplingTelemetry.unavailableReasonCounts, availability.reason);
}

function recordSampledResponse(parseMode: SamplingParseMode, model: string | null, stopReason: string | null): void {
  incrementCounter(devLoopSamplingTelemetry.modelCounts, model);
  incrementCounter(devLoopSamplingTelemetry.stopReasonCounts, stopReason);

  if (parseMode === "structured_json") {
    devLoopSamplingTelemetry.sampledSuccesses += 1;
    devLoopSamplingTelemetry.structuredParseSuccesses += 1;
    return;
  }

  devLoopSamplingTelemetry.deterministicFallbacks += 1;
  if (parseMode === "plain_text_fallback") {
    devLoopSamplingTelemetry.plainTextFallbacks += 1;
    return;
  }

  devLoopSamplingTelemetry.malformedPayloadCount += 1;
}

export function resetDevLoopSamplingTelemetry(): void {
  devLoopSamplingTelemetry.totalAttempts = 0;
  devLoopSamplingTelemetry.availableAttempts = 0;
  devLoopSamplingTelemetry.unavailableAttempts = 0;
  devLoopSamplingTelemetry.sampledSuccesses = 0;
  devLoopSamplingTelemetry.deterministicFallbacks = 0;
  devLoopSamplingTelemetry.structuredParseSuccesses = 0;
  devLoopSamplingTelemetry.plainTextFallbacks = 0;
  devLoopSamplingTelemetry.malformedPayloadCount = 0;
  devLoopSamplingTelemetry.nestedBlockCount = 0;
  devLoopSamplingTelemetry.lastAttemptAt = null;
  for (const key of Object.keys(devLoopSamplingTelemetry.transportCounts)) {
    delete devLoopSamplingTelemetry.transportCounts[key];
  }
  for (const key of Object.keys(devLoopSamplingTelemetry.unavailableReasonCounts)) {
    delete devLoopSamplingTelemetry.unavailableReasonCounts[key];
  }
  for (const key of Object.keys(devLoopSamplingTelemetry.modelCounts)) {
    delete devLoopSamplingTelemetry.modelCounts[key];
  }
  for (const key of Object.keys(devLoopSamplingTelemetry.stopReasonCounts)) {
    delete devLoopSamplingTelemetry.stopReasonCounts[key];
  }
  devLoopSamplingTelemetry.sampledToolCount = 0;
  devLoopSamplingTelemetry.sampledToolNames = [];
}

export function getDevLoopSamplingTelemetrySnapshot(): DevLoopSamplingTelemetryState {
  return {
    ...devLoopSamplingTelemetry,
    transportCounts: { ...devLoopSamplingTelemetry.transportCounts },
    unavailableReasonCounts: { ...devLoopSamplingTelemetry.unavailableReasonCounts },
    modelCounts: { ...devLoopSamplingTelemetry.modelCounts },
    stopReasonCounts: { ...devLoopSamplingTelemetry.stopReasonCounts },
  };
}

export interface DevLoopSamplingAvailability {
  available: boolean;
  transportKind: McpSamplingSession["transportKind"];
  clientSupportsSampling: boolean;
  clientSupportsSamplingTools: boolean;
  reason: string | null;
  maxDepth: number;
  maxContextChars: number;
  allowTools: boolean;
  nestedFlowBlocked: boolean;
}

export interface DevLoopSamplingResult {
  availability: DevLoopSamplingAvailability;
  session: {
    sessionId: string | null;
    traceId: string | null;
    requestId: string | null;
    toolInvocationId: string | null;
    idempotencyKey: string | null;
    requestStartedAt: string | null;
    toolBudgetAllowed: boolean;
  };
  diagnosisSource: "sampled" | "deterministic_fallback";
  summary: string;
  status: "ok" | "warning" | "blocked" | "unknown" | "unavailable" | "error";
  tripletHealth: StructuredSamplingResult["tripletHealth"];
  latestFailure: string | null;
  likelyRootCause: string | null;
  suggestedFix: string | null;
  smallestNextFix: string | null;
  recommendedNextProbe: string | null;
  evidenceUsed: string[];
  nextSteps: string[];
  confidence: "low" | "medium" | "high";
  model: string | null;
  stopReason: string | null;
  rawText: string | null;
}

function buildSessionMetadata(session: McpSamplingSession | null | undefined) {
  return {
    sessionId: session?.sessionId ?? null,
    traceId: session?.traceId ?? null,
    requestId: session?.requestId ?? null,
    toolInvocationId: session?.toolInvocationId ?? null,
    idempotencyKey: session?.idempotencyKey ?? null,
    requestStartedAt: session?.requestStartedAt ?? null,
    toolBudgetAllowed: session?.toolBudgetAllowed === true,
  };
}

function readState(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "unknown";
  }

  const state = (value as { state?: unknown }).state;
  return typeof state === "string" ? state : "unknown";
}

function normalizeTripletState(state: string): StructuredSamplingResult["tripletHealth"]["overall"] {
  switch (state) {
    case "aligned":
    case "drifted":
    case "not_available":
      return state;
    case "pending_capture":
    case "captured":
      return "pending";
    default:
      return "unknown";
  }
}

function getTripletHealth(context: BuilderDevLoopContext): StructuredSamplingResult["tripletHealth"] {
  const mcpState = readState(context.mcpSnapshot);
  const dependencyState = readState(context.dependencyContract);
  const fileTopologyState = readState(context.fileTopologyContract);

  const overall = [mcpState, dependencyState, fileTopologyState].includes("drifted")
    ? "drifted"
    : [mcpState, dependencyState, fileTopologyState].some((state) => state === "pending_capture" || state === "captured")
      ? "pending"
      : [mcpState, dependencyState, fileTopologyState].some((state) => state === "not_available")
        ? "not_available"
        : [mcpState, dependencyState, fileTopologyState].every((state) => state === "aligned")
          ? "aligned"
          : "unknown";

  return {
    overall,
    mcpSnapshot: normalizeTripletState(mcpState),
    dependencyContract: normalizeTripletState(dependencyState),
    fileTopologyContract: normalizeTripletState(fileTopologyState),
  };
}

function getLatestFailureEvidence(context: BuilderDevLoopContext): string | null {
  return context.currentBlockerOrLastErrorSignal.activeRunBlockedReason
    ?? context.currentBlockerOrLastErrorSignal.latestFailedRun?.blockedReason
    ?? context.currentBlockerOrLastErrorSignal.latestReviewSummary
    ?? context.currentBlockerOrLastErrorSignal.trustRuntimeSummary.runtimeSummary
    ?? null;
}

function getClientSamplingCapabilities(session: McpSamplingSession | null | undefined): ClientCapabilities["sampling"] | undefined {
  return session?.getClientCapabilities()?.sampling;
}

function buildAvailability(session: McpSamplingSession | null | undefined): DevLoopSamplingAvailability {
  const transportKind = session?.transportKind ?? "http";
  const policy = getMcpSamplingPolicy(DEV_LOOP_SAMPLING_INTENT, transportKind, true);
  const clientSampling = getClientSamplingCapabilities(session);
  const blockReason = getMcpSamplingBlockReason(DEV_LOOP_SAMPLING_INTENT, transportKind, true);
  const clientSupportsSampling = Boolean(clientSampling);
  const clientSupportsSamplingTools = Boolean(clientSampling?.tools);
  const available = Boolean(session) && policy.advertiseSampling && clientSupportsSampling && !blockReason;

  return {
    available,
    transportKind,
    clientSupportsSampling,
    clientSupportsSamplingTools,
    reason: blockReason ?? (!session
      ? "No MCP sampling session is attached to this tool execution."
      : !policy.advertiseSampling
        ? `Sampling is disabled for the ${transportKind} transport.`
        : !clientSupportsSampling
          ? "The connected MCP client did not advertise sampling support."
          : null),
    maxDepth: policy.maxDepth,
    maxContextChars: policy.maxContextChars,
    allowTools: policy.allowTools,
    nestedFlowBlocked: Boolean(blockReason && blockReason.includes("already handling")),
  };
}

function trimSerializedContext(context: BuilderDevLoopContext, maxContextChars: number): string {
  const serialized = JSON.stringify(context, null, 2);
  if (serialized.length <= maxContextChars) {
    return serialized;
  }

  const truncatedBy = serialized.length - maxContextChars;
  return `${serialized.slice(0, maxContextChars)}\n...[truncated ${truncatedBy} chars]`;
}

function buildSystemPrompt(): string {
  return [
    "You are analyzing a BizBot Builder MCP development loop.",
    "Use only the supplied evidence. Do not assume missing facts.",
    "You may use the provided tools when they materially improve correctness.",
    "Do not delegate and do not propose approval bypasses.",
    "Return a single JSON object with exactly these keys:",
    "summary, status, tripletHealth, latestFailure, likelyRootCause, suggestedFix, smallestNextFix, recommendedNextProbe, evidenceUsed, nextSteps, confidence.",
    "status must be one of: ok, warning, blocked, unknown.",
    "confidence must be one of: low, medium, high.",
    "tripletHealth must be an object with keys: overall, mcpSnapshot, dependencyContract, fileTopologyContract.",
    "evidenceUsed must list the exact evidence lines that support the diagnosis.",
    "smallestNextFix must be the smallest concrete next fix, not a broad plan.",
    "recommendedNextProbe must name the next artifact or signal to inspect if uncertainty remains.",
  ].join(" ");
}

function buildDeterministicFallbackDiagnosis(
  context: BuilderDevLoopContext,
  options?: { summaryOverride?: string | null; unavailableReason?: string | null },
): StructuredSamplingResult {
  const tripletHealth = getTripletHealth(context);
  const latestFailure = getLatestFailureEvidence(context);
  const evidenceUsed = [
    context.diagnosticSummary.contracts.summary,
    context.diagnosticSummary.reviewFocus.summary,
    latestFailure,
    context.currentBlockerOrLastErrorSignal.trustRuntimeSummary.runtimeSummary,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  let likelyRootCause: string | null = null;
  let suggestedFix: string | null = null;
  let smallestNextFix: string | null = null;
  let recommendedNextProbe: string | null = context.diagnosticSummary.probeTargets[0] ?? null;
  let status: StructuredSamplingResult["status"] = "unknown";

  if (tripletHealth.mcpSnapshot === "drifted") {
    status = context.currentBlockerOrLastErrorSignal.trustRuntimeSummary.runtimeStatus === "blocked" ? "blocked" : "warning";
    likelyRootCause = "The Builder MCP snapshot baseline is stale or the live MCP contract changed without being rolled forward.";
    suggestedFix = "Inspect the active MCP contract drift and reconcile or refresh the accepted snapshot baseline before re-running verification.";
    smallestNextFix = "Open the MCP contract drift summary and refresh the accepted snapshot baseline if the change is intentional.";
    recommendedNextProbe = "Inspect the active Builder MCP contract drift and current contract seed.";
  } else if (tripletHealth.dependencyContract === "drifted") {
    status = "warning";
    likelyRootCause = "The Builder dependency contract drifted from the accepted baseline.";
    suggestedFix = "Review package and lockfile drift, then approve or revert the dependency rollover before re-running verification.";
    smallestNextFix = "Inspect the package manifest diff and the dependency contract recommendations.";
    recommendedNextProbe = "Inspect the dependency contract drift summary and package manifest changes.";
  } else if (tripletHealth.fileTopologyContract === "drifted") {
    status = "warning";
    likelyRootCause = "The Builder file topology contract drifted from the accepted placement baseline.";
    suggestedFix = "Review structural placement drift, then approve or revert the topology rollover before re-running verification.";
    smallestNextFix = "Inspect the file-topology drift summary and the first changed anchor or top-level entry.";
    recommendedNextProbe = "Inspect the file topology drift summary and placement-policy changes.";
  } else if (context.diagnosticSummary.validation.passed === false) {
    status = "warning";
    likelyRootCause = latestFailure ?? context.diagnosticSummary.validation.summary ?? "Builder verification failed in the most recent loop.";
    suggestedFix = "Fix the first failing verification step and re-run the smallest relevant validation.";
    smallestNextFix = "Open the first failing verification script summary and repair the smallest changed file involved.";
  } else if (context.diagnosticSummary.trustFocus.runtimeStatus === "warning" || context.diagnosticSummary.trustFocus.runtimeStatus === "blocked") {
    status = context.diagnosticSummary.trustFocus.runtimeStatus === "blocked" ? "blocked" : "warning";
    likelyRootCause = context.currentBlockerOrLastErrorSignal.trustRuntimeSummary.runtimeSummary;
    suggestedFix = "Inspect the runtime trust blockers and address the first blocking review or operational issue.";
    smallestNextFix = "Inspect the current runtime trust summary and the latest Builder review side by side.";
  }

  const summary = options?.summaryOverride?.trim()
    || options?.unavailableReason?.trim()
    || likelyRootCause
    || latestFailure
    || "Sampling was unavailable, so BizBot returned a deterministic local diagnosis from the current Builder evidence package.";

  return {
    summary,
    status,
    tripletHealth,
    latestFailure,
    likelyRootCause,
    suggestedFix,
    smallestNextFix,
    recommendedNextProbe,
    evidenceUsed,
    nextSteps: context.latestReview?.nextSteps?.slice(0, 3) ?? [],
    confidence: likelyRootCause ? "medium" : "low",
  };
}

function toSamplingToolSchema(properties: ToolParametersSchema["properties"] | undefined): Record<string, object> | undefined {
  if (!properties) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(properties).flatMap(([key, value]) => value ? [[key, value as object]] : []),
  );
}

function getSamplingSafeToolDefinitions() {
  return getAllToolDefinitions(getAgentRuntimeConfig(), { agentProfile: MCP_AGENT_PROFILE })
    .filter((tool) => isSamplingSafeTool(tool.name));
}

function buildDevLoopSamplingTools(): Tool[] {
  const safeTools = getSamplingSafeToolDefinitions();
  devLoopSamplingTelemetry.sampledToolCount = safeTools.length;
  devLoopSamplingTelemetry.sampledToolNames = safeTools.map((tool) => tool.name);

  return safeTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: "object",
      ...(toSamplingToolSchema(tool.parameters.properties) ? { properties: toSamplingToolSchema(tool.parameters.properties) } : {}),
      ...(tool.parameters.required ? { required: tool.parameters.required } : {}),
    },
  }));
}

export function getDevLoopSamplingToolDescriptors() {
  return getSamplingSafeToolDefinitions();
}

export function buildDevLoopSamplingRequest(
  context: BuilderDevLoopContext,
  options?: {
    allowTools?: boolean;
    clientSupportsSamplingTools?: boolean;
    session?: McpSamplingSession | null;
  },
): CreateMessageRequest["params"] {
  const policy = getMcpSamplingPolicy(DEV_LOOP_SAMPLING_INTENT, "stdio", true);
  const contextPayload = trimSerializedContext(context, policy.maxContextChars);
  const includeTools = Boolean(policy.allowTools && options?.allowTools && options?.clientSupportsSamplingTools);
  const samplingTools = includeTools ? buildDevLoopSamplingTools() : undefined;

  return {
    systemPrompt: buildSystemPrompt(),
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            "Analyze this BizBot Builder dev-loop package and identify the most likely root cause and next fix.",
            "Evidence package:",
            contextPayload,
          ].join("\n\n"),
        },
      },
    ],
    includeContext: "none",
    maxTokens: 900,
    temperature: 0,
    ...(samplingTools ? {
      tools: samplingTools,
      toolChoice: { mode: "auto" as const },
    } : {}),
    metadata: {
      bizbotIntent: DEV_LOOP_SAMPLING_INTENT,
      analysisMode: "read_only",
      toolsAllowed: includeTools,
      sessionId: options?.session?.sessionId ?? null,
      traceId: options?.session?.traceId ?? null,
      parentRequestId: options?.session?.requestId ?? null,
      toolInvocationId: options?.session?.toolInvocationId ?? null,
      idempotencyKey: options?.session?.idempotencyKey ?? null,
      requestStartedAt: options?.session?.requestStartedAt ?? null,
      toolBudgetAllowed: options?.session?.toolBudgetAllowed === true,
    },
  };
}

function extractResponseText(result: CreateMessageResult | CreateMessageResultWithTools): string | null {
  const blocks = Array.isArray(result.content) ? result.content : [result.content];
  const text = blocks
    .filter((block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return text.length > 0 ? text : null;
}

function extractJsonCandidate(text: string): string | null {
  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

function parseStructuredResult(rawText: string | null, context: BuilderDevLoopContext): ParsedStructuredSamplingResult {
  const fallback = buildDeterministicFallbackDiagnosis(context, rawText ? { summaryOverride: rawText } : undefined);

  if (!rawText) {
    return { result: fallback, parseMode: "plain_text_fallback" };
  }

  const jsonCandidate = extractJsonCandidate(rawText);
  if (!jsonCandidate) {
    return { result: fallback, parseMode: "plain_text_fallback" };
  }

  try {
    const parsed = structuredSamplingResultSchema.safeParse(JSON.parse(jsonCandidate));
    if (!parsed.success) {
      return { result: fallback, parseMode: "malformed_json_fallback" };
    }

    return {
      result: {
        ...parsed.data,
        latestFailure: parsed.data.latestFailure ?? fallback.latestFailure,
        smallestNextFix: parsed.data.smallestNextFix ?? fallback.smallestNextFix,
        recommendedNextProbe: parsed.data.recommendedNextProbe ?? fallback.recommendedNextProbe,
        evidenceUsed: parsed.data.evidenceUsed.length > 0 ? parsed.data.evidenceUsed : fallback.evidenceUsed,
      },
      parseMode: "structured_json",
    };
  } catch {
    return { result: fallback, parseMode: "malformed_json_fallback" };
  }
}

export async function requestDevLoopSampling(serverOrSession: McpSamplingSession | null | undefined, context: BuilderDevLoopContext): Promise<DevLoopSamplingResult> {
  if (!isMcpSamplingIntentAllowed(DEV_LOOP_SAMPLING_INTENT)) {
    const fallback = buildDeterministicFallbackDiagnosis(context, {
      unavailableReason: "BizBot MCP policy rejected the requested sampling intent.",
    });
    recordDevLoopSamplingAttempt(buildAvailability(serverOrSession));
    return {
      availability: buildAvailability(serverOrSession),
      session: buildSessionMetadata(serverOrSession),
      diagnosisSource: "deterministic_fallback",
      summary: fallback.summary,
      status: "error",
      tripletHealth: fallback.tripletHealth,
      latestFailure: fallback.latestFailure,
      likelyRootCause: fallback.likelyRootCause,
      suggestedFix: fallback.suggestedFix,
      smallestNextFix: fallback.smallestNextFix,
      recommendedNextProbe: fallback.recommendedNextProbe,
      evidenceUsed: fallback.evidenceUsed,
      nextSteps: fallback.nextSteps,
      confidence: fallback.confidence,
      model: null,
      stopReason: null,
      rawText: null,
    };
  }

  const availability = buildAvailability(serverOrSession);
  recordDevLoopSamplingAttempt(availability);
  if (!availability.available || !serverOrSession) {
    const fallback = buildDeterministicFallbackDiagnosis(context, {
      unavailableReason: availability.reason ?? "Sampling is unavailable for this MCP session.",
    });
    return {
      availability,
      session: buildSessionMetadata(serverOrSession),
      diagnosisSource: "deterministic_fallback",
      summary: fallback.summary,
      status: fallback.status === "unknown" ? "unavailable" : fallback.status,
      tripletHealth: fallback.tripletHealth,
      latestFailure: fallback.latestFailure,
      likelyRootCause: fallback.likelyRootCause,
      suggestedFix: fallback.suggestedFix,
      smallestNextFix: fallback.smallestNextFix,
      recommendedNextProbe: fallback.recommendedNextProbe,
      evidenceUsed: fallback.evidenceUsed,
      nextSteps: fallback.nextSteps,
      confidence: fallback.confidence,
      model: null,
      stopReason: null,
      rawText: null,
    };
  }

  const response = await runWithMcpSamplingFlow(DEV_LOOP_SAMPLING_INTENT, serverOrSession.transportKind, async () => {
    const request = buildDevLoopSamplingRequest(context, {
      allowTools: availability.allowTools,
      clientSupportsSamplingTools: availability.clientSupportsSamplingTools,
      session: serverOrSession,
    });
    return serverOrSession.createMessage(request);
  });

  const rawText = extractResponseText(response);
  const parsed = parseStructuredResult(rawText, context);
  recordSampledResponse(parsed.parseMode, response.model ?? null, response.stopReason ?? null);

  return {
    availability,
    session: buildSessionMetadata(serverOrSession),
    diagnosisSource: "sampled",
    summary: parsed.result.summary,
    status: parsed.result.status,
    tripletHealth: parsed.result.tripletHealth,
    latestFailure: parsed.result.latestFailure,
    likelyRootCause: parsed.result.likelyRootCause,
    suggestedFix: parsed.result.suggestedFix,
    smallestNextFix: parsed.result.smallestNextFix,
    recommendedNextProbe: parsed.result.recommendedNextProbe,
    evidenceUsed: parsed.result.evidenceUsed,
    nextSteps: parsed.result.nextSteps,
    confidence: parsed.result.confidence,
    model: response.model,
    stopReason: response.stopReason ?? null,
    rawText,
  };
}