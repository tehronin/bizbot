import type {
  BuilderMilestoneStatus,
  BuilderProjectBrief,
  BuilderProjectLifecycle,
  BuilderTaskSpecStatus,
  BuilderTaskSpecValidator,
  BuilderTaskStage,
  BuilderTaskStatus,
} from "@prisma/client";

export interface BuilderArchitectureDecisionState {
  key: string;
  canonicalKey: string;
  displayName: string;
  description: string | null;
  confidence: number;
  status: string;
  source: string;
  updatedAt: string;
}

export interface BuilderArchitectureContextState {
  active: BuilderArchitectureDecisionState[];
  stale: BuilderArchitectureDecisionState[];
}

export interface BuilderArchitectureReconciliationState {
  activeKeys: string[];
  staleKeys: string[];
  reconfirmedStaleKeys: string[];
  addressedStaleKeys: string[];
  missingStaleKeys: string[];
  unreferencedActiveKeys: string[];
  conflictingDecisionKeys: string[];
  newDecisionKeys: string[];
  retiredDecisionKeys: string[];
}

export interface BuilderPlanAdherenceState {
  allowsExecution: boolean;
  mode: "analysis_only" | "scaffold" | "implementation" | "verification";
  summary: string;
  blockingIssues: string[];
  requiredDecisionKeys: string[];
  staleDecisionKeys: string[];
  reconfirmedStaleKeys: string[];
  directives: string[];
}

export interface BuilderPlannerCritiqueIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface BuilderPlannerCritiqueState {
  valid: boolean;
  issues: BuilderPlannerCritiqueIssue[];
  normalizedMilestones: BuilderNormalizedMilestoneDraft[];
  reconciliation: BuilderArchitectureReconciliationState;
}

export interface BuilderPlannerInputState {
  projectId: string;
  projectName: string;
  template: string;
  packageManager: string;
  brief: BuilderProjectBriefState;
  constraints: string[];
  nonGoals: string[];
  acceptanceCriteria: string[];
  activeArchitecture: BuilderArchitectureDecisionState[];
  staleArchitecture: BuilderArchitectureDecisionState[];
}

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

export interface BuilderProjectBriefState {
  title: string;
  summary: string;
  goals: string[];
  constraints: string[];
  deliverables: string[];
  notes: string | null;
}

export interface BuilderTaskSpecState {
  id: string;
  milestoneId: string;
  title: string;
  summary: string;
  status: BuilderTaskSpecStatus;
  sortOrder: number;
  completionCriteria: string[];
  validators: BuilderTaskSpecValidator[];
  architecturalDecisionKeys: string[];
  dependencyIds: string[];
}

export interface BuilderMilestoneState {
  id: string;
  title: string;
  summary: string;
  status: BuilderMilestoneStatus;
  sortOrder: number;
  taskSpecs: BuilderTaskSpecState[];
}

export interface BuilderPlanningSnapshot {
  lifecycle: BuilderProjectLifecycle;
  brief: BuilderProjectBrief | null;
  milestones: BuilderMilestoneState[];
  currentMilestone: BuilderMilestoneState | null;
  currentTaskSpec: BuilderTaskSpecState | null;
}

export interface BuilderPlannerTaskDraft {
  key: string;
  title: string;
  summary: string;
  completionCriteria: string[];
  validators: string[];
  dependencyKeys?: string[];
  architectural_new_decisions?: string[];
  architectural_stale_keys?: string[];
}

export interface BuilderPlannerMilestoneDraft {
  key: string;
  title: string;
  summary: string;
  tasks: BuilderPlannerTaskDraft[];
}

export interface BuilderNormalizedTaskSpecDraft {
  key: string;
  title: string;
  summary: string;
  status: BuilderTaskSpecStatus;
  sortOrder: number;
  completionCriteria: string[];
  validators: BuilderTaskSpecValidator[];
  dependencyKeys: string[];
  architecturalDecisionKeys: string[];
  architecturalStaleKeys: string[];
}

export interface BuilderNormalizedMilestoneDraft {
  key: string;
  title: string;
  summary: string;
  status: BuilderMilestoneStatus;
  sortOrder: number;
  tasks: BuilderNormalizedTaskSpecDraft[];
}

export interface BuilderProjectContextState {
  objective: string | null;
  architectureNotes: string[];
  architecture?: BuilderArchitectureContextState;
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
  architecture?: BuilderArchitectureReconciliationState;
  updatedAt: string;
}

export function defaultBuilderArchitectureContext(): BuilderArchitectureContextState {
  return {
    active: [],
    stale: [],
  };
}

export function defaultBuilderProjectContext(): BuilderProjectContextState {
  return {
    objective: null,
    architectureNotes: [],
    architecture: defaultBuilderArchitectureContext(),
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
  const readArchitecture = (input: unknown): BuilderArchitectureContextState => {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return defaultBuilderArchitectureContext();
    }

    const candidateArchitecture = input as Record<string, unknown>;
    const readDecisionList = (entry: unknown): BuilderArchitectureDecisionState[] => Array.isArray(entry)
      ? entry.flatMap((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return [];
          }

          const decision = item as Record<string, unknown>;
          const key = typeof decision.key === "string" ? decision.key.trim() : "";
          const canonicalKey = typeof decision.canonicalKey === "string" ? decision.canonicalKey.trim() : "";
          const displayName = typeof decision.displayName === "string" ? decision.displayName.trim() : "";
          if (!key || !canonicalKey || !displayName) {
            return [];
          }

          return [{
            key,
            canonicalKey,
            displayName,
            description: typeof decision.description === "string" && decision.description.trim() ? decision.description.trim() : null,
            confidence: typeof decision.confidence === "number" && Number.isFinite(decision.confidence) ? decision.confidence : 0,
            status: typeof decision.status === "string" && decision.status.trim() ? decision.status.trim() : "active",
            source: typeof decision.source === "string" && decision.source.trim() ? decision.source.trim() : "builder_adr",
            updatedAt: typeof decision.updatedAt === "string" && decision.updatedAt.trim() ? decision.updatedAt.trim() : new Date(0).toISOString(),
          }];
        })
      : [];

    return {
      active: readDecisionList(candidateArchitecture.active),
      stale: readDecisionList(candidateArchitecture.stale),
    };
  };

  return {
    objective: typeof candidate.objective === "string" && candidate.objective.trim() ? candidate.objective.trim() : null,
    architectureNotes: readStringArray(candidate.architectureNotes),
    architecture: readArchitecture(candidate.architecture),
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

export function normalizeBuilderProjectBriefState(value: unknown): BuilderProjectBriefState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const readString = (input: unknown): string => typeof input === "string" ? input.trim() : "";
  const readStringArray = (input: unknown): string[] => Array.isArray(input)
    ? input.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : [])
    : [];
  const title = readString(candidate.title);
  const summary = readString(candidate.summary);

  if (!title || !summary) {
    return null;
  }

  return {
    title,
    summary,
    goals: readStringArray(candidate.goals),
    constraints: readStringArray(candidate.constraints),
    deliverables: readStringArray(candidate.deliverables),
    notes: readString(candidate.notes) || null,
  };
}