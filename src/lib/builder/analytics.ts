import type { BuilderRun, BuilderTask } from "@prisma/client";
import { db } from "@/lib/db";
import type { BuilderPlanningSnapshot, BuilderProjectContextState, BuilderStructuredReview } from "@/lib/builder/types";

export interface BuilderStats {
  totalRuns: number;
  totalTasksRun: number;
  successRate: number;
  verificationPassRate: number;
  retryRate: number;
  avgIterationsPerTask: number;
  avgIterationsPerRun: number;
  statusCounts: Record<string, number>;
}

export interface BuilderHealthMetrics {
  efficiency: {
    successRate: number;
    verificationPassRate: number;
    retryRate: number;
    avgIterationsPerRun: number;
    avgIterationsPerTask: number;
    tasksInRetry: number;
  };
  promotion: {
    completedMilestones: number;
    totalMilestones: number;
    milestoneCompletionRate: number;
    completedTaskSpecs: number;
    blockedTaskSpecs: number;
    totalTaskSpecs: number;
    taskSpecCompletionRate: number;
  };
  architecture: {
    activeDecisionCount: number;
    staleDecisionCount: number;
    currentTaskDecisionCount: number;
    latestAddressedStaleCount: number;
    latestMissingStaleCount: number;
    latestNewDecisionCount: number;
    latestRetiredDecisionCount: number;
  };
}

function getRunLoopMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const loop = (metadata as Record<string, unknown>).loop;
  return loop && typeof loop === "object" && !Array.isArray(loop)
    ? loop as Record<string, unknown>
    : null;
}

function getRunReview(metadata: unknown): BuilderStructuredReview | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const review = (metadata as Record<string, unknown>).review;
  return review && typeof review === "object" && !Array.isArray(review)
    ? review as BuilderStructuredReview
    : null;
}

function getIterationCount(metadata: unknown): number {
  const loop = getRunLoopMetadata(metadata);
  if (!loop) {
    return 1;
  }

  const iterations = loop.iterations;
  return Array.isArray(iterations) && iterations.length > 0 ? iterations.length : 1;
}

function getVerificationOutcome(metadata: unknown): { passed: boolean; skipped: boolean } | null {
  const review = getRunReview(metadata);
  if (review?.validation) {
    return {
      passed: review.validation.passed,
      skipped: review.validation.skipped,
    };
  }

  const loop = getRunLoopMetadata(metadata);
  if (!loop) {
    return null;
  }

  return {
    passed: loop.verified === true,
    skipped: loop.verificationSkipped === true,
  };
}

function roundMetric(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function summarizeRunMetrics(runs: Array<Pick<BuilderRun, "taskId" | "status" | "metadata">>): BuilderStats {
  if (runs.length === 0) {
    return {
      totalRuns: 0,
      totalTasksRun: 0,
      successRate: 0,
      verificationPassRate: 0,
      retryRate: 0,
      avgIterationsPerTask: 0,
      avgIterationsPerRun: 0,
      statusCounts: {},
    };
  }

  const statusCounts: Record<string, number> = {};
  const iterationsPerRun = runs.map((run) => getIterationCount(run.metadata));
  const iterationsByTask = new Map<string, number[]>();
  let deterministicVerificationRuns = 0;
  let deterministicVerificationPasses = 0;
  let retryingRuns = 0;

  runs.forEach((run, index) => {
    statusCounts[run.status] = (statusCounts[run.status] ?? 0) + 1;

    const iterationCount = iterationsPerRun[index] ?? 1;
    if (iterationCount > 1) {
      retryingRuns += 1;
    }

    if (run.taskId) {
      const current = iterationsByTask.get(run.taskId) ?? [];
      current.push(iterationCount);
      iterationsByTask.set(run.taskId, current);
    }

    const verification = getVerificationOutcome(run.metadata);
    if (verification && !verification.skipped) {
      deterministicVerificationRuns += 1;
      if (verification.passed) {
        deterministicVerificationPasses += 1;
      }
    }
  });

  const totalIterations = iterationsPerRun.reduce((sum, count) => sum + count, 0);
  const totalTaskIterations = Array.from(iterationsByTask.values())
    .reduce((sum, counts) => sum + counts.reduce((taskSum, count) => taskSum + count, 0), 0);
  const succeeded = statusCounts.SUCCEEDED ?? 0;

  return {
    totalRuns: runs.length,
    totalTasksRun: iterationsByTask.size,
    successRate: roundMetric(succeeded / runs.length),
    verificationPassRate: roundMetric(deterministicVerificationRuns > 0 ? deterministicVerificationPasses / deterministicVerificationRuns : 0),
    retryRate: roundMetric(retryingRuns / runs.length),
    avgIterationsPerTask: roundMetric(iterationsByTask.size > 0 ? totalTaskIterations / iterationsByTask.size : 0),
    avgIterationsPerRun: roundMetric(totalIterations / runs.length),
    statusCounts,
  };
}

export function summarizeBuilderProjectMetrics(args: {
  runs: Array<Pick<BuilderRun, "taskId" | "status" | "metadata">>;
  tasks: Array<Pick<BuilderTask, "metadata">>;
  planning: BuilderPlanningSnapshot;
  context: BuilderProjectContextState;
  latestReview: BuilderStructuredReview | null;
}): BuilderHealthMetrics {
  const runMetrics = summarizeRunMetrics(args.runs);
  const tasksInRetry = args.tasks.filter((task) => {
    const metadata = task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
      ? task.metadata as Record<string, unknown>
      : null;
    const retryCount = typeof metadata?.retryCount === "number" ? metadata.retryCount : 0;
    const currentIteration = typeof metadata?.currentIteration === "number" ? metadata.currentIteration : 0;
    return retryCount > 0 || currentIteration > 1;
  }).length;
  const milestones = args.planning.milestones;
  const taskSpecs = milestones.flatMap((milestone) => milestone.taskSpecs);
  const completedMilestones = milestones.filter((milestone) => milestone.status === "COMPLETE").length;
  const completedTaskSpecs = taskSpecs.filter((taskSpec) => taskSpec.status === "COMPLETE").length;
  const blockedTaskSpecs = taskSpecs.filter((taskSpec) => taskSpec.status === "BLOCKED").length;
  const architecture = args.context.architecture ?? { active: [], stale: [] };

  return {
    efficiency: {
      successRate: runMetrics.successRate,
      verificationPassRate: runMetrics.verificationPassRate,
      retryRate: runMetrics.retryRate,
      avgIterationsPerRun: runMetrics.avgIterationsPerRun,
      avgIterationsPerTask: runMetrics.avgIterationsPerTask,
      tasksInRetry,
    },
    promotion: {
      completedMilestones,
      totalMilestones: milestones.length,
      milestoneCompletionRate: roundMetric(milestones.length > 0 ? completedMilestones / milestones.length : 0),
      completedTaskSpecs,
      blockedTaskSpecs,
      totalTaskSpecs: taskSpecs.length,
      taskSpecCompletionRate: roundMetric(taskSpecs.length > 0 ? completedTaskSpecs / taskSpecs.length : 0),
    },
    architecture: {
      activeDecisionCount: architecture.active.length,
      staleDecisionCount: architecture.stale.length,
      currentTaskDecisionCount: args.planning.currentTaskSpec?.architecturalDecisionKeys.length ?? 0,
      latestAddressedStaleCount: args.latestReview?.architecture?.addressedStaleKeys.length ?? 0,
      latestMissingStaleCount: args.latestReview?.architecture?.missingStaleKeys.length ?? 0,
      latestNewDecisionCount: args.latestReview?.architecture?.newDecisionKeys.length ?? 0,
      latestRetiredDecisionCount: args.latestReview?.architecture?.retiredDecisionKeys.length ?? 0,
    },
  };
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

  return summarizeRunMetrics(runs);
}