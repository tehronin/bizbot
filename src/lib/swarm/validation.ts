import type { SwarmExecutionPlan, SwarmValidationResult, SwarmWorkerResult } from "@/lib/swarm/types";

export function validateSwarmResults(plan: SwarmExecutionPlan, results: SwarmWorkerResult[]): SwarmValidationResult {
  const completedWorkItemIds = results.filter((result) => result.status === "completed").map((result) => result.workItemId);
  const failedWorkItemIds = results.filter((result) => result.status === "failed").map((result) => result.workItemId);
  const missingWorkItemIds = plan.workItems
    .map((workItem) => workItem.id)
    .filter((workItemId) => !results.some((result) => result.workItemId === workItemId));
  const issues: string[] = [];

  if (missingWorkItemIds.length > 0) {
    issues.push(`Missing worker results for: ${missingWorkItemIds.join(", ")}.`);
  }
  if (failedWorkItemIds.length > 0) {
    issues.push(`Worker failures for: ${failedWorkItemIds.join(", ")}.`);
  }
  if (results.some((result) => typeof result.output !== "object" || result.output === null || Array.isArray(result.output))) {
    issues.push("One or more worker outputs were not structured objects.");
  }

  return {
    valid: issues.length === 0,
    issues,
    completedWorkItemIds,
    failedWorkItemIds,
    missingWorkItemIds,
  };
}