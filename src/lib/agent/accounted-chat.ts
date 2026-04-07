import { chatComplete, type ChatRequestOptions, type LLMProvider, type LLMResponse } from "@/lib/agent/kernel";
import { getAgentRun, recordAgentRunRoundUsage } from "@/lib/agent/run-journal";
import type { ChatMessage, ToolDescriptor, ToolExecutionContext } from "@/lib/agent/tools";

function getNextToolUsageRound(runId: string): number {
  const run = getAgentRun(runId);
  const lowestRound = run.usage.rounds.reduce((lowest, round) => Math.min(lowest, round.round), 0);

  return lowestRound <= 0 ? lowestRound - 1 : -1;
}

export async function chatCompleteWithRunAccounting(
  messages: ChatMessage[],
  context: ToolExecutionContext,
  tools?: ToolDescriptor[],
  options?: ChatRequestOptions,
): Promise<LLMResponse> {
  const response = await chatComplete(
    messages,
    context.provider as LLMProvider | undefined,
    tools,
    {
      ...options,
      signal: options?.signal ?? context.signal,
    },
  );

  if (!context.runId || !response.usage) {
    return response;
  }

  try {
    recordAgentRunRoundUsage(context.runId, {
      round: getNextToolUsageRound(context.runId),
      provider: response.provider,
      model: response.model,
      promptTokens: response.usage.promptTokens ?? 0,
      completionTokens: response.usage.completionTokens ?? 0,
      totalTokens: response.usage.totalTokens ?? 0,
      cachedPromptTokens: response.usage.cachedPromptTokens ?? 0,
    });
  } catch (error) {
    console.warn("[accounted chat] failed to record tool-owned usage:", error);
  }

  return response;
}