"use client";

import { buildBuilderGovernanceCommandPayload } from "@/lib/builder/governance-shared";
import { PaginationControls } from "@/components/layout/PaginationControls";
import { usePagination } from "@/hooks/usePagination";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

interface BuilderConfig {
  workspaceRoot: string;
  projectsRoot: string;
  repositoryRoot: string;
  configuredByEnv: boolean;
  safe: boolean;
  reason?: string;
  allowedCommands: string[];
  defaultTemplate: string;
  defaultPackageManager: "NPM" | "PNPM";
  initializeGitByDefault: boolean;
  installDependenciesByDefault: boolean;
  defaultAgenticProfile: string;
  agenticTimeoutSeconds: number;
  agenticMaxIterations: number;
}

interface BuilderTemplatePreset {
  id: string;
  key: string;
  displayName: string;
  description: string;
  enabled: boolean;
  defaultPackageManager: "NPM" | "PNPM";
}

interface BuilderCliProfile {
  id: string;
  key: string;
  displayName: string;
  command: string;
  description: string;
  enabled: boolean;
  supportsNonInteractive: boolean;
  metadata?: {
    available?: boolean;
    resolvedCommand?: string | null;
    availabilityReason?: string | null;
    healthy?: boolean;
    healthReason?: string | null;
    healthCheckedAt?: string | null;
    authReady?: boolean;
    authReason?: string | null;
    ready?: boolean;
    readinessReason?: string | null;
    commandSource?: string;
    platform?: string;
  };
}

interface BuilderProject {
  id: string;
  name: string;
  slug: string;
  relativePath: string;
  template: string;
  packageManager: "NPM" | "PNPM";
  gitInitialized: boolean;
  lifecycle: "DRAFT" | "PLANNED" | "ACTIVE" | "BLOCKED" | "COMPLETE";
  lastRunStatus: "IDLE" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  workspaceState: "present" | "missing" | "unavailable";
  latestSessionSummary?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BuilderConfigMalformedEntry {
  path: ".env" | ".env.local" | ".env.example";
  line: number;
  content: string;
  reason: string;
}

interface BuilderProjectConfigReadiness {
  schemaPath: ".env.example" | null;
  schemaAvailable: boolean;
  projectReady: boolean;
  executionReady: boolean;
  totalRequiredKeys: number;
  missingProjectKeys: string[];
  missingExecutionKeys: string[];
  malformedEntries: BuilderConfigMalformedEntry[];
  keys: Array<{
    key: string;
    required: boolean;
    examplePresent: boolean;
    projectValuePresent: boolean;
    executionValuePresent: boolean;
    projectSource: ".env" | ".env.local" | ".env.example" | null;
    executionSource: ".env" | ".env.local" | ".env.example" | "host_env" | "missing";
    redactedProjectValue: string | null;
    redactedExecutionValue: string | null;
  }>;
  summary: string;
}

interface BuilderOperatorTrustApprovalItem {
  id: string;
  postId: string;
  approvalStatus: string;
  postStatus: string;
  platform: string;
  excerpt: string;
  notes: string | null;
  createdAt: string;
}

interface BuilderOperatorTrustState {
  generatedAt: string;
  overallStatus: "trusted" | "warning" | "blocked";
  summary: string;
  review: {
    status: "trusted" | "warning" | "blocked";
    summary: string;
    reviewStatus: string | null;
    validationPassed: boolean | null;
    riskCount: number;
    updatedAt: string | null;
  };
  config: {
    status: "trusted" | "warning" | "blocked";
    summary: string;
    schemaAvailable: boolean;
    projectReady: boolean;
    executionReady: boolean;
    missingProjectKeys: string[];
    missingExecutionKeys: string[];
  };
  runtime: {
    status: "trusted" | "warning" | "blocked";
    summary: string;
    activeAlertCount: number;
    unresolvedAlertCount: number;
    autoFixCount: number;
    mcpState: string;
    driftDetected: boolean;
  };
  approvals: {
    status: "trusted" | "warning" | "blocked";
    summary: string;
    pendingCount: number;
    pendingApprovals: BuilderOperatorTrustApprovalItem[];
  };
  governance: {
    status: "trusted" | "warning" | "blocked";
    summary: string;
    approvalRequiredCapabilities: string[];
  };
  prioritizedBlockers: Array<{
    key: string;
    label: string;
    status: "trusted" | "warning" | "blocked";
    priority: number;
    summary: string;
  }>;
  trend: {
    direction: "improving" | "steady" | "degrading";
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
  };
  artifactPaths: {
    markdown: string;
    json: string;
    latestReview: string;
    processArtifacts: string;
  };
}

interface BuilderWorkspaceReconcileResponse {
  projects: BuilderProject[];
  scanned: number;
  verified: number;
  relinked: number;
  imported: number;
  metadataRebound: number;
  ignored: number;
  summary: string;
  error?: string;
}

interface BuilderProjectBrief {
  id: string;
  title: string;
  summary: string;
  goals: string[];
  constraints: string[];
  deliverables: string[];
  notes?: string | null;
}

interface BuilderTaskSpec {
  id: string;
  milestoneId: string;
  title: string;
  summary: string;
  status: "PENDING" | "ACTIVE" | "BLOCKED" | "COMPLETE";
  sortOrder: number;
  completionCriteria: string[];
  validators: Array<"BUILD" | "TEST" | "LINT" | "TYPECHECK" | "NONE" | "MANUAL_REVIEW">;
  architecturalDecisionKeys: string[];
  dependencyIds: string[];
}

interface BuilderMilestone {
  id: string;
  title: string;
  summary: string;
  status: "PENDING" | "ACTIVE" | "BLOCKED" | "COMPLETE";
  sortOrder: number;
  taskSpecs: BuilderTaskSpec[];
}

interface BuilderPlanStep {
  id: string;
  label: string;
  status: "pending" | "in_progress" | "completed";
  notes?: string;
}

interface BuilderProjectContext {
  objective: string | null;
  plannedStack: {
    presetKey: string | null;
    label: string;
    template: string;
    packageManager: "NPM" | "PNPM";
    tags: string[];
  } | null;
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

interface BuilderTask {
  id: string;
  title: string;
  description: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  stage: "PLANNING" | "IMPLEMENTING" | "TESTING" | "REVIEW" | "DOCUMENTING" | "DONE";
  summary?: string | null;
  metadata?: {
    retryCount?: number;
    lastStageError?: string | null;
    lastAttemptedStage?: string | null;
    planSteps?: BuilderPlanStep[];
    lastRetryAt?: string | null;
    currentIteration?: number | null;
    maxIterations?: number | null;
    latestLoopSummary?: string | null;
    resumeFromIteration?: number | null;
  } | null;
}

interface BuilderTaskHistoryEntry {
  runId: string;
  taskId: string | null;
  projectId: string;
  iteration: number | null;
  verdict: string;
  status: string;
  summary: string | null;
  stdout: string | null;
  stderr: string | null;
  timestamp: string;
  finishedAt: string | null;
}

interface BuilderTaskHistoryResponse {
  history: BuilderTaskHistoryEntry[];
  error?: string;
}

interface BuilderStats {
  totalRuns: number;
  totalTasksRun: number;
  successRate: number;
  verificationPassRate: number;
  retryRate: number;
  avgIterationsPerTask: number;
  avgIterationsPerRun: number;
  statusCounts: Record<string, number>;
}

interface BuilderHealthMetrics {
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

interface BuilderBudgetProfile {
  mode: "analysis_only" | "scaffold" | "implementation" | "verification";
  maxIterations: number;
  maxDurationMs: number;
  maxTotalTokens: number;
  maxEstimatedCostUsd: number;
  maxRequestCount: number;
  maxRetries: number;
  rationale: string;
  observedRuns: number;
  observedAvgDurationMs: number;
  observedAvgTotalTokens: number;
  observedAvgCostUsd: number;
  topBlockedReason: string | null;
}

interface BuilderTelemetrySummary {
  completedRuns: number;
  runningRuns: number;
  avgDurationMs: number;
  avgTimeToCompletionMs: number;
  totalDurationMs: number;
  blockedReasonCounts: Record<string, number>;
  topBlockedReason: string | null;
  modeCounts: Record<string, number>;
  templateCounts: Record<string, number>;
  tokenTotals: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedPromptTokens: number;
    requestCount: number;
    estimatedCostUsd: number;
  };
}

interface BuilderOperationalAlert {
  code: string;
  runId: string;
  taskId: string | null;
  severity: "warning" | "danger";
  summary: string;
  autoFixable: boolean;
  triggeredAt: string;
}

interface BuilderReconciliationAuditEntry {
  runId: string;
  taskId: string | null;
  action: string;
  reason: string;
  previousStatus: string;
  nextStatus: string;
  correctedAt: string;
}

interface BuilderOperationalStateSummary {
  thresholds: {
    staleRunningMs: number;
    noProgressMs: number;
    identicalFailureThreshold: number;
  };
  alerts: BuilderOperationalAlert[];
  corrections: BuilderReconciliationAuditEntry[];
  activeAlertCount: number;
  reconciledRunCount: number;
  unresolvedAlertCount: number;
}

interface BuilderMcpSnapshotHistoryEntry {
  id: string;
  snapshotSequence: number;
  versionHash: string;
  appliedAt: string;
  metadata?: Record<string, unknown> | null;
}

interface BuilderMcpSnapshotOverview {
  activeRunId: string | null;
  currentSnapshotId: string | null;
  currentSequence: number | null;
  currentHash: string | null;
  state: "pending_capture" | "captured" | "aligned" | "drifted";
  history: BuilderMcpSnapshotHistoryEntry[];
  drift: {
    changed: boolean;
    previousHash: string | null;
    currentHash: string;
    profileChanged: boolean;
    tools: { added: string[]; removed: string[]; changed: string[] };
    prompts: { added: string[]; removed: string[]; changed: string[] };
    resources: { added: string[]; removed: string[]; changed: string[] };
  } | null;
  semantic: {
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
  };
  semanticMatches: Array<{
    snapshotId: string;
    runId: string;
    snapshotSequence: number;
    versionHash: string;
    similarity: number;
    appliedAt: string;
  }>;
  planning: {
    baselineSnapshotId: string | null;
    baselineSnapshotSequence: number | null;
    baselineHash: string | null;
    currentHash: string;
    driftDetected: boolean;
    relatedArchitectureDecisionKeys: string[];
    recommendations: string[];
    summary: string;
  } | null;
}

interface BuilderDependencyContractOverview {
  runId: string | null;
  currentHash: string | null;
  state: "not_available" | "pending_capture" | "captured" | "aligned" | "drifted";
  baseline: {
    expectedHash: string;
    decisionKeys: string[];
    updatedAt: string;
  } | null;
  planning: {
    baselineHash: string | null;
    currentHash: string;
    driftDetected: boolean;
    packageManager: "npm" | "pnpm";
    relatedArchitectureDecisionKeys: string[];
    highlightedPackages: string[];
    recommendations: string[];
    summary: string;
  } | null;
  drift: {
    changed: boolean;
    previousHash: string | null;
    currentHash: string;
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
    lockfileChanged: boolean;
    packageManagerChanged: boolean;
  } | null;
}

interface BuilderFileTopologyContractOverview {
  runId: string | null;
  currentHash: string | null;
  state: "pending_capture" | "captured" | "aligned" | "drifted";
  baseline: {
    expectedHash: string;
    decisionKeys: string[];
    updatedAt: string;
  } | null;
  planning: {
    baselineHash: string | null;
    currentHash: string;
    driftDetected: boolean;
    relatedArchitectureDecisionKeys: string[];
    anchors: Record<string, string | null>;
    topLevel: string[];
    placementGuidance: string[];
    recommendations: string[];
    summary: string;
  } | null;
  drift: {
    changed: boolean;
    previousHash: string | null;
    currentHash: string;
    directories: { added: string[]; removed: string[] };
    importantFiles: { added: string[]; removed: string[] };
    anchorsChanged: string[];
    classificationsChanged: string[];
    rulesChanged: string[];
  } | null;
}

interface BuilderReview {
  taskId: string;
  projectId: string;
  status: string;
  stage: string;
  summary: string;
  filesChanged: string[];
  commandsExecuted: string[];
  vcs?: {
    summary: string;
    currentBranch: string | null;
    stagedCount: number;
    unstagedCount: number;
    untrackedCount: number;
    auditPath?: string | null;
  };
  process?: {
    summary: string;
    managedCount: number;
    runningCount: number;
    failedCount: number;
  };
  audit?: {
    summary: string;
    auditPath: string | null;
    totalEvents: number;
  };
  database?: {
    status: "not_available" | "probe_failed" | "in_sync" | "drifted";
    summary: string;
    latestProbeAt: string | null;
  };
  runtime?: {
    summary: string;
    totalServices: number;
    runningServices: number;
    failedServices: number;
  };
  risks: string[];
  nextSteps: string[];
}

interface BuilderRun {
  id: string;
  kind: string;
  title: string;
  command: string | null;
  status: string;
  summary: string | null;
  stdout: string | null;
  stderr: string | null;
  startedAt: string;
  finishedAt: string | null;
  metadata?: Record<string, unknown> | null;
}

interface BuilderRunVerificationStep {
  script: string;
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
}

interface BuilderRunIteration {
  iteration: number;
  changedFiles: string[];
  verification: {
    scripts: string[];
    steps: BuilderRunVerificationStep[];
    passed: boolean;
    skipped: boolean;
    summary: string;
  };
  review: {
    verdict: "complete" | "retry" | "blocked" | "max_iterations";
    reason: string;
  };
}

interface BuilderRunLoopMetadata {
  maxIterations: number;
  finalVerdict?: "complete" | "blocked" | "max_iterations";
  verified: boolean;
  verificationSkipped: boolean;
  selectedScripts: string[];
  summary: string;
  iterations: BuilderRunIteration[];
  currentIteration?: number;
  phase?: "acting" | "verifying" | "reviewing" | "complete";
}

interface BuilderStatusResponse {
  config: BuilderConfig;
  templates: BuilderTemplatePreset[];
  stackPresets: Array<{
    key: string;
    displayName: string;
    description: string;
    template: string;
    packageManager: "NPM" | "PNPM";
    tags: string[];
  }>;
  cliProfiles: BuilderCliProfile[];
  projects: {
    total: number;
    running: number;
  };
}

interface BuilderProjectsResponse {
  projects: BuilderProject[];
  error?: string;
}

interface BuilderProjectDetailResponse {
  project: BuilderProject;
  context: BuilderProjectContext;
  configReadiness: BuilderProjectConfigReadiness;
  operatorTrust: BuilderOperatorTrustState;
  brief: BuilderProjectBrief | null;
  milestones: BuilderMilestone[];
  currentMilestone: BuilderMilestone | null;
  currentTaskSpec: BuilderTaskSpec | null;
  tasks: BuilderTask[];
  currentTask: BuilderTask | null;
  runs: BuilderRun[];
  latestReview: BuilderReview | null;
  metrics: BuilderHealthMetrics;
  budgetProfiles: BuilderBudgetProfile[];
  telemetry: BuilderTelemetrySummary;
  reconciliation: BuilderOperationalStateSummary;
  mcpSnapshot: BuilderMcpSnapshotOverview;
  dependencyContract: BuilderDependencyContractOverview;
  fileTopologyContract: BuilderFileTopologyContractOverview;
  governanceHistory: BuilderGovernanceDecisionRecord[];
  nextRecommendedStep: string | null;
  error?: string;
}

interface BuilderGovernanceDecisionRecord {
  eventId: string;
  timestamp: string;
  action: BuilderGovernanceCommandAction;
  decision: "approve" | "reject" | "reconcile";
  reason: string;
  sourceSurface: "dashboard" | "api" | "plugin_tool";
  commandRunId: string;
  targetRunId: string | null;
  outcome: string;
  summary: string;
}

interface BuilderCapabilityAuditEvent {
  eventId: string;
  capabilityKey: string;
  eventName: string;
  timestamp: string;
  outcomeStatus: "succeeded" | "failed" | "blocked" | "cancelled" | "timed_out";
  severity: "info" | "warning" | "critical";
  metadata?: Record<string, unknown>;
}

interface BuilderCapabilityAuditOverview {
  auditPath: string;
  totalEvents: number;
  capabilityCounts: Record<string, number>;
  outcomeCounts: Record<string, number>;
  severityCounts: { info: number; warning: number; critical: number };
  retention: {
    maxEvents: number;
    maxAgeDays: number;
    droppedExpiredCount: number;
    droppedOverflowCount: number;
  };
  recentEvents: BuilderCapabilityAuditEvent[];
}

interface BuilderDatabaseLiveProbe {
  status: "succeeded" | "failed";
  source: "live";
  provider: string | null;
  connectionTarget: string | null;
  probedAt: string;
  summary: string;
  tableCount: number;
  tables: Array<{ modelName: string; tableName: string; fieldCount: number }>;
  auditPath: string;
  error?: string;
}

interface BuilderDatabaseInspectionOverview {
  artifact: {
    provider: string | null;
    datasourceName: string | null;
    connectionTarget: string | null;
    migrationsPath: string | null;
    migrationsCount: number;
    tableCount: number;
    tables: Array<{ modelName: string; tableName: string; fieldCount: number }>;
    auditPath: string;
  };
  latestLiveProbe: BuilderDatabaseLiveProbe | null;
  driftSummary: {
    status: "not_available" | "probe_failed" | "in_sync" | "drifted";
    summary: string;
    comparedAt: string | null;
    artifactTableCount: number;
    liveTableCount: number;
    missingInLive: string[];
    unexpectedLive: string[];
    fieldCountMismatches: Array<{
      tableName: string;
      artifactFieldCount: number;
      liveFieldCount: number;
    }>;
  };
}

interface BuilderInspectionResponse {
  capabilityAudit: BuilderCapabilityAuditOverview;
  databaseInspection: BuilderDatabaseInspectionOverview;
  runtimeInspection: BuilderRuntimeInspectionOverview;
  error?: string;
  status?: string;
  message?: string;
}

interface BuilderRuntimeServiceSummary {
  serviceId: string;
  label: string;
  source: "package_script" | "workspace_package" | "compose_file" | "procfile";
  runner: "npm_script" | "compose_service" | "procfile_process";
  declaredIn: string;
  workingDirectory: string;
  command: string | null;
  processId: string | null;
  processStatus: "running" | "exited" | "failed" | "cancelled" | "timed_out" | null;
  status: "running" | "failed" | "stopped" | "declared";
  startedAt: string | null;
  logPath: string | null;
  auditPath: string | null;
  supportsRestart: boolean;
  supportsExec: boolean;
  supportsStart: boolean;
  supportsStop: boolean;
  healthStatus: "healthy" | "unhealthy" | "starting" | "stopped" | "declared" | "unknown";
  healthReason: string | null;
  containerId: string | null;
  publishedPorts: string[];
}

interface BuilderRuntimeInspectionOverview {
  summary: string;
  totalServices: number;
  runningServices: number;
  failedServices: number;
  managedServices: number;
  services: BuilderRuntimeServiceSummary[];
}

interface BuilderRuntimeServiceLogPreview {
  service: BuilderRuntimeServiceSummary;
  logs: string;
  cursorUsed: number;
  nextCursor: number;
  truncatedBeforeCursor: boolean;
  complete: boolean;
  followed: boolean;
  followTimedOut: boolean;
  error?: string;
}

interface BuilderRuntimeControlResponse {
  status: "completed" | "blocked";
  message: string;
  service: BuilderRuntimeServiceSummary;
  process?: {
    processId: string;
    status: "running" | "exited" | "failed" | "cancelled" | "timed_out";
    logPath: string;
    auditPath: string;
  };
  previousProcess?: {
    processId: string;
    status: "running" | "exited" | "failed" | "cancelled" | "timed_out";
  } | null;
  commandResult?: {
    ok: boolean;
    command: string;
    args: string[];
    cwd: string;
    exitCode: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    cancelled: boolean;
  };
  runtimeInspection: BuilderRuntimeInspectionOverview;
  auditPath?: string;
  error?: string;
}

interface BuilderBriefDraft {
  title: string;
  summary: string;
  notes: string;
}

interface BuilderEnvDraft {
  key: string;
  value: string;
  file: ".env" | ".env.local";
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payloadText = await response.text();
  if (!payloadText.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(payloadText) as T;
  } catch (error) {
    if (!response.ok) {
      return { error: `Request failed with status ${response.status}.` } as T;
    }

    throw error instanceof Error
      ? error
      : new Error(`Invalid JSON response from ${response.url || "request"}.`);
  }
}

type BuilderShortcutAction = "retry-last-failed-task" | "open-current-task-logs" | "cancel-running-task";

function normalizeBuilderShortcutAction(value: string | null | undefined): BuilderShortcutAction | null {
  switch (value) {
    case "retry-last-failed-task":
    case "open-current-task-logs":
    case "cancel-running-task":
      return value;
    default:
      return null;
  }
}

function readBuilderShortcutFromHash(): BuilderShortcutAction | null {
  if (typeof window === "undefined" || !window.location.hash) {
    return null;
  }

  const match = window.location.hash.match(/builder-shortcut=([^&]+)/);
  return normalizeBuilderShortcutAction(match ? decodeURIComponent(match[1] ?? "") : null);
}

function clearBuilderShortcutHash(): void {
  if (typeof window === "undefined" || !window.location.hash.includes("builder-shortcut=")) {
    return;
  }

  const nextUrl = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(null, "", nextUrl);
}

function formatPercentage(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "0%";
  }

  return `${Math.round(value * 100)}%`;
}

type BuilderHealthTone = "default" | "success" | "warning" | "danger";

function getToneColor(tone: BuilderHealthTone): string {
  switch (tone) {
    case "success":
      return "var(--success)";
    case "warning":
      return "var(--warning)";
    case "danger":
      return "var(--danger)";
    default:
      return "var(--border)";
  }
}

function getToneSurface(tone: BuilderHealthTone): string {
  switch (tone) {
    case "success":
      return "color-mix(in srgb, var(--success) 10%, var(--bg-surface))";
    case "warning":
      return "color-mix(in srgb, var(--warning) 12%, var(--bg-surface))";
    case "danger":
      return "color-mix(in srgb, var(--danger) 12%, var(--bg-surface))";
    default:
      return "var(--bg-surface)";
  }
}

function getEfficiencyTone(metrics: BuilderHealthMetrics["efficiency"] | null | undefined): BuilderHealthTone {
  if (!metrics) {
    return "default";
  }
  if (metrics.retryRate >= 0.35 || metrics.verificationPassRate < 0.6 || metrics.tasksInRetry >= 3) {
    return "danger";
  }
  if (metrics.retryRate >= 0.2 || metrics.verificationPassRate < 0.8 || metrics.tasksInRetry > 0) {
    return "warning";
  }
  if (metrics.successRate >= 0.85 && metrics.verificationPassRate >= 0.9) {
    return "success";
  }
  return "default";
}

function getPromotionTone(metrics: BuilderHealthMetrics["promotion"] | null | undefined): BuilderHealthTone {
  if (!metrics) {
    return "default";
  }
  if (metrics.blockedTaskSpecs > 0) {
    return "danger";
  }
  if (metrics.totalTaskSpecs > 0 && metrics.taskSpecCompletionRate < 0.4) {
    return "warning";
  }
  if (metrics.totalTaskSpecs > 0 && metrics.taskSpecCompletionRate >= 0.8) {
    return "success";
  }
  return "default";
}

function getArchitectureTone(metrics: BuilderHealthMetrics["architecture"] | null | undefined): BuilderHealthTone {
  if (!metrics) {
    return "default";
  }
  if (metrics.latestMissingStaleCount > 0 || metrics.staleDecisionCount >= 3) {
    return "danger";
  }
  if (metrics.staleDecisionCount > 0 || metrics.latestAddressedStaleCount > 0) {
    return "warning";
  }
  if (metrics.activeDecisionCount > 0 && metrics.staleDecisionCount === 0) {
    return "success";
  }
  return "default";
}

function buildHealthAlerts(metrics: BuilderHealthMetrics | null | undefined): Array<{ label: string; tone: BuilderHealthTone }> {
  if (!metrics) {
    return [];
  }

  const alerts: Array<{ label: string; tone: BuilderHealthTone }> = [];
  if (metrics.efficiency.retryRate >= 0.35) {
    alerts.push({ label: `High retry rate ${formatPercentage(metrics.efficiency.retryRate)}`, tone: "danger" });
  } else if (metrics.efficiency.retryRate >= 0.2) {
    alerts.push({ label: `Retry rate rising ${formatPercentage(metrics.efficiency.retryRate)}`, tone: "warning" });
  }

  if (metrics.efficiency.verificationPassRate < 0.6) {
    alerts.push({ label: `Low verification pass ${formatPercentage(metrics.efficiency.verificationPassRate)}`, tone: "danger" });
  } else if (metrics.efficiency.verificationPassRate < 0.8) {
    alerts.push({ label: `Verification needs work ${formatPercentage(metrics.efficiency.verificationPassRate)}`, tone: "warning" });
  }

  if (metrics.architecture.latestMissingStaleCount > 0) {
    alerts.push({ label: `${metrics.architecture.latestMissingStaleCount} stale ADRs unaddressed`, tone: "danger" });
  } else if (metrics.architecture.staleDecisionCount > 0) {
    alerts.push({ label: `${metrics.architecture.staleDecisionCount} stale ADRs in flight`, tone: "warning" });
  }

  return alerts;
}

function selectPreferredProjectId(projects: BuilderProject[], currentProjectId?: string | null): string | null {
  if (currentProjectId) {
    const currentProject = projects.find((project) => project.id === currentProjectId) ?? null;
    if (currentProject && (currentProject.workspaceState === "present" || !projects.some((project) => project.workspaceState === "present"))) {
      return currentProjectId;
    }
  }

  return projects.find((project) =>
    project.workspaceState === "present"
    && (
      project.lastRunStatus !== "IDLE"
      || project.lifecycle === "ACTIVE"
      || project.lifecycle === "BLOCKED"
      || project.lifecycle === "COMPLETE"
    )
  )?.id
    ?? projects.find((project) => project.workspaceState === "present")?.id
    ?? projects.find((project) =>
      project.lastRunStatus !== "IDLE"
      || project.lifecycle === "ACTIVE"
      || project.lifecycle === "BLOCKED"
      || project.lifecycle === "COMPLETE"
    )?.id
    ?? projects[0]?.id
    ?? null;
}

function getWorkspaceStateLabel(state: BuilderProject["workspaceState"]): string {
  switch (state) {
    case "present":
      return "workspace present";
    case "missing":
      return "workspace missing";
    default:
      return "workspace unavailable";
  }
}

function getWorkspaceStateColor(state: BuilderProject["workspaceState"]): string {
  switch (state) {
    case "present":
      return "var(--success)";
    case "missing":
      return "var(--warning)";
    default:
      return "var(--text-dim)";
  }
}

function getConfigStatusLabel(config: BuilderProjectConfigReadiness | null | undefined): string {
  if (!config?.schemaAvailable) {
    return "schema missing";
  }
  if (!config.executionReady) {
    return "execution blocked";
  }
  if (!config.projectReady) {
    return "host-backed only";
  }
  return "ready";
}

function getConfigStatusColor(config: BuilderProjectConfigReadiness | null | undefined): string {
  if (!config?.schemaAvailable || !config.executionReady) {
    return "var(--danger)";
  }
  if (!config.projectReady) {
    return "var(--warning)";
  }
  return "var(--success)";
}

function getOperatorTrustColor(status: BuilderOperatorTrustState["overallStatus"] | BuilderOperatorTrustState["review"]["status"] | undefined): string {
  switch (status) {
    case "blocked":
      return "var(--danger)";
    case "warning":
      return "var(--warning)";
    default:
      return "var(--success)";
  }
}

function formatOperatorTrustLabel(status: BuilderOperatorTrustState["overallStatus"] | BuilderOperatorTrustState["review"]["status"] | undefined): string {
  switch (status) {
    case "blocked":
      return "blocked";
    case "warning":
      return "needs review";
    default:
      return "trusted";
  }
}

function getRunLoopMetadata(metadata: Record<string, unknown> | null | undefined): BuilderRunLoopMetadata | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const candidate = metadata.loop;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  return candidate as BuilderRunLoopMetadata;
}

const EMPTY_CREATE_PROJECT = {
  name: "",
  stackPresetKey: "",
  template: "node-cli",
  packageManager: "NPM" as "NPM" | "PNPM",
};

const EMPTY_BRIEF_DRAFT: BuilderBriefDraft = {
  title: "",
  summary: "",
  notes: "",
};

const EMPTY_ENV_DRAFT: BuilderEnvDraft = {
  key: "",
  value: "",
  file: ".env.local",
};

type BuilderToastTone = "success" | "warning" | "danger";

interface BuilderDashboardToast {
  id: string;
  tone: BuilderToastTone;
  title: string;
  message: string;
}

type BuilderGovernanceCommandAction = "reconcile_mcp_policy" | "resolve_mcp_contract_drift" | "resolve_dependency_contract_drift" | "resolve_file_topology_contract_drift";

export default function BuilderPage() {
  const [status, setStatus] = useState<BuilderStatusResponse | null>(null);
  const [projects, setProjects] = useState<BuilderProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [projectDetail, setProjectDetail] = useState<BuilderProjectDetailResponse | null>(null);
  const [projectInspection, setProjectInspection] = useState<BuilderInspectionResponse | null>(null);
  const [selectedRuntimeServiceId, setSelectedRuntimeServiceId] = useState<string | null>(null);
  const [runtimeServiceLogs, setRuntimeServiceLogs] = useState<BuilderRuntimeServiceLogPreview | null>(null);
  const [runtimeLogLive, setRuntimeLogLive] = useState(false);
  const [runtimeLogState, setRuntimeLogState] = useState<"idle" | "connecting" | "live" | "complete">("idle");
  const [runtimeExecCommand, setRuntimeExecCommand] = useState("");
  const [runtimeExecArgs, setRuntimeExecArgs] = useState("");
  const [runtimeExecResult, setRuntimeExecResult] = useState<BuilderRuntimeControlResponse["commandResult"] | null>(null);
  const [runtimeActionServiceId, setRuntimeActionServiceId] = useState<string | null>(null);
  const [taskHistory, setTaskHistory] = useState<BuilderTaskHistoryEntry[]>([]);
  const [builderStats, setBuilderStats] = useState<BuilderStats | null>(null);
  const [createDraft, setCreateDraft] = useState(EMPTY_CREATE_PROJECT);
  const [installPackages, setInstallPackages] = useState("");
  const [scriptName, setScriptName] = useState("build");
  const [taskRequest, setTaskRequest] = useState("");
  const [agenticPrompt, setAgenticPrompt] = useState("");
  const [agenticProfile, setAgenticProfile] = useState("");
  const [agenticModel, setAgenticModel] = useState("");
  const [bootstrapOptions, setBootstrapOptions] = useState({ initializeGit: true, installDependencies: false });
  const [briefDraft, setBriefDraft] = useState<BuilderBriefDraft>(EMPTY_BRIEF_DRAFT);
  const [envDraft, setEnvDraft] = useState<BuilderEnvDraft>(EMPTY_ENV_DRAFT);
  const [saving, setSaving] = useState(false);
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);
  const [highlightedRunId, setHighlightedRunId] = useState<string | null>(null);
  const [pendingShortcutAction, setPendingShortcutAction] = useState<BuilderShortcutAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultNotice, setResultNotice] = useState<string | null>(null);
  const [dashboardToast, setDashboardToast] = useState<BuilderDashboardToast | null>(null);
  const [governanceReason, setGovernanceReason] = useState("");
  const [governanceConfirmed, setGovernanceConfirmed] = useState(false);
  const [governanceAction, setGovernanceAction] = useState<BuilderGovernanceCommandAction | null>(null);
  const recentRunsRef = useRef<HTMLElement | null>(null);
  const runtimeLogStreamRef = useRef<EventSource | null>(null);
  const seenGovernanceToastKeysRef = useRef<Set<string>>(new Set());

  function showDashboardToast(toast: Omit<BuilderDashboardToast, "id">): void {
    setDashboardToast({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...toast,
    });
  }

  async function loadStatus(): Promise<BuilderStatusResponse> {
    const response = await fetch("/api/builder/status");
    const payload = await readJsonResponse<BuilderStatusResponse & { error?: string }>(response);
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load builder status.");
    }
    setStatus(payload);
    setBootstrapOptions({
      initializeGit: payload.config.initializeGitByDefault,
      installDependencies: payload.config.installDependenciesByDefault,
    });
    return payload;
  }

  async function loadProjects(nextSelectedProjectId?: string | null): Promise<BuilderProject[]> {
    const response = await fetch("/api/builder/projects");
    const payload = await readJsonResponse<BuilderProjectsResponse>(response);
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load builder projects.");
    }
    setProjects(payload.projects);

    const desiredProjectId = selectPreferredProjectId(payload.projects, nextSelectedProjectId ?? selectedProjectId);
    setSelectedProjectId(desiredProjectId);
    return payload.projects;
  }

  async function loadProjectDetail(projectId: string): Promise<void> {
    const response = await fetch(`/api/builder/projects/${projectId}`);
    const payload = await readJsonResponse<BuilderProjectDetailResponse>(response);
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load builder project details.");
    }
    setProjectDetail(payload);
    setBriefDraft({
      title: payload.brief?.title ?? "",
      summary: payload.brief?.summary ?? "",
      notes: payload.brief?.notes ?? "",
    });
    setEnvDraft((current) => ({
      key: current.key && payload.configReadiness.keys.some((entry) => entry.key === current.key)
        ? current.key
        : payload.configReadiness.missingProjectKeys[0]
          ?? payload.configReadiness.keys[0]?.key
          ?? "",
      value: "",
      file: current.file,
    }));
    setSelectedTaskId((current) => {
      if (current && payload.tasks.some((task) => task.id === current)) {
        return current;
      }

      return payload.currentTask?.id ?? payload.tasks[0]?.id ?? null;
    });
  }

  async function loadBuilderStats(projectId: string): Promise<void> {
    const response = await fetch(`/api/analytics/builder-stats?projectId=${encodeURIComponent(projectId)}`);
    const payload = await readJsonResponse<BuilderStats & { error?: string }>(response);
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load builder stats.");
    }
    setBuilderStats(payload);
  }

  async function loadProjectInspection(projectId: string): Promise<void> {
    const response = await fetch(`/api/builder/projects/${projectId}/inspect`);
    const payload = await readJsonResponse<BuilderInspectionResponse>(response);
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load builder inspection details.");
    }
    setProjectInspection(payload);
  }

  async function loadRuntimeServiceLogs(projectId: string, serviceId: string): Promise<void> {
    const response = await fetch(`/api/builder/projects/${projectId}/runtime/logs?serviceId=${encodeURIComponent(serviceId)}`);
    const payload = await readJsonResponse<BuilderRuntimeServiceLogPreview>(response);
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load runtime service logs.");
    }
    setRuntimeServiceLogs(payload);
  }

  function stopRuntimeLogStream(): void {
    runtimeLogStreamRef.current?.close();
    runtimeLogStreamRef.current = null;
    setRuntimeLogLive(false);
    setRuntimeLogState("idle");
  }

  function startRuntimeLogStream(projectId: string, serviceId: string): void {
    stopRuntimeLogStream();
    setRuntimeLogLive(true);
    setRuntimeLogState("connecting");
    const eventSource = new EventSource(`/api/builder/projects/${projectId}/runtime/logs/stream?serviceId=${encodeURIComponent(serviceId)}`);
    runtimeLogStreamRef.current = eventSource;

    eventSource.addEventListener("open", () => {
      setRuntimeLogState("connecting");
      setRuntimeServiceLogs((current) => current && current.service.serviceId === serviceId ? { ...current, logs: "", cursorUsed: 0, nextCursor: 0, complete: false, followed: false, followTimedOut: false, error: undefined } : current);
    });

    eventSource.addEventListener("state", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { service?: BuilderRuntimeServiceSummary; process?: { status?: BuilderRuntimeServiceSummary["processStatus"] } };
      if (!payload.service) {
        return;
      }
      const nextService = payload.service;
      setRuntimeServiceLogs((current) => current ? { ...current, service: nextService, error: undefined } : {
        service: nextService,
        logs: "",
        cursorUsed: 0,
        nextCursor: 0,
        truncatedBeforeCursor: false,
        complete: false,
        followed: false,
        followTimedOut: false,
      });
      setRuntimeLogState(payload.process?.status === "running" ? "live" : "connecting");
    });

    eventSource.addEventListener("log", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { logs: string; cursorUsed: number; nextCursor: number; truncatedBeforeCursor: boolean };
      setRuntimeLogState("live");
      setRuntimeServiceLogs((current) => current ? {
        ...current,
        logs: `${current.logs}${payload.logs}`,
        cursorUsed: payload.cursorUsed,
        nextCursor: payload.nextCursor,
        truncatedBeforeCursor: current.truncatedBeforeCursor || payload.truncatedBeforeCursor,
        followed: true,
        followTimedOut: false,
        error: undefined,
      } : current);
    });

    eventSource.addEventListener("heartbeat", () => {
      setRuntimeLogState("live");
      setRuntimeServiceLogs((current) => current ? { ...current, followed: true, followTimedOut: true } : current);
    });

    eventSource.addEventListener("complete", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { nextCursor: number };
      setRuntimeLogState("complete");
      setRuntimeServiceLogs((current) => current ? { ...current, nextCursor: payload.nextCursor, complete: true, followed: true, followTimedOut: false } : current);
      eventSource.close();
      runtimeLogStreamRef.current = null;
      setRuntimeLogLive(false);
    });

    eventSource.addEventListener("error", (event) => {
      const payload = event instanceof MessageEvent && typeof event.data === "string" && event.data ? JSON.parse(event.data) as { error?: string } : {};
      setRuntimeServiceLogs((current) => current ? { ...current, error: payload.error ?? "Runtime log stream disconnected." } : current);
      setRuntimeLogState("idle");
      setRuntimeLogLive(false);
      eventSource.close();
      runtimeLogStreamRef.current = null;
    });
  }

  async function restartRuntimeService(): Promise<void> {
    if (!selectedProjectId || !selectedRuntimeServiceId) {
      return;
    }
    setSaving(true);
    setRuntimeActionServiceId(selectedRuntimeServiceId);
    setResultNotice(null);
    setError(null);
    setRuntimeExecResult(null);
    try {
      const response = await fetch(`/api/builder/projects/${selectedProjectId}/runtime/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "restart_service", serviceId: selectedRuntimeServiceId }),
      });
      const payload = await readJsonResponse<BuilderRuntimeControlResponse>(response);
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to restart runtime service.");
      }
      setProjectInspection((current) => current ? { ...current, runtimeInspection: payload.runtimeInspection } : current);
      setResultNotice(payload.message);
      await loadRuntimeServiceLogs(selectedProjectId, selectedRuntimeServiceId);
      if (runtimeLogLive) {
        startRuntimeLogStream(selectedProjectId, selectedRuntimeServiceId);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to restart runtime service.");
    } finally {
      setRuntimeActionServiceId(null);
      setSaving(false);
    }
  }

  async function mutateRuntimeService(action: "start_service" | "stop_service"): Promise<void> {
    if (!selectedProjectId || !selectedRuntimeServiceId) {
      return;
    }
    setSaving(true);
    setRuntimeActionServiceId(selectedRuntimeServiceId);
    setResultNotice(null);
    setError(null);
    setRuntimeExecResult(null);
    try {
      const response = await fetch(`/api/builder/projects/${selectedProjectId}/runtime/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, serviceId: selectedRuntimeServiceId }),
      });
      const payload = await readJsonResponse<BuilderRuntimeControlResponse>(response);
      if (!response.ok) {
        throw new Error(payload.error ?? `Failed to ${action === "start_service" ? "start" : "stop"} runtime service.`);
      }
      setProjectInspection((current) => current ? { ...current, runtimeInspection: payload.runtimeInspection } : current);
      setResultNotice(payload.message);
      await loadRuntimeServiceLogs(selectedProjectId, selectedRuntimeServiceId);
      if (runtimeLogLive && action === "start_service") {
        startRuntimeLogStream(selectedProjectId, selectedRuntimeServiceId);
      }
      if (runtimeLogLive && action === "stop_service") {
        stopRuntimeLogStream();
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `Failed to ${action === "start_service" ? "start" : "stop"} runtime service.`);
    } finally {
      setRuntimeActionServiceId(null);
      setSaving(false);
    }
  }

  async function execRuntimeServiceCommand(): Promise<void> {
    if (!selectedProjectId || !selectedRuntimeServiceId || !runtimeExecCommand.trim()) {
      return;
    }
    setSaving(true);
    setRuntimeActionServiceId(selectedRuntimeServiceId);
    setResultNotice(null);
    setError(null);
    try {
      const response = await fetch(`/api/builder/projects/${selectedProjectId}/runtime/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "exec_in_service",
          serviceId: selectedRuntimeServiceId,
          command: runtimeExecCommand.trim(),
          commandArgs: runtimeExecArgs.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean),
        }),
      });
      const payload = await readJsonResponse<BuilderRuntimeControlResponse>(response);
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to execute runtime service command.");
      }
      setProjectInspection((current) => current ? { ...current, runtimeInspection: payload.runtimeInspection } : current);
      setRuntimeExecResult(payload.commandResult ?? null);
      setResultNotice(payload.message);
      await loadRuntimeServiceLogs(selectedProjectId, selectedRuntimeServiceId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to execute runtime service command.");
    } finally {
      setRuntimeActionServiceId(null);
      setSaving(false);
    }
  }

  async function loadTaskHistory(taskId: string): Promise<void> {
    const response = await fetch(`/api/builder/tasks/${taskId}/history`);
    const payload = await readJsonResponse<BuilderTaskHistoryResponse>(response);
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load task history.");
    }
    setTaskHistory(payload.history);
  }

  async function refresh(nextSelectedProjectId?: string | null): Promise<void> {
    setError(null);
    try {
      await loadStatus();
      const loadedProjects = await loadProjects(nextSelectedProjectId);
      const projectId = selectPreferredProjectId(loadedProjects, nextSelectedProjectId ?? selectedProjectId);
      if (projectId) {
        await loadProjectDetail(projectId);
        try {
          await loadProjectInspection(projectId);
        } catch {
          setProjectInspection(null);
        }
      } else {
        setProjectDetail(null);
        setProjectInspection(null);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to refresh Builder state.");
    }
  }

  async function reconcileWorkspaceProjects(): Promise<void> {
    setSaving(true);
    setError(null);
    setResultNotice(null);
    try {
      const response = await fetch("/api/builder/projects/reconcile", {
        method: "POST",
      });
      const payload = await readJsonResponse<BuilderWorkspaceReconcileResponse>(response);
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to reconcile Builder workspace projects.");
      }
      setProjects(payload.projects);
      setResultNotice(payload.summary);
      await refresh(selectPreferredProjectId(payload.projects, selectedProjectId));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to reconcile Builder workspace projects.");
    } finally {
      setSaving(false);
    }
  }

  const refreshBuilderData = useEffectEvent((nextSelectedProjectId?: string | null) => {
    void refresh(nextSelectedProjectId).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Failed to refresh builder data.");
    });
  });

  useEffect(() => {
    refreshBuilderData();
  }, []);

  useEffect(() => {
    if (selectedProjectId && projectDetail?.project.id !== selectedProjectId) {
      void loadProjectDetail(selectedProjectId).catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : "Failed to load builder project details.");
      });
      void loadProjectInspection(selectedProjectId).catch(() => {
        setProjectInspection(null);
      });
    }
  }, [projectDetail?.project.id, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setBuilderStats(null);
      return;
    }

    void loadBuilderStats(selectedProjectId).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Failed to load builder stats.");
    });
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedTaskId) {
      setTaskHistory([]);
      return;
    }

    void loadTaskHistory(selectedTaskId).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Failed to load task history.");
    });
  }, [selectedTaskId]);

  useEffect(() => {
    const services = projectInspection?.runtimeInspection.services ?? [];
    if (services.length === 0) {
      stopRuntimeLogStream();
      setSelectedRuntimeServiceId(null);
      setRuntimeServiceLogs(null);
      return;
    }

    setSelectedRuntimeServiceId((current) => services.some((service) => service.serviceId === current) ? current : services[0]?.serviceId ?? null);
  }, [projectInspection]);

  useEffect(() => {
    if (!selectedProjectId || !selectedRuntimeServiceId) {
      stopRuntimeLogStream();
      return;
    }

    setRuntimeExecResult(null);

    if (runtimeLogLive) {
      startRuntimeLogStream(selectedProjectId, selectedRuntimeServiceId);
      return;
    }

    void loadRuntimeServiceLogs(selectedProjectId, selectedRuntimeServiceId).catch((nextError) => {
      const fallbackService = projectInspection?.runtimeInspection.services.find((service) => service.serviceId === selectedRuntimeServiceId);
      if (!fallbackService) {
        setRuntimeServiceLogs(null);
        return;
      }
      setRuntimeServiceLogs({
        service: fallbackService,
        logs: "",
        cursorUsed: 0,
        nextCursor: 0,
        truncatedBeforeCursor: false,
        complete: true,
        followed: false,
        followTimedOut: false,
        error: nextError instanceof Error ? nextError.message : "Failed to load runtime service logs.",
      });
    });
  }, [projectInspection, runtimeLogLive, selectedProjectId, selectedRuntimeServiceId]);

  useEffect(() => () => {
    runtimeLogStreamRef.current?.close();
  }, []);

  useEffect(() => {
    if (!dashboardToast) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setDashboardToast((current) => current?.id === dashboardToast.id ? null : current);
    }, 5000);

    return () => window.clearTimeout(timeout);
  }, [dashboardToast]);

  const enabledAgentProfiles = useMemo(
    () => (status?.cliProfiles ?? []).filter((profile) => profile.enabled && profile.metadata?.ready === true),
    [status],
  );

  useEffect(() => {
    if (!agenticProfile) {
      return;
    }

    if (!enabledAgentProfiles.some((profile) => profile.key === agenticProfile)) {
      setAgenticProfile("");
    }
  }, [agenticProfile, enabledAgentProfiles]);

  const hasRunningRun = useMemo(
    () => (projectDetail?.runs ?? []).some((run) => run.status === "RUNNING"),
    [projectDetail],
  );

  useEffect(() => {
    if (!selectedProjectId || !hasRunningRun) {
      return;
    }

    const interval = window.setInterval(() => {
      refreshBuilderData(selectedProjectId);
    }, 2000);

    return () => window.clearInterval(interval);
  }, [hasRunningRun, selectedProjectId]);

  async function createProject(): Promise<void> {
    if (!createDraft.name.trim()) {
      setError("Project name is required.");
      return;
    }

    setSaving(true);
    setError(null);
    setResultNotice(null);
    try {
      const response = await fetch("/api/builder/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...createDraft,
          stackPresetKey: createDraft.stackPresetKey || undefined,
        }),
      });
      const payload = await readJsonResponse<{ project?: BuilderProject; error?: string }>(response);
      if (!response.ok || !payload.project) {
        throw new Error(payload.error ?? "Failed to create builder project.");
      }
      setCreateDraft({
        name: "",
        stackPresetKey: "",
        template: status?.config.defaultTemplate ?? EMPTY_CREATE_PROJECT.template,
        packageManager: status?.config.defaultPackageManager ?? EMPTY_CREATE_PROJECT.packageManager,
      });
      setResultNotice(`Created project ${payload.project.name}.`);
      await refresh(payload.project.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to create builder project.");
    } finally {
      setSaving(false);
    }
  }

  async function runProjectAction(path: string, body?: Record<string, unknown>): Promise<void> {
    if (!selectedProjectId) {
      setError("Select a project first.");
      return;
    }

    setSaving(true);
    setError(null);
    setResultNotice(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const payload = await readJsonResponse<{ error?: string; runId?: string; status?: string; result?: { ok?: boolean } }>(response);
      if (!response.ok) {
        throw new Error(payload.error ?? "Builder action failed.");
      }
      setResultNotice(payload.status === "RUNNING"
        ? `Started run ${payload.runId}. Polling live progress.`
        : payload.status === "PLANNED"
          ? "Generated the canonical Builder plan. Review the staged view, then advance the current task."
          : payload.runId
            ? `Started run ${payload.runId}.`
            : "Builder action completed.");
      await refresh(selectedProjectId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Builder action failed.");
    } finally {
      setSaving(false);
    }
  }

  async function planProject(): Promise<void> {
    if (!selectedProjectId) {
      setError("Select a project first.");
      return;
    }
    if (!briefDraft.title.trim() || !briefDraft.summary.trim()) {
      setError("Brief title and summary are required to plan a project.");
      return;
    }

    setSaving(true);
    setError(null);
    setResultNotice(null);
    try {
      const response = await fetch(`/api/builder/projects/${selectedProjectId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: briefDraft.title,
          summary: briefDraft.summary,
          notes: briefDraft.notes || undefined,
          regenerate: true,
        }),
      });
      const payload = await readJsonResponse<BuilderProjectDetailResponse>(response);
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to plan Builder project.");
      }
      setProjectDetail(payload);
      setResultNotice("Updated the project brief and regenerated the canonical Builder plan.");
      await refresh(selectedProjectId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to plan Builder project.");
    } finally {
      setSaving(false);
    }
  }

  async function mutateProjectEnv(action: { action: "write"; key: string; value: string; file: ".env" | ".env.local" } | { action: "sync_example" }): Promise<void> {
    if (!selectedProjectId) {
      setError("Select a project first.");
      return;
    }

    setSaving(true);
    setError(null);
    setResultNotice(null);
    try {
      const response = await fetch(`/api/builder/projects/${selectedProjectId}/env`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const payload = await readJsonResponse<{ error?: string; result?: { key?: string; path?: string; addedKeys?: string[] } }>(response);
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update project env state.");
      }
      setResultNotice(action.action === "sync_example"
        ? `Synced .env.example${payload.result?.addedKeys?.length ? ` and added ${payload.result.addedKeys.join(", ")}.` : "."}`
        : `Updated ${payload.result?.key ?? action.key} in ${payload.result?.path ?? action.file}.`);
      if (action.action === "write") {
        setEnvDraft((current) => ({ ...current, value: "" }));
      }
      await loadProjectDetail(selectedProjectId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to update project env state.");
    } finally {
      setSaving(false);
    }
  }

  async function probeLiveDatabase(): Promise<void> {
    if (!selectedProjectId) {
      setError("Select a project first.");
      return;
    }

    setSaving(true);
    setError(null);
    setResultNotice(null);
    try {
      const response = await fetch(`/api/builder/projects/${selectedProjectId}/inspect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "probe_live_database" }),
      });
      const payload = await readJsonResponse<BuilderInspectionResponse>(response);
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to run live database probe.");
      }
      setProjectInspection(payload);
      setResultNotice(payload.message ?? "Live database probe completed.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to run live database probe.");
    } finally {
      setSaving(false);
    }
  }

  async function resumeTask(taskId: string, options?: { fromIteration?: number; profile?: string; model?: string }): Promise<void> {
    setSaving(true);
    setError(null);
    setResultNotice(null);
    try {
      const response = await fetch(`/api/builder/tasks/${taskId}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options ?? {}),
      });
      const payload = await readJsonResponse<{ error?: string; runId?: string; taskId?: string; status?: string }>(response);
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to resume builder task.");
      }
      setResultNotice(payload.runId ? `Resumed task ${payload.taskId} as run ${payload.runId}.` : "Builder task resumed.");
      if (selectedProjectId) {
        await refresh(selectedProjectId);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to resume builder task.");
    } finally {
      setSaving(false);
    }
  }

  async function cancelRun(runId: string): Promise<void> {
    setCancellingRunId(runId);
    setError(null);
    setResultNotice(null);
    try {
      const response = await fetch(`/api/builder/runs/${runId}/cancel`, {
        method: "POST",
      });
      const payload = await readJsonResponse<{ error?: string; status?: string; runId?: string }>(response);
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to cancel builder run.");
      }
      setResultNotice(payload.status === "NOT_RUNNING"
        ? `Run ${payload.runId} was no longer running.`
        : `Cancellation requested for run ${payload.runId}.`);
      await refresh(selectedProjectId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to cancel builder run.");
    } finally {
      setCancellingRunId(null);
    }
  }

  function focusRunLogs(runId?: string): void {
    const targetRun = runId
      ? projectDetail?.runs.find((run) => run.id === runId) ?? null
      : projectDetail?.runs?.[0] ?? null;
    if (!targetRun) {
      setResultNotice("No builder run logs are available for this project yet.");
      return;
    }

    setHighlightedRunId(targetRun.id);
    recentRunsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setResultNotice(`Focused logs for run ${targetRun.id}.`);
  }

  const handleDesktopShortcut = useEffectEvent((action: BuilderShortcutAction) => {
    if (!selectedProjectId || !projectDetail) {
      return;
    }

    if (action === "open-current-task-logs") {
      focusRunLogs();
      setPendingShortcutAction(null);
      return;
    }

    if (saving || cancellingRunId) {
      return;
    }

    if (action === "cancel-running-task") {
      const runningRun = projectDetail.runs.find((run) => run.status === "RUNNING");
      if (!runningRun) {
        setResultNotice("No running builder run is available to cancel.");
        setPendingShortcutAction(null);
        return;
      }

      void cancelRun(runningRun.id).finally(() => {
        setPendingShortcutAction(null);
      });
      return;
    }

    const failedTask = projectDetail.tasks.find((task) => task.status === "FAILED");
    if (!failedTask) {
      setResultNotice("No failed builder task is available to retry.");
      setPendingShortcutAction(null);
      return;
    }

    void resumeTask(failedTask.id, {
      fromIteration: failedTask.metadata?.currentIteration ?? failedTask.metadata?.resumeFromIteration ?? undefined,
    }).finally(() => {
      setPendingShortcutAction(null);
    });
  });

  useEffect(() => {
    const handleHashShortcut = () => {
      const action = readBuilderShortcutFromHash();
      if (action) {
        setPendingShortcutAction(action);
        clearBuilderShortcutHash();
      }
    };

    const handleCustomShortcut = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string }>).detail;
      const action = normalizeBuilderShortcutAction(detail?.action);
      if (action) {
        setPendingShortcutAction(action);
      }
    };

    handleHashShortcut();
    window.addEventListener("hashchange", handleHashShortcut);
    window.addEventListener("bizbot:builder-shortcut", handleCustomShortcut as EventListener);
    return () => {
      window.removeEventListener("hashchange", handleHashShortcut);
      window.removeEventListener("bizbot:builder-shortcut", handleCustomShortcut as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!pendingShortcutAction) {
      return;
    }

    handleDesktopShortcut(pendingShortcutAction);
  }, [pendingShortcutAction]);

  useEffect(() => {
    const activeRunId = projectDetail?.mcpSnapshot.activeRunId;
    const currentHash = projectDetail?.mcpSnapshot.currentHash ?? "unknown";
    if (!projectDetail?.mcpSnapshot.drift || !activeRunId || !projectDetail?.project.id) {
      return;
    }

    const toastKey = `${projectDetail.project.id}:${activeRunId}:${currentHash}`;
    if (seenGovernanceToastKeysRef.current.has(toastKey)) {
      return;
    }

    seenGovernanceToastKeysRef.current.add(toastKey);
    showDashboardToast({
      tone: "warning",
      title: "Governance review required",
      message: "Builder MCP contract drift is waiting for explicit operator approval in the dashboard.",
    });
  }, [projectDetail?.mcpSnapshot.activeRunId, projectDetail?.mcpSnapshot.currentHash, projectDetail?.mcpSnapshot.drift, projectDetail?.project.id]);

  const selectedProject = projectDetail?.project ?? projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedTask = projectDetail?.tasks.find((task) => task.id === selectedTaskId) ?? projectDetail?.currentTask ?? null;
  const projectsPagination = usePagination(projects, 15);
  const runsPagination = usePagination(projectDetail?.runs ?? [], 15);
  const healthAlerts = useMemo(() => buildHealthAlerts(projectDetail?.metrics ?? null), [projectDetail?.metrics]);
  const efficiencyTone = getEfficiencyTone(projectDetail?.metrics?.efficiency);
  const promotionTone = getPromotionTone(projectDetail?.metrics?.promotion);
  const architectureTone = getArchitectureTone(projectDetail?.metrics?.architecture);
  const governanceCapabilityGates = projectDetail?.operatorTrust.governance.approvalRequiredCapabilities ?? [];
  const hasMcpGovernanceDrift = Boolean(projectDetail?.mcpSnapshot.drift && projectDetail?.mcpSnapshot.activeRunId);
  const dependencyGovernanceState = projectDetail?.dependencyContract.state ?? "not_available";
  const fileTopologyGovernanceState = projectDetail?.fileTopologyContract.state ?? "pending_capture";
  const dependencyGovernanceNeedsReview = dependencyGovernanceState === "drifted" || dependencyGovernanceState === "pending_capture";
  const fileTopologyGovernanceNeedsReview = fileTopologyGovernanceState === "drifted" || fileTopologyGovernanceState === "pending_capture";

  function consumeGovernanceReason(actionLabel: string): string | null {
    if (!governanceConfirmed) {
      const message = `${actionLabel} requires explicit confirmation.`;
      setError(message);
      showDashboardToast({ tone: "warning", title: "Confirmation required", message });
      return null;
    }

    const reason = governanceReason.trim();
    if (!reason) {
      const message = `${actionLabel} requires a written review reason.`;
      setError(message);
      showDashboardToast({ tone: "warning", title: "Reason required", message });
      return null;
    }

    return reason;
  }

  async function runGovernanceAction(action: BuilderGovernanceCommandAction, body: Record<string, unknown>, successMessage: string): Promise<void> {
    if (!selectedProjectId) {
      setError("Select a project first.");
      return;
    }

    setSaving(true);
    setGovernanceAction(action);
    setError(null);
    setResultNotice(null);

    try {
      const response = await fetch(`/api/builder/projects/${selectedProjectId}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) {
        throw new Error(payload.error ?? "Governance action failed.");
      }

      setResultNotice(successMessage);
      setGovernanceReason("");
      setGovernanceConfirmed(false);
      showDashboardToast({ tone: "success", title: "Governance action recorded", message: successMessage });
      await refresh(selectedProjectId);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Governance action failed.";
      setError(message);
      showDashboardToast({ tone: "danger", title: "Governance action failed", message });
    } finally {
      setGovernanceAction(null);
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {dashboardToast ? (
        <div
          data-testid="builder-governance-toast"
          className="fixed bottom-5 right-5 z-50 w-[min(360px,calc(100vw-2rem))] border p-3 shadow-xl"
          style={{
            borderColor: dashboardToast.tone === "success" ? "var(--success)" : dashboardToast.tone === "warning" ? "var(--warning)" : "var(--danger)",
            background: dashboardToast.tone === "success"
              ? "color-mix(in srgb, var(--success) 16%, var(--bg-surface))"
              : dashboardToast.tone === "warning"
                ? "color-mix(in srgb, var(--warning) 16%, var(--bg-surface))"
                : "color-mix(in srgb, var(--danger) 16%, var(--bg-surface))",
            color: "var(--text-primary)",
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>{dashboardToast.title}</div>
              <div className="mt-1 text-sm">{dashboardToast.message}</div>
            </div>
            <button onClick={() => setDashboardToast(null)} className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-dim)" }}>
              dismiss
            </button>
          </div>
        </div>
      ) : null}
      <section className="space-y-5">
        <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] font-medium mb-1" style={{ color: "var(--text-muted)" }}>builder mode</div>
              <div className="text-sm" style={{ color: "var(--text-dim)" }}>
                Safe project creation, preset bootstrapping, and typed package actions are the primary supported Builder path. Agentic CLI adapters stay opt-in and blocked unless they are explicitly ready.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button disabled={saving || !status?.config.safe} onClick={() => void reconcileWorkspaceProjects()} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                reconcile/import workspace
              </button>
              <button onClick={() => void refresh(selectedProjectId)} className="px-3 py-2 border text-xs uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                refresh
              </button>
            </div>
          </div>
          {error ? <div className="text-sm mb-3" style={{ color: "var(--danger)" }}>{error}</div> : null}
          {resultNotice ? <div className="text-sm mb-3" style={{ color: "var(--success)" }}>{resultNotice}</div> : null}
          {hasRunningRun ? <div className="text-xs mb-3" style={{ color: "var(--text-dim)" }}>Polling live builder progress every 2 seconds.</div> : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "workspace", value: status?.config.safe ? "safe" : "blocked" },
              { label: "projects", value: String(status?.projects.total ?? 0) },
              { label: "running", value: String(status?.projects.running ?? 0) },
              { label: "agentic profile", value: status?.config.defaultAgenticProfile || "none configured" },
            ].map((card) => (
              <div key={card.label} className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="text-xs uppercase tracking-[0.22em] mb-2" style={{ color: "var(--text-muted)" }}>{card.label}</div>
                <div className="text-sm" style={{ color: "var(--text-primary)" }}>{card.value}</div>
              </div>
            ))}
          </div>
          {!status?.config.safe && status?.config.reason ? (
            <div className="mt-4 text-xs leading-6" style={{ color: "var(--danger)" }}>{status.config.reason}</div>
          ) : null}
          <div className="mt-4 text-xs leading-6" style={{ color: "var(--text-dim)" }}>
            Workspace root: {status?.config.workspaceRoot ?? "loading"}
          </div>
        </section>

        <section className="border p-4 space-y-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>create project</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Project name</label>
              <input data-testid="builder-create-project-name" value={createDraft.name} onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Planned stack</label>
              <select value={createDraft.stackPresetKey} onChange={(event) => {
                const nextKey = event.target.value;
                const preset = (status?.stackPresets ?? []).find((candidate) => candidate.key === nextKey);
                setCreateDraft((current) => ({
                  ...current,
                  stackPresetKey: nextKey,
                  template: preset?.template ?? current.template,
                  packageManager: preset?.packageManager ?? current.packageManager,
                }));
              }} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                <option value="">No preset yet</option>
                {(status?.stackPresets ?? []).map((preset) => (
                  <option key={preset.key} value={preset.key}>{preset.displayName}</option>
                ))}
              </select>
              <div className="mt-2 text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                {createDraft.stackPresetKey
                  ? ((status?.stackPresets ?? []).find((preset) => preset.key === createDraft.stackPresetKey)?.description ?? "")
                  : "Choose a common stack preset or leave this empty and set template/package manager manually."}
              </div>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Template</label>
              <select value={createDraft.template} onChange={(event) => setCreateDraft((current) => ({ ...current, stackPresetKey: "", template: event.target.value }))} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                {(status?.templates ?? []).map((template) => (
                  <option key={template.key} value={template.key}>{template.displayName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Package manager</label>
              <select value={createDraft.packageManager} onChange={(event) => setCreateDraft((current) => ({ ...current, stackPresetKey: "", packageManager: event.target.value as "NPM" | "PNPM" }))} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                <option value="NPM">NPM</option>
                <option value="PNPM">PNPM</option>
              </select>
            </div>
            <div className="flex items-end">
              <button data-testid="builder-create-project-button" disabled={saving || !status?.config.safe} onClick={() => void createProject()} className="w-full px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                create project
              </button>
            </div>
          </div>
        </section>

        <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>CLI profiles</div>
          <div className="space-y-3 text-sm">
            {(status?.cliProfiles ?? []).map((profile) => (
              <div key={profile.key} className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="flex items-center justify-between gap-4">
                  <span>{profile.displayName}</span>
                  <span style={{ color: profile.enabled ? (profile.metadata?.available ? "var(--success)" : "var(--danger)") : "var(--text-dim)" }}>
                    {profile.enabled ? (profile.metadata?.ready ? "enabled and ready" : "enabled but blocked") : "disabled"}
                  </span>
                </div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{profile.command}</div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{profile.description}</div>
                {profile.metadata?.readinessReason ? <div className="text-xs leading-6" style={{ color: profile.metadata.ready ? "var(--success)" : "var(--danger)" }}>{profile.metadata.readinessReason}</div> : null}
              </div>
            ))}
          </div>
        </section>
      </section>

      <section className="space-y-5">
        <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>projects</div>
          <div className="space-y-3 text-sm">
            {projects.length === 0 ? (
              <div style={{ color: "var(--text-dim)" }}>No builder projects yet.</div>
            ) : projectsPagination.pageItems.map((project) => (
              <button
                key={project.id}
                onClick={() => setSelectedProjectId(project.id)}
                className="w-full border p-3 text-left"
                style={{
                  borderColor: project.id === selectedProjectId ? "var(--accent)" : "var(--border-sub)",
                  background: project.id === selectedProjectId ? "var(--accent-glow)" : "var(--bg-raised)",
                }}
              >
                <div className="flex items-center justify-between gap-4">
                  <span>{project.name}</span>
                  <span style={{ color: project.lifecycle === "BLOCKED" ? "var(--danger)" : project.lifecycle === "COMPLETE" ? "var(--success)" : project.lifecycle === "ACTIVE" ? "var(--accent)" : "var(--text-dim)" }}>{project.lifecycle.toLowerCase()}</span>
                </div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{project.relativePath}</div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{project.template} · {project.packageManager} · last run {project.lastRunStatus.toLowerCase()}</div>
                <div className="text-xs leading-6" style={{ color: getWorkspaceStateColor(project.workspaceState) }}>{getWorkspaceStateLabel(project.workspaceState)}</div>
                {projectDetail?.project.id === project.id && projectDetail.context.plannedStack ? (
                  <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{projectDetail.context.plannedStack.label} · {projectDetail.context.plannedStack.tags.join(", ")}</div>
                ) : null}
              </button>
            ))}
            <PaginationControls {...projectsPagination} />
          </div>
        </section>

        <section className="border p-4 space-y-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="flex items-center justify-between gap-4">
            <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>selected project</div>
            {selectedProject ? <div className="text-xs" style={{ color: "var(--text-dim)" }}>{selectedProject.slug}</div> : null}
          </div>
          {!selectedProject ? (
            <div className="text-sm" style={{ color: "var(--text-dim)" }}>Select a builder project to inspect runs and execute actions.</div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="text-xs uppercase tracking-[0.22em] mb-2" style={{ color: "var(--text-muted)" }}>path</div>
                  <div className="text-sm">{selectedProject.relativePath}</div>
                  {projectDetail?.context.plannedStack ? <div className="text-xs mt-2" style={{ color: "var(--text-dim)" }}>{projectDetail.context.plannedStack.label}</div> : null}
                </div>
                <div className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="text-xs uppercase tracking-[0.22em] mb-2" style={{ color: "var(--text-muted)" }}>git</div>
                  <div className="text-sm">{selectedProject.gitInitialized ? "initialized" : "not initialized"}</div>
                </div>
                <div className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="text-xs uppercase tracking-[0.22em] mb-2" style={{ color: "var(--text-muted)" }}>lifecycle</div>
                  <div data-testid="builder-selected-project-lifecycle" className="text-sm">{selectedProject.lifecycle.toLowerCase()}</div>
                </div>
                <div className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="text-xs uppercase tracking-[0.22em] mb-2" style={{ color: "var(--text-muted)" }}>workspace</div>
                  <div className="text-sm" style={{ color: getWorkspaceStateColor(selectedProject.workspaceState) }}>{getWorkspaceStateLabel(selectedProject.workspaceState)}</div>
                </div>
                <div className="border p-3 sm:col-span-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>config</div>
                    <div className="text-xs uppercase tracking-[0.18em]" style={{ color: getConfigStatusColor(projectDetail?.configReadiness) }}>
                      {getConfigStatusLabel(projectDetail?.configReadiness)}
                    </div>
                  </div>
                  <div className="text-sm" style={{ color: "var(--text-primary)" }}>
                    {projectDetail?.configReadiness.summary ?? "Config readiness has not been evaluated yet."}
                  </div>
                  {projectDetail?.configReadiness.totalRequiredKeys ? (
                    <div className="mt-2 text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      Required keys: {projectDetail.configReadiness.totalRequiredKeys}
                    </div>
                  ) : null}
                  {projectDetail?.configReadiness.missingProjectKeys.length ? (
                    <div className="mt-2 text-xs leading-6" style={{ color: "var(--warning)" }}>
                      Missing project-local keys: {projectDetail.configReadiness.missingProjectKeys.join(", ")}
                    </div>
                  ) : null}
                  {projectDetail?.configReadiness.missingExecutionKeys.length ? (
                    <div className="mt-1 text-xs leading-6" style={{ color: "var(--danger)" }}>
                      Missing execution keys: {projectDetail.configReadiness.missingExecutionKeys.join(", ")}
                    </div>
                  ) : null}
                  {projectDetail?.configReadiness.malformedEntries.length ? (
                    <div className="mt-1 text-xs leading-6" style={{ color: "var(--danger)" }}>
                      Malformed env entries: {projectDetail.configReadiness.malformedEntries.map((entry) => `${entry.path}:${entry.line}`).join(", ")}
                    </div>
                  ) : null}
                  <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(260px,0.7fr)]">
                    <div className="border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                      <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>required config keys</div>
                      {projectDetail?.configReadiness.keys.length ? projectDetail.configReadiness.keys.map((entry) => (
                        <button
                          key={entry.key}
                          onClick={() => setEnvDraft((current) => ({ ...current, key: entry.key }))}
                          className="w-full border p-2 text-left"
                          style={{ borderColor: envDraft.key === entry.key ? "var(--accent)" : "var(--border)", background: envDraft.key === entry.key ? "var(--accent-glow)" : "var(--bg-raised)" }}
                        >
                          <div className="flex items-center justify-between gap-3 text-xs uppercase tracking-[0.14em]">
                            <span>{entry.key}</span>
                            <span style={{ color: !entry.executionValuePresent ? "var(--danger)" : !entry.projectValuePresent ? "var(--warning)" : "var(--success)" }}>
                              {!entry.executionValuePresent ? "missing" : !entry.projectValuePresent ? "host-backed" : "project-local"}
                            </span>
                          </div>
                          <div className="mt-1 text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                            project {entry.projectSource ?? "missing"}: {entry.redactedProjectValue ?? "missing"}
                          </div>
                          <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                            execution {entry.executionSource}: {entry.redactedExecutionValue ?? "missing"}
                          </div>
                        </button>
                      )) : <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>No declared config keys yet. Sync .env.example after writing project-local values.</div>}
                    </div>
                    <div className="border p-3 space-y-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>env actions</div>
                        <button disabled={saving} onClick={() => void mutateProjectEnv({ action: "sync_example" })} className="px-3 py-2 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                          sync .env.example
                        </button>
                      </div>
                      <div>
                        <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Key</label>
                        <input value={envDraft.key} onChange={(event) => setEnvDraft((current) => ({ ...current, key: event.target.value }))} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} placeholder="DATABASE_URL" />
                      </div>
                      <div>
                        <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Value</label>
                        <input value={envDraft.value} onChange={(event) => setEnvDraft((current) => ({ ...current, value: event.target.value }))} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} placeholder="Project-local value" />
                      </div>
                      <div>
                        <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Target file</label>
                        <select value={envDraft.file} onChange={(event) => setEnvDraft((current) => ({ ...current, file: event.target.value as ".env" | ".env.local" }))} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                          <option value=".env.local">.env.local</option>
                          <option value=".env">.env</option>
                        </select>
                      </div>
                      <button
                        disabled={saving || !envDraft.key.trim()}
                        onClick={() => void mutateProjectEnv({ action: "write", key: envDraft.key, value: envDraft.value, file: envDraft.file })}
                        className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50"
                        style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                      >
                        write env entry
                      </button>
                    </div>
                  </div>
                </div>
                <div className="border p-3 sm:col-span-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="text-xs uppercase tracking-[0.22em] mb-2" style={{ color: "var(--text-muted)" }}>objective</div>
                  <div className="text-sm" style={{ color: projectDetail?.context.objective ? "var(--text-primary)" : "var(--text-dim)" }}>
                    {projectDetail?.context.objective ?? "No durable Builder objective recorded yet."}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-3">
                <div className="border p-3 space-y-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>brief</div>
                    <button data-testid="builder-save-plan-button" disabled={saving || !selectedProjectId} onClick={() => void planProject()} className="px-3 py-2 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                      save + plan
                    </button>
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Title</label>
                    <input data-testid="builder-brief-title" value={briefDraft.title} onChange={(event) => setBriefDraft((current) => ({ ...current, title: event.target.value }))} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Summary</label>
                    <textarea data-testid="builder-brief-summary" value={briefDraft.summary} onChange={(event) => setBriefDraft((current) => ({ ...current, summary: event.target.value }))} rows={5} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Notes</label>
                    <textarea data-testid="builder-brief-notes" value={briefDraft.notes} onChange={(event) => setBriefDraft((current) => ({ ...current, notes: event.target.value }))} rows={3} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                  </div>
                </div>
                <div className="border p-3 space-y-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>plan</div>
                  {projectDetail?.milestones.length ? projectDetail.milestones.map((milestone) => (
                    <div key={milestone.id} className="border p-2" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span>{milestone.sortOrder}. {milestone.title}</span>
                        <span style={{ color: milestone.status === "BLOCKED" ? "var(--danger)" : milestone.status === "COMPLETE" ? "var(--success)" : milestone.status === "ACTIVE" ? "var(--accent)" : "var(--text-dim)" }}>{milestone.status.toLowerCase()}</span>
                      </div>
                      <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{milestone.summary}</div>
                      {milestone.taskSpecs.map((taskSpec) => (
                        <div key={taskSpec.id} className="text-xs leading-6" style={{ color: taskSpec.id === projectDetail.currentTaskSpec?.id ? "var(--accent)" : "var(--text-dim)" }}>
                          {taskSpec.sortOrder}. [{taskSpec.status.toLowerCase()}] {taskSpec.title}
                        </div>
                      ))}
                    </div>
                  )) : <div className="text-sm" style={{ color: "var(--text-dim)" }}>No canonical Builder plan has been generated yet.</div>}
                </div>
                <div className="border p-3 space-y-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>current task</div>
                  {projectDetail?.currentTaskSpec ? (
                    <>
                      <div className="text-sm">{projectDetail.currentTaskSpec.title}</div>
                      <div className="text-xs" style={{ color: "var(--text-dim)" }}>
                        {projectDetail.currentMilestone?.title ?? "no milestone"} · {projectDetail.currentTaskSpec.status.toLowerCase()}
                      </div>
                      <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{projectDetail.currentTaskSpec.summary}</div>
                      <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                        Validators: {projectDetail.currentTaskSpec.validators.join(", ").toLowerCase() || "manual_review"}
                      </div>
                      <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                        Completion: {projectDetail.currentTaskSpec.completionCriteria.join("; ") || "none recorded"}
                      </div>
                      {selectedTask ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>Execution task: {selectedTask.stage.toLowerCase()} · {selectedTask.status.toLowerCase()}</div> : null}
                      {selectedTask?.summary ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{selectedTask.summary}</div> : null}
                      {selectedTask?.metadata?.latestLoopSummary ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{selectedTask.metadata.latestLoopSummary}</div> : null}
                    </>
                  ) : <div className="text-sm" style={{ color: "var(--text-dim)" }}>No Builder task spec is active yet.</div>}
                  <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>next recommended step</div>
                  <div className="text-sm" style={{ color: projectDetail?.nextRecommendedStep ? "var(--text-primary)" : "var(--text-dim)" }}>
                    {projectDetail?.nextRecommendedStep ?? "No next step has been synthesized yet."}
                  </div>
                </div>
              </div>

              <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="flex items-center justify-between gap-4">
                  <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>builder stats</div>
                  <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-dim)" }}>project scoped</div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    { label: "success rate", value: formatPercentage(builderStats?.successRate) },
                    { label: "verification pass", value: formatPercentage(builderStats?.verificationPassRate) },
                    { label: "retry rate", value: formatPercentage(builderStats?.retryRate) },
                    { label: "avg iterations / task", value: String(builderStats?.avgIterationsPerTask ?? 0) },
                    { label: "avg iterations / run", value: String(builderStats?.avgIterationsPerRun ?? 0) },
                    { label: "total runs", value: String(builderStats?.totalRuns ?? 0) },
                  ].map((card) => (
                    <div key={card.label} className="border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                      <div className="text-xs uppercase tracking-[0.16em] mb-2" style={{ color: "var(--text-muted)" }}>{card.label}</div>
                      <div className="text-sm" style={{ color: "var(--text-primary)" }}>{card.value}</div>
                    </div>
                  ))}
                </div>
                {builderStats ? (
                  <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                    Status counts: {Object.entries(builderStats.statusCounts).length > 0
                      ? Object.entries(builderStats.statusCounts).map(([statusKey, count]) => `${statusKey.toLowerCase()}: ${count}`).join("; ")
                      : "none recorded"}
                  </div>
                ) : null}
              </div>

              <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="flex items-center justify-between gap-4">
                  <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>builder health</div>
                  <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-dim)" }}>overview scoped</div>
                </div>
                {healthAlerts.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {healthAlerts.map((alert) => (
                      <div
                        key={alert.label}
                        className="border px-2 py-1 text-[11px] uppercase tracking-[0.14em]"
                        style={{
                          borderColor: getToneColor(alert.tone),
                          background: getToneSurface(alert.tone),
                          color: getToneColor(alert.tone),
                        }}
                      >
                        {alert.label}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                    No Builder health thresholds are currently tripped.
                  </div>
                )}
                <div className="grid gap-3 lg:grid-cols-3">
                  <div className="border p-3 space-y-2" style={{ borderColor: getToneColor(efficiencyTone), background: getToneSurface(efficiencyTone) }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>efficiency</div>
                      <div className="text-[11px] uppercase tracking-[0.14em]" style={{ color: getToneColor(efficiencyTone) }}>{efficiencyTone}</div>
                    </div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      Success {formatPercentage(projectDetail?.metrics.efficiency.successRate)}; verification {formatPercentage(projectDetail?.metrics.efficiency.verificationPassRate)}; retry {formatPercentage(projectDetail?.metrics.efficiency.retryRate)}.
                    </div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      Avg iterations / run {projectDetail?.metrics.efficiency.avgIterationsPerRun ?? 0}; avg iterations / task {projectDetail?.metrics.efficiency.avgIterationsPerTask ?? 0}; tasks in retry {projectDetail?.metrics.efficiency.tasksInRetry ?? 0}.
                    </div>
                  </div>
                  <div className="border p-3 space-y-2" style={{ borderColor: getToneColor(promotionTone), background: getToneSurface(promotionTone) }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>promotion</div>
                      <div className="text-[11px] uppercase tracking-[0.14em]" style={{ color: getToneColor(promotionTone) }}>{promotionTone}</div>
                    </div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      Milestones {projectDetail?.metrics.promotion.completedMilestones ?? 0}/{projectDetail?.metrics.promotion.totalMilestones ?? 0} complete ({formatPercentage(projectDetail?.metrics.promotion.milestoneCompletionRate)}).
                    </div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      Task specs {projectDetail?.metrics.promotion.completedTaskSpecs ?? 0}/{projectDetail?.metrics.promotion.totalTaskSpecs ?? 0} complete ({formatPercentage(projectDetail?.metrics.promotion.taskSpecCompletionRate)}); blocked {projectDetail?.metrics.promotion.blockedTaskSpecs ?? 0}.
                    </div>
                  </div>
                  <div className="border p-3 space-y-2" style={{ borderColor: getToneColor(architectureTone), background: getToneSurface(architectureTone) }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>architecture</div>
                      <div className="text-[11px] uppercase tracking-[0.14em]" style={{ color: getToneColor(architectureTone) }}>{architectureTone}</div>
                    </div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      Active ADRs {projectDetail?.metrics.architecture.activeDecisionCount ?? 0}; stale ADRs {projectDetail?.metrics.architecture.staleDecisionCount ?? 0}; current task keys {projectDetail?.metrics.architecture.currentTaskDecisionCount ?? 0}.
                    </div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      Latest review addressed {projectDetail?.metrics.architecture.latestAddressedStaleCount ?? 0} stale keys, missed {projectDetail?.metrics.architecture.latestMissingStaleCount ?? 0}, added {projectDetail?.metrics.architecture.latestNewDecisionCount ?? 0}, retired {projectDetail?.metrics.architecture.latestRetiredDecisionCount ?? 0}.
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-3">
                <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>budget profiles</div>
                    <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-dim)" }}>mode defaults</div>
                  </div>
                  {(projectDetail?.budgetProfiles ?? []).map((profile) => (
                    <div key={profile.mode} className="border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>{profile.mode.replace("_", " ")}</div>
                        <div className="text-[11px]" style={{ color: "var(--text-dim)" }}>{profile.observedRuns} observed</div>
                      </div>
                      <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                        Max {profile.maxIterations} iterations; {formatDurationMs(profile.maxDurationMs)}; {profile.maxTotalTokens.toLocaleString()} tokens; {formatUsd(profile.maxEstimatedCostUsd)}; {profile.maxRetries} retries.
                      </div>
                      <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                        Observed avg {formatDurationMs(profile.observedAvgDurationMs)} and {Math.round(profile.observedAvgTotalTokens).toLocaleString()} tokens at {formatUsd(profile.observedAvgCostUsd)}.
                      </div>
                      <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{profile.rationale}</div>
                      {profile.topBlockedReason ? <div className="text-xs leading-6" style={{ color: "var(--warning)" }}>Top blocker: {profile.topBlockedReason}</div> : null}
                    </div>
                  ))}
                </div>

                <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>telemetry</div>
                    <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-dim)" }}>run behavior</div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      { label: "avg completion", value: formatDurationMs(projectDetail?.telemetry?.avgTimeToCompletionMs) },
                      { label: "total duration", value: formatDurationMs(projectDetail?.telemetry?.totalDurationMs) },
                      { label: "requests", value: String(projectDetail?.telemetry?.tokenTotals.requestCount ?? 0) },
                      { label: "estimated cost", value: formatUsd(projectDetail?.telemetry?.tokenTotals.estimatedCostUsd) },
                    ].map((card) => (
                      <div key={card.label} className="border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                        <div className="text-xs uppercase tracking-[0.16em] mb-2" style={{ color: "var(--text-muted)" }}>{card.label}</div>
                        <div className="text-sm" style={{ color: "var(--text-primary)" }}>{card.value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                    Tokens: prompt {(projectDetail?.telemetry?.tokenTotals.promptTokens ?? 0).toLocaleString()}, completion {(projectDetail?.telemetry?.tokenTotals.completionTokens ?? 0).toLocaleString()}, total {(projectDetail?.telemetry?.tokenTotals.totalTokens ?? 0).toLocaleString()}, cached {(projectDetail?.telemetry?.tokenTotals.cachedPromptTokens ?? 0).toLocaleString()}.
                  </div>
                  <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                    Top blocked reason: {projectDetail?.telemetry?.topBlockedReason ?? "none"}
                  </div>
                  <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                    Modes: {Object.entries(projectDetail?.telemetry?.modeCounts ?? {}).length > 0
                      ? Object.entries(projectDetail?.telemetry?.modeCounts ?? {}).map(([mode, count]) => `${mode.replace("_", " ")}: ${count}`).join("; ")
                      : "none recorded"}
                  </div>
                  <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                    Templates: {Object.entries(projectDetail?.telemetry?.templateCounts ?? {}).length > 0
                      ? Object.entries(projectDetail?.telemetry?.templateCounts ?? {}).map(([template, count]) => `${template}: ${count}`).join("; ")
                      : "none recorded"}
                  </div>
                </div>

                <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>reconciliation</div>
                    <button disabled={saving} onClick={() => void runProjectAction(`/api/builder/projects/${selectedProject.id}/commands`, { action: "reconcile_operational_state" })} className="px-3 py-2 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                      reconcile now
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      { label: "active alerts", value: String(projectDetail?.reconciliation?.activeAlertCount ?? 0) },
                      { label: "auto fixes", value: String(projectDetail?.reconciliation?.reconciledRunCount ?? 0) },
                      { label: "unresolved", value: String(projectDetail?.reconciliation?.unresolvedAlertCount ?? 0) },
                      { label: "stale threshold", value: formatDurationMs(projectDetail?.reconciliation?.thresholds.staleRunningMs) },
                    ].map((card) => (
                      <div key={card.label} className="border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                        <div className="text-xs uppercase tracking-[0.16em] mb-2" style={{ color: "var(--text-muted)" }}>{card.label}</div>
                        <div className="text-sm" style={{ color: "var(--text-primary)" }}>{card.value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                    No-progress threshold {formatDurationMs(projectDetail?.reconciliation?.thresholds.noProgressMs)}; identical failure threshold {projectDetail?.reconciliation?.thresholds.identicalFailureThreshold ?? 0}.
                  </div>
                  {(projectDetail?.reconciliation?.alerts ?? []).slice(0, 3).map((alert) => (
                    <div key={`${alert.code}-${alert.runId}`} className="border p-2 text-xs leading-6" style={{ borderColor: alert.severity === "danger" ? "var(--danger)" : "var(--warning)", background: alert.severity === "danger" ? "color-mix(in srgb, var(--danger) 10%, var(--bg-surface))" : "color-mix(in srgb, var(--warning) 10%, var(--bg-surface))", color: "var(--text-dim)" }}>
                      {alert.summary} {alert.autoFixable ? "Safe auto-fix available." : "Needs operator review."}
                    </div>
                  ))}
                  {(projectDetail?.reconciliation?.corrections ?? []).slice(0, 2).map((entry) => (
                    <div key={`${entry.runId}-${entry.correctedAt}`} className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      Corrected {entry.runId}: {entry.previousStatus.toLowerCase()} → {entry.nextStatus.toLowerCase()} because {entry.reason}.
                    </div>
                  ))}
                </div>
              </div>

              <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="flex items-center justify-between gap-4">
                  <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>mcp snapshot</div>
                  <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: projectDetail?.mcpSnapshot.state === "drifted" ? "var(--danger)" : "var(--text-dim)" }}>
                    {projectDetail?.mcpSnapshot.state.replace("_", " ")}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    { label: "sequence", value: String(projectDetail?.mcpSnapshot.currentSequence ?? 0) },
                    { label: "semantic", value: projectDetail?.mcpSnapshot.semantic.queueState.replace("_", " ") ?? "idle" },
                    { label: "mappings", value: String(projectDetail?.mcpSnapshot.semantic.mappingCount ?? 0) },
                    { label: "unique tools", value: String(projectDetail?.mcpSnapshot.semantic.uniqueToolCount ?? 0) },
                  ].map((card) => (
                    <div key={card.label} className="border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                      <div className="text-xs uppercase tracking-[0.16em] mb-2" style={{ color: "var(--text-muted)" }}>{card.label}</div>
                      <div className="text-sm" style={{ color: "var(--text-primary)" }}>{card.value}</div>
                    </div>
                  ))}
                </div>
                <div className="text-xs leading-6 break-all" style={{ color: "var(--text-dim)" }}>
                  Current hash: {projectDetail?.mcpSnapshot.currentHash ?? "none"}
                </div>
                {projectDetail?.mcpSnapshot.drift ? (
                  <div className="border p-3 space-y-2" style={{ borderColor: "var(--danger)", background: "color-mix(in srgb, var(--danger) 10%, var(--bg-surface))" }}>
                    <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--danger)" }}>contract drift detected</div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      Tools +{projectDetail.mcpSnapshot.drift.tools.added.length} / -{projectDetail.mcpSnapshot.drift.tools.removed.length} / ~{projectDetail.mcpSnapshot.drift.tools.changed.length}; prompts +{projectDetail.mcpSnapshot.drift.prompts.added.length} / -{projectDetail.mcpSnapshot.drift.prompts.removed.length} / ~{projectDetail.mcpSnapshot.drift.prompts.changed.length}; resources +{projectDetail.mcpSnapshot.drift.resources.added.length} / -{projectDetail.mcpSnapshot.drift.resources.removed.length} / ~{projectDetail.mcpSnapshot.drift.resources.changed.length}.
                    </div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      Resolve this through the governance review panel so the decision is confirmed and annotated.
                    </div>
                  </div>
                ) : null}
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                    <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>semantic enrichment</div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      Embedding format {projectDetail?.mcpSnapshot.semantic.embeddingFormatVersion ?? "none"}; embedded {projectDetail?.mcpSnapshot.semantic.embeddedAt ? new Date(projectDetail.mcpSnapshot.semantic.embeddedAt).toLocaleString() : "not yet"}; ontology sync {projectDetail?.mcpSnapshot.semantic.ontologySyncVersion ?? "none"}.
                    </div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      Validators {projectDetail?.mcpSnapshot.semantic.validatorCount ?? 0}; ADR keys {projectDetail?.mcpSnapshot.semantic.activeAdrDecisionKeys.join(", ") || "none"}; ontology hints {projectDetail?.mcpSnapshot.semantic.ontologyHints.join(", ") || "none"}.
                    </div>
                    {projectDetail?.mcpSnapshot.semantic.cleanupProcessedAt ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>Cleanup processed {new Date(projectDetail.mcpSnapshot.semantic.cleanupProcessedAt).toLocaleString()}.</div> : null}
                  </div>
                  <div className="border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                    <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>contract-aware planning</div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      {projectDetail?.mcpSnapshot.planning?.summary ?? "No accepted MCP baseline exists yet for planner evolution analysis."}
                    </div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      Related ADR keys: {projectDetail?.mcpSnapshot.planning?.relatedArchitectureDecisionKeys.join(", ") || "none"}
                    </div>
                    {(projectDetail?.mcpSnapshot.planning?.recommendations ?? []).slice(0, 3).map((recommendation) => (
                      <div key={recommendation} className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{recommendation}</div>
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                    <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>recent history</div>
                    {(projectDetail?.mcpSnapshot.history ?? []).slice(0, 3).map((entry) => (
                      <div key={entry.id} className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                        seq {entry.snapshotSequence} · {entry.versionHash.slice(0, 12)} · {new Date(entry.appliedAt).toLocaleString()}
                      </div>
                    ))}
                    {(projectDetail?.mcpSnapshot.history ?? []).length === 0 ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>No accepted snapshot history recorded yet.</div> : null}
                  </div>
                  <div className="border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                    <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>semantic neighbors</div>
                    {(projectDetail?.mcpSnapshot.semanticMatches ?? []).slice(0, 3).map((match) => (
                      <div key={match.snapshotId} className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                        seq {match.snapshotSequence} · similarity {(match.similarity * 100).toFixed(1)}% · {new Date(match.appliedAt).toLocaleString()}
                      </div>
                    ))}
                    {(projectDetail?.mcpSnapshot.semanticMatches ?? []).length === 0 ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>No semantic neighbors available yet.</div> : null}
                  </div>
                </div>
              </div>

              <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="flex items-center justify-between gap-4">
                  <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>governance review</div>
                  <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: getOperatorTrustColor(projectDetail?.operatorTrust.governance.status) }}>
                    {formatOperatorTrustLabel(projectDetail?.operatorTrust.governance.status)}
                  </div>
                </div>
                <div data-testid="builder-governance-panel" className="space-y-3">
                  <div className="text-sm" style={{ color: "var(--text-primary)" }}>
                    {projectDetail?.operatorTrust.governance.summary ?? "Governance actions are not available until a Builder project is loaded."}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {governanceCapabilityGates.length > 0 ? governanceCapabilityGates.map((capabilityKey) => (
                      <div key={capabilityKey} className="border px-2 py-1 text-[11px] uppercase tracking-[0.14em]" style={{ borderColor: "var(--warning)", background: "color-mix(in srgb, var(--warning) 10%, var(--bg-surface))", color: "var(--warning)" }}>
                        {capabilityKey.replaceAll("_", " ")}
                      </div>
                    )) : (
                      <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>No approval-gated governance capabilities are currently advertised.</div>
                    )}
                  </div>
                  <div className="grid gap-3 lg:grid-cols-[minmax(280px,0.92fr)_minmax(0,1.08fr)]">
                    <div className="border p-3 space-y-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                      <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>operator approval</div>
                      <div>
                        <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Review reason</label>
                        <textarea
                          data-testid="builder-governance-reason"
                          value={governanceReason}
                          onChange={(event) => setGovernanceReason(event.target.value)}
                          rows={5}
                          className="w-full bg-transparent border px-3 py-2 text-sm"
                          style={{ borderColor: "var(--border)" }}
                          placeholder="Explain why this governance change is intentional and safe."
                        />
                      </div>
                      <label className="flex items-start gap-3 border p-3 text-xs leading-6" style={{ borderColor: governanceConfirmed ? "var(--accent)" : "var(--border)", background: governanceConfirmed ? "var(--accent-glow)" : "var(--bg-raised)" }}>
                        <input
                          data-testid="builder-governance-confirmed"
                          type="checkbox"
                          checked={governanceConfirmed}
                          onChange={(event) => setGovernanceConfirmed(event.target.checked)}
                        />
                        <span>I reviewed the drift and I want Builder to record an explicit governance decision with the reason above.</span>
                      </label>
                      <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                        Governance actions are durable and reviewable. The dashboard requires the same explicit confirmation model as the medium-authority Builder tools.
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div data-testid="builder-governance-mcp-review" className="border p-3 space-y-3" style={{ borderColor: hasMcpGovernanceDrift ? "var(--danger)" : "var(--border)", background: hasMcpGovernanceDrift ? "color-mix(in srgb, var(--danger) 10%, var(--bg-surface))" : "var(--bg-surface)" }}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: hasMcpGovernanceDrift ? "var(--danger)" : "var(--text-muted)" }}>mcp contract drift</div>
                          <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: hasMcpGovernanceDrift ? "var(--danger)" : "var(--text-dim)" }}>
                            {hasMcpGovernanceDrift ? "approval required" : "aligned"}
                          </div>
                        </div>
                        {hasMcpGovernanceDrift && projectDetail?.mcpSnapshot.drift ? (
                          <>
                            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                              Tools +{projectDetail.mcpSnapshot.drift.tools.added.length} / -{projectDetail.mcpSnapshot.drift.tools.removed.length} / ~{projectDetail.mcpSnapshot.drift.tools.changed.length}; prompts +{projectDetail.mcpSnapshot.drift.prompts.added.length} / -{projectDetail.mcpSnapshot.drift.prompts.removed.length} / ~{projectDetail.mcpSnapshot.drift.prompts.changed.length}; resources +{projectDetail.mcpSnapshot.drift.resources.added.length} / -{projectDetail.mcpSnapshot.drift.resources.removed.length} / ~{projectDetail.mcpSnapshot.drift.resources.changed.length}.
                            </div>
                            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                              Active run: {projectDetail.mcpSnapshot.activeRunId}
                            </div>
                            <div className="flex flex-wrap gap-3">
                              <button
                                data-testid="builder-governance-approve-mcp-drift"
                                disabled={saving || governanceAction !== null || !projectDetail.mcpSnapshot.activeRunId}
                                onClick={() => {
                                  const reason = consumeGovernanceReason("Approving MCP contract drift");
                                  if (!reason || !projectDetail.mcpSnapshot.activeRunId) {
                                    return;
                                  }
                                  void runGovernanceAction("resolve_mcp_contract_drift", buildBuilderGovernanceCommandPayload({
                                    action: "resolve_mcp_contract_drift",
                                    runId: projectDetail.mcpSnapshot.activeRunId,
                                    decision: "approve",
                                    confirmed: true,
                                    reason,
                                    sourceSurface: "dashboard",
                                  }), "Approved the Builder MCP contract rollover from the dashboard.");
                                }}
                                className="px-3 py-2 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50"
                                style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                              >
                                approve rollover
                              </button>
                              <button
                                data-testid="builder-governance-reject-mcp-drift"
                                disabled={saving || governanceAction !== null || !projectDetail.mcpSnapshot.activeRunId}
                                onClick={() => {
                                  const reason = consumeGovernanceReason("Rejecting MCP contract drift");
                                  if (!reason || !projectDetail.mcpSnapshot.activeRunId) {
                                    return;
                                  }
                                  void runGovernanceAction("resolve_mcp_contract_drift", buildBuilderGovernanceCommandPayload({
                                    action: "resolve_mcp_contract_drift",
                                    runId: projectDetail.mcpSnapshot.activeRunId,
                                    decision: "reject",
                                    confirmed: true,
                                    reason,
                                    sourceSurface: "dashboard",
                                  }), "Rejected the Builder MCP contract rollover from the dashboard.");
                                }}
                                className="px-3 py-2 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50"
                                style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                              >
                                reject drift
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                            No active MCP contract drift is waiting for a decision.
                          </div>
                        )}
                      </div>
                      <div data-testid="builder-governance-policy-review" className="border p-3 space-y-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>mcp policy baseline</div>
                          <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-dim)" }}>manual reconcile</div>
                        </div>
                        <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                          Use this only when the current Builder MCP contract is intentionally changing and you want to promote the reviewed state into the accepted policy baseline.
                        </div>
                        <button
                          data-testid="builder-governance-reconcile-policy"
                          disabled={saving || governanceAction !== null}
                          onClick={() => {
                            const reason = consumeGovernanceReason("Reconciling Builder MCP policy");
                            if (!reason) {
                              return;
                            }
                            void runGovernanceAction("reconcile_mcp_policy", buildBuilderGovernanceCommandPayload({
                              action: "reconcile_mcp_policy",
                              confirmed: true,
                              reason,
                              sourceSurface: "dashboard",
                            }), "Reconciled the Builder MCP policy baseline from the dashboard.");
                          }}
                          className="px-3 py-2 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50"
                          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                        >
                          reconcile baseline
                        </button>
                      </div>
                      <div data-testid="builder-governance-dependency-review" className="border p-3 space-y-3" style={{ borderColor: dependencyGovernanceNeedsReview ? "var(--warning)" : "var(--border)", background: dependencyGovernanceNeedsReview ? "color-mix(in srgb, var(--warning) 10%, var(--bg-surface))" : "var(--bg-surface)" }}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: dependencyGovernanceNeedsReview ? "var(--warning)" : "var(--text-muted)" }}>dependency contract</div>
                          <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: dependencyGovernanceNeedsReview ? "var(--warning)" : "var(--text-dim)" }}>
                            {dependencyGovernanceNeedsReview ? "approval required" : dependencyGovernanceState.replaceAll("_", " ")}
                          </div>
                        </div>
                        <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                          {projectDetail?.dependencyContract.planning?.summary ?? "No dependency contract data is available for this project yet."}
                        </div>
                        {projectDetail?.dependencyContract.drift ? (
                          <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                            Packages +{projectDetail.dependencyContract.drift.packages.added.length} / -{projectDetail.dependencyContract.drift.packages.removed.length} / ~{projectDetail.dependencyContract.drift.packages.changed.length} / reclass {projectDetail.dependencyContract.drift.packages.reclassified.length}; scripts +{projectDetail.dependencyContract.drift.scripts.added.length} / -{projectDetail.dependencyContract.drift.scripts.removed.length} / ~{projectDetail.dependencyContract.drift.scripts.changed.length}; lockfile changed {projectDetail.dependencyContract.drift.lockfileChanged ? "yes" : "no"}; package manager changed {projectDetail.dependencyContract.drift.packageManagerChanged ? "yes" : "no"}.
                          </div>
                        ) : null}
                        {projectDetail?.dependencyContract.planning?.highlightedPackages.length ? (
                          <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                            Highlighted packages: {projectDetail.dependencyContract.planning.highlightedPackages.join(", ")}
                          </div>
                        ) : null}
                        {(projectDetail?.dependencyContract.planning?.recommendations ?? []).slice(0, 2).map((recommendation) => (
                          <div key={recommendation} className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{recommendation}</div>
                        ))}
                        {dependencyGovernanceNeedsReview && projectDetail?.dependencyContract.runId ? (
                          <div className="flex flex-wrap gap-3">
                            <button
                              data-testid="builder-governance-approve-dependency-drift"
                              disabled={saving || governanceAction !== null}
                              onClick={() => {
                                const reason = consumeGovernanceReason("Approving dependency contract drift");
                                if (!reason) {
                                  return;
                                }
                                void runGovernanceAction("resolve_dependency_contract_drift", buildBuilderGovernanceCommandPayload({
                                  action: "resolve_dependency_contract_drift",
                                  runId: projectDetail.dependencyContract.runId,
                                  decision: "approve",
                                  confirmed: true,
                                  reason,
                                  sourceSurface: "dashboard",
                                }), "Approved the Builder dependency contract rollover from the dashboard.");
                              }}
                              className="px-3 py-2 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50"
                              style={{ borderColor: "var(--warning)", color: "var(--warning)" }}
                            >
                              approve dependency rollover
                            </button>
                            <button
                              data-testid="builder-governance-reject-dependency-drift"
                              disabled={saving || governanceAction !== null}
                              onClick={() => {
                                const reason = consumeGovernanceReason("Rejecting dependency contract drift");
                                if (!reason) {
                                  return;
                                }
                                void runGovernanceAction("resolve_dependency_contract_drift", buildBuilderGovernanceCommandPayload({
                                  action: "resolve_dependency_contract_drift",
                                  runId: projectDetail.dependencyContract.runId,
                                  decision: "reject",
                                  confirmed: true,
                                  reason,
                                  sourceSurface: "dashboard",
                                }), "Rejected the Builder dependency contract rollover from the dashboard.");
                              }}
                              className="px-3 py-2 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50"
                              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                            >
                              reject dependency drift
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <div data-testid="builder-governance-file-topology-review" className="border p-3 space-y-3" style={{ borderColor: fileTopologyGovernanceNeedsReview ? "var(--warning)" : "var(--border)", background: fileTopologyGovernanceNeedsReview ? "color-mix(in srgb, var(--warning) 10%, var(--bg-surface))" : "var(--bg-surface)" }}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: fileTopologyGovernanceNeedsReview ? "var(--warning)" : "var(--text-muted)" }}>file topology contract</div>
                          <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: fileTopologyGovernanceNeedsReview ? "var(--warning)" : "var(--text-dim)" }}>
                            {fileTopologyGovernanceNeedsReview ? "approval required" : fileTopologyGovernanceState.replaceAll("_", " ")}
                          </div>
                        </div>
                        <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                          {projectDetail?.fileTopologyContract.planning?.summary ?? "No file topology contract data is available for this project yet."}
                        </div>
                        {projectDetail?.fileTopologyContract.drift ? (
                          <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                            Directories +{projectDetail.fileTopologyContract.drift.directories.added.length} / -{projectDetail.fileTopologyContract.drift.directories.removed.length}; important files +{projectDetail.fileTopologyContract.drift.importantFiles.added.length} / -{projectDetail.fileTopologyContract.drift.importantFiles.removed.length}; anchors changed {projectDetail.fileTopologyContract.drift.anchorsChanged.length}; classifications changed {projectDetail.fileTopologyContract.drift.classificationsChanged.length}; rules changed {projectDetail.fileTopologyContract.drift.rulesChanged.length}.
                          </div>
                        ) : null}
                        {projectDetail?.fileTopologyContract.planning?.topLevel.length ? (
                          <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                            Top-level entries: {projectDetail.fileTopologyContract.planning.topLevel.slice(0, 8).join(", ")}
                          </div>
                        ) : null}
                        {(projectDetail?.fileTopologyContract.planning?.recommendations ?? []).slice(0, 2).map((recommendation) => (
                          <div key={recommendation} className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{recommendation}</div>
                        ))}
                        {fileTopologyGovernanceNeedsReview && projectDetail?.fileTopologyContract.runId ? (
                          <div className="flex flex-wrap gap-3">
                            <button
                              data-testid="builder-governance-approve-file-topology-drift"
                              disabled={saving || governanceAction !== null}
                              onClick={() => {
                                const reason = consumeGovernanceReason("Approving file topology contract drift");
                                if (!reason) {
                                  return;
                                }
                                void runGovernanceAction("resolve_file_topology_contract_drift", buildBuilderGovernanceCommandPayload({
                                  action: "resolve_file_topology_contract_drift",
                                  runId: projectDetail.fileTopologyContract.runId,
                                  decision: "approve",
                                  confirmed: true,
                                  reason,
                                  sourceSurface: "dashboard",
                                }), "Approved the Builder file topology contract rollover from the dashboard.");
                              }}
                              className="px-3 py-2 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50"
                              style={{ borderColor: "var(--warning)", color: "var(--warning)" }}
                            >
                              approve topology rollover
                            </button>
                            <button
                              data-testid="builder-governance-reject-file-topology-drift"
                              disabled={saving || governanceAction !== null}
                              onClick={() => {
                                const reason = consumeGovernanceReason("Rejecting file topology contract drift");
                                if (!reason) {
                                  return;
                                }
                                void runGovernanceAction("resolve_file_topology_contract_drift", buildBuilderGovernanceCommandPayload({
                                  action: "resolve_file_topology_contract_drift",
                                  runId: projectDetail.fileTopologyContract.runId,
                                  decision: "reject",
                                  confirmed: true,
                                  reason,
                                  sourceSurface: "dashboard",
                                }), "Rejected the Builder file topology contract rollover from the dashboard.");
                              }}
                              className="px-3 py-2 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50"
                              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                            >
                              reject topology drift
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <div data-testid="builder-governance-history" className="border p-3 space-y-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>recent governance decisions</div>
                          <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-dim)" }}>
                            {(projectDetail?.governanceHistory ?? []).length} shown
                          </div>
                        </div>
                        {(projectDetail?.governanceHistory ?? []).length === 0 ? (
                          <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                            No governance decisions have been recorded for this project yet.
                          </div>
                        ) : (projectDetail?.governanceHistory ?? []).map((entry) => (
                          <div key={entry.eventId} className="border p-2 space-y-1" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                            <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
                              <span>{entry.action.replaceAll("_", " ")}</span>
                              <span>{entry.decision} · {entry.outcome.replaceAll("_", " ")}</span>
                            </div>
                            <div className="text-xs leading-6" style={{ color: "var(--text-primary)" }}>{entry.summary}</div>
                            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{entry.reason}</div>
                            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                              {new Date(entry.timestamp).toLocaleString()} · source {entry.sourceSurface.replaceAll("_", " ")} · command run {entry.commandRunId}{entry.targetRunId ? ` · target ${entry.targetRunId}` : ""}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>builder task</div>
                <div>
                  <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Task request</label>
                  <textarea value={taskRequest} onChange={(event) => setTaskRequest(event.target.value)} rows={4} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} placeholder="Describe the next Builder step for this project." />
                </div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                  Builder tasks now run through BizBot&apos;s native in-process builder operator. The CLI profile section below remains available only for direct adapter prompts.
                </div>
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                  Desktop shortcuts: Ctrl+Shift+R retries the latest failed task, Ctrl+Shift+L focuses current logs, and Ctrl+Shift+K cancels the active run.
                </div>
                <div className="flex flex-wrap gap-3">
                  <button disabled={saving || !taskRequest.trim()} onClick={() => void runProjectAction(`/api/builder/projects/${selectedProject.id}/tasks`, { request: taskRequest })} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                    start builder task
                  </button>
                  <button disabled={saving || !taskRequest.trim() || !projectDetail?.currentTask} onClick={() => void runProjectAction(`/api/builder/projects/${selectedProject.id}/tasks`, { request: taskRequest, taskId: projectDetail?.currentTask?.id })} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                    continue current task
                  </button>
                  <button disabled={saving || !taskRequest.trim()} onClick={() => void runProjectAction(`/api/builder/projects/${selectedProject.id}/tasks`, { request: taskRequest, retryFailed: true })} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                    retry last failed
                  </button>
                  <button disabled={saving} onClick={() => void runProjectAction(`/api/builder/projects/${selectedProject.id}/commands`, { action: "reconcile_operational_state" })} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                    reconcile state
                  </button>
                  <button disabled={saving || !selectedTask || selectedTask.status === "RUNNING" || selectedTask.status === "PENDING"} onClick={() => selectedTask ? void resumeTask(selectedTask.id) : undefined} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                    resume selected task
                  </button>
                  <button disabled={!projectDetail?.runs?.length} onClick={() => focusRunLogs()} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                    open current logs
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="border p-3 space-y-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>plan</div>
                  {(projectDetail?.context.currentPlan ?? []).length > 0 ? projectDetail?.context.currentPlan.map((step) => (
                    <div key={step.id} className="text-xs leading-6" style={{ color: step.status === "completed" ? "var(--success)" : step.status === "in_progress" ? "var(--accent)" : "var(--text-dim)" }}>
                      [{step.status.replace("_", " ")}] {step.label}
                    </div>
                  )) : <div className="text-sm" style={{ color: "var(--text-dim)" }}>No active plan recorded yet.</div>}
                </div>
                <div className="border p-3 space-y-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>latest review</div>
                  {projectDetail?.latestReview ? (
                    <>
                      <div className="text-sm">{projectDetail.latestReview.summary}</div>
                      {projectDetail.latestReview.vcs ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>VCS: {projectDetail.latestReview.vcs.summary}</div> : null}
                      {projectDetail.latestReview.process ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>Processes: {projectDetail.latestReview.process.summary}</div> : null}
                      {projectDetail.latestReview.audit ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>Audit: {projectDetail.latestReview.audit.summary}</div> : null}
                      {projectDetail.latestReview.database ? <div className="text-xs leading-6" style={{ color: projectDetail.latestReview.database.status === "drifted" || projectDetail.latestReview.database.status === "probe_failed" ? "var(--warning)" : "var(--text-dim)" }}>DB: {projectDetail.latestReview.database.summary}</div> : null}
                      {projectDetail.latestReview.runtime ? <div className="text-xs leading-6" style={{ color: projectDetail.latestReview.runtime.failedServices > 0 ? "var(--warning)" : "var(--text-dim)" }}>Runtime: {projectDetail.latestReview.runtime.summary}</div> : null}
                      {projectDetail.latestReview.risks.length > 0 ? <div className="text-xs leading-6" style={{ color: "var(--danger)" }}>Risks: {projectDetail.latestReview.risks.join("; ")}</div> : null}
                      {projectDetail.latestReview.nextSteps.length > 0 ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>Next: {projectDetail.latestReview.nextSteps.join("; ")}</div> : null}
                    </>
                  ) : <div className="text-sm" style={{ color: "var(--text-dim)" }}>No structured Builder review yet.</div>}
                </div>
              </div>

              <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="flex items-center justify-between gap-4">
                  <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>operator trust</div>
                  <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: getOperatorTrustColor(projectDetail?.operatorTrust.overallStatus) }}>
                    {formatOperatorTrustLabel(projectDetail?.operatorTrust.overallStatus)}
                  </div>
                </div>
                <div className="text-sm" style={{ color: "var(--text-primary)" }}>
                  {projectDetail?.operatorTrust.summary ?? "No operator trust artifact has been generated yet."}
                </div>
                <div className="border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>trust trend</div>
                    <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: projectDetail?.operatorTrust.trend.direction === "degrading" ? "var(--danger)" : projectDetail?.operatorTrust.trend.direction === "improving" ? "var(--success)" : "var(--warning)" }}>
                      {projectDetail?.operatorTrust.trend.direction ?? "steady"}
                    </div>
                  </div>
                  <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{projectDetail?.operatorTrust.trend.basis}</div>
                  <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{projectDetail?.operatorTrust.trend.summary}</div>
                  <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                    Warning audit events {projectDetail?.operatorTrust.trend.warningAuditEvents ?? 0}; critical audit events {projectDetail?.operatorTrust.trend.criticalAuditEvents ?? 0}; prioritized blockers {projectDetail?.operatorTrust.trend.blockerCount ?? 0}.
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="border p-2 space-y-1" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                      <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>recent window</div>
                      <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                        Runs {projectDetail?.operatorTrust.trend.recentWindow.runCount ?? 0}; success {Math.round((projectDetail?.operatorTrust.trend.recentWindow.successRate ?? 0) * 100)}%; verification {Math.round((projectDetail?.operatorTrust.trend.recentWindow.verificationPassRate ?? 0) * 100)}%.
                      </div>
                      <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                        Avg risks {projectDetail?.operatorTrust.trend.recentWindow.averageRiskCount ?? 0}; review warnings {projectDetail?.operatorTrust.trend.recentWindow.reviewWarningCount ?? 0}; blocked runs {projectDetail?.operatorTrust.trend.recentWindow.blockedRunCount ?? 0}.
                      </div>
                    </div>
                    <div className="border p-2 space-y-1" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                      <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>previous window</div>
                      <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                        Runs {projectDetail?.operatorTrust.trend.previousWindow.runCount ?? 0}; success {Math.round((projectDetail?.operatorTrust.trend.previousWindow.successRate ?? 0) * 100)}%; verification {Math.round((projectDetail?.operatorTrust.trend.previousWindow.verificationPassRate ?? 0) * 100)}%.
                      </div>
                      <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                        Avg risks {projectDetail?.operatorTrust.trend.previousWindow.averageRiskCount ?? 0}; review warnings {projectDetail?.operatorTrust.trend.previousWindow.reviewWarningCount ?? 0}; blocked runs {projectDetail?.operatorTrust.trend.previousWindow.blockedRunCount ?? 0}.
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    { label: "review", value: formatOperatorTrustLabel(projectDetail?.operatorTrust.review.status), tone: getOperatorTrustColor(projectDetail?.operatorTrust.review.status) },
                    { label: "config", value: formatOperatorTrustLabel(projectDetail?.operatorTrust.config.status), tone: getOperatorTrustColor(projectDetail?.operatorTrust.config.status) },
                    { label: "runtime", value: formatOperatorTrustLabel(projectDetail?.operatorTrust.runtime.status), tone: getOperatorTrustColor(projectDetail?.operatorTrust.runtime.status) },
                    { label: "approvals", value: `${projectDetail?.operatorTrust.approvals.pendingCount ?? 0} pending`, tone: getOperatorTrustColor(projectDetail?.operatorTrust.approvals.status) },
                  ].map((card) => (
                    <div key={card.label} className="border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                      <div className="text-xs uppercase tracking-[0.16em] mb-2" style={{ color: "var(--text-muted)" }}>{card.label}</div>
                      <div className="text-sm" style={{ color: card.tone }}>{card.value}</div>
                    </div>
                  ))}
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                    <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>runtime trust</div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{projectDetail?.operatorTrust.runtime.summary}</div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      Active alerts {projectDetail?.operatorTrust.runtime.activeAlertCount ?? 0}; unresolved {projectDetail?.operatorTrust.runtime.unresolvedAlertCount ?? 0}; auto-fixes {projectDetail?.operatorTrust.runtime.autoFixCount ?? 0}; MCP {projectDetail?.operatorTrust.runtime.mcpState.replaceAll("_", " ") ?? "unknown"}.
                    </div>
                  </div>
                  <div className="border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                    <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>approval queue</div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{projectDetail?.operatorTrust.approvals.summary}</div>
                    {(projectDetail?.operatorTrust.approvals.pendingApprovals ?? []).slice(0, 3).map((approval) => (
                      <div key={approval.id} className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                        {approval.platform} · {approval.postStatus.toLowerCase()} · {approval.excerpt}
                      </div>
                    ))}
                    {(projectDetail?.operatorTrust.approvals.pendingApprovals ?? []).length === 0 ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>No queue items are waiting right now.</div> : null}
                  </div>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                    <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>review + config trust</div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{projectDetail?.operatorTrust.review.summary}</div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{projectDetail?.operatorTrust.config.summary}</div>
                  </div>
                  <div className="border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                    <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>artifact paths</div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{projectDetail?.operatorTrust.artifactPaths.markdown}</div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{projectDetail?.operatorTrust.artifactPaths.json}</div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{projectDetail?.operatorTrust.artifactPaths.processArtifacts}</div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      Approval-required capability gates: {projectDetail?.operatorTrust.governance.approvalRequiredCapabilities.join(", ") || "none"}
                    </div>
                  </div>
                </div>
                <div className="border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                  <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>prioritized blockers</div>
                  {(projectDetail?.operatorTrust.prioritizedBlockers ?? []).map((blocker) => (
                    <div key={`${blocker.key}-${blocker.priority}`} className="border p-2 space-y-1" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                      <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
                        <span>{blocker.label}</span>
                        <span style={{ color: getOperatorTrustColor(blocker.status) }}>{formatOperatorTrustLabel(blocker.status)} · p{blocker.priority}</span>
                      </div>
                      <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{blocker.summary}</div>
                    </div>
                  ))}
                  {(projectDetail?.operatorTrust.prioritizedBlockers ?? []).length === 0 ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>No operator blockers are prioritized right now.</div> : null}
                </div>
              </div>

              <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="flex items-center justify-between gap-4">
                  <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>recent tasks</div>
                  {selectedTask ? <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-dim)" }}>history target: {selectedTask.title}</div> : null}
                </div>
                {(projectDetail?.tasks ?? []).length > 0 ? projectDetail?.tasks.slice(0, 5).map((task) => (
                  <button key={task.id} onClick={() => setSelectedTaskId(task.id)} className="w-full border p-2 text-left" style={{ borderColor: task.id === selectedTaskId ? "var(--accent)" : "var(--border)", background: task.id === selectedTaskId ? "var(--accent-glow)" : "var(--bg-surface)" }}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span>{task.title}</span>
                      <span style={{ color: task.status === "FAILED" ? "var(--danger)" : task.status === "SUCCEEDED" ? "var(--success)" : "var(--text-dim)" }}>{task.status.toLowerCase()}</span>
                    </div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{task.stage.toLowerCase()} · {task.description}</div>
                    {task.summary ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{task.summary}</div> : null}
                  </button>
                )) : <div className="text-sm" style={{ color: "var(--text-dim)" }}>No Builder tasks recorded yet.</div>}
              </div>

              <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="flex items-center justify-between gap-4">
                  <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>task history</div>
                  {selectedTask ? <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-dim)" }}>{selectedTask.status.toLowerCase()}</div> : null}
                </div>
                {selectedTask ? (
                  taskHistory.length > 0 ? taskHistory.map((entry) => (
                    <div key={`${entry.runId}-${entry.iteration ?? "run"}`} className="border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span>
                          {entry.iteration ? `iteration ${entry.iteration}` : "run replay"}
                        </span>
                        <span style={{ color: entry.verdict === "complete" || entry.status === "SUCCEEDED" ? "var(--success)" : entry.verdict === "retry" ? "var(--accent)" : "var(--danger)" }}>
                          {entry.verdict.replace(/_/g, " ")}
                        </span>
                      </div>
                      <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                        {new Date(entry.timestamp).toLocaleString()} · run {entry.runId}
                      </div>
                      {entry.summary ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{entry.summary}</div> : null}
                      <div className="flex flex-wrap gap-3">
                        <button disabled={saving || selectedTask.status === "RUNNING"} onClick={() => void resumeTask(selectedTask.id, { fromIteration: entry.iteration ?? undefined })} className="px-3 py-2 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                          resume from here
                        </button>
                        <button onClick={() => focusRunLogs(entry.runId)} className="px-3 py-2 border text-[11px] uppercase tracking-[0.16em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                          show run logs
                        </button>
                      </div>
                    </div>
                  )) : <div className="text-sm" style={{ color: "var(--text-dim)" }}>No task history recorded for the selected task yet.</div>
                ) : <div className="text-sm" style={{ color: "var(--text-dim)" }}>Select a task to inspect its run history.</div>}
              </div>

              <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>bootstrap</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center justify-between border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                    <span>Initialize git</span>
                    <input type="checkbox" checked={bootstrapOptions.initializeGit} onChange={(event) => setBootstrapOptions((current) => ({ ...current, initializeGit: event.target.checked }))} />
                  </label>
                  <label className="flex items-center justify-between border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                    <span>Install dependencies</span>
                    <input type="checkbox" checked={bootstrapOptions.installDependencies} onChange={(event) => setBootstrapOptions((current) => ({ ...current, installDependencies: event.target.checked }))} />
                  </label>
                </div>
                <button disabled={saving || !status?.config.safe} onClick={() => void runProjectAction(`/api/builder/projects/${selectedProject.id}/bootstrap`, bootstrapOptions)} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                  bootstrap project
                </button>
              </div>

              <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>package actions</div>
                <div>
                  <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Install packages</label>
                  <input value={installPackages} onChange={(event) => setInstallPackages(event.target.value)} placeholder="react react-dom" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                </div>
                <div className="flex flex-wrap gap-3">
                  <button disabled={saving} onClick={() => void runProjectAction(`/api/builder/projects/${selectedProject.id}/commands`, { action: "install_dependencies", packages: installPackages.split(/\s+/).filter(Boolean) })} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                    install
                  </button>
                  <button disabled={saving} onClick={() => void runProjectAction(`/api/builder/projects/${selectedProject.id}/commands`, { action: "initialize_git" })} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                    init git
                  </button>
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Run script</label>
                  <div className="flex gap-3">
                    <input value={scriptName} onChange={(event) => setScriptName(event.target.value)} className="flex-1 bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                    <button disabled={saving || !scriptName.trim()} onClick={() => void runProjectAction(`/api/builder/projects/${selectedProject.id}/commands`, { action: "run_script", script: scriptName })} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                      run
                    </button>
                  </div>
                </div>
              </div>

              <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>direct cli prompt</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Profile</label>
                    <select value={agenticProfile} onChange={(event) => setAgenticProfile(event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                      <option value="">Select a profile</option>
                      {enabledAgentProfiles.map((profile) => (
                        <option key={profile.key} value={profile.key}>{profile.displayName}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Model override</label>
                    <input value={agenticModel} onChange={(event) => setAgenticModel(event.target.value)} placeholder="optional" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Prompt</label>
                  <textarea value={agenticPrompt} onChange={(event) => setAgenticPrompt(event.target.value)} rows={5} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                </div>
                <button disabled={saving || !agenticPrompt.trim() || !agenticProfile} onClick={() => void runProjectAction(`/api/builder/projects/${selectedProject.id}/commands`, { action: "run_agentic_task", profile: agenticProfile, prompt: agenticPrompt, model: agenticModel || undefined })} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                  run raw agentic prompt
                </button>
              </div>

              <div className="border p-3 space-y-4" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>extension inspection</div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      Capability audit activity plus current database inspection state for Builder extension surfaces.
                    </div>
                  </div>
                  <button disabled={saving} onClick={() => void probeLiveDatabase()} className="px-3 py-2 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                    run live db probe
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>capability audit</div>
                      <div className="flex flex-wrap justify-end gap-2">
                        {(projectInspection?.capabilityAudit.retention.droppedExpiredCount ?? 0) > 0 ? (
                          <span className="border px-2 py-1 text-[10px] uppercase tracking-[0.16em]" style={{ borderColor: "var(--warning)", color: "var(--warning)", background: "color-mix(in srgb, var(--warning) 10%, var(--bg-surface))" }}>
                            pruned {(projectInspection?.capabilityAudit.retention.droppedExpiredCount ?? 0)} expired
                          </span>
                        ) : null}
                        {(projectInspection?.capabilityAudit.retention.droppedOverflowCount ?? 0) > 0 ? (
                          <span className="border px-2 py-1 text-[10px] uppercase tracking-[0.16em]" style={{ borderColor: "var(--danger)", color: "var(--danger)", background: "color-mix(in srgb, var(--danger) 10%, var(--bg-surface))" }}>
                            dropped {(projectInspection?.capabilityAudit.retention.droppedOverflowCount ?? 0)} overflow
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      {projectInspection?.capabilityAudit.totalEvents ?? 0} events · outcomes {Object.entries(projectInspection?.capabilityAudit.outcomeCounts ?? {}).map(([key, value]) => `${key}:${value}`).join(" ") || "none"}
                    </div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      Severity info:{projectInspection?.capabilityAudit.severityCounts.info ?? 0} warning:{projectInspection?.capabilityAudit.severityCounts.warning ?? 0} critical:{projectInspection?.capabilityAudit.severityCounts.critical ?? 0}
                    </div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      {Object.entries(projectInspection?.capabilityAudit.capabilityCounts ?? {}).map(([key, value]) => `${key.replaceAll("_", " ")}:${value}`).join(" · ") || "No extension audit events recorded yet."}
                    </div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      {projectInspection?.capabilityAudit.auditPath ?? "No audit log path available yet."}
                    </div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      Retention {projectInspection?.capabilityAudit.retention.maxEvents ?? 0} events / {projectInspection?.capabilityAudit.retention.maxAgeDays ?? 0} days; dropped expired {projectInspection?.capabilityAudit.retention.droppedExpiredCount ?? 0}; dropped overflow {projectInspection?.capabilityAudit.retention.droppedOverflowCount ?? 0}
                    </div>
                    <div className="space-y-2">
                      {(projectInspection?.capabilityAudit.recentEvents ?? []).slice(0, 4).map((event) => (
                        <div key={event.eventId} className="border p-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span>{event.capabilityKey.replaceAll("_", " ")}</span>
                            <span style={{ color: event.outcomeStatus === "succeeded" ? "var(--success)" : event.outcomeStatus === "failed" || event.outcomeStatus === "blocked" ? "var(--danger)" : "var(--warning)" }}>{event.outcomeStatus.replaceAll("_", " ")}</span>
                          </div>
                          <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{new Date(event.timestamp).toLocaleString()}</div>
                          <div className="text-xs leading-6" style={{ color: event.severity === "critical" ? "var(--danger)" : event.severity === "warning" ? "var(--warning)" : "var(--text-dim)" }}>severity {event.severity}</div>
                          {typeof event.metadata?.operation === "string" ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>operation {event.metadata.operation}</div> : null}
                        </div>
                      ))}
                      {(projectInspection?.capabilityAudit.recentEvents ?? []).length === 0 ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>No extension audit events recorded yet.</div> : null}
                    </div>
                  </div>
                  <div className="border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                    <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>database inspection</div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      Artifact provider {projectInspection?.databaseInspection.artifact.provider ?? "unknown"}; target {projectInspection?.databaseInspection.artifact.connectionTarget ?? "unresolved"}
                    </div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      Artifact tables {projectInspection?.databaseInspection.artifact.tableCount ?? 0}; migrations {projectInspection?.databaseInspection.artifact.migrationsCount ?? 0}
                    </div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      {projectInspection?.databaseInspection.artifact.auditPath ?? "No database artifact audit path recorded yet."}
                    </div>
                    <div className="border p-2 space-y-1" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span>drift summary</span>
                        <span style={{ color: projectInspection?.databaseInspection.driftSummary.status === "in_sync" ? "var(--success)" : projectInspection?.databaseInspection.driftSummary.status === "drifted" || projectInspection?.databaseInspection.driftSummary.status === "probe_failed" ? "var(--warning)" : "var(--text-dim)" }}>
                          {projectInspection?.databaseInspection.driftSummary.status.replaceAll("_", " ") ?? "not available"}
                        </span>
                      </div>
                      <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                        {projectInspection?.databaseInspection.driftSummary.summary ?? "Run a live probe to compare live metadata against Prisma artifacts."}
                      </div>
                      {projectInspection?.databaseInspection.driftSummary.comparedAt ? (
                        <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                          Compared {new Date(projectInspection.databaseInspection.driftSummary.comparedAt).toLocaleString()} · artifact {projectInspection.databaseInspection.driftSummary.artifactTableCount} tables · live {projectInspection.databaseInspection.driftSummary.liveTableCount} tables
                        </div>
                      ) : null}
                      {projectInspection?.databaseInspection.driftSummary.missingInLive.length ? <div className="text-xs leading-6" style={{ color: "var(--warning)" }}>Missing in live: {projectInspection.databaseInspection.driftSummary.missingInLive.join(", ")}</div> : null}
                      {projectInspection?.databaseInspection.driftSummary.unexpectedLive.length ? <div className="text-xs leading-6" style={{ color: "var(--warning)" }}>Unexpected live: {projectInspection.databaseInspection.driftSummary.unexpectedLive.join(", ")}</div> : null}
                      {projectInspection?.databaseInspection.driftSummary.fieldCountMismatches.length ? (
                        <div className="text-xs leading-6" style={{ color: "var(--warning)" }}>
                          Field-count mismatches: {projectInspection.databaseInspection.driftSummary.fieldCountMismatches.map((entry) => `${entry.tableName} ${entry.artifactFieldCount}->${entry.liveFieldCount}`).join(", ")}
                        </div>
                      ) : null}
                    </div>
                    {projectInspection?.databaseInspection.latestLiveProbe ? (
                      <div className="border p-2 space-y-1" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span>live probe</span>
                          <span style={{ color: projectInspection.databaseInspection.latestLiveProbe.status === "succeeded" ? "var(--success)" : "var(--danger)" }}>
                            {projectInspection.databaseInspection.latestLiveProbe.status}
                          </span>
                        </div>
                        <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{projectInspection.databaseInspection.latestLiveProbe.summary}</div>
                        <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                          {new Date(projectInspection.databaseInspection.latestLiveProbe.probedAt).toLocaleString()} · {projectInspection.databaseInspection.latestLiveProbe.tableCount} tables
                        </div>
                        <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{projectInspection.databaseInspection.latestLiveProbe.auditPath}</div>
                        {projectInspection.databaseInspection.latestLiveProbe.error ? <div className="text-xs leading-6" style={{ color: "var(--danger)" }}>{projectInspection.databaseInspection.latestLiveProbe.error}</div> : null}
                      </div>
                    ) : <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>No live database probe has been recorded yet.</div>}
                  </div>
                </div>
                <div className="border p-3 space-y-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>runtime services</div>
                    <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                      {projectInspection?.runtimeInspection.summary ?? "No runtime services discovered yet."}
                    </div>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                    <div className="space-y-2">
                      {(projectInspection?.runtimeInspection.services ?? []).map((service) => (
                        <button key={service.serviceId} onClick={() => setSelectedRuntimeServiceId(service.serviceId)} className="w-full border p-2 text-left" style={{ borderColor: service.serviceId === selectedRuntimeServiceId ? "var(--accent)" : "var(--border-sub)", background: service.serviceId === selectedRuntimeServiceId ? "var(--accent-glow)" : "var(--bg-raised)" }}>
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span>{service.label}</span>
                            <span style={{ color: service.status === "running" ? "var(--success)" : service.status === "failed" ? "var(--danger)" : "var(--text-dim)" }}>{service.status}</span>
                          </div>
                          <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{service.source.replaceAll("_", " ")} · {service.declaredIn}</div>
                          <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{service.workingDirectory}</div>
                          <div className="text-xs leading-6" style={{ color: service.healthStatus === "healthy" ? "var(--success)" : service.healthStatus === "unhealthy" ? "var(--danger)" : service.healthStatus === "starting" ? "var(--warning)" : "var(--text-dim)" }}>
                            health {service.healthStatus}{service.healthReason ? ` · ${service.healthReason}` : ""}
                          </div>
                          {service.publishedPorts.length > 0 ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>ports {service.publishedPorts.join(", ")}</div> : null}
                          {service.command ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{service.command}</div> : null}
                        </button>
                      ))}
                      {(projectInspection?.runtimeInspection.services ?? []).length === 0 ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>No package-script or compose services were detected.</div> : null}
                    </div>
                    <div className="border p-3 space-y-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>service logs and controls</div>
                        <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: runtimeLogState === "live" ? "var(--success)" : "var(--text-muted)" }}>{runtimeLogState}</div>
                      </div>
                      {runtimeServiceLogs ? (
                        <>
                          <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                            {runtimeServiceLogs.service.label} · {runtimeServiceLogs.service.status}{runtimeServiceLogs.service.logPath ? ` · ${runtimeServiceLogs.service.logPath}` : ""}
                          </div>
                          <div className="text-xs leading-6" style={{ color: runtimeServiceLogs.service.healthStatus === "healthy" ? "var(--success)" : runtimeServiceLogs.service.healthStatus === "unhealthy" ? "var(--danger)" : runtimeServiceLogs.service.healthStatus === "starting" ? "var(--warning)" : "var(--text-dim)" }}>
                            health {runtimeServiceLogs.service.healthStatus}{runtimeServiceLogs.service.healthReason ? ` · ${runtimeServiceLogs.service.healthReason}` : ""}
                          </div>
                          {runtimeServiceLogs.service.containerId ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>container {runtimeServiceLogs.service.containerId}</div> : null}
                          {runtimeServiceLogs.service.publishedPorts.length > 0 ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>ports {runtimeServiceLogs.service.publishedPorts.join(", ")}</div> : null}
                          <div className="flex flex-wrap gap-2">
                            <button disabled={saving || runtimeActionServiceId === runtimeServiceLogs.service.serviceId || !runtimeServiceLogs.service.supportsStart} onClick={() => void mutateRuntimeService("start_service")} className="px-3 py-2 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-main)" }}>
                              start service
                            </button>
                            <button disabled={saving || runtimeActionServiceId === runtimeServiceLogs.service.serviceId || !runtimeServiceLogs.service.supportsStop} onClick={() => void mutateRuntimeService("stop_service")} className="px-3 py-2 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-main)" }}>
                              stop service
                            </button>
                            <button disabled={saving || runtimeActionServiceId === runtimeServiceLogs.service.serviceId || !runtimeServiceLogs.service.supportsRestart} onClick={() => void restartRuntimeService()} className="px-3 py-2 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                              restart service
                            </button>
                            <button disabled={saving || (runtimeServiceLogs.service.status !== "running" && !runtimeServiceLogs.service.processId && !runtimeServiceLogs.service.containerId)} onClick={() => {
                              if (!selectedProjectId || !selectedRuntimeServiceId) {
                                return;
                              }
                              if (runtimeLogLive) {
                                stopRuntimeLogStream();
                                void loadRuntimeServiceLogs(selectedProjectId, selectedRuntimeServiceId).catch((nextError) => {
                                  setError(nextError instanceof Error ? nextError.message : "Failed to refresh runtime service logs.");
                                });
                                return;
                              }
                              startRuntimeLogStream(selectedProjectId, selectedRuntimeServiceId);
                            }} className="px-3 py-2 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text-main)" }}>
                              {runtimeLogLive ? "stop live follow" : "start live follow"}
                            </button>
                          </div>
                          {runtimeServiceLogs.error ? <div className="text-xs leading-6" style={{ color: "var(--danger)" }}>{runtimeServiceLogs.error}</div> : null}
                          {!runtimeServiceLogs.error && runtimeServiceLogs.service.status === "declared" ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>This service is declared but not currently active, so no logs are available yet.</div> : null}
                          {runtimeServiceLogs.logs ? <pre className="overflow-x-auto whitespace-pre-wrap text-xs leading-6 p-2 border" style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-dim)" }}>{runtimeServiceLogs.logs}</pre> : null}
                          {!runtimeServiceLogs.logs && runtimeServiceLogs.service.status === "running" && !runtimeServiceLogs.error ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>No buffered logs are available for this service yet.</div> : null}
                          <div className="border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                            <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>exec in service</div>
                            <input value={runtimeExecCommand} onChange={(event) => setRuntimeExecCommand(event.target.value)} placeholder="command" className="w-full border px-3 py-2 text-sm" style={{ borderColor: "var(--border)", background: "var(--bg-raised)", color: "var(--text-main)" }} />
                            <textarea value={runtimeExecArgs} onChange={(event) => setRuntimeExecArgs(event.target.value)} placeholder="one argument per line" rows={3} className="w-full border px-3 py-2 text-sm" style={{ borderColor: "var(--border)", background: "var(--bg-raised)", color: "var(--text-main)" }} />
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>Commands remain subject to the Builder command allowlist.</div>
                              <button disabled={saving || runtimeActionServiceId === runtimeServiceLogs.service.serviceId || !runtimeExecCommand.trim() || !runtimeServiceLogs.service.supportsExec} onClick={() => void execRuntimeServiceCommand()} className="px-3 py-2 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                                run command
                              </button>
                            </div>
                            {runtimeExecResult ? (
                              <div className="space-y-2">
                                <div className="text-xs leading-6" style={{ color: runtimeExecResult.ok ? "var(--success)" : "var(--warning)" }}>
                                  {runtimeExecResult.command} {runtimeExecResult.args.join(" ")} · exit {runtimeExecResult.exitCode ?? "unknown"}
                                </div>
                                {runtimeExecResult.stdout ? <pre className="overflow-x-auto whitespace-pre-wrap text-xs leading-6 p-2 border" style={{ borderColor: "var(--border)", background: "var(--bg-raised)", color: "var(--text-dim)" }}>{runtimeExecResult.stdout}</pre> : null}
                                {runtimeExecResult.stderr ? <pre className="overflow-x-auto whitespace-pre-wrap text-xs leading-6 p-2 border" style={{ borderColor: "var(--border)", background: "var(--bg-raised)", color: "var(--danger)" }}>{runtimeExecResult.stderr}</pre> : null}
                              </div>
                            ) : null}
                          </div>
                        </>
                      ) : <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>Select a service to inspect its current Builder-managed log buffer.</div>}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>

        <section ref={recentRunsRef} className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>recent runs</div>
          <div className="space-y-3 text-sm">
            {(projectDetail?.runs ?? []).length === 0 ? (
              <div style={{ color: "var(--text-dim)" }}>No recorded runs for this project yet.</div>
            ) : runsPagination.pageItems.map((run) => (
              <div key={run.id} className="border p-3" style={{ borderColor: highlightedRunId === run.id ? "var(--accent)" : "var(--border-sub)", background: highlightedRunId === run.id ? "var(--accent-glow)" : "var(--bg-raised)" }}>
                {(() => {
                  const loop = getRunLoopMetadata(run.metadata);
                  return (
                    <>
                      <div className="flex items-center justify-between gap-4">
                        <span>{run.title}</span>
                        <div className="flex items-center gap-3">
                          {run.status === "RUNNING" ? (
                            <button
                              disabled={cancellingRunId === run.id}
                              onClick={() => void cancelRun(run.id)}
                              className="px-2 py-1 border text-[10px] uppercase tracking-[0.16em] disabled:opacity-50"
                              style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                            >
                              {cancellingRunId === run.id ? "cancelling" : "cancel"}
                            </button>
                          ) : null}
                          <span style={{ color: run.status === "FAILED" ? "var(--danger)" : run.status === "SUCCEEDED" ? "var(--success)" : run.status === "CANCELLED" ? "var(--danger)" : "var(--text-dim)" }}>{run.status.toLowerCase()}</span>
                        </div>
                      </div>
                      <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{run.command ?? "command unavailable"}</div>
                      {run.summary ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{run.summary}</div> : null}
                      {loop ? (
                        <div className="mt-3 border p-3 space-y-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                          <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
                            <span>{(loop.finalVerdict ?? run.status.toLowerCase()).replace(/_/g, " ")}</span>
                            <span>{loop.iterations.length}/{loop.maxIterations} iterations</span>
                            <span>{loop.verified ? "verified" : loop.verificationSkipped ? "verification skipped" : "not verified"}</span>
                            {loop.selectedScripts.length > 0 ? <span>scripts {loop.selectedScripts.join(", ")}</span> : null}
                            {loop.phase ? <span>phase {loop.phase}</span> : null}
                            {loop.currentIteration ? <span>current {loop.currentIteration}</span> : null}
                          </div>
                          {run.status === "RUNNING" ? <div className="text-xs" style={{ color: "var(--accent)" }}>{loop.summary}</div> : null}
                          {loop.iterations.map((iteration) => (
                            <details key={`${run.id}-iteration-${iteration.iteration}`} className="border p-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                              <summary className="cursor-pointer text-xs flex flex-wrap gap-3" style={{ color: "var(--text-primary)" }}>
                                <span>attempt {iteration.iteration}</span>
                                <span style={{ color: iteration.review.verdict === "complete" ? "var(--success)" : iteration.review.verdict === "retry" ? "var(--accent)" : "var(--danger)" }}>
                                  {iteration.review.verdict.replace(/_/g, " ")}
                                </span>
                                <span style={{ color: "var(--text-dim)" }}>{iteration.verification.summary}</span>
                              </summary>
                              <div className="mt-2 space-y-2 text-xs" style={{ color: "var(--text-dim)" }}>
                                <div>{iteration.review.reason}</div>
                                {iteration.changedFiles.length > 0 ? <div>changed files: {iteration.changedFiles.join(", ")}</div> : <div>changed files: none detected</div>}
                                {iteration.verification.steps.length > 0 ? (
                                  <div className="flex flex-wrap gap-2">
                                    {iteration.verification.steps.map((step) => (
                                      <span key={`${run.id}-iteration-${iteration.iteration}-${step.script}`} className="border px-2 py-1" style={{ borderColor: step.ok ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)", color: step.ok ? "var(--success)" : "var(--danger)" }}>
                                        {step.script} {step.ok ? "passed" : `failed (${step.exitCode ?? "?"})`}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </details>
                          ))}
                        </div>
                      ) : null}
                      {run.stdout ? <pre className="mt-2 text-xs whitespace-pre-wrap border p-2 overflow-auto" style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-dim)" }}>{run.stdout}</pre> : null}
                      {run.stderr ? <pre className="mt-2 text-xs whitespace-pre-wrap border p-2 overflow-auto" style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--danger)" }}>{run.stderr}</pre> : null}
                    </>
                  );
                })()}
              </div>
            ))}
            <PaginationControls {...runsPagination} />
          </div>
        </section>
      </section>
    </div>
  );
}

function formatDurationMs(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "0m";
  }
  const totalSeconds = Math.round(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "$0.00";
  }
  if (value === 0) {
    return "$0.00";
  }
  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }
  return `$${value.toFixed(2)}`;
}