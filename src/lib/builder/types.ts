import type {
  BuilderPackageManager,
  BuilderMilestoneStatus,
  BuilderProjectBrief,
  BuilderProjectLifecycle,
  BuilderTaskSpecStatus,
  BuilderTaskSpecValidator,
  BuilderTaskStage,
  BuilderTaskStatus,
} from "@prisma/client";
import type { BuilderConfigReadinessState, BuilderConfigMalformedEntryState } from "@/lib/builder/environment";
import type {
  BizBotContractDriftSectionState,
  BizBotPlatformContractImpactState,
  BizBotPlatformContractSnapshotState,
} from "@/lib/platform/contract";

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

export interface BuilderMcpToolSnapshotEntry {
  name: string;
  title: string;
  description: string;
  ownerId: string;
  ownerKind: string;
  annotations: unknown;
  parameters: unknown;
}

export interface BuilderMcpPromptSnapshotEntry {
  sourceKind: "builtin" | "imported";
  serverName: string | null;
  name: string;
  title: string;
  description: string;
  ownerId: string;
  group: string;
  arguments: Array<{
    name: string;
    required: boolean;
    description: string;
  }>;
}

export interface BuilderMcpResourceSnapshotEntry {
  sourceKind: "builtin" | "imported";
  serverName: string | null;
  name: string;
  uri: string;
  title: string;
  description: string;
  ownerId: string;
  group: string;
  mimeType: string;
}

export interface BuilderMcpContractSnapshotState {
  contract: BizBotPlatformContractSnapshotState;
  profile: {
    agentProfile: string;
    autonomyPreset: string;
    capabilities: unknown;
  };
  tools: BuilderMcpToolSnapshotEntry[];
  prompts: BuilderMcpPromptSnapshotEntry[];
  resources: BuilderMcpResourceSnapshotEntry[];
}

export interface BuilderMcpMappingState {
  toolName: string;
  toolTitle: string | null;
  ownerId: string;
  ownerKind: string;
  taskId: string | null;
  taskSpecId: string | null;
  builderRunId: string;
  agentRunId: string | null;
  validatorContext: string[];
  activeAdrDecisionKeys: string[];
  ontologyHints: string[];
  recordedAt: string;
}

export interface BuilderMcpSnapshotRecordState {
  id: string;
  projectId: string;
  runId: string;
  taskId: string | null;
  taskSpecId: string | null;
  snapshotSequence: number;
  versionHash: string;
  snapshot: BuilderMcpContractSnapshotState;
  mappings: BuilderMcpMappingState[];
  metadata: Record<string, unknown> | null;
  appliedAt: string;
}

export interface BuilderMcpContractDriftSectionState {
  added: string[];
  removed: string[];
  changed: string[];
}

export interface BuilderMcpContractDriftState {
  previousHash: string | null;
  currentHash: string;
  changed: boolean;
  tools: BizBotContractDriftSectionState;
  prompts: BizBotContractDriftSectionState;
  resources: BizBotContractDriftSectionState;
  profileChanged: boolean;
  contractChanged: boolean;
  impact: BizBotPlatformContractImpactState;
}

export interface BuilderMcpSemanticState {
  queueState: "idle" | "queued" | "embedded" | "ontology_synced" | "failed";
  embeddingFormatVersion: string | null;
  embeddedAt: string | null;
  ontologySyncVersion: string | null;
  ontologySyncedAt: string | null;
  cleanupProcessedAt: string | null;
  mappingCount: number;
  uniqueToolCount: number;
  validatorCount: number;
  activeAdrDecisionKeys: string[];
  ontologyHints: string[];
}

export interface BuilderMcpSemanticSearchMatchState {
  snapshotId: string;
  runId: string;
  snapshotSequence: number;
  versionHash: string;
  similarity: number;
  appliedAt: string;
}

export interface BuilderMcpPlanningContextState {
  baselineSnapshotId: string | null;
  baselineSnapshotSequence: number | null;
  baselineHash: string | null;
  currentHash: string;
  driftDetected: boolean;
  relatedArchitectureDecisionKeys: string[];
  recommendations: string[];
  summary: string;
  drift: BuilderMcpContractDriftState | null;
}

export interface BuilderDependencyPackageEntry {
  name: string;
  kind: "runtime" | "dev" | "optional" | "peer";
  range: string;
  resolvedVersion: string | null;
}

export interface BuilderDependencyScriptEntry {
  name: string;
  command: string;
}

export interface BuilderDependencyClassificationState {
  framework: string[];
  ui: string[];
  database: string[];
  mcp: string[];
  queue: string[];
  desktop: string[];
  validation: string[];
  graph: string[];
  ai: string[];
}

export interface BuilderDependencyContractSnapshotState {
  packageManager: "npm" | "pnpm";
  manifest: {
    name: string | null;
    version: string | null;
    private: boolean;
    type: string | null;
  };
  scripts: BuilderDependencyScriptEntry[];
  packages: BuilderDependencyPackageEntry[];
  lockfile: {
    path: string | null;
    present: boolean;
    lockfileVersion: number | null;
    contentHash: string | null;
  };
  classifications: BuilderDependencyClassificationState;
}

export interface BuilderDependencyContractDriftState {
  previousHash: string | null;
  currentHash: string;
  changed: boolean;
  packageManagerChanged: boolean;
  lockfileChanged: boolean;
  packages: {
    added: string[];
    removed: string[];
    changed: string[];
    reclassified: string[];
  };
  scripts: {
    added: string[];
    removed: string[];
    changed: string[];
  };
}

export interface BuilderDependencyContractBaselineState {
  version: number;
  expectedHash: string;
  packageManager: "npm" | "pnpm";
  decisionKeys: string[];
  snapshot: BuilderDependencyContractSnapshotState;
  updatedAt: string;
}

export interface BuilderFileTopologyContractSnapshotState {
  root: ".";
  topLevel: string[];
  anchors: {
    appRoot: string | null;
    libRoot: string | null;
    componentsRoot: string | null;
    testsRoot: string | null;
    scriptsRoot: string | null;
    prismaRoot: string | null;
    tauriRoot: string | null;
    builderProjectionRoot: ".builder";
  };
  directories: string[];
  importantFiles: string[];
  classifications: {
    usesSrcRoot: boolean;
    usesNextAppRouter: boolean;
    usesTestsRoot: boolean;
    usesScriptsRoot: boolean;
    usesDesktopShell: boolean;
    rootMinimal: boolean;
  };
  rules: {
    preferSrcLib: boolean;
    preferSrcComponents: boolean;
    discourageTopLevelFeatureFolders: boolean;
    reserveBuilderProjectionPaths: boolean;
  };
}

export interface BuilderFileTopologySnapshotRecordState {
  snapshotSequence: number;
  versionHash: string;
  snapshot: BuilderFileTopologyContractSnapshotState;
  appliedAt: string;
}

export interface BuilderFileTopologyContractDriftState {
  previousHash: string | null;
  currentHash: string;
  changed: boolean;
  directories: {
    added: string[];
    removed: string[];
  };
  importantFiles: {
    added: string[];
    removed: string[];
  };
  anchorsChanged: string[];
  classificationsChanged: string[];
  rulesChanged: string[];
}

export interface BuilderFileTopologyContractBaselineState {
  version: number;
  expectedHash: string;
  decisionKeys: string[];
  snapshot: BuilderFileTopologyContractSnapshotState;
  updatedAt: string;
}

export interface BuilderRelevantFileTopologyContextState {
  currentHash: string;
  anchors: BuilderFileTopologyContractSnapshotState["anchors"];
  topLevel: string[];
  placementGuidance: string[];
  reasons: string[];
}

export interface BuilderFileTopologyPlanningContextState {
  baselineHash: string | null;
  currentHash: string;
  driftDetected: boolean;
  relatedArchitectureDecisionKeys: string[];
  anchors: BuilderFileTopologyContractSnapshotState["anchors"];
  topLevel: string[];
  placementGuidance: string[];
  recommendations: string[];
  summary: string;
  drift: BuilderFileTopologyContractDriftState | null;
}

export interface BuilderDependencySnapshotOverviewState {
  runId: string | null;
  currentHash: string | null;
  state: "not_available" | "pending_capture" | "captured" | "aligned" | "drifted";
  baseline: BuilderDependencyContractBaselineState | null;
  planning: BuilderDependencyPlanningContextState | null;
  drift: BuilderDependencyContractDriftState | null;
}

export interface BuilderFileTopologySnapshotOverviewState {
  runId: string | null;
  currentHash: string | null;
  state: "pending_capture" | "captured" | "aligned" | "drifted";
  baseline: BuilderFileTopologyContractBaselineState | null;
  drift: BuilderFileTopologyContractDriftState | null;
  planning: BuilderFileTopologyPlanningContextState | null;
}

export interface BuilderDependencyPlanningContextState {
  baselineHash: string | null;
  currentHash: string;
  driftDetected: boolean;
  packageManager: "npm" | "pnpm";
  relatedArchitectureDecisionKeys: string[];
  highlightedPackages: string[];
  recommendations: string[];
  summary: string;
  drift: BuilderDependencyContractDriftState | null;
}

export interface BuilderRelevantDependencyContextState {
  currentHash: string;
  packageManager: "npm" | "pnpm";
  highlightedPackages: string[];
  classifications: BuilderDependencyClassificationState;
  reasons: string[];
}

export interface BuilderRelevantMcpContextState {
  currentHash: string;
  tools: BuilderMcpToolSnapshotEntry[];
  prompts: BuilderMcpPromptSnapshotEntry[];
  resources: BuilderMcpResourceSnapshotEntry[];
  reasons: string[];
}

export interface BuilderMcpSnapshotOverviewState {
  activeRunId: string | null;
  currentSnapshotId: string | null;
  currentSequence: number | null;
  currentHash: string | null;
  state: "pending_capture" | "captured" | "aligned" | "drifted";
  history: BuilderMcpSnapshotRecordState[];
  drift: BuilderMcpContractDriftState | null;
  semantic: BuilderMcpSemanticState;
  semanticMatches: BuilderMcpSemanticSearchMatchState[];
  planning: BuilderMcpPlanningContextState | null;
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
  plannedStack: BuilderPlannedStackState | null;
  mcpPolicy?: BuilderMcpPolicyBaselineState | null;
  dependencyContract?: BuilderDependencyContractBaselineState | null;
  fileTopologyContract?: BuilderFileTopologyContractBaselineState | null;
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

export interface BuilderPlannedStackState {
  presetKey: string | null;
  label: string;
  template: string;
  packageManager: BuilderPackageManager;
  tags: string[];
}

export interface BuilderMcpPolicyBaselineState {
  artifactPath: string;
  version: number;
  template: string;
  packageManager: "npm" | "pnpm";
  expectedHash: string;
  expectedMcpContractHash: string;
  policyHashVersion: number;
  allowedToolCategories: string[];
  decisionKeys: string[];
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

export interface BuilderConfigReviewState {
  schemaAvailable: boolean;
  projectReady: boolean;
  executionReady: boolean;
  missingProjectKeys: string[];
  missingExecutionKeys: string[];
  malformedEntries: BuilderConfigMalformedEntryState[];
  summary: string;
}

export interface BuilderReviewVcsState {
  available: boolean;
  repoRoot: string | null;
  currentBranch: string | null;
  headCommitSha: string | null;
  ahead: number;
  behind: number;
  dirty: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictedCount: number;
  stashCount: number;
  tagCount: number;
  remoteCount: number;
  remoteNames: string[];
  pendingPush: boolean;
  pendingPushContext: string | null;
  summary: string;
  auditPath?: string | null;
  error?: string | null;
}

export interface BuilderReviewProcessState {
  managedCount: number;
  runningCount: number;
  failedCount: number;
  timedOutCount: number;
  cancelledCount: number;
  recentProcessIds: string[];
  summary: string;
}

export interface BuilderReviewAuditState {
  auditPath: string | null;
  totalEvents: number;
  recentCount: number;
  capabilityCounts: Record<string, number>;
  notableEvents: Array<{
    capabilityKey: string;
    eventName: string;
    outcomeStatus: string;
    timestamp: string;
  }>;
  summary: string;
}

export interface BuilderReviewDatabaseState {
  status: "not_available" | "probe_failed" | "in_sync" | "drifted";
  summary: string;
  provider: string | null;
  connectionTarget: string | null;
  artifactTableCount: number;
  liveTableCount: number;
  latestProbeAt: string | null;
  auditPath: string | null;
}

export interface BuilderReviewRuntimeState {
  totalServices: number;
  runningServices: number;
  failedServices: number;
  managedServices: number;
  prominentServiceIds: string[];
  summary: string;
}

export type BuilderOperatorTrustStatus = "trusted" | "warning" | "blocked";
export type BuilderOperatorTrustTrendDirection = "improving" | "steady" | "degrading";

export interface BuilderOperatorTrustReviewState {
  status: BuilderOperatorTrustStatus;
  summary: string;
  reviewStatus: BuilderTaskStatus | string | null;
  validationPassed: boolean | null;
  riskCount: number;
  gitAvailable: boolean;
  gitDirty: boolean;
  gitRemoteCount: number;
  gitHasRemotes: boolean;
  gitPendingPush: boolean;
  updatedAt: string | null;
}

export interface BuilderOperatorTrustConfigState {
  status: BuilderOperatorTrustStatus;
  summary: string;
  schemaAvailable: boolean;
  projectReady: boolean;
  executionReady: boolean;
  missingProjectKeys: string[];
  missingExecutionKeys: string[];
}

export interface BuilderOperatorTrustRuntimeState {
  status: BuilderOperatorTrustStatus;
  summary: string;
  activeAlertCount: number;
  unresolvedAlertCount: number;
  autoFixCount: number;
  mcpState: string;
  driftDetected: boolean;
}

export interface BuilderOperatorTrustApprovalItem {
  id: string;
  postId: string;
  approvalStatus: string;
  postStatus: string;
  platform: string;
  excerpt: string;
  notes: string | null;
  createdAt: string;
}

export interface BuilderOperatorTrustApprovalState {
  status: BuilderOperatorTrustStatus;
  summary: string;
  pendingCount: number;
  pendingApprovals: BuilderOperatorTrustApprovalItem[];
}

export interface BuilderOperatorTrustGovernanceState {
  status: BuilderOperatorTrustStatus;
  summary: string;
  approvalRequiredCapabilities: string[];
  gitRemoteAllowlistConfigured: boolean;
  gitPushCapableToolsAvailable: boolean;
  gitPushRequiresApproval: boolean;
}

export interface BuilderOperatorTrustArtifactPaths {
  markdown: string;
  json: string;
  latestReview: string;
  processArtifacts: string;
}

export interface BuilderOperatorTrustTrendState {
  direction: BuilderOperatorTrustTrendDirection;
  basis: string;
  summary: string;
  warningAuditEvents: number;
  criticalAuditEvents: number;
  blockerCount: number;
  recentWindow: {
    runCount: number;
    successRate: number;
    verificationPassRate: number;
    averageRiskCount: number;
    reviewWarningCount: number;
    blockedRunCount: number;
  };
  previousWindow: {
    runCount: number;
    successRate: number;
    verificationPassRate: number;
    averageRiskCount: number;
    reviewWarningCount: number;
    blockedRunCount: number;
  };
}

export interface BuilderOperatorTrustPrioritizedBlocker {
  key: string;
  label: string;
  status: BuilderOperatorTrustStatus;
  priority: number;
  summary: string;
}

export interface BuilderOperatorTrustState {
  generatedAt: string;
  overallStatus: BuilderOperatorTrustStatus;
  summary: string;
  review: BuilderOperatorTrustReviewState;
  config: BuilderOperatorTrustConfigState;
  runtime: BuilderOperatorTrustRuntimeState;
  approvals: BuilderOperatorTrustApprovalState;
  governance: BuilderOperatorTrustGovernanceState;
  prioritizedBlockers: BuilderOperatorTrustPrioritizedBlocker[];
  trend: BuilderOperatorTrustTrendState;
  artifactPaths: BuilderOperatorTrustArtifactPaths;
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
  config?: BuilderConfigReviewState;
  vcs?: BuilderReviewVcsState;
  process?: BuilderReviewProcessState;
  audit?: BuilderReviewAuditState;
  database?: BuilderReviewDatabaseState;
  runtime?: BuilderReviewRuntimeState;
  risks: string[];
  nextSteps: string[];
  architecture?: BuilderArchitectureReconciliationState;
  updatedAt: string;
}

export type BuilderProjectConfigState = BuilderConfigReadinessState;

export function defaultBuilderArchitectureContext(): BuilderArchitectureContextState {
  return {
    active: [],
    stale: [],
  };
}

export function defaultBuilderProjectContext(): BuilderProjectContextState {
  return {
    objective: null,
    plannedStack: null,
    mcpPolicy: null,
    dependencyContract: null,
    fileTopologyContract: null,
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
  const readDependencyClassifications = (input: unknown): BuilderDependencyClassificationState => {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return {
        framework: [],
        ui: [],
        database: [],
        mcp: [],
        queue: [],
        desktop: [],
        validation: [],
        graph: [],
        ai: [],
      };
    }

    const candidateClassifications = input as Record<string, unknown>;
    return {
      framework: readStringArray(candidateClassifications.framework),
      ui: readStringArray(candidateClassifications.ui),
      database: readStringArray(candidateClassifications.database),
      mcp: readStringArray(candidateClassifications.mcp),
      queue: readStringArray(candidateClassifications.queue),
      desktop: readStringArray(candidateClassifications.desktop),
      validation: readStringArray(candidateClassifications.validation),
      graph: readStringArray(candidateClassifications.graph),
      ai: readStringArray(candidateClassifications.ai),
    };
  };
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
    plannedStack: (() => {
      const input = candidate.plannedStack;
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return null;
      }
      const plannedStack = input as Record<string, unknown>;
      const label = typeof plannedStack.label === "string" ? plannedStack.label.trim() : "";
      const template = typeof plannedStack.template === "string" ? plannedStack.template.trim() : "";
      const packageManager = plannedStack.packageManager === "PNPM" ? "PNPM" : plannedStack.packageManager === "NPM" ? "NPM" : null;
      if (!label || !template || !packageManager) {
        return null;
      }
      return {
        presetKey: typeof plannedStack.presetKey === "string" && plannedStack.presetKey.trim() ? plannedStack.presetKey.trim() : null,
        label,
        template,
        packageManager,
        tags: readStringArray(plannedStack.tags),
      };
    })(),
    mcpPolicy: (() => {
      const input = candidate.mcpPolicy;
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return null;
      }

      const policy = input as Record<string, unknown>;
      const artifactPath = typeof policy.artifactPath === "string" ? policy.artifactPath.trim() : "";
      const template = typeof policy.template === "string" ? policy.template.trim() : "";
      const packageManager = policy.packageManager === "pnpm" ? "pnpm" : policy.packageManager === "npm" ? "npm" : null;
      const expectedHash = typeof policy.expectedHash === "string" ? policy.expectedHash.trim() : "";
      const expectedMcpContractHash = typeof policy.expectedMcpContractHash === "string" ? policy.expectedMcpContractHash.trim() : "";
      const version = typeof policy.version === "number" && Number.isFinite(policy.version) ? Math.trunc(policy.version) : null;
      const policyHashVersion = typeof policy.policyHashVersion === "number" && Number.isFinite(policy.policyHashVersion)
        ? Math.trunc(policy.policyHashVersion)
        : null;
      if (!artifactPath || !template || !packageManager || !expectedHash || !expectedMcpContractHash || !version || !policyHashVersion) {
        return null;
      }

      return {
        artifactPath,
        version,
        template,
        packageManager,
        expectedHash,
        expectedMcpContractHash,
        policyHashVersion,
        allowedToolCategories: readStringArray(policy.allowedToolCategories),
        decisionKeys: readStringArray(policy.decisionKeys),
      };
    })(),
    dependencyContract: (() => {
      const input = candidate.dependencyContract;
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return null;
      }

      const dependencyContract = input as Record<string, unknown>;
      const expectedHash = typeof dependencyContract.expectedHash === "string" ? dependencyContract.expectedHash.trim() : "";
      const packageManager = dependencyContract.packageManager === "pnpm"
        ? "pnpm"
        : dependencyContract.packageManager === "npm"
          ? "npm"
          : null;
      const version = typeof dependencyContract.version === "number" && Number.isFinite(dependencyContract.version)
        ? Math.trunc(dependencyContract.version)
        : null;
      const updatedAt = typeof dependencyContract.updatedAt === "string" && dependencyContract.updatedAt.trim()
        ? dependencyContract.updatedAt.trim()
        : null;
      const snapshotValue = dependencyContract.snapshot;
      if (!expectedHash || !packageManager || !version || !updatedAt || !snapshotValue || typeof snapshotValue !== "object" || Array.isArray(snapshotValue)) {
        return null;
      }

      const snapshot = snapshotValue as Record<string, unknown>;
      const manifestValue = snapshot.manifest;
      const lockfileValue = snapshot.lockfile;
      if (!manifestValue || typeof manifestValue !== "object" || Array.isArray(manifestValue) || !lockfileValue || typeof lockfileValue !== "object" || Array.isArray(lockfileValue)) {
        return null;
      }

      const manifest = manifestValue as Record<string, unknown>;
      const lockfile = lockfileValue as Record<string, unknown>;
      return {
        version,
        expectedHash,
        packageManager,
        decisionKeys: readStringArray(dependencyContract.decisionKeys),
        updatedAt,
        snapshot: {
          packageManager,
          manifest: {
            name: typeof manifest.name === "string" && manifest.name.trim() ? manifest.name.trim() : null,
            version: typeof manifest.version === "string" && manifest.version.trim() ? manifest.version.trim() : null,
            private: manifest.private === true,
            type: typeof manifest.type === "string" && manifest.type.trim() ? manifest.type.trim() : null,
          },
          scripts: Array.isArray(snapshot.scripts)
            ? snapshot.scripts.flatMap((item) => {
                if (!item || typeof item !== "object" || Array.isArray(item)) {
                  return [];
                }
                const script = item as Record<string, unknown>;
                const name = typeof script.name === "string" ? script.name.trim() : "";
                const command = typeof script.command === "string" ? script.command.trim() : "";
                return name && command ? [{ name, command }] : [];
              })
            : [],
          packages: Array.isArray(snapshot.packages)
            ? snapshot.packages.flatMap((item) => {
                if (!item || typeof item !== "object" || Array.isArray(item)) {
                  return [];
                }
                const dependency = item as Record<string, unknown>;
                const name = typeof dependency.name === "string" ? dependency.name.trim() : "";
                const range = typeof dependency.range === "string" ? dependency.range.trim() : "";
                const kind = dependency.kind === "dev"
                  ? "dev"
                  : dependency.kind === "optional"
                    ? "optional"
                    : dependency.kind === "peer"
                      ? "peer"
                      : dependency.kind === "runtime"
                        ? "runtime"
                        : null;
                if (!name || !range || !kind) {
                  return [];
                }

                return [{
                  name,
                  kind,
                  range,
                  resolvedVersion: typeof dependency.resolvedVersion === "string" && dependency.resolvedVersion.trim()
                    ? dependency.resolvedVersion.trim()
                    : null,
                }];
              })
            : [],
          lockfile: {
            path: typeof lockfile.path === "string" && lockfile.path.trim() ? lockfile.path.trim() : null,
            present: lockfile.present === true,
            lockfileVersion: typeof lockfile.lockfileVersion === "number" && Number.isFinite(lockfile.lockfileVersion)
              ? Math.trunc(lockfile.lockfileVersion)
              : null,
            contentHash: typeof lockfile.contentHash === "string" && lockfile.contentHash.trim() ? lockfile.contentHash.trim() : null,
          },
          classifications: readDependencyClassifications(snapshot.classifications),
        },
      };
    })(),
    fileTopologyContract: (() => {
      const input = candidate.fileTopologyContract;
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return null;
      }

      const fileTopologyContract = input as Record<string, unknown>;
      const expectedHash = typeof fileTopologyContract.expectedHash === "string" ? fileTopologyContract.expectedHash.trim() : "";
      const version = typeof fileTopologyContract.version === "number" && Number.isFinite(fileTopologyContract.version)
        ? Math.trunc(fileTopologyContract.version)
        : null;
      const updatedAt = typeof fileTopologyContract.updatedAt === "string" && fileTopologyContract.updatedAt.trim()
        ? fileTopologyContract.updatedAt.trim()
        : null;
      const snapshotValue = fileTopologyContract.snapshot;
      if (!expectedHash || !version || !updatedAt || !snapshotValue || typeof snapshotValue !== "object" || Array.isArray(snapshotValue)) {
        return null;
      }

      const snapshot = snapshotValue as Record<string, unknown>;
      const anchorsValue = snapshot.anchors;
      const classificationsValue = snapshot.classifications;
      const rulesValue = snapshot.rules;
      if (!anchorsValue || typeof anchorsValue !== "object" || Array.isArray(anchorsValue)
        || !classificationsValue || typeof classificationsValue !== "object" || Array.isArray(classificationsValue)
        || !rulesValue || typeof rulesValue !== "object" || Array.isArray(rulesValue)) {
        return null;
      }

      const anchors = anchorsValue as Record<string, unknown>;
      const classifications = classificationsValue as Record<string, unknown>;
      const rules = rulesValue as Record<string, unknown>;

      return {
        version,
        expectedHash,
        decisionKeys: readStringArray(fileTopologyContract.decisionKeys),
        updatedAt,
        snapshot: {
          root: ".",
          topLevel: readStringArray(snapshot.topLevel),
          anchors: {
            appRoot: typeof anchors.appRoot === "string" && anchors.appRoot.trim() ? anchors.appRoot.trim() : null,
            libRoot: typeof anchors.libRoot === "string" && anchors.libRoot.trim() ? anchors.libRoot.trim() : null,
            componentsRoot: typeof anchors.componentsRoot === "string" && anchors.componentsRoot.trim() ? anchors.componentsRoot.trim() : null,
            testsRoot: typeof anchors.testsRoot === "string" && anchors.testsRoot.trim() ? anchors.testsRoot.trim() : null,
            scriptsRoot: typeof anchors.scriptsRoot === "string" && anchors.scriptsRoot.trim() ? anchors.scriptsRoot.trim() : null,
            prismaRoot: typeof anchors.prismaRoot === "string" && anchors.prismaRoot.trim() ? anchors.prismaRoot.trim() : null,
            tauriRoot: typeof anchors.tauriRoot === "string" && anchors.tauriRoot.trim() ? anchors.tauriRoot.trim() : null,
            builderProjectionRoot: ".builder",
          },
          directories: readStringArray(snapshot.directories),
          importantFiles: readStringArray(snapshot.importantFiles),
          classifications: {
            usesSrcRoot: classifications.usesSrcRoot === true,
            usesNextAppRouter: classifications.usesNextAppRouter === true,
            usesTestsRoot: classifications.usesTestsRoot === true,
            usesScriptsRoot: classifications.usesScriptsRoot === true,
            usesDesktopShell: classifications.usesDesktopShell === true,
            rootMinimal: classifications.rootMinimal === true,
          },
          rules: {
            preferSrcLib: rules.preferSrcLib === true,
            preferSrcComponents: rules.preferSrcComponents === true,
            discourageTopLevelFeatureFolders: rules.discourageTopLevelFeatureFolders === true,
            reserveBuilderProjectionPaths: rules.reserveBuilderProjectionPaths === true,
          },
        },
      };
    })(),
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