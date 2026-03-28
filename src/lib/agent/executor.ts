import { buildContext, getOrCreateConversation, saveMessage } from "@/lib/agent/memory";
import { chatComplete, getModelForProvider, type ChatRequestOptions, type LLMProvider } from "@/lib/agent/kernel";
import { executeTool, getAllToolDefinitions } from "@/lib/agent/plugins";
import { ensureMcpClientsInitialized } from "@/lib/mcp/client";
import { buildAutonomySystemPrompt, getAgentRuntimeConfig } from "@/lib/agent/runtime";
import {
  completeAgentRun,
  recordAgentRunToolCall,
  recordAgentRunToolResult,
  startAgentRun,
} from "@/lib/agent/run-journal";
import type { ChatMessage, ToolExecutionResult } from "@/lib/agent/tools";
import {
  buildAgentProfilePrompt,
  getAgentProfileDescriptor,
  routeAgentProfile,
  type AgentProfile,
} from "@/lib/agent/profiles";

const MAX_TOOL_ROUNDS = 8;
const MAX_TOOL_RESULT_CHARS = 8_000;

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
  | { type: "status"; message: string; round?: number }
  | { type: "tool_call"; round: number; toolCallId: string; name: string; args: object }
  | { type: "tool_result"; round: number; toolCallId: string; name: string; result: string }
  | { type: "assistant_message"; content: string }
  | { type: "done"; conversationId: string; reply: string }
  | { type: "error"; error: string };

export interface AgentExecutionParams {
  message: string;
  conversationId?: string;
  provider?: LLMProvider;
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

function stringifyToolResult(result: ToolExecutionResult): string {
  const rawResult = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  if (rawResult.length <= MAX_TOOL_RESULT_CHARS) {
    return rawResult;
  }

  const overflow = rawResult.length - MAX_TOOL_RESULT_CHARS;
  return `${rawResult.slice(0, MAX_TOOL_RESULT_CHARS)}\n\n[truncated ${overflow} chars to keep tool context bounded]`;
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

export async function executeAgentConversation(
  params: AgentExecutionParams,
): Promise<AgentExecutionResult> {
  const {
    message,
    conversationId,
    provider,
    forcedProfile,
    parentRunId,
    delegationReason,
    delegatedByProfile,
    onEvent,
  } = params;
  const { signal } = params;
  throwIfAborted(signal);
  const userId = "local-user";
  const runtimeConfig = getAgentRuntimeConfig();
  const resolvedConversationId = await getOrCreateConversation(conversationId, userId);
  const routedProfileDecision = routeAgentProfile(message);
  const profileDecision = forcedProfile
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
  const contextBlock = await buildContext(message, resolvedConversationId, userId);
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

  const systemPrompt =
    "You are BizBot, a local desktop social media agent. Use tools when they improve correctness, prefer deterministic tool outputs over guessing, and keep responses operational."
    + ` ${buildAutonomySystemPrompt(runtimeConfig)}`
    + ` ${profilePrompt.systemInstruction}`
    + ` Delegation options: ${profileDescriptor.delegationTargets.join(", ") || "none"}.`
    + (contextBlock ? `\n\nContext:\n${contextBlock}` : "");

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: systemPrompt,
    },
    { role: "user", content: message },
  ];

  await saveMessage(resolvedConversationId, "USER", message, {
    userId,
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
    while (round < MAX_TOOL_ROUNDS) {
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
                  provider: resolvedProvider,
                  signal,
                },
              });
            } catch (error) {
              isError = true;
              result = { error: String(error) };
            }
            throwIfAborted(signal);

            const resultText = stringifyToolResult(result);
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
        userId,
        toolRoundCount: round,
        agentRunId: run.runId,
        agentProfile: profileDecision.profile,
        llmProvider: response.provider,
        llmModel: response.model,
        ...(response.metadata ? { llmMetadata: response.metadata } : {}),
      };
      await saveMessage(resolvedConversationId, "ASSISTANT", assistantContent, {
        ...assistantMetadata,
      });
      completeAgentRun(run.runId, {
        status: "completed",
        reply: assistantContent,
        roundsCompleted: round,
      });

      await emit(onEvent, { type: "assistant_message", content: assistantContent });
      await emit(onEvent, {
        type: "done",
        conversationId: resolvedConversationId,
        reply: assistantContent,
      });

      return {
        reply: assistantContent,
        runId: run.runId,
        conversationId: resolvedConversationId,
        profile: profileDecision.profile,
        provider: response.provider,
        model: response.model,
      };
    }

    const fallback = "I reached the maximum number of tool-use steps. Please try a simpler request.";
    throwIfAborted(signal);
    await saveMessage(resolvedConversationId, "ASSISTANT", fallback, {
      userId,
      toolRoundCount: MAX_TOOL_ROUNDS,
      agentRunId: run.runId,
      agentProfile: profileDecision.profile,
    });
    completeAgentRun(run.runId, {
      status: "max_tool_rounds",
      reply: fallback,
      roundsCompleted: MAX_TOOL_ROUNDS,
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