import { completeBuilderRun, getBuilderRun, updateBuilderRun } from "@/lib/builder/projects";
import { cancelBuilderRunController } from "@/lib/builder/session";
import { updateBuilderTask } from "@/lib/builder/tasks";

export async function cancelBuilderProjectRun(runId: string): Promise<{ runId: string; status: "CANCELLED" | "NOT_RUNNING" }> {
  const cancelled = cancelBuilderRunController(runId);
  const run = await getBuilderRun(runId);
  if (run.status !== "RUNNING") {
    return { runId, status: "NOT_RUNNING" };
  }

  if (cancelled) {
    await updateBuilderRun(runId, {
      summary: "Cancellation requested.",
    });
    return { runId, status: "CANCELLED" };
  }

  await completeBuilderRun(runId, {
    status: "CANCELLED",
    summary: "Cancelled after the live Builder controller was no longer attached to this run.",
    metadata: {
      ...(run.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata) ? run.metadata as Record<string, unknown> : {}),
      cancellationReason: "missing_live_controller",
    },
  });

  if (run.taskId) {
    await updateBuilderTask(run.taskId, {
      status: "CANCELLED",
      summary: "Cancelled after the live Builder controller was no longer attached to the run.",
    }).catch(() => undefined);
  }

  return { runId, status: "CANCELLED" };
}