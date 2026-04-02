import type { BuilderTaskStage, BuilderTaskStatus } from "@prisma/client";

export interface BuilderPlanStep {
  id: string;
  label: string;
  status: "pending" | "in_progress" | "completed";
  notes?: string;
}

export interface BuilderInstructionFragment {
  source: string;
  heading: string;
  content: string;
}

export interface BuilderProjectContextState {
  objective: string | null;
  architectureNotes: string[];
  codingConventions: string[];
  constraints: string[];
  importantCommands: string[];
  currentPlan: BuilderPlanStep[];
  latestSessionSummary: string | null;
  knownFailures: string[];
  nextSteps: string[];
  instructionNotes: string | null;
  updatedAt: string | null;
}

export interface BuilderTaskMetadataState {
  retryCount: number;
  lastStageError: string | null;
  lastAttemptedStage: BuilderTaskStage | null;
  planSteps: BuilderPlanStep[];
  lastUserRequest: string | null;
  requestedProfile: string | null;
  requestedModel: string | null;
  lastRetryAt: string | null;
  currentIteration: number | null;
  maxIterations: number | null;
  loopPhase: string | null;
  latestLoopSummary: string | null;
  resumeFromIteration: number | null;
  lastRunId: string | null;
}

export interface BuilderStructuredValidationSummary {
  passed: boolean;
  skipped: boolean;
  summary: string;
  scripts: string[];
}

export interface BuilderStructuredCheckSummary {
  passed: boolean | null;
  exitCode: number | null;
  summary: string | null;
}

export interface BuilderStructuredReview {
  taskId: string;
  projectId: string;
  status: BuilderTaskStatus | string;
  stage: BuilderTaskStage | string;
  summary: string;
  filesChanged: string[];
  commandsExecuted: string[];
  validation: BuilderStructuredValidationSummary;
  tests: BuilderStructuredCheckSummary;
  lint: BuilderStructuredCheckSummary;
  build: BuilderStructuredCheckSummary;
  risks: string[];
  nextSteps: string[];
  updatedAt: string;
}

export function defaultBuilderProjectContext(): BuilderProjectContextState {
  return {
    objective: null,
    architectureNotes: [],
    codingConventions: [],
    constraints: [],
    importantCommands: [],
    currentPlan: [],
    latestSessionSummary: null,
    knownFailures: [],
    nextSteps: [],
    instructionNotes: null,
    updatedAt: null,
  };
}

export function defaultBuilderTaskMetadata(): BuilderTaskMetadataState {
  return {
    retryCount: 0,
    lastStageError: null,
    lastAttemptedStage: null,
    planSteps: [],
    lastUserRequest: null,
    requestedProfile: null,
    requestedModel: null,
    lastRetryAt: null,
    currentIteration: null,
    maxIterations: null,
    loopPhase: null,
    latestLoopSummary: null,
    resumeFromIteration: null,
    lastRunId: null,
  };
}

export function normalizePlanSteps(value: unknown): BuilderPlanStep[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const candidate = entry as Record<string, unknown>;
    const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
    if (!label) {
      return [];
    }

    const status = candidate.status === "completed"
      ? "completed"
      : candidate.status === "in_progress"
        ? "in_progress"
        : "pending";

    return [{
      id: typeof candidate.id === "string" && candidate.id.trim()
        ? candidate.id.trim()
        : `step-${index + 1}`,
      label,
      status,
      ...(typeof candidate.notes === "string" && candidate.notes.trim() ? { notes: candidate.notes.trim() } : {}),
    }];
  });
}

export function normalizeBuilderProjectContext(value: unknown): BuilderProjectContextState {
  const defaults = defaultBuilderProjectContext();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const candidate = value as Record<string, unknown>;
  const readStringArray = (input: unknown): string[] => Array.isArray(input)
    ? input.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : [])
    : [];

  return {
    objective: typeof candidate.objective === "string" && candidate.objective.trim() ? candidate.objective.trim() : null,
    architectureNotes: readStringArray(candidate.architectureNotes),
    codingConventions: readStringArray(candidate.codingConventions),
    constraints: readStringArray(candidate.constraints),
    importantCommands: readStringArray(candidate.importantCommands),
    currentPlan: normalizePlanSteps(candidate.currentPlan),
    latestSessionSummary: typeof candidate.latestSessionSummary === "string" && candidate.latestSessionSummary.trim() ? candidate.latestSessionSummary.trim() : null,
    knownFailures: readStringArray(candidate.knownFailures),
    nextSteps: readStringArray(candidate.nextSteps),
    instructionNotes: typeof candidate.instructionNotes === "string" && candidate.instructionNotes.trim() ? candidate.instructionNotes.trim() : null,
    updatedAt: typeof candidate.updatedAt === "string" && candidate.updatedAt.trim() ? candidate.updatedAt.trim() : null,
  };
}

export function normalizeBuilderTaskMetadata(value: unknown): BuilderTaskMetadataState {
  const defaults = defaultBuilderTaskMetadata();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const candidate = value as Record<string, unknown>;
  const readPositiveInteger = (input: unknown): number | null =>
    typeof input === "number" && Number.isFinite(input) && input > 0
      ? Math.trunc(input)
      : null;
  return {
    retryCount: typeof candidate.retryCount === "number" && Number.isFinite(candidate.retryCount) ? candidate.retryCount : defaults.retryCount,
    lastStageError: typeof candidate.lastStageError === "string" && candidate.lastStageError.trim() ? candidate.lastStageError.trim() : null,
    lastAttemptedStage: typeof candidate.lastAttemptedStage === "string" ? candidate.lastAttemptedStage as BuilderTaskStage : null,
    planSteps: normalizePlanSteps(candidate.planSteps),
    lastUserRequest: typeof candidate.lastUserRequest === "string" && candidate.lastUserRequest.trim() ? candidate.lastUserRequest.trim() : null,
    requestedProfile: typeof candidate.requestedProfile === "string" && candidate.requestedProfile.trim() ? candidate.requestedProfile.trim() : null,
    requestedModel: typeof candidate.requestedModel === "string" && candidate.requestedModel.trim() ? candidate.requestedModel.trim() : null,
    lastRetryAt: typeof candidate.lastRetryAt === "string" && candidate.lastRetryAt.trim() ? candidate.lastRetryAt.trim() : null,
    currentIteration: readPositiveInteger(candidate.currentIteration),
    maxIterations: readPositiveInteger(candidate.maxIterations),
    loopPhase: typeof candidate.loopPhase === "string" && candidate.loopPhase.trim() ? candidate.loopPhase.trim() : null,
    latestLoopSummary: typeof candidate.latestLoopSummary === "string" && candidate.latestLoopSummary.trim() ? candidate.latestLoopSummary.trim() : null,
    resumeFromIteration: readPositiveInteger(candidate.resumeFromIteration),
    lastRunId: typeof candidate.lastRunId === "string" && candidate.lastRunId.trim() ? candidate.lastRunId.trim() : null,
  };
}

export function trimReviewSummary(value: string, maxChars = 240): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars - 1).trimEnd()}…`;
}