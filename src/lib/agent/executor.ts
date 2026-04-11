import {
  buildContextForPrompt,
  getOrCreateConversation,
  saveMessage,
} from "@/lib/agent/memory";
import {
  buildBizBotCapabilitySummary,
  buildRuntimeToolVisibilitySummary,
  shouldInjectBizBotCapabilitySummary,
  shouldInjectRuntimeToolVisibilitySummary,
} from "@/lib/agent/capabilities";
import { formatMemoryFactsForPrompt, getRelevantMemoryFacts } from "@/lib/agent/memory/service";
import { chatComplete, getModelForProvider, type ChatRequestOptions, type LLMProvider } from "@/lib/agent/kernel";
import { executeTool, getAllToolDefinitions } from "@/lib/agent/plugins";
import { ensureMcpClientsInitialized } from "@/lib/mcp/client";
import { buildAutonomySystemPrompt, getAgentRuntimeConfig } from "@/lib/agent/runtime";
import { resolveAgentUserId } from "@/lib/agent/user-context";
import {
  getChatExecutionProfile,
  isOracleChatExecutionSelection,
  resolveChatExecutionSelection,
  resolveChatExecutionToolNames,
  type ChatExecutionMode,
  type ChatMessageAttachment,
} from "@/lib/chat/execution";
import { getKnowledgeFilePreview } from "@/lib/agent/knowledge-management";
import { buildOntologyPromptBlock } from "@/lib/ontology/prompt";
import {
  completeAgentRun,
  countDelegationDepth,
  getDelegationChain,
  recordAgentRunPromptAssembly,
  recordAgentRunRoundUsage,
  recordAgentRunSwarm,
  recordAgentRunToolCall,
  recordAgentRunToolResult,
  startAgentRun,
} from "@/lib/agent/run-journal";
import type { ChatMessage, JsonObject, ToolExecutionResult } from "@/lib/agent/tools";
import {
  buildAgentProfilePrompt,
  getAgentProfileDescriptor,
  routeAgentProfile,
  type AgentProfile,
} from "@/lib/agent/profiles";
import { getOraclePredictionIntent } from "@/lib/oracle/intent";
import { syncActiveSidecarPanel } from "@/lib/sidecar/state";
import { buildSidecarStreamEvent, isSidecarToolResult } from "@/lib/sidecar/validation";
import type { SidecarStreamEvent } from "@/lib/sidecar/types";
import { aggregateChatSwarmFindings, buildChatSwarmPlan, classifyChatSwarmRequest, collectChatSwarmSources } from "@/lib/agent/swarm-chat";
import { auditChatSwarmDraft, buildChatSwarmSynthesisPacket, executeChatSwarmWorkItem } from "@/lib/agent/swarm-workers";
import { executeSwarmPlan } from "@/lib/swarm/runtime";
import { summarizeSwarmExecution, summarizeSwarmPlan, summarizeSwarmWorkerResults } from "@/lib/swarm/telemetry";
import { validateSwarmResults } from "@/lib/swarm/validation";

export type AgentExecutionEvent =
  | {
      type: "meta";
      runId: string;
      conversationId: string;
      profile: AgentProfile;
      profileLabel: string;
      provider: LLMProvider;
      model: string;
    }
  | {
      type: "usage";
      runId: string;
      conversationId: string;
      round: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      cachedPromptTokens: number;
      requestCount: number;
    }
  | { type: "status"; message: string; round?: number }
  | { type: "tool_call"; round: number; toolCallId: string; name: string; args: object }
  | { type: "tool_result"; round: number; toolCallId: string; name: string; result: string }
  | {
      type: "swarm_plan";
      runId: string;
      mode: string;
      reason: string;
      workerCount: number;
      plannerConfidence: number;
    }
  | {
      type: "swarm_worker_start";
      runId: string;
      workItemId: string;
      sourceId: string;
      sourceKind: string;
      operation: string;
    }
  | {
      type: "swarm_worker_result";
      runId: string;
      workItemId: string;
      status: string;
      diagnostics: string[];
      durationMs: number;
    }
  | {
      type: "swarm_validation";
      runId: string;
      valid: boolean;
      issues: string[];
    }
  | {
      type: "swarm_audit";
      runId: string;
      passed: boolean;
      summary: string;
      unsupportedSentenceCount: number;
      contradictionReminderMissing: boolean;
      evidenceCoverage: number;
    }
  | SidecarStreamEvent
  | { type: "assistant_message"; content: string }
  | { type: "done"; conversationId: string; reply: string }
  | { type: "error"; error: string };

export interface AgentExecutionParams {
  message: string;
  conversationId?: string;
  userId?: string;
  provider?: LLMProvider;
  mode?: ChatExecutionMode;
  pluginId?: string;
  attachments?: ChatMessageAttachment[];
  oraclePrediction?: boolean;
  forcedProfile?: AgentProfile;
  parentRunId?: string;
  delegationReason?: string;
  delegatedByProfile?: AgentProfile;
  builderMcpContext?: {
    projectId: string;
    builderRunId: string;
    taskId?: string | null;
    taskSpecId?: string | null;
    validatorContext?: string[];
    activeAdrDecisionKeys?: string[];
    ontologyHints?: string[];
  };
  onEvent?: (event: AgentExecutionEvent) => Promise<void> | void;
  signal?: AbortSignal;
}

export interface AgentExecutionResult {
  reply: string;
  runId: string;
  conversationId: string;
  profile: AgentProfile;
  provider: LLMProvider;
  model: string;
}

function stringifyToolResult(result: ToolExecutionResult, maxChars: number): string {
  const rawResult = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  if (rawResult.length <= maxChars) {
    return rawResult;
  }

  const overflow = rawResult.length - maxChars;
  return `${rawResult.slice(0, maxChars)}\n\n[truncated ${overflow} chars to keep tool context bounded]`;
}

async function emit(
  onEvent: AgentExecutionParams["onEvent"],
  event: AgentExecutionEvent,
): Promise<void> {
  if (!onEvent) {
    return;
  }

  await onEvent(event);
}

async function emitStatus(
  onEvent: AgentExecutionParams["onEvent"],
  message: string,
  round?: number,
): Promise<void> {
  await emit(onEvent, { type: "status", message, ...(round !== undefined ? { round } : {}) });
}

async function recordAndEmitUsage(args: {
  runId: string;
  conversationId: string;
  round: number;
  response: Awaited<ReturnType<typeof chatComplete>>;
  onEvent?: AgentExecutionParams["onEvent"];
}): Promise<void> {
  if (!args.response.usage) {
    return;
  }

  const updatedRun = recordAgentRunRoundUsage(args.runId, {
    round: args.round,
    provider: args.response.provider,
    model: args.response.model,
    promptTokens: args.response.usage.promptTokens ?? 0,
    completionTokens: args.response.usage.completionTokens ?? 0,
    totalTokens: args.response.usage.totalTokens ?? 0,
    cachedPromptTokens: args.response.usage.cachedPromptTokens ?? 0,
  });

  await emit(args.onEvent, {
    type: "usage",
    runId: args.runId,
    conversationId: args.conversationId,
    round: args.round,
    promptTokens: updatedRun.usage.promptTokens,
    completionTokens: updatedRun.usage.completionTokens,
    totalTokens: updatedRun.usage.totalTokens,
    cachedPromptTokens: updatedRun.usage.cachedPromptTokens,
    requestCount: updatedRun.usage.rounds.length,
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("Request aborted");
  }
}

async function finalizeAssistantReply({
  reply,
  round,
  resolvedConversationId,
  resolvedUserId,
  runId,
  profile,
  provider,
  model,
  onEvent,
  metadata,
}: {
  reply: string;
  round: number;
  resolvedConversationId: string;
  resolvedUserId: string;
  runId: string;
  profile: AgentProfile;
  provider: LLMProvider;
  model: string;
  onEvent?: AgentExecutionParams["onEvent"];
  metadata?: Record<string, unknown>;
}): Promise<AgentExecutionResult> {
  await saveMessage(resolvedConversationId, "ASSISTANT", reply, {
    userId: resolvedUserId,
    toolRoundCount: round,
    agentRunId: runId,
    agentProfile: profile,
    llmProvider: provider,
    llmModel: model,
    ...(metadata ?? {}),
  });

  completeAgentRun(runId, {
    status: "completed",
    reply,
    roundsCompleted: round,
  });

  await emit(onEvent, { type: "assistant_message", content: reply });
  await emit(onEvent, {
    type: "done",
    conversationId: resolvedConversationId,
    reply,
  });

  return {
    reply,
    runId,
    conversationId: resolvedConversationId,
    profile,
    provider,
    model,
  };
}

async function buildAttachmentContextBlock(attachments: ChatMessageAttachment[]): Promise<string> {
  if (attachments.length === 0) {
    return "";
  }

  const previews = await Promise.all(attachments.map(async (attachment) => {
    if (attachment.type !== "knowledge-doc") {
      return null;
    }

    const preview = await getKnowledgeFilePreview(attachment.path).catch(() => null);
    if (!preview || preview.status === "missing" || preview.chunks.length === 0) {
      return null;
    }

    const snippets = preview.chunks
      .slice(0, 3)
      .map((chunk) => `- ${chunk.snippet}`)
      .join("\n");

    return `Document: ${attachment.label} (${attachment.path})\n${snippets}`;
  }));

  const resolvedPreviews = previews.filter((value): value is string => Boolean(value));
  return resolvedPreviews.length > 0
    ? `Attached docs:\n${resolvedPreviews.join("\n\n")}`
    : "";
}

export async function executeAgentConversation(
  params: AgentExecutionParams,
): Promise<AgentExecutionResult> {
  const {
    message,
    conversationId,
    userId,
    provider,
    mode,
    pluginId,
    attachments = [],
    oraclePrediction,
    forcedProfile,
    parentRunId,
    delegationReason,
    delegatedByProfile,
    builderMcpContext,
    onEvent,
  } = params;
  const { signal } = params;
  throwIfAborted(signal);
  await emitStatus(onEvent, "Preparing agent conversation state.");
  const resolvedUserId = resolveAgentUserId(userId);
  const runtimeConfig = getAgentRuntimeConfig();
  const useLegacyExecutionRouting = !mode && !pluginId && !oraclePrediction;
  const executionSelection = oraclePrediction
    ? resolveChatExecutionSelection({ mode: "agent", pluginId: pluginId ?? "oracle" })
    : resolveChatExecutionSelection({
        mode: mode ?? (useLegacyExecutionRouting ? "agent" : undefined),
        pluginId: pluginId ?? "just-chatting",
      });
  if (oraclePrediction && pluginId && !isOracleChatExecutionSelection(executionSelection)) {
    throw new Error("Oracle prediction requires the Oracle chat plugin.");
  }
  const resolvedConversationId = await getOrCreateConversation(conversationId, resolvedUserId);
  try {
    const memoryModule = await import("@/lib/agent/memory");
    if ("updateConversationExecutionDefaults" in memoryModule && typeof memoryModule.updateConversationExecutionDefaults === "function") {
      await memoryModule.updateConversationExecutionDefaults(resolvedConversationId, executionSelection);
    }
  } catch {
    // Older tests partially mock the memory module without this helper.
  }
  await emitStatus(onEvent, `Using conversation ${resolvedConversationId}.`);
  const routedProfileDecision = routeAgentProfile(message);
  const oracleIntent = oraclePrediction ? getOraclePredictionIntent(message) : { matched: false, query: "" };
  const selectedProfile = oraclePrediction ? "research_operator" : getChatExecutionProfile(executionSelection);
  const profileDecision = oraclePrediction
    ? {
        profile: selectedProfile,
        reason: "Oracle prediction was explicitly triggered from the Oracle chat plugin.",
      }
    : forcedProfile
    ? {
        profile: forcedProfile,
        reason: delegatedByProfile
          ? `delegated by ${delegatedByProfile}`
          : "profile was forced by the caller",
      }
    : useLegacyExecutionRouting
    ? routedProfileDecision
    : {
        profile: selectedProfile,
        reason: executionSelection.pluginId === "just-chatting"
          ? `chat plugin '${executionSelection.pluginId}' keeps the request in the general chat lane`
          : `chat plugin '${executionSelection.pluginId}' selected the ${selectedProfile} lane instead of message-based routing (${routedProfileDecision.profile})`,
      };
  const profilePrompt = buildAgentProfilePrompt(profileDecision.profile, message);
  const profileDescriptor = getAgentProfileDescriptor(profileDecision.profile);
  const resolvedProvider = provider ?? (process.env.ACTIVE_LLM_PROVIDER as LLMProvider | undefined) ?? "ollama";
  const resolvedModel = getModelForProvider(resolvedProvider);
  await emitStatus(onEvent, `Resolved profile ${profileDecision.profile} via ${resolvedProvider}/${resolvedModel}.`);
  throwIfAborted(signal);
  await emitStatus(onEvent, "Initializing MCP clients.");
  await ensureMcpClientsInitialized().catch((error) => {
    console.warn("[agent executor] MCP client init skipped:", error);
  });
  throwIfAborted(signal);
  await emitStatus(onEvent, "Loading explicit memory facts.");
  const explicitMemoryFacts = await getRelevantMemoryFacts({ userId: resolvedUserId, query: message });
  await emitStatus(onEvent, "Building prompt context.");
  const contextResult = await buildContextForPrompt(message, resolvedConversationId, resolvedUserId);
  await emitStatus(onEvent, "Loading ontology context.");
  const ontologyPrompt = await buildOntologyPromptBlock(resolvedUserId).catch((error) => {
    console.warn("[agent executor] ontology context skipped:", error);
    return { block: "", lines: [], omitted: true, reason: "read_failed" };
  });
  const explicitMemoryBlock = formatMemoryFactsForPrompt(explicitMemoryFacts);
  const ontologyBlock = ontologyPrompt.omitted ? "" : ontologyPrompt.block;
  const contextBlock = contextResult.text;
  const attachmentContextBlock = await buildAttachmentContextBlock(attachments);
  const capabilitySummaryBlock = shouldInjectBizBotCapabilitySummary(message)
    ? buildBizBotCapabilitySummary()
    : "";
  const attachmentMetadata = attachments.map((attachment) => ({
    type: attachment.type,
    path: attachment.path,
    label: attachment.label,
  }));
  const allowedToolNames = useLegacyExecutionRouting ? undefined : resolveChatExecutionToolNames(executionSelection);
  const tools = getAllToolDefinitions(runtimeConfig, {
    agentProfile: profileDecision.profile,
    chatMode: executionSelection.mode,
    chatPluginId: executionSelection.pluginId,
    allowedToolNames,
  });
  const runtimeToolVisibilityBlock = shouldInjectRuntimeToolVisibilitySummary(message)
    ? buildRuntimeToolVisibilitySummary({
        profile: profileDecision.profile,
        tools,
        delegationTargets: profileDescriptor.delegationTargets,
      })
    : "";
  const maxToolRounds = profileDecision.profile === "builder_operator"
    ? Math.max(runtimeConfig.toolMaxRounds, 16)
    : runtimeConfig.toolMaxRounds;
  await emitStatus(onEvent, `Creating agent run journal with ${tools.length} available tools.`);
  const run = startAgentRun({
    conversationId: resolvedConversationId,
    profile: profileDecision.profile,
    provider: resolvedProvider,
    model: resolvedModel,
    userMessage: message,
    availableTools: tools.map((tool) => tool.name),
    ...(parentRunId ? { parentRunId } : {}),
    ...(delegationReason ? { delegationReason } : {}),
    ...(delegatedByProfile ? { delegatedByProfile } : {}),
  });
  await emitStatus(onEvent, `Agent run ${run.runId} created.`);
  const delegationDepth = parentRunId ? countDelegationDepth(parentRunId) + 1 : 0;
  const delegationChain = parentRunId
    ? [...getDelegationChain(parentRunId), profileDecision.profile]
    : [profileDecision.profile];
  console.info(
    `[agent] profile=${profileDecision.profile} depth=${delegationDepth} run=${run.runId} parent=${parentRunId ?? "none"} route=${profileDecision.reason} chain=${delegationChain.join(" -> ")}`,
  );

  const systemPrompt =
    "You are BizBot, a local-first desktop agent platform. Use tools when they improve correctness, prefer deterministic tool outputs over guessing, and keep responses operational."
    + ` ${buildAutonomySystemPrompt(runtimeConfig)}`
    + ` Execution mode: ${executionSelection.mode}. Selected chat plugin: ${executionSelection.pluginId}.`
    + ` ${profilePrompt.systemInstruction}`
    + " Explicit user memory policy: use memory_get_facts when stable user preferences, identity, workflows, constraints, or operator settings are relevant. Use memory_set_fact only when the user explicitly asks BizBot to remember a stable fact or an approved onboarding/system flow requires it. Use memory_forget_fact only when the user explicitly asks BizBot to forget a stored fact. Never store secrets, credentials, tokens, payment details, ephemeral chat noise, or speculative inferences as stable memory."
    + ` Delegation options: ${profileDescriptor.delegationTargets.join(", ") || "none"}.`
    + (capabilitySummaryBlock ? `\n\n${capabilitySummaryBlock}` : "")
    + (runtimeToolVisibilityBlock ? `\n\n${runtimeToolVisibilityBlock}` : "")
    + (explicitMemoryBlock ? `\n\n${explicitMemoryBlock}` : "")
    + (ontologyBlock ? `\n\n${ontologyBlock}` : "")
    + (attachmentContextBlock ? `\n\n${attachmentContextBlock}` : "")
    + (contextBlock ? `\n\nContext:\n${contextBlock}` : "");

  recordAgentRunPromptAssembly(run.runId, {
    promptAssembly: {
      capabilitySummaryChars: capabilitySummaryBlock.length,
      runtimeToolVisibilityChars: runtimeToolVisibilityBlock.length,
      explicitMemoryChars: explicitMemoryBlock.length,
      ontologyChars: ontologyBlock.length,
      attachmentContextChars: attachmentContextBlock.length,
      conversationSummaryChars: contextResult.blocks.conversationSummary.length,
      recentConversationChars: contextResult.blocks.recentConversation.length,
      semanticRecallChars: contextResult.blocks.semanticRecall.length,
      graphChars: contextResult.blocks.graph.length,
      knowledgeDocsChars: contextResult.blocks.knowledgeDocs.length,
      contextChars: contextBlock.length,
      systemPromptChars: systemPrompt.length,
      userMessageChars: message.length,
    },
    retrieval: contextResult.retrieval,
  });

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: systemPrompt,
    },
    { role: "user", content: message },
  ];

  await saveMessage(resolvedConversationId, "USER", message, {
    userId: resolvedUserId,
    agentRunId: run.runId,
    agentProfile: profileDecision.profile,
    chatMode: executionSelection.mode,
    chatPluginId: executionSelection.pluginId,
    attachments: attachmentMetadata,
  });

  await emit(onEvent, {
    type: "meta",
    runId: run.runId,
    conversationId: resolvedConversationId,
    profile: profileDecision.profile,
    profileLabel: profileDescriptor.label,
    provider: resolvedProvider,
    model: resolvedModel,
  });
  await emit(onEvent, {
    type: "status",
    message: `Routed to ${profilePrompt.streamLabel}. ${profileDecision.reason}.`,
  });

  let round = 0;

  try {
    if (oraclePrediction) {
      if (!oracleIntent.matched || !oracleIntent.query.trim()) {
        return finalizeAssistantReply({
          reply: "Oracle prediction needs a prompt containing both 'oracle' and 'predict' or 'prediction', plus a market topic to search.",
          round,
          resolvedConversationId,
          resolvedUserId,
          runId: run.runId,
          profile: profileDecision.profile,
          provider: resolvedProvider,
          model: resolvedModel,
          onEvent,
          metadata: { oraclePrediction: true, oracleQuery: oracleIntent.query },
        });
      }

      const executeOracleTool = async (toolName: string, args: JsonObject): Promise<ToolExecutionResult> => {
        round += 1;
        const toolCallId = `oracle-${round}-${toolName}`;
        await emit(onEvent, {
          type: "tool_call",
          round,
          toolCallId,
          name: toolName,
          args,
        });
        recordAgentRunToolCall(run.runId, {
          round,
          toolCallId,
          name: toolName,
          args,
        });

        const result = await executeTool(toolName, args, {
          config: runtimeConfig,
          access: {
            agentProfile: profileDecision.profile,
            chatMode: executionSelection.mode,
            chatPluginId: executionSelection.pluginId,
            allowedToolNames,
            conversationId: resolvedConversationId,
            runId: run.runId,
            userId: resolvedUserId,
            provider: resolvedProvider,
            signal,
            builderContext: builderMcpContext,
          },
        });

        if (isSidecarToolResult(result)) {
          syncActiveSidecarPanel({
            action: result.action,
            panel: result.panel,
            conversationId: resolvedConversationId,
            runId: run.runId,
            userId: resolvedUserId,
            toolName,
          });
          await emit(onEvent, buildSidecarStreamEvent({
            action: result.action,
            panel: result.panel,
            runId: run.runId,
            conversationId: resolvedConversationId,
            round,
            toolCallId,
            name: toolName,
          }));
        }

        const resultText = stringifyToolResult(result, runtimeConfig.toolResultMaxChars);
        recordAgentRunToolResult(run.runId, {
          round,
          toolCallId,
          name: toolName,
          result: resultText,
          isError: false,
        });
        await emit(onEvent, {
          type: "tool_result",
          round,
          toolCallId,
          name: toolName,
          result: resultText,
        });

        return result;
      };

      await emit(onEvent, {
        type: "status",
        message: `Oracle is resolving a market target for "${oracleIntent.query}" and collecting odds evidence from enabled market sources.`,
        round: round + 1,
      });

      const analysisResult = await executeOracleTool("oracle_analyze_prediction", {
        prompt: message,
        limit: 12,
      }) as {
        target: { canonicalQuestion: string };
        personality: string;
        personalityLabel: string;
        evidenceMode: "exact_market" | "adjacent_inference" | "no_useful_match";
        impliedProbability: number | null;
        confidence: "low" | "medium" | "high";
        sentiment: "bullish" | "bearish" | "mixed" | "unclear";
        exactMatch: { question: string } | null;
        adjacentMatches: Array<{ question: string }>;
        summaryPacket: string;
        fallbackReply: string;
      };

      await emit(onEvent, {
        type: "status",
        message: analysisResult.evidenceMode === "exact_market"
          ? "Oracle found an exact market match and is drafting a prediction from its odds."
          : analysisResult.evidenceMode === "no_useful_match"
            ? "Oracle found no active matching market support and is drafting a low-confidence negative prediction from that absence."
          : "Oracle is drafting a prediction from adjacent market odds and sentiment.",
        round: round + 1,
      });

      round += 1;
      const oracleResponse = await chatComplete([
        {
          role: "system",
          content: "You are Oracle, a market-sentiment prediction narrator. Ground every sentence in the supplied evidence packet. Do not invent markets, odds, or external facts. Keep the reply concise, state whether the evidence is exact or adjacent, mention implied probability and confidence, and adopt the specified Oracle personality style.",
        },
        {
          role: "user",
          content: analysisResult.summaryPacket,
        },
      ], resolvedProvider, undefined, {
        agentProfile: profileDecision.profile,
        signal,
      });
      throwIfAborted(signal);

      await recordAndEmitUsage({
        runId: run.runId,
        conversationId: resolvedConversationId,
        round,
        response: oracleResponse,
        onEvent,
      });

      const finalReply = oracleResponse.content.trim() || analysisResult.fallbackReply;

      return finalizeAssistantReply({
        reply: finalReply,
        round,
        resolvedConversationId,
        resolvedUserId,
        runId: run.runId,
        profile: profileDecision.profile,
        provider: oracleResponse.provider,
        model: oracleResponse.model,
        onEvent,
        metadata: {
          oraclePrediction: true,
          oracleQuery: oracleIntent.query,
          oracleEvidenceMode: analysisResult.evidenceMode,
          oracleImpliedProbability: analysisResult.impliedProbability,
          chatMode: executionSelection.mode,
          chatPluginId: executionSelection.pluginId,
          attachments: attachmentMetadata,
        },
      });
    }

    const swarmSources = collectChatSwarmSources({ message, context: contextResult });
    const swarmClassification = classifyChatSwarmRequest({
      message,
      profile: profileDecision.profile,
      context: contextResult,
    });
    const shouldRunSwarm = swarmClassification.activate && swarmClassification.plannerConfidence >= 0.7;

    if (shouldRunSwarm) {
      const swarmPlan = buildChatSwarmPlan({
        message,
        classification: swarmClassification,
        sources: swarmSources,
      });
      const summarizedPlan = summarizeSwarmPlan(swarmPlan);

      recordAgentRunSwarm(run.runId, {
        activated: true,
        mode: swarmPlan.mode,
        reason: swarmClassification.reason,
        plannerConfidence: swarmClassification.plannerConfidence,
        sources: swarmSources.map((source) => ({
          id: source.id,
          sourceKind: source.sourceKind,
          title: source.title,
          chars: source.text.length,
        })),
        plan: summarizedPlan,
      });

      await emitStatus(onEvent, `Activating core chat swarm across ${swarmSources.length} source units.`);
      await emit(onEvent, {
        type: "swarm_plan",
        runId: run.runId,
        mode: swarmPlan.mode,
        reason: swarmPlan.reason,
        workerCount: swarmPlan.workItems.length,
        plannerConfidence: swarmPlan.plannerConfidence,
      });

      for (const workItem of swarmPlan.workItems) {
        await emit(onEvent, {
          type: "swarm_worker_start",
          runId: run.runId,
          workItemId: workItem.id,
          sourceId: workItem.sourceId,
          sourceKind: workItem.sourceKind,
          operation: workItem.operation,
        });
      }

      const { results: swarmResults, trace } = await executeSwarmPlan(swarmPlan, executeChatSwarmWorkItem);
      const swarmValidation = validateSwarmResults(swarmPlan, swarmResults);
      const swarmFindings = aggregateChatSwarmFindings({
        sources: swarmSources,
        results: swarmResults,
      });
      const swarmPacket = buildChatSwarmSynthesisPacket(swarmFindings, swarmClassification.auditRequested);

      recordAgentRunSwarm(run.runId, {
        ...summarizeSwarmExecution({
          plan: swarmPlan,
          trace,
          validation: swarmValidation,
          results: swarmResults,
        }),
        activated: true,
        mode: swarmPlan.mode,
        reason: swarmClassification.reason,
        plannerConfidence: swarmClassification.plannerConfidence,
        synthesis: {
          sourceCoverage: swarmPacket.sourceCoverage,
          contradictionCount: swarmPacket.contradictions.length,
          evidenceRefCount: swarmPacket.evidenceRefs.length,
          gapCount: swarmPacket.gaps.length,
          auditNeeded: swarmPacket.auditNeeded,
        },
      });

      for (const result of summarizeSwarmWorkerResults(swarmResults)) {
        await emit(onEvent, {
          type: "swarm_worker_result",
          runId: run.runId,
          workItemId: result.workItemId,
          status: result.status,
          diagnostics: result.diagnostics,
          durationMs: result.durationMs,
        });
      }

      await emit(onEvent, {
        type: "swarm_validation",
        runId: run.runId,
        valid: swarmValidation.valid,
        issues: swarmValidation.issues,
      });

      if (!swarmValidation.valid) {
        await emitStatus(onEvent, "Swarm validation failed. Falling back to the standard chat loop.");
      } else {
        round += 1;
        await emitStatus(onEvent, "Synthesizing a grounded reply from swarm evidence.", round);

        let synthesisResponse = await chatComplete([
          {
            role: "system",
            content: `${systemPrompt}\n\nYou are in core chat swarm synthesis mode. The internal workers already extracted source findings. Do not call tools. Ground every substantive claim in the provided evidence refs. If the sources disagree, say so plainly.`,
          },
          {
            role: "user",
            content: [
              `Original request:\n${message}`,
              `Swarm evidence packet:\n${JSON.stringify(swarmPacket, null, 2)}`,
            ].join("\n\n"),
          },
        ], resolvedProvider, undefined, {
          agentProfile: profileDecision.profile,
          signal,
        });
        throwIfAborted(signal);

        await recordAndEmitUsage({
          runId: run.runId,
          conversationId: resolvedConversationId,
          round,
          response: synthesisResponse,
          onEvent,
        });

        let finalReply = synthesisResponse.content.trim();
        let finalProvider = synthesisResponse.provider;
        let finalModel = synthesisResponse.model;
        let finalMetadata = synthesisResponse.metadata;

        if (swarmPacket.auditNeeded) {
          let auditResult = auditChatSwarmDraft({
            draft: finalReply,
            findings: swarmFindings,
            contradictions: swarmPacket.contradictions,
          });

          recordAgentRunSwarm(run.runId, {
            activated: true,
            audit: auditResult,
          });
          await emit(onEvent, {
            type: "swarm_audit",
            runId: run.runId,
            passed: auditResult.passed,
            summary: auditResult.summary,
            unsupportedSentenceCount: auditResult.unsupportedSentences.length,
            contradictionReminderMissing: auditResult.contradictionReminderMissing,
            evidenceCoverage: auditResult.evidenceCoverage,
          });

          if (!auditResult.passed) {
            round += 1;
            await emitStatus(onEvent, "Revising the reply after swarm audit.", round);

            synthesisResponse = await chatComplete([
              {
                role: "system",
                content: `${systemPrompt}\n\nRevise the draft using only the supplied swarm evidence. Remove unsupported claims and mention contradictions when present. Do not call tools.`,
              },
              {
                role: "user",
                content: [
                  `Original request:\n${message}`,
                  `Current draft:\n${finalReply}`,
                  `Audit issues:\n${JSON.stringify(auditResult, null, 2)}`,
                  `Swarm evidence packet:\n${JSON.stringify(swarmPacket, null, 2)}`,
                ].join("\n\n"),
              },
            ], resolvedProvider, undefined, {
              agentProfile: profileDecision.profile,
              signal,
            });
            throwIfAborted(signal);

            await recordAndEmitUsage({
              runId: run.runId,
              conversationId: resolvedConversationId,
              round,
              response: synthesisResponse,
              onEvent,
            });

            finalReply = synthesisResponse.content.trim() || finalReply;
            finalProvider = synthesisResponse.provider;
            finalModel = synthesisResponse.model;
            finalMetadata = synthesisResponse.metadata;

            auditResult = auditChatSwarmDraft({
              draft: finalReply,
              findings: swarmFindings,
              contradictions: swarmPacket.contradictions,
            });
            recordAgentRunSwarm(run.runId, {
              activated: true,
              audit: auditResult,
            });
            await emit(onEvent, {
              type: "swarm_audit",
              runId: run.runId,
              passed: auditResult.passed,
              summary: auditResult.summary,
              unsupportedSentenceCount: auditResult.unsupportedSentences.length,
              contradictionReminderMissing: auditResult.contradictionReminderMissing,
              evidenceCoverage: auditResult.evidenceCoverage,
            });
          }
        }

        if (finalReply) {
          return finalizeAssistantReply({
            reply: finalReply,
            round,
            resolvedConversationId,
            resolvedUserId,
            runId: run.runId,
            profile: profileDecision.profile,
            provider: finalProvider,
            model: finalModel,
            onEvent,
            metadata: {
              userId: resolvedUserId,
              toolRoundCount: round,
              agentRunId: run.runId,
              agentProfile: profileDecision.profile,
              chatMode: executionSelection.mode,
              chatPluginId: executionSelection.pluginId,
              attachments: attachmentMetadata,
              llmProvider: finalProvider,
              llmModel: finalModel,
              swarm: {
                activated: true,
                planId: swarmPlan.id,
                sourceCount: swarmSources.length,
                contradictionCount: swarmPacket.contradictions.length,
                evidenceRefCount: swarmPacket.evidenceRefs.length,
              },
              ...(finalMetadata ? { llmMetadata: finalMetadata } : {}),
            },
          });
        }

        await emitStatus(onEvent, "Swarm synthesis returned no reply. Falling back to the standard chat loop.");
      }
    } else {
      recordAgentRunSwarm(run.runId, {
        activated: false,
        reason: swarmClassification.reason,
        plannerConfidence: swarmClassification.plannerConfidence,
        sources: swarmSources.map((source) => ({
          id: source.id,
          sourceKind: source.sourceKind,
          title: source.title,
          chars: source.text.length,
        })),
      });
    }

    while (round < maxToolRounds) {
      throwIfAborted(signal);
      round += 1;
      await emit(onEvent, {
        type: "status",
        message: `Planning step ${round} with ${tools.length} available tools.`,
        round,
      });

      const requestOptions: ChatRequestOptions = {
        enableGoogleSearch: profilePrompt.googleSearch,
        enableGoogleCodeExecution: profilePrompt.googleCodeExecution,
        forceFunctionCall: useLegacyExecutionRouting
          ? round === 1 && profilePrompt.forceToolUse
          : round === 1 && profilePrompt.forceToolUse && tools.length > 0 && executionSelection.mode === "agent",
        includeServerSideToolInvocations: true,
        agentProfile: profileDecision.profile,
        signal,
      };

      const response = await chatComplete(messages, resolvedProvider, tools, requestOptions);
      throwIfAborted(signal);

      await recordAndEmitUsage({
        runId: run.runId,
        conversationId: resolvedConversationId,
        round,
        response,
        onEvent,
      });

      if (response.metadata?.googleSearchQueries) {
        await emit(onEvent, {
          type: "status",
          message: `Grounded with Google Search: ${String(response.metadata.googleSearchQueries)}.`,
          round,
        });
      }

      if (response.metadata?.codeExecutionResult) {
        await emit(onEvent, {
          type: "status",
          message: "Gemini used code execution during this step.",
          round,
        });
      }

      if (response.toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: response.content,
          toolCalls: response.toolCalls,
          providerState: response.providerState,
        });

        const toolMessages = await Promise.all(
          response.toolCalls.map(async (toolCall) => {
            throwIfAborted(signal);
            await emit(onEvent, {
              type: "tool_call",
              round,
              toolCallId: toolCall.id,
              name: toolCall.name,
              args: toolCall.arguments,
            });
            recordAgentRunToolCall(run.runId, {
              round,
              toolCallId: toolCall.id,
              name: toolCall.name,
              args: toolCall.arguments,
            });

            let result: ToolExecutionResult;
            let isError = false;
            try {
              result = await executeTool(toolCall.name, toolCall.arguments, {
                config: runtimeConfig,
                access: {
                  agentProfile: profileDecision.profile,
                  chatMode: executionSelection.mode,
                  chatPluginId: executionSelection.pluginId,
                  allowedToolNames,
                  conversationId: resolvedConversationId,
                  runId: run.runId,
                  userId: resolvedUserId,
                  provider: resolvedProvider,
                  signal,
                  builderContext: builderMcpContext,
                },
              });
            } catch (error) {
              isError = true;
              result = { error: String(error) };
            }
            throwIfAborted(signal);

            if (!isError && isSidecarToolResult(result)) {
              syncActiveSidecarPanel({
                action: result.action,
                panel: result.panel,
                conversationId: resolvedConversationId,
                runId: run.runId,
                userId: resolvedUserId,
                toolName: toolCall.name,
              });
              await emit(onEvent, buildSidecarStreamEvent({
                action: result.action,
                panel: result.panel,
                runId: run.runId,
                conversationId: resolvedConversationId,
                round,
                toolCallId: toolCall.id,
                name: toolCall.name,
              }));
            }

            const resultText = stringifyToolResult(result, runtimeConfig.toolResultMaxChars);
            recordAgentRunToolResult(run.runId, {
              round,
              toolCallId: toolCall.id,
              name: toolCall.name,
              result: resultText,
              isError,
            });
            await emit(onEvent, {
              type: "tool_result",
              round,
              toolCallId: toolCall.id,
              name: toolCall.name,
              result: resultText,
            });

            return {
              role: "tool" as const,
              name: toolCall.name,
              content: resultText,
              toolCallId: toolCall.id,
            };
          }),
        );

        messages.push(...toolMessages);
        continue;
      }

      const assistantContent = response.content;
      throwIfAborted(signal);
      const assistantMetadata = {
        userId: resolvedUserId,
        toolRoundCount: round,
        agentRunId: run.runId,
        agentProfile: profileDecision.profile,
        chatMode: executionSelection.mode,
        chatPluginId: executionSelection.pluginId,
        attachments: attachmentMetadata,
        llmProvider: response.provider,
        llmModel: response.model,
        ...(response.metadata ? { llmMetadata: response.metadata } : {}),
      };
      return finalizeAssistantReply({
        reply: assistantContent,
        round,
        resolvedConversationId,
        resolvedUserId,
        runId: run.runId,
        profile: profileDecision.profile,
        provider: response.provider,
        model: response.model,
        onEvent,
        metadata: assistantMetadata,
      });
    }

    const fallback = "I reached the maximum number of tool-use steps. Please try a simpler request.";
    throwIfAborted(signal);
    await saveMessage(resolvedConversationId, "ASSISTANT", fallback, {
      userId: resolvedUserId,
      toolRoundCount: maxToolRounds,
      agentRunId: run.runId,
      agentProfile: profileDecision.profile,
      chatMode: executionSelection.mode,
      chatPluginId: executionSelection.pluginId,
      attachments: attachmentMetadata,
    });
    completeAgentRun(run.runId, {
      status: "max_tool_rounds",
      reply: fallback,
      roundsCompleted: maxToolRounds,
    });
    await emit(onEvent, { type: "assistant_message", content: fallback });
    await emit(onEvent, { type: "done", conversationId: resolvedConversationId, reply: fallback });

    return {
      reply: fallback,
      runId: run.runId,
      conversationId: resolvedConversationId,
      profile: profileDecision.profile,
      provider: resolvedProvider,
      model: resolvedModel,
    };
  } catch (error) {
    const aborted = signal?.aborted;
    completeAgentRun(run.runId, {
      status: aborted ? "cancelled" : "failed",
      error: String(error),
      roundsCompleted: round,
    });
    await emit(onEvent, { type: "error", error: String(error) });
    throw error;
  }
}