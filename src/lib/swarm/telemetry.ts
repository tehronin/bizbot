import type { SwarmExecutionPlan, SwarmTrace, SwarmValidationResult, SwarmWorkerResult } from "@/lib/swarm/types";

export function summarizeSwarmPlan(plan: SwarmExecutionPlan): {
  id: string;
  mode: string;
  reason: string;
  taskSummary: string;
  workerCount: number;
  aggregationStrategy: string;
  failurePolicy: string;
  plannerConfidence: number;
  createdAt: string;
} {
  return {
    id: plan.id,
    mode: plan.mode,
    reason: plan.reason,
    taskSummary: plan.taskSummary,
    workerCount: plan.workItems.length,
    aggregationStrategy: plan.aggregationStrategy,
    failurePolicy: plan.failurePolicy,
    plannerConfidence: plan.plannerConfidence,
    createdAt: plan.createdAt,
  };
}

export function summarizeSwarmWorkerResults(results: SwarmWorkerResult[]): Array<{
  workItemId: string;
  status: string;
  diagnostics: string[];
  durationMs: number;
}> {
  return results.map((result) => ({
    workItemId: result.workItemId,
    status: result.status,
    diagnostics: result.diagnostics,
    durationMs: result.metrics.durationMs,
  }));
}

export function summarizeSwarmExecution(args: {
  plan: SwarmExecutionPlan;
  trace: SwarmTrace;
  validation: SwarmValidationResult;
  results: SwarmWorkerResult[];
}) {
  return {
    plan: summarizeSwarmPlan(args.plan),
    trace: args.trace,
    validation: args.validation,
    results: summarizeSwarmWorkerResults(args.results),
  };
}