/**
 * POST /api/agent
 * Receives a user message and returns either JSON or an SSE stream of agent execution events.
 */

import { NextRequest } from "next/server";
import { executeAgentConversation, type AgentExecutionEvent } from "@/lib/agent/executor";
import type { LLMProvider } from "@/lib/agent/kernel";

function toSseChunk(event: string, payload: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(req: NextRequest) {
  try {
    const { message, conversationId, provider, stream } = (await req.json()) as {
      message: string;
      conversationId?: string;
      provider?: string;
      stream?: boolean;
    };

    if (stream) {
      const encoder = new TextEncoder();
      const responseStream = new ReadableStream<Uint8Array>({
        start(controller) {
          void (async () => {
            try {
              await executeAgentConversation({
                message,
                conversationId,
                provider: provider as LLMProvider | undefined,
                onEvent: async (event: AgentExecutionEvent) => {
                  controller.enqueue(encoder.encode(toSseChunk(event.type, event)));
                },
              });
            } catch (error) {
              controller.enqueue(
                encoder.encode(
                  toSseChunk("error", { type: "error", error: String(error) }),
                ),
              );
            } finally {
              controller.close();
            }
          })();
        },
      });

      return new Response(responseStream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    const result = await executeAgentConversation({
      message,
      conversationId,
      provider: provider as LLMProvider | undefined,
    });

    return Response.json({
      reply: result.reply,
      conversationId: result.conversationId,
      profile: result.profile,
      provider: result.provider,
      model: result.model,
    });
  } catch (err) {
    console.error("[agent route]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
