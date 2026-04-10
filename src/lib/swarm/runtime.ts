import type { SwarmExecutionPlan, SwarmTrace, SwarmWorkerResult, SwarmWorkItem } from "@/lib/swarm/types";

export async function executeSwarmPlan<TOutput extends Record<string, unknown>>(
  plan: SwarmExecutionPlan,
  worker: (workItem: SwarmWorkItem) => Promise<TOutput>,
): Promise<{ results: SwarmWorkerResult[]; trace: SwarmTrace }> {
  const startedAt = new Date();

  const results = await Promise.all(plan.workItems.map(async (workItem) => {
    const itemStartedAt = Date.now();
    try {
      const output = await worker(workItem);
      return {
        id: `${plan.id}:${workItem.id}`,
        workItemId: workItem.id,
        status: "completed" as const,
        output,
        diagnostics: [],
        metrics: {
          durationMs: Date.now() - itemStartedAt,
        },
      } satisfies SwarmWorkerResult;
    } catch (error) {
      return {
        id: `${plan.id}:${workItem.id}`,
        workItemId: workItem.id,
        status: "failed" as const,
        output: {},
        diagnostics: [error instanceof Error ? error.message : String(error)],
        metrics: {
          durationMs: Date.now() - itemStartedAt,
        },
      } satisfies SwarmWorkerResult;
    }
  }));

  const finishedAt = new Date();
  return {
    results,
    trace: {
      planId: plan.id,
      mode: plan.mode,
      workerCount: plan.workItems.length,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    },
  };
}