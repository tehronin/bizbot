import { getBuilderTask } from "@/lib/builder/tasks";
import { normalizeBuilderTaskMetadata } from "@/lib/builder/types";

export async function GET(
  _req: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await context.params;
    const task = await getBuilderTask(taskId);
    const metadata = normalizeBuilderTaskMetadata(task.metadata);
    return Response.json({
      taskId: task.id,
      status: task.status,
      stage: task.stage,
      currentIteration: metadata.currentIteration ?? null,
      maxIterations: metadata.maxIterations ?? null,
      loopPhase: metadata.loopPhase ?? null,
      latestLoopSummary: metadata.latestLoopSummary ?? null,
    });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
