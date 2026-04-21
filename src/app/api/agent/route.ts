/**
 * POST /api/agent
 * Receives a user message and returns either JSON or an SSE stream of agent execution events.
 */

import { NextRequest } from "next/server";
import { executeAgentConversation, type AgentExecutionEvent } from "@/lib/agent/executor";
import type { LLMProvider } from "@/lib/agent/kernel";
import type { AgentProfile } from "@/lib/agent/profiles";
import {
  normalizeChatMessageAttachments,
  resolveChatExecutionSelection,
} from "@/lib/chat/execution";
import { db } from "@/lib/db";

function toSseChunk(event: string, payload: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

async function recordAgentStreamAbort(): Promise<void> {
  await db.setting.upsert({
    where: { key: "agent_stream_abort_count" },
    update: { value: { increment: 1 } as never },
    create: { key: "agent_stream_abort_count", value: "1" },
  }).catch(async () => {
    const current = await db.setting.findUnique({ where: { key: "agent_stream_abort_count" } });
    const nextValue = String((current ? Number.parseInt(current.value, 10) || 0 : 0) + 1);
    await db.setting.upsert({
      where: { key: "agent_stream_abort_count" },
      update: { value: nextValue },
      create: { key: "agent_stream_abort_count", value: nextValue },
    });
  });

  await db.setting.upsert({
    where: { key: "agent_stream_last_aborted_at" },
    update: { value: new Date().toISOString() },
    create: { key: "agent_stream_last_aborted_at", value: new Date().toISOString() },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      message?: unknown;
      resumeRunId?: unknown;
      conversationId?: unknown;
      userId?: unknown;
      provider?: unknown;
      mode?: unknown;
      pluginId?: unknown;
      companyProfileId?: unknown;
      attachments?: unknown;
      stream?: unknown;
      oraclePrediction?: unknown;
      forcedProfile?: AgentProfile;
      parentRunId?: string;
      delegationReason?: string;
      delegatedByProfile?: AgentProfile;
    };

    if (
      body.forcedProfile !== undefined
      || body.parentRunId !== undefined
      || body.delegationReason !== undefined
      || body.delegatedByProfile !== undefined
    ) {
      return Response.json(
        { error: "Delegated execution fields are internal-only and cannot be supplied via the public agent API." },
        { status: 400 },
      );
    }

    const resumeRunId = typeof body.resumeRunId === "string" ? body.resumeRunId : undefined;
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message && !resumeRunId) {
      return Response.json({ error: "A non-empty message is required." }, { status: 400 });
    }

    const conversationId = typeof body.conversationId === "string" ? body.conversationId : undefined;
    const userId = typeof body.userId === "string" ? body.userId : undefined;
    const provider = typeof body.provider === "string" ? body.provider : undefined;
    const executionSelection = resolveChatExecutionSelection({
      mode: body.mode === "ask" || body.mode === "agent" ? body.mode : undefined,
      pluginId: typeof body.pluginId === "string" ? body.pluginId : undefined,
    });
    const companyProfileId = typeof body.companyProfileId === "string" && body.companyProfileId.trim()
      ? body.companyProfileId.trim()
      : undefined;
    const attachments = normalizeChatMessageAttachments(body.attachments);
    const stream = body.stream === true;
    const oraclePrediction = body.oraclePrediction === true;

    if (stream) {
      const encoder = new TextEncoder();
      const executionAbortController = new AbortController();
      let abortRecorded = false;
      const handleAbort = () => {
        executionAbortController.abort(new Error("Client disconnected"));
        if (!abortRecorded) {
          abortRecorded = true;
          void recordAgentStreamAbort();
        }
      };

      if (req.signal.aborted) {
        handleAbort();
      } else {
        req.signal.addEventListener("abort", handleAbort, { once: true });
      }

      const responseStream = new ReadableStream<Uint8Array>({
        start(controller) {
          void (async () => {
            try {
              await executeAgentConversation({
                message: message || `Resume agent run ${resumeRunId}`,
                conversationId,
                userId,
                provider: provider as LLMProvider | undefined,
                mode: executionSelection.mode,
                pluginId: executionSelection.pluginId,
                companyProfileId,
                attachments,
                oraclePrediction,
                resumeRunId,
                signal: executionAbortController.signal,
                onEvent: async (event: AgentExecutionEvent) => {
                  if (executionAbortController.signal.aborted) {
                    return;
                  }
                  controller.enqueue(encoder.encode(toSseChunk(event.type, event)));
                },
              });
            } catch (error) {
              if (!executionAbortController.signal.aborted) {
                controller.enqueue(
                  encoder.encode(
                    toSseChunk("error", { type: "error", error: String(error) }),
                  ),
                );
              }
            } finally {
              req.signal.removeEventListener("abort", handleAbort);
              if (!executionAbortController.signal.aborted) {
                controller.close();
              }
            }
          })();
        },
        cancel() {
          handleAbort();
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
      message: message || `Resume agent run ${resumeRunId}`,
      conversationId,
      userId,
      provider: provider as LLMProvider | undefined,
      mode: executionSelection.mode,
      pluginId: executionSelection.pluginId,
      companyProfileId,
      attachments,
      oraclePrediction,
      resumeRunId,
    });

    return Response.json({
      reply: result.reply,
      runId: result.runId,
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
