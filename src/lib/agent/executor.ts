import { buildContext, getOrCreateConversation, saveMessage } from "@/lib/agent/memory";
import { chatComplete, getModelForProvider, type ChatRequestOptions, type LLMProvider } from "@/lib/agent/kernel";
import { executeTool, getAllToolDefinitions } from "@/lib/agent/plugins";
import { buildAutonomySystemPrompt, getAgentRuntimeConfig } from "@/lib/agent/runtime";
import type { ChatMessage, ToolExecutionResult } from "@/lib/agent/tools";
import {
  buildAgentProfilePrompt,
  canProfileUseTool,
  routeAgentProfile,
  type AgentProfile,
} from "@/lib/agent/profiles";

const MAX_TOOL_ROUNDS = 8;

export type AgentExecutionEvent =
  | {
      type: "meta";
      conversationId: string;
      profile: AgentProfile;
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
  onEvent?: (event: AgentExecutionEvent) => Promise<void> | void;
}

export interface AgentExecutionResult {
  reply: string;
  conversationId: string;
  profile: AgentProfile;
  provider: LLMProvider;
  model: string;
}

function stringifyToolResult(result: ToolExecutionResult): string {
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
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

export async function executeAgentConversation(
  params: AgentExecutionParams,
): Promise<AgentExecutionResult> {
  const { message, conversationId, provider, onEvent } = params;
  const userId = "local-user";
  const runtimeConfig = getAgentRuntimeConfig();
  const resolvedConversationId = await getOrCreateConversation(conversationId, userId);
  const profileDecision = routeAgentProfile(message);
  const profilePrompt = buildAgentProfilePrompt(profileDecision.profile, message);
  const resolvedProvider = provider ?? (process.env.ACTIVE_LLM_PROVIDER as LLMProvider | undefined) ?? "ollama";
  const resolvedModel = getModelForProvider(resolvedProvider);
  const contextBlock = await buildContext(message, resolvedConversationId, userId);
  const tools = getAllToolDefinitions(runtimeConfig).filter((tool) =>
    canProfileUseTool(profileDecision.profile, tool.name),
  );

  const systemPrompt =
    "You are BizBot, a local desktop social media agent. Use tools when they improve correctness, prefer deterministic tool outputs over guessing, and keep responses operational."
    + ` ${buildAutonomySystemPrompt(runtimeConfig)}`
    + ` ${profilePrompt.systemInstruction}`
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
    agentProfile: profileDecision.profile,
  });

  await emit(onEvent, {
    type: "meta",
    conversationId: resolvedConversationId,
    profile: profileDecision.profile,
    provider: resolvedProvider,
    model: resolvedModel,
  });
  await emit(onEvent, {
    type: "status",
    message: `Routed to ${profilePrompt.streamLabel}. ${profileDecision.reason}.`,
  });

  let round = 0;

  while (round < MAX_TOOL_ROUNDS) {
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
    };

    const response = await chatComplete(messages, resolvedProvider, tools, requestOptions);

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
          await emit(onEvent, {
            type: "tool_call",
            round,
            toolCallId: toolCall.id,
            name: toolCall.name,
            args: toolCall.arguments,
          });

          let result: ToolExecutionResult;
          try {
            result = await executeTool(toolCall.name, toolCall.arguments);
          } catch (error) {
            result = { error: String(error) };
          }

          const resultText = stringifyToolResult(result);
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
    const assistantMetadata = {
      userId,
      toolRoundCount: round,
      agentProfile: profileDecision.profile,
      llmProvider: response.provider,
      llmModel: response.model,
      ...(response.metadata ? { llmMetadata: response.metadata } : {}),
    };
    await saveMessage(resolvedConversationId, "ASSISTANT", assistantContent, {
      ...assistantMetadata,
    });

    await emit(onEvent, { type: "assistant_message", content: assistantContent });
    await emit(onEvent, {
      type: "done",
      conversationId: resolvedConversationId,
      reply: assistantContent,
    });

    return {
      reply: assistantContent,
      conversationId: resolvedConversationId,
      profile: profileDecision.profile,
      provider: response.provider,
      model: response.model,
    };
  }

  const fallback = "I reached the maximum number of tool-use steps. Please try a simpler request.";
  await saveMessage(resolvedConversationId, "ASSISTANT", fallback, {
    userId,
    toolRoundCount: MAX_TOOL_ROUNDS,
    agentProfile: profileDecision.profile,
  });
  await emit(onEvent, { type: "assistant_message", content: fallback });
  await emit(onEvent, { type: "done", conversationId: resolvedConversationId, reply: fallback });

  return {
    reply: fallback,
    conversationId: resolvedConversationId,
    profile: profileDecision.profile,
    provider: resolvedProvider,
    model: resolvedModel,
  };
}