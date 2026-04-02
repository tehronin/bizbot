import { NextRequest } from "next/server";
import { getBuilderProjectOverview, launchBuilderTask } from "@/lib/builder/orchestrator";

function parseTaskPayload(value: object | null): {
  request: string;
  taskId?: string;
  retryFailed?: boolean;
  fromIteration?: number;
  profile?: string;
  model?: string;
} {
  if (!value || Array.isArray(value)) {
    throw new Error("Invalid builder task payload.");
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.request !== "string" || !candidate.request.trim()) {
    throw new Error("Builder task request is required.");
  }

  return {
    request: candidate.request,
    taskId: typeof candidate.taskId === "string" ? candidate.taskId : undefined,
    retryFailed: typeof candidate.retryFailed === "boolean" ? candidate.retryFailed : undefined,
    fromIteration: typeof candidate.fromIteration === "number" && Number.isFinite(candidate.fromIteration) && candidate.fromIteration > 0
      ? Math.trunc(candidate.fromIteration)
      : undefined,
    profile: typeof candidate.profile === "string" ? candidate.profile : undefined,
    model: typeof candidate.model === "string" ? candidate.model : undefined,
  };
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const overview = await getBuilderProjectOverview(id);
    return Response.json({ tasks: overview.tasks, currentTask: overview.currentTask, nextRecommendedStep: overview.nextRecommendedStep });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const payload = parseTaskPayload(await req.json());
    const execution = await launchBuilderTask(id, payload);
    return Response.json(execution, { status: 202 });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}