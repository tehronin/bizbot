import { db } from "@/lib/db";

export interface BuilderStats {
  totalRuns: number;
  totalTasksRun: number;
  successRate: number;
  avgIterationsPerTask: number;
  avgIterationsPerRun: number;
  statusCounts: Record<string, number>;
}

function getIterationCount(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return 1;
  }

  const loop = "loop" in metadata ? (metadata as Record<string, unknown>).loop : null;
  if (!loop || typeof loop !== "object" || Array.isArray(loop)) {
    return 1;
  }

  const iterations = "iterations" in loop ? (loop as Record<string, unknown>).iterations : null;
  return Array.isArray(iterations) && iterations.length > 0 ? iterations.length : 1;
}

function roundMetric(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

export async function getBuilderStats(projectId?: string): Promise<BuilderStats> {
  const runs = await db.builderRun.findMany({
    where: projectId ? { projectId } : undefined,
    select: {
      id: true,
      taskId: true,
      status: true,
      metadata: true,
    },
  });

  if (runs.length === 0) {
    return {
      totalRuns: 0,
      totalTasksRun: 0,
      successRate: 0,
      avgIterationsPerTask: 0,
      avgIterationsPerRun: 0,
      statusCounts: {},
    };
  }

  const statusCounts: Record<string, number> = {};
  const iterationsPerRun = runs.map((run) => getIterationCount(run.metadata));
  const iterationsByTask = new Map<string, number[]>();

  runs.forEach((run, index) => {
    statusCounts[run.status] = (statusCounts[run.status] ?? 0) + 1;
    if (run.taskId) {
      const current = iterationsByTask.get(run.taskId) ?? [];
      current.push(iterationsPerRun[index] ?? 1);
      iterationsByTask.set(run.taskId, current);
    }
  });

  const totalIterations = iterationsPerRun.reduce((sum, count) => sum + count, 0);
  const totalTaskIterations = Array.from(iterationsByTask.values())
    .reduce((sum, counts) => sum + counts.reduce((taskSum, count) => taskSum + count, 0), 0);
  const succeeded = statusCounts.SUCCEEDED ?? 0;

  return {
    totalRuns: runs.length,
    totalTasksRun: runs.length,
    successRate: roundMetric(succeeded / runs.length),
    avgIterationsPerTask: roundMetric(iterationsByTask.size > 0 ? totalTaskIterations / iterationsByTask.size : 0),
    avgIterationsPerRun: roundMetric(totalIterations / runs.length),
    statusCounts,
  };
}