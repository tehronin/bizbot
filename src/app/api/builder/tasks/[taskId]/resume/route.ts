import { NextRequest } from "next/server";
import { launchBuilderTask } from "@/lib/builder/orchestrator";
import { getBuilderTask } from "@/lib/builder/tasks";
import { normalizeBuilderTaskMetadata } from "@/lib/builder/types";

function parseResumePayload(value: object | null): {
  request?: string;
  fromIteration?: number;
  profile?: string;
  model?: string;
} {
  if (!value || Array.isArray(value)) {
    return {};
  }

  const candidate = value as Record<string, unknown>;
  return {
    request: typeof candidate.request === "string" && candidate.request.trim() ? candidate.request.trim() : undefined,
    fromIteration: typeof candidate.fromIteration === "number" && Number.isFinite(candidate.fromIteration) && candidate.fromIteration > 0
      ? Math.trunc(candidate.fromIteration)
      : undefined,
    profile: typeof candidate.profile === "string" && candidate.profile.trim() ? candidate.profile.trim() : undefined,
    model: typeof candidate.model === "string" && candidate.model.trim() ? candidate.model.trim() : undefined,
  };
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await context.params;
    const task = await getBuilderTask(taskId);
    const payload = parseResumePayload(await req.json().catch(() => null));
    const metadata = normalizeBuilderTaskMetadata(task.metadata);
    const request = payload.request ?? metadata.lastUserRequest ?? task.description;
    const execution = await launchBuilderTask(task.projectId, {
      request,
      taskId,
      retryFailed: true,
      fromIteration: payload.fromIteration,
      profile: payload.profile,
      model: payload.model,
    });
    return Response.json(execution, { status: 202 });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}