import { NextRequest } from "next/server";
import { getBuilderProject } from "@/lib/builder/projects";
import { getBuilderRuntimeServiceLogs, resolveBuilderRuntimeService } from "@/lib/builder/runtime-orchestration";

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
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const serviceId = req.nextUrl.searchParams.get("serviceId");
    if (!serviceId) {
      throw new Error("Service id is required.");
    }
    const project = await getBuilderProject(id);
    const service = resolveBuilderRuntimeService({
      projectId: id,
      projectRelativePath: project.relativePath,
      packageManager: project.packageManager,
      serviceId,
    });
    const initialCursor = parseOptionalNumber(req.nextUrl.searchParams.get("cursor"));
    const maxBytes = parseOptionalNumber(req.nextUrl.searchParams.get("maxBytes"));
    const tailBytes = parseOptionalNumber(req.nextUrl.searchParams.get("tailBytes")) ?? 6000;
    const encoder = new TextEncoder();

    const responseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        void (async () => {
          let cursor = initialCursor;
          let initialTailBytes: number | undefined = tailBytes;
          let lastStateKey: string | null = null;

          try {
            controller.enqueue(encoder.encode(toSseChunk("open", { type: "open", serviceId, cursor, service })));

            if (service.status === "declared" && !service.processId && !service.containerId) {
              controller.enqueue(encoder.encode(toSseChunk("state", { type: "state", serviceId, service })));
              controller.enqueue(encoder.encode(toSseChunk("complete", { type: "complete", serviceId, nextCursor: 0, service })));
              controller.close();
              return;
            }

            while (!req.signal.aborted) {
              const currentService = resolveBuilderRuntimeService({
                projectId: id,
                projectRelativePath: project.relativePath,
                packageManager: project.packageManager,
                serviceId,
              });
              const result = await getBuilderRuntimeServiceLogs({
                projectId: id,
                projectRelativePath: project.relativePath,
                packageManager: project.packageManager,
                serviceId,
                cursor,
                maxBytes,
                tailBytes: cursor === undefined ? initialTailBytes : undefined,
                followSeconds: LIVE_STREAM_FOLLOW_SECONDS,
              });

              initialTailBytes = undefined;

              const nextStateKey = [currentService.status, currentService.processId ?? "", currentService.containerId ?? "", currentService.healthStatus].join(":");
              if (lastStateKey !== nextStateKey) {
                controller.enqueue(encoder.encode(toSseChunk("state", {
                  type: "state",
                  serviceId,
                  service: currentService,
                })));
                lastStateKey = nextStateKey;
              }

              if (result.logs) {
                controller.enqueue(encoder.encode(toSseChunk("log", {
                  type: "log",
                  serviceId,
                  cursorUsed: result.cursorUsed,
                  nextCursor: result.nextCursor,
                  truncatedBeforeCursor: result.truncatedBeforeCursor,
                  logs: result.logs,
                  service: result.service,
                })));
              } else if (result.followTimedOut) {
                controller.enqueue(encoder.encode(toSseChunk("heartbeat", {
                  type: "heartbeat",
                  serviceId,
                  nextCursor: result.nextCursor,
                  service: result.service,
                })));
              }

              cursor = result.nextCursor;

              if (result.complete) {
                controller.enqueue(encoder.encode(toSseChunk("complete", {
                  type: "complete",
                  serviceId,
                  nextCursor: result.nextCursor,
                  service: result.service,
                })));
                controller.close();
                return;
              }
            }
          } catch (error) {
            controller.enqueue(encoder.encode(toSseChunk("error", { type: "error", serviceId, error: String(error) })));
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
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}