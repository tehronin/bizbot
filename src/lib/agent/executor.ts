import { buildContextForPrompt, getOrCreateConversation, saveMessage } from "@/lib/agent/memory";
import { formatMemoryFactsForPrompt, getRelevantMemoryFacts } from "@/lib/agent/memory/service";
import { chatComplete, getModelForProvider, type ChatRequestOptions, type LLMProvider } from "@/lib/agent/kernel";
import { executeTool, getAllToolDefinitions } from "@/lib/agent/plugins";
import { ensureMcpClientsInitialized } from "@/lib/mcp/client";
import { buildAutonomySystemPrompt, getAgentRuntimeConfig } from "@/lib/agent/runtime";
import { resolveAgentUserId } from "@/lib/agent/user-context";
import { buildOntologyPromptBlock } from "@/lib/ontology/prompt";
import {
  completeAgentRun,
  countDelegationDepth,
  getDelegationChain,
  recordAgentRunPromptAssembly,
  recordAgentRunRoundUsage,
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
  | SidecarStreamEvent
  | { type: "assistant_message"; content: string }
  | { type: "done"; conversationId: string; reply: string }
  | { type: "error"; error: string };

export interface AgentExecutionParams {
  message: string;
  conversationId?: string;
  userId?: string;
  provider?: LLMProvider;
  oraclePrediction?: boolean;
  forcedProfile?: AgentProfile;
  parentRunId?: string;
  delegationReason?: string;
  delegatedByProfile?: AgentProfile;
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

export async function executeAgentConversation(
  params: AgentExecutionParams,
): Promise<AgentExecutionResult> {
  const {
    message,
    conversationId,
    userId,
    provider,
    oraclePrediction,
    forcedProfile,
    parentRunId,
    delegationReason,
    delegatedByProfile,
    onEvent,
  } = params;
  const { signal } = params;
  throwIfAborted(signal);
  const resolvedUserId = resolveAgentUserId(userId);
  const runtimeConfig = getAgentRuntimeConfig();
  const resolvedConversationId = await getOrCreateConversation(conversationId, resolvedUserId);
  const routedProfileDecision = routeAgentProfile(message);
  const oracleIntent = oraclePrediction ? getOraclePredictionIntent(message) : { matched: false, query: "" };
  const profileDecision = oraclePrediction
    ? {
        profile: "research_operator" as const,
        reason: "Oracle prediction was explicitly triggered from chat.",
      }
    : forcedProfile
    ? {
        profile: forcedProfile,
        reason: delegatedByProfile
          ? `delegated by ${delegatedByProfile}`
          : "profile was forced by the caller",
      }
    : routedProfileDecision;
  const profilePrompt = buildAgentProfilePrompt(profileDecision.profile, message);
  const profileDescriptor = getAgentProfileDescriptor(profileDecision.profile);
  const resolvedProvider = provider ?? (process.env.ACTIVE_LLM_PROVIDER as LLMProvider | undefined) ?? "ollama";
  const resolvedModel = getModelForProvider(resolvedProvider);
  throwIfAborted(signal);
  await ensureMcpClientsInitialized().catch((error) => {
    console.warn("[agent executor] MCP client init skipped:", error);
  });
  throwIfAborted(signal);
  const [explicitMemoryFacts, contextResult, ontologyPrompt] = await Promise.all([
    getRelevantMemoryFacts({ userId: resolvedUserId, query: message }),
    buildContextForPrompt(message, resolvedConversationId, resolvedUserId),
    buildOntologyPromptBlock(resolvedUserId).catch((error) => {
      console.warn("[agent executor] ontology context skipped:", error);
      return { block: "", lines: [], omitted: true, reason: "read_failed" };
    }),
  ]);
  const explicitMemoryBlock = formatMemoryFactsForPrompt(explicitMemoryFacts);
  const ontologyBlock = ontologyPrompt.omitted ? "" : ontologyPrompt.block;
  const contextBlock = contextResult.text;
  const tools = getAllToolDefinitions(runtimeConfig, { agentProfile: profileDecision.profile });
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
  const delegationDepth = parentRunId ? countDelegationDepth(parentRunId) + 1 : 0;
  const delegationChain = parentRunId
    ? [...getDelegationChain(parentRunId), profileDecision.profile]
    : [profileDecision.profile];
  console.info(
    `[agent] profile=${profileDecision.profile} depth=${delegationDepth} run=${run.runId} parent=${parentRunId ?? "none"} route=${profileDecision.reason} chain=${delegationChain.join(" -> ")}`,
  );

  const systemPrompt =
    "You are BizBot, a local desktop social media agent. Use tools when they improve correctness, prefer deterministic tool outputs over guessing, and keep responses operational."
    + ` ${buildAutonomySystemPrompt(runtimeConfig)}`
    + ` ${profilePrompt.systemInstruction}`
    + " Explicit user memory policy: use memory_get_facts when stable user preferences, identity, workflows, constraints, or operator settings are relevant. Use memory_set_fact only when the user explicitly asks BizBot to remember a stable fact or an approved onboarding/system flow requires it. Use memory_forget_fact only when the user explicitly asks BizBot to forget a stored fact. Never store secrets, credentials, tokens, payment details, ephemeral chat noise, or speculative inferences as stable memory."
    + ` Delegation options: ${profileDescriptor.delegationTargets.join(", ") || "none"}.`
    + (explicitMemoryBlock ? `\n\n${explicitMemoryBlock}` : "")
    + (ontologyBlock ? `\n\n${ontologyBlock}` : "")
    + (contextBlock ? `\n\nContext:\n${contextBlock}` : "");

  recordAgentRunPromptAssembly(run.runId, {
    promptAssembly: {
      explicitMemoryChars: explicitMemoryBlock.length,
      ontologyChars: ontologyBlock.length,
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

      const recordAndEmitUsage = async (
        response: Awaited<ReturnType<typeof chatComplete>>,
      ): Promise<void> => {
        if (!response.usage) {
          return;
        }

        const updatedRun = recordAgentRunRoundUsage(run.runId, {
          round,
          provider: response.provider,
          model: response.model,
          promptTokens: response.usage.promptTokens ?? 0,
          completionTokens: response.usage.completionTokens ?? 0,
          totalTokens: response.usage.totalTokens ?? 0,
          cachedPromptTokens: response.usage.cachedPromptTokens ?? 0,
        });

        await emit(onEvent, {
          type: "usage",
          runId: run.runId,
          conversationId: resolvedConversationId,
          round,
          promptTokens: updatedRun.usage.promptTokens,
          completionTokens: updatedRun.usage.completionTokens,
          totalTokens: updatedRun.usage.totalTokens,
          cachedPromptTokens: updatedRun.usage.cachedPromptTokens,
          requestCount: updatedRun.usage.rounds.length,
        });
      };

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
            conversationId: resolvedConversationId,
            runId: run.runId,
            userId: resolvedUserId,
            provider: resolvedProvider,
            signal,
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
        message: `Oracle is resolving a market target for "${oracleIntent.query}" and collecting odds evidence from Polymarket.`,
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

      await recordAndEmitUsage(oracleResponse);

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
        },
      });
    }

    while (round < runtimeConfig.toolMaxRounds) {
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
        forceFunctionCall: round === 1 && profilePrompt.forceToolUse,
        includeServerSideToolInvocations: true,
        agentProfile: profileDecision.profile,
        signal,
      };

      const response = await chatComplete(messages, resolvedProvider, tools, requestOptions);
      throwIfAborted(signal);

      if (response.usage) {
        const updatedRun = recordAgentRunRoundUsage(run.runId, {
          round,
          provider: response.provider,
          model: response.model,
          promptTokens: response.usage.promptTokens ?? 0,
          completionTokens: response.usage.completionTokens ?? 0,
          totalTokens: response.usage.totalTokens ?? 0,
          cachedPromptTokens: response.usage.cachedPromptTokens ?? 0,
        });

        await emit(onEvent, {
          type: "usage",
          runId: run.runId,
          conversationId: resolvedConversationId,
          round,
          promptTokens: updatedRun.usage.promptTokens,
          completionTokens: updatedRun.usage.completionTokens,
          totalTokens: updatedRun.usage.totalTokens,
          cachedPromptTokens: updatedRun.usage.cachedPromptTokens,
          requestCount: updatedRun.usage.rounds.length,
        });
      }

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
                  conversationId: resolvedConversationId,
                  runId: run.runId,
                  userId: resolvedUserId,
                  provider: resolvedProvider,
                  signal,
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
      toolRoundCount: runtimeConfig.toolMaxRounds,
      agentRunId: run.runId,
      agentProfile: profileDecision.profile,
    });
    completeAgentRun(run.runId, {
      status: "max_tool_rounds",
      reply: fallback,
      roundsCompleted: runtimeConfig.toolMaxRounds,
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