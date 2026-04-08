import { NextRequest } from "next/server";
import { streamBuilderManagedProcessLogs } from "@/lib/builder/process-registry";

const LIVE_STREAM_FOLLOW_SECONDS = 25;

function toSseChunk(event: string, payload: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function parseOptionalNumber(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ processId: string }> },
) {
  const { processId } = await context.params;
  const initialCursor = parseOptionalNumber(req.nextUrl.searchParams.get("cursor"));
  const maxBytes = parseOptionalNumber(req.nextUrl.searchParams.get("maxBytes"));
  const tailBytes = parseOptionalNumber(req.nextUrl.searchParams.get("tailBytes"));
  const encoder = new TextEncoder();

  const responseStream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        let cursor = initialCursor;
        let initialTailBytes = tailBytes;
        let lastStatus: string | null = null;

        try {
          controller.enqueue(encoder.encode(toSseChunk("open", { type: "open", processId, cursor })));

          while (!req.signal.aborted) {
            const result = await streamBuilderManagedProcessLogs({
              processId,
              cursor,
              maxBytes,
              tailBytes: cursor === undefined ? initialTailBytes : undefined,
              followSeconds: LIVE_STREAM_FOLLOW_SECONDS,
            });

            initialTailBytes = undefined;

            if (lastStatus !== result.process.status) {
              controller.enqueue(encoder.encode(toSseChunk("state", {
                type: "state",
                processId,
                process: result.process,
              })));
              lastStatus = result.process.status;
            }

            if (result.logs) {
              controller.enqueue(encoder.encode(toSseChunk("log", {
                type: "log",
                processId,
                cursorUsed: result.cursorUsed,
                nextCursor: result.nextCursor,
                truncatedBeforeCursor: result.truncatedBeforeCursor,
                logs: result.logs,
                process: result.process,
              })));
            } else if (result.followTimedOut) {
              controller.enqueue(encoder.encode(toSseChunk("heartbeat", {
                type: "heartbeat",
                processId,
                nextCursor: result.nextCursor,
                process: result.process,
              })));
            }

            cursor = result.nextCursor;

            if (result.complete) {
              controller.enqueue(encoder.encode(toSseChunk("complete", {
                type: "complete",
                processId,
                nextCursor: result.nextCursor,
                process: result.process,
              })));
              controller.close();
              return;
            }
          }
        } catch (error) {
          controller.enqueue(encoder.encode(toSseChunk("error", {
            type: "error",
            processId,
            error: String(error),
          })));
          controller.close();
          return;
        }

        controller.close();
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