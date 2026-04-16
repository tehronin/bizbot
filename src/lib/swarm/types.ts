export type SwarmExecutionMode = "core_chat_swarm" | "builder_swarm" | "oracle_swarm";

export type SwarmFailurePolicy = "fail_closed" | "fallback_to_single_agent";

export type SwarmAggregationStrategy = "chat_brain_synthesis" | "deterministic_merge";

export type SwarmValidationRule =
  | "all_work_items_completed"
  | "structured_outputs_only"
  | "evidence_required_for_claims"
  | "deterministic_ordering";

export type SwarmWorkItemStatus = "completed" | "failed";

export interface SwarmWorkItem {
  id: string;
  type: string;
  sourceId: string;
  sourceKind: string;
  operation: string;
  instructions: string[];
  constraints: {
    maxOutputChars?: number;
    mustIncludeEvidenceRefs?: boolean;
    allowToolCalls?: boolean;
  };
  payload: Record<string, unknown>;
}

export interface SwarmExecutionPlan {
  id: string;
  mode: SwarmExecutionMode;
  reason: string;
  taskSummary: string;
  workItems: SwarmWorkItem[];
  aggregationStrategy: SwarmAggregationStrategy;
  validationRules: SwarmValidationRule[];
  failurePolicy: SwarmFailurePolicy;
  plannerConfidence: number;
  createdAt: string;
}

export interface SwarmWorkerResult {
  id: string;
  workItemId: string;
  status: SwarmWorkItemStatus;
  output: Record<string, unknown>;
  diagnostics: string[];
  metrics: {
    durationMs: number;
  };
}

export interface SwarmTrace {
  planId: string;
  mode: SwarmExecutionMode;
  workerCount: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface SwarmValidationResult {
  valid: boolean;
  issues: string[];
  completedWorkItemIds: string[];
  failedWorkItemIds: string[];
  missingWorkItemIds: string[];
}