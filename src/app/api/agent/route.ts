/**
 * POST /api/agent
 * Receives a user message, runs the tool-use loop, and streams the final reply.
 */

import { NextRequest } from "next/server";
import { buildAutonomySystemPrompt, getAgentRuntimeConfig } from "@/lib/agent/runtime";
import { buildContext, saveMessage, getOrCreateConversation } from "@/lib/agent/memory";
import { chatComplete, type LLMProvider } from "@/lib/agent/kernel";
import { getAllToolDefinitions, executeTool } from "@/lib/agent/plugins";
import type { ChatMessage, ToolExecutionResult } from "@/lib/agent/tools";

const MAX_TOOL_ROUNDS = 8;

function stringifyToolResult(result: ToolExecutionResult): string {
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}

export async function POST(req: NextRequest) {
  try {
    const { message, conversationId, provider } = (await req.json()) as {
      message: string;
      conversationId?: string;
      provider?: string;
    };

    const userId = "local-user";
    const resolvedConversationId = await getOrCreateConversation(conversationId, userId);
    const runtimeConfig = getAgentRuntimeConfig();

    const contextBlock = await buildContext(message, resolvedConversationId, userId);
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are BizBot, a local desktop social media agent. Use tools when they improve correctness, prefer deterministic tool outputs over guessing, and keep responses operational."
          + ` ${buildAutonomySystemPrompt(runtimeConfig)}`
          + (contextBlock ? `\n\nContext:\n${contextBlock}` : ""),
      },
      { role: "user", content: message },
    ];

    await saveMessage(resolvedConversationId, "USER", message, { userId });

    const tools = getAllToolDefinitions(runtimeConfig);
    let round = 0;

    while (round < MAX_TOOL_ROUNDS) {
      round++;
      const response = await chatComplete(messages, provider as LLMProvider | undefined, tools);

      if (response.toolCalls.length > 0) {
        const assistantToolMessage: ChatMessage = {
          role: "assistant",
          content: response.content,
          toolCalls: response.toolCalls,
        };
        messages.push(assistantToolMessage);

        for (const toolCall of response.toolCalls) {
          let result: ToolExecutionResult;
          try {
            result = await executeTool(toolCall.name, toolCall.arguments);
          } catch (err) {
            result = { error: String(err) };
          }

          messages.push({
            role: "tool",
            name: toolCall.name,
            content: stringifyToolResult(result),
            toolCallId: toolCall.id,
          });
        }

        continue;
      }

      const assistantContent = response.content;

      await saveMessage(resolvedConversationId, "ASSISTANT", assistantContent, {
        userId,
        toolRoundCount: round,
      });

      return Response.json({
        reply: assistantContent,
        conversationId: resolvedConversationId,
      });
    }

    const fallback = "I reached the maximum number of tool-use steps. Please try a simpler request.";
    await saveMessage(resolvedConversationId, "ASSISTANT", fallback, {
      userId,
      toolRoundCount: MAX_TOOL_ROUNDS,
    });
    return Response.json({ reply: fallback, conversationId: resolvedConversationId });
  } catch (err) {
    console.error("[agent route]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
