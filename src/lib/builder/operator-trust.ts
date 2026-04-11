import type { BuilderRun } from "@prisma/client";
import type { BuilderConfigReadinessState } from "@/lib/builder/environment";
import type { BuilderCapabilityAuditOverview } from "@/lib/builder/audit";
import { listBuilderCapabilities } from "@/lib/builder/capabilities";
import type { BuilderOperationalStateSummary } from "@/lib/builder/reconciliation";
import type {
  BuilderMcpSnapshotOverviewState,
  BuilderOperatorTrustApprovalState,
  BuilderOperatorTrustConfigState,
  BuilderOperatorTrustGovernanceState,
  BuilderOperatorTrustReviewState,
  BuilderOperatorTrustRuntimeState,
  BuilderOperatorTrustTrendState,
  BuilderOperatorTrustPrioritizedBlocker,
  BuilderOperatorTrustState,
  BuilderOperatorTrustStatus,
  BuilderStructuredReview,
} from "@/lib/builder/types";
import { listPendingApprovalSnapshots, type PendingApprovalSnapshot } from "@/lib/approvals";

export const BUILDER_OPERATOR_TRUST_MARKDOWN_PATH = ".builder/reports/operator-trust.md";
export const BUILDER_OPERATOR_TRUST_JSON_PATH = ".builder/reports/operator-trust.json";
export const BUILDER_LATEST_REVIEW_PATH = ".builder/reports/latest-review.md";
export const BUILDER_PROCESS_ARTIFACTS_PATH = ".builder/processes";
const BUILDER_OPERATOR_TREND_WINDOW_SIZE = 5;

function summarizeStatus(status: BuilderOperatorTrustStatus): string {
  switch (status) {
    case "blocked":
      return "blocked";
    case "warning":
      return "needs review";
    default:
      return "trusted";
  }
}

function foldStatuses(statuses: BuilderOperatorTrustStatus[]): BuilderOperatorTrustStatus {
  if (statuses.includes("blocked")) {
    return "blocked";
  }
  if (statuses.includes("warning")) {
    return "warning";
  }
  return "trusted";
}

function buildReviewState(review: BuilderStructuredReview | null): BuilderOperatorTrustReviewState {
  if (!review) {
    return {
      status: "warning",
      summary: "No structured Builder review exists yet.",
      reviewStatus: null,
      validationPassed: null,
      riskCount: 0,
      updatedAt: null,
    };
  }

  const databaseConcern = review.database?.status === "drifted" || review.database?.status === "probe_failed";
  const auditConcern = (review.audit?.notableEvents.length ?? 0) > 0;
  const runtimeConcern = (review.runtime?.failedServices ?? 0) > 0;
  const status: BuilderOperatorTrustStatus = review.status === "SUCCEEDED" && review.risks.length === 0 && review.validation.passed && !databaseConcern && !auditConcern && !runtimeConcern
    ? "trusted"
    : "warning";
  const reviewSummary = [
    review.summary,
    review.vcs ? `VCS: ${review.vcs.summary}` : null,
    review.database ? `DB: ${review.database.summary}` : null,
    review.runtime ? `Runtime: ${review.runtime.summary}` : null,
    review.audit ? `Audit: ${review.audit.summary}` : null,
  ].filter(Boolean).join(" ");

  return {
    status,
    summary: reviewSummary,
    reviewStatus: review.status,
    validationPassed: review.validation.passed,
    riskCount: review.risks.length,
    updatedAt: review.updatedAt,
  };
}

function buildConfigState(configReadiness: BuilderConfigReadinessState): BuilderOperatorTrustConfigState {
  const status: BuilderOperatorTrustStatus = !configReadiness.schemaAvailable || !configReadiness.executionReady
    ? "blocked"
    : !configReadiness.projectReady
      ? "warning"
      : "trusted";

  return {
    status,
    summary: configReadiness.summary,
    schemaAvailable: configReadiness.schemaAvailable,
    projectReady: configReadiness.projectReady,
    executionReady: configReadiness.executionReady,
    missingProjectKeys: [...configReadiness.missingProjectKeys],
    missingExecutionKeys: [...configReadiness.missingExecutionKeys],
  };
}

function buildRuntimeState(args: {
  review: BuilderStructuredReview | null;
  reconciliation: BuilderOperationalStateSummary;
  mcpSnapshot: BuilderMcpSnapshotOverviewState;
}): BuilderOperatorTrustRuntimeState {
  const driftDetected = Boolean(args.mcpSnapshot.drift);
  const databaseBlocked = args.review?.database?.status === "drifted" || args.review?.database?.status === "probe_failed";
  const runtimeFailures = (args.review?.runtime?.failedServices ?? 0) > 0;
  const auditBlocked = (args.review?.audit?.notableEvents.length ?? 0) > 0;
  const status: BuilderOperatorTrustStatus = driftDetected || args.reconciliation.activeAlertCount > 0 || databaseBlocked
    ? "blocked"
    : args.reconciliation.unresolvedAlertCount > 0 || args.mcpSnapshot.state !== "captured" || runtimeFailures || auditBlocked
      ? "warning"
      : "trusted";

  const summary = driftDetected
    ? "MCP contract drift is active and must be resolved before trusting runtime state."
    : args.reconciliation.activeAlertCount > 0
      ? `Runtime surfaced ${args.reconciliation.activeAlertCount} active operational alert(s).`
      : databaseBlocked
        ? args.review?.database?.summary ?? "Database inspection surfaced drift or a failed probe."
      : args.reconciliation.unresolvedAlertCount > 0
        ? `Runtime still has ${args.reconciliation.unresolvedAlertCount} unresolved operational alert(s).`
        : runtimeFailures
          ? args.review?.runtime?.summary ?? "Runtime inspection found failed services."
          : auditBlocked
            ? args.review?.audit?.summary ?? "Capability audit contains notable blocked or failed events."
        : `Runtime artifacts are aligned; MCP snapshot state is ${args.mcpSnapshot.state.replaceAll("_", " ")}.`;

  return {
    status,
    summary,
    activeAlertCount: args.reconciliation.activeAlertCount,
    unresolvedAlertCount: args.reconciliation.unresolvedAlertCount,
    autoFixCount: args.reconciliation.reconciledRunCount,
    mcpState: args.mcpSnapshot.state,
    driftDetected,
  };
}

function buildApprovalState(approvals: PendingApprovalSnapshot[]): BuilderOperatorTrustApprovalState {
  return {
    status: approvals.length > 0 ? "warning" : "trusted",
    summary: approvals.length > 0
      ? `${approvals.length} post approval item${approvals.length === 1 ? " is" : "s are"} waiting in the human queue.`
      : "No pending human approvals are waiting in the queue.",
    pendingCount: approvals.length,
    pendingApprovals: approvals,
  };
}

function buildGovernanceState(): BuilderOperatorTrustGovernanceState {
  const approvalRequiredCapabilities = listBuilderCapabilities()
    .filter((capability) => capability.policy.requiresExplicitApproval)
    .map((capability) => capability.key);

  return {
    status: approvalRequiredCapabilities.length > 0 ? "warning" : "trusted",
    summary: approvalRequiredCapabilities.length > 0
      ? `Builder capability gates that require explicit approval when invoked: ${approvalRequiredCapabilities.join(", ")}.`
      : "No Builder capability gates currently require explicit approval.",
    approvalRequiredCapabilities,
  };
}

function buildPrioritizedBlockers(args: {
  review: BuilderOperatorTrustReviewState;
  config: BuilderOperatorTrustConfigState;
  runtime: BuilderOperatorTrustRuntimeState;
  approvals: BuilderOperatorTrustApprovalState;
  governance: BuilderOperatorTrustGovernanceState;
  capabilityAudit?: BuilderCapabilityAuditOverview | null;
}): BuilderOperatorTrustPrioritizedBlocker[] {
  const blockers: BuilderOperatorTrustPrioritizedBlocker[] = [];

  const pushBlocker = (blocker: BuilderOperatorTrustPrioritizedBlocker | null) => {
    if (blocker) {
      blockers.push(blocker);
    }
  };

  pushBlocker(args.runtime.status === "trusted" ? null : {
    key: "runtime",
    label: "runtime",
    status: args.runtime.status,
    priority: args.runtime.status === "blocked" ? 300 + args.runtime.activeAlertCount + args.runtime.unresolvedAlertCount : 220 + args.runtime.unresolvedAlertCount,
    summary: args.runtime.summary,
  });
  pushBlocker(args.config.status === "trusted" ? null : {
    key: "config",
    label: "config",
    status: args.config.status,
    priority: args.config.status === "blocked" ? 280 + args.config.missingExecutionKeys.length : 200 + args.config.missingProjectKeys.length,
    summary: args.config.summary,
  });
  pushBlocker(args.review.status === "trusted" ? null : {
    key: "review",
    label: "review",
    status: args.review.status,
    priority: args.review.validationPassed === false ? 260 + args.review.riskCount : 180 + args.review.riskCount,
    summary: args.review.summary,
  });
  pushBlocker(args.approvals.status === "trusted" ? null : {
    key: "approvals",
    label: "approvals",
    status: args.approvals.status,
    priority: 150 + args.approvals.pendingCount,
    summary: args.approvals.summary,
  });
  pushBlocker(args.governance.status === "trusted" ? null : {
    key: "governance",
    label: "governance",
    status: args.governance.status,
    priority: 120 + args.governance.approvalRequiredCapabilities.length,
    summary: args.governance.summary,
  });

  const criticalAuditEvents = args.capabilityAudit?.severityCounts.critical ?? 0;
  const warningAuditEvents = args.capabilityAudit?.severityCounts.warning ?? 0;
  if (criticalAuditEvents > 0 || warningAuditEvents > 0) {
    pushBlocker({
      key: "capability_audit",
      label: "capability audit",
      status: criticalAuditEvents > 0 ? "blocked" : "warning",
      priority: criticalAuditEvents > 0 ? 240 + criticalAuditEvents : 160 + warningAuditEvents,
      summary: criticalAuditEvents > 0
        ? `${criticalAuditEvents} critical capability audit event${criticalAuditEvents === 1 ? "" : "s"} remain inside the retention window.`
        : `${warningAuditEvents} warning capability audit event${warningAuditEvents === 1 ? "" : "s"} remain inside the retention window.`,
    });
  }

  return blockers.sort((left, right) => right.priority - left.priority).slice(0, 5);
}

function getStructuredReviewFromRun(run: Pick<BuilderRun, "metadata">): BuilderStructuredReview | null {
  const metadata = run.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const review = (metadata as Record<string, unknown>).review;
  return review && typeof review === "object" && !Array.isArray(review)
    ? review as BuilderStructuredReview
    : null;
}

function roundMetric(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function summarizeTrendWindow(runs: Array<Pick<BuilderRun, "status" | "metadata">>): BuilderOperatorTrustTrendState["recentWindow"] {
  if (runs.length === 0) {
    return {
      runCount: 0,
      successRate: 0,
      verificationPassRate: 0,
      averageRiskCount: 0,
      reviewWarningCount: 0,
      blockedRunCount: 0,
    };
  }

  let successCount = 0;
  let verificationEligibleCount = 0;
  let verificationPassCount = 0;
  let totalRiskCount = 0;
  let reviewWarningCount = 0;
  let blockedRunCount = 0;

  for (const run of runs) {
    if (run.status === "SUCCEEDED") {
      successCount += 1;
    }
    if (run.status === "FAILED" || run.status === "CANCELLED" || run.status === "TIMED_OUT") {
      blockedRunCount += 1;
    }

    const review = getStructuredReviewFromRun(run);
    if (!review) {
      continue;
    }

    totalRiskCount += review.risks.length;
    if (review.validation && !review.validation.skipped) {
      verificationEligibleCount += 1;
      if (review.validation.passed) {
        verificationPassCount += 1;
      }
    }

    if (!review.validation.passed || review.risks.length > 0 || review.status !== "SUCCEEDED") {
      reviewWarningCount += 1;
    }
  }

  return {
    runCount: runs.length,
    successRate: roundMetric(successCount / runs.length),
    verificationPassRate: roundMetric(verificationEligibleCount > 0 ? verificationPassCount / verificationEligibleCount : 0),
    averageRiskCount: roundMetric(totalRiskCount / runs.length),
    reviewWarningCount,
    blockedRunCount,
  };
}

function buildTrendStateFromRuns(args: {
  blockers: BuilderOperatorTrustPrioritizedBlocker[];
  capabilityAudit?: BuilderCapabilityAuditOverview | null;
  recentRuns: Array<Pick<BuilderRun, "status" | "metadata">>;
}): BuilderOperatorTrustTrendState {
  const warningAuditEvents = args.capabilityAudit?.severityCounts.warning ?? 0;
  const criticalAuditEvents = args.capabilityAudit?.severityCounts.critical ?? 0;
  const blockedBlockers = args.blockers.filter((blocker) => blocker.status === "blocked").length;
  const finishedRuns = args.recentRuns.filter((run) => run.status !== "RUNNING");
  const recentWindowRuns = finishedRuns.slice(0, BUILDER_OPERATOR_TREND_WINDOW_SIZE);
  const previousWindowRuns = finishedRuns.slice(BUILDER_OPERATOR_TREND_WINDOW_SIZE, BUILDER_OPERATOR_TREND_WINDOW_SIZE * 2);
  const recentWindow = summarizeTrendWindow(recentWindowRuns);
  const previousWindow = summarizeTrendWindow(previousWindowRuns);
  const basis = previousWindow.runCount > 0
    ? `Compared the last ${recentWindow.runCount} finished Builder run${recentWindow.runCount === 1 ? "" : "s"} against the previous ${previousWindow.runCount}.`
    : recentWindow.runCount > 0
      ? `Only ${recentWindow.runCount} finished Builder run${recentWindow.runCount === 1 ? " is" : "s are"} available, so the trend is based on the current window only.`
      : "No finished Builder runs are available yet, so the trend falls back to current audit and blocker state.";

  const scoreDelta = previousWindow.runCount > 0
    ? ((recentWindow.successRate - previousWindow.successRate) * 100)
      + ((recentWindow.verificationPassRate - previousWindow.verificationPassRate) * 80)
      - ((recentWindow.averageRiskCount - previousWindow.averageRiskCount) * 20)
      - ((recentWindow.reviewWarningCount - previousWindow.reviewWarningCount) * 12)
      - ((recentWindow.blockedRunCount - previousWindow.blockedRunCount) * 18)
    : 0;

  const direction = scoreDelta >= 15 && criticalAuditEvents === 0 && blockedBlockers === 0
    ? "improving"
    : scoreDelta <= -15 || criticalAuditEvents > 0 || blockedBlockers > 0
      ? "degrading"
      : "steady";

  const summary = direction === "degrading"
    ? previousWindow.runCount > 0
      ? `Trust is degrading: recent runs are trending worse than the prior window and ${criticalAuditEvents} critical audit event${criticalAuditEvents === 1 ? "" : "s"} remain active.`
      : `Trust is degrading: ${criticalAuditEvents} critical audit event${criticalAuditEvents === 1 ? "" : "s"} and ${blockedBlockers} blocked surface${blockedBlockers === 1 ? "" : "s"} need action.`
    : direction === "improving"
      ? `Trust is improving: recent run and review results are stronger than the prior window, and retained audit history is clean.`
      : previousWindow.runCount > 0
        ? `Trust is steady: recent Builder runs look similar to the prior window, with ${args.blockers[0]?.label ?? "operator trust"} still the highest-priority issue.`
        : args.blockers.length > 0
          ? `Trust is steady: ${args.blockers[0]?.label ?? "operator trust"} remains the top blocker while the run history is still shallow.`
          : "Trust is steady: no retained audit or review signal indicates a clear trend shift yet.";

  return {
    direction,
    basis,
    summary,
    warningAuditEvents,
    criticalAuditEvents,
    blockerCount: args.blockers.length,
    recentWindow,
    previousWindow,
  };
}

export function composeBuilderOperatorTrustState(args: {
  review: BuilderStructuredReview | null;
  configReadiness: BuilderConfigReadinessState;
  reconciliation: BuilderOperationalStateSummary;
  mcpSnapshot: BuilderMcpSnapshotOverviewState;
  approvals: PendingApprovalSnapshot[];
  capabilityAudit?: BuilderCapabilityAuditOverview | null;
  recentRuns?: Array<Pick<BuilderRun, "status" | "metadata">>;
  generatedAt?: string;
}): BuilderOperatorTrustState {
  const review = buildReviewState(args.review);
  const config = buildConfigState(args.configReadiness);
  const runtime = buildRuntimeState({
    review: args.review,
    reconciliation: args.reconciliation,
    mcpSnapshot: args.mcpSnapshot,
  });
  const approvals = buildApprovalState(args.approvals);
  const governance = buildGovernanceState();
  const prioritizedBlockers = buildPrioritizedBlockers({
    review,
    config,
    runtime,
    approvals,
    governance,
    capabilityAudit: args.capabilityAudit,
  });
  const trend = buildTrendStateFromRuns({
    blockers: prioritizedBlockers,
    capabilityAudit: args.capabilityAudit,
    recentRuns: args.recentRuns ?? [],
  });
  const overallStatus = foldStatuses([review.status, config.status, runtime.status, approvals.status, governance.status]);
  const reasons = [
    config.status !== "trusted" ? `config ${summarizeStatus(config.status)}` : null,
    runtime.status !== "trusted" ? `runtime ${summarizeStatus(runtime.status)}` : null,
    review.status !== "trusted" ? `review ${summarizeStatus(review.status)}` : null,
    approvals.status !== "trusted" ? `approvals ${summarizeStatus(approvals.status)}` : null,
  ].filter(Boolean);

  return {
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    overallStatus,
    summary: reasons.length > 0
      ? `Operator trust is ${summarizeStatus(overallStatus)} because ${reasons.join(", ")}.`
      : "Operator trust is trusted across config, runtime, review, and approval surfaces.",
    review,
    config,
    runtime,
    approvals,
    governance,
    prioritizedBlockers,
    trend,
    artifactPaths: {
      markdown: BUILDER_OPERATOR_TRUST_MARKDOWN_PATH,
      json: BUILDER_OPERATOR_TRUST_JSON_PATH,
      latestReview: BUILDER_LATEST_REVIEW_PATH,
      processArtifacts: BUILDER_PROCESS_ARTIFACTS_PATH,
    },
  };
}

export async function buildBuilderOperatorTrustState(args: {
  review: BuilderStructuredReview | null;
  configReadiness: BuilderConfigReadinessState;
  reconciliation: BuilderOperationalStateSummary;
  mcpSnapshot: BuilderMcpSnapshotOverviewState;
  capabilityAudit?: BuilderCapabilityAuditOverview | null;
  recentRuns?: Array<Pick<BuilderRun, "status" | "metadata">>;
}): Promise<BuilderOperatorTrustState> {
  const approvals = await listPendingApprovalSnapshots(5);
  return composeBuilderOperatorTrustState({
    ...args,
    approvals,
  });
}

export function renderBuilderOperatorTrustMarkdown(trust: BuilderOperatorTrustState): string {
  return [
    "# Operator Trust",
    "",
    `- Generated: ${trust.generatedAt}`,
    `- Overall status: ${trust.overallStatus}`,
    `- Summary: ${trust.summary}`,
    "",
    "## Review",
    "",
    `- Status: ${trust.review.status}`,
    `- Review result: ${trust.review.reviewStatus ?? "none"}`,
    `- Validation passed: ${trust.review.validationPassed ?? "unknown"}`,
    `- Risk count: ${trust.review.riskCount}`,
    `- Summary: ${trust.review.summary}`,
    "",
    "## Configuration",
    "",
    `- Status: ${trust.config.status}`,
    `- Schema available: ${trust.config.schemaAvailable}`,
    `- Project ready: ${trust.config.projectReady}`,
    `- Execution ready: ${trust.config.executionReady}`,
    `- Missing project keys: ${trust.config.missingProjectKeys.join(", ") || "none"}`,
    `- Missing execution keys: ${trust.config.missingExecutionKeys.join(", ") || "none"}`,
    `- Summary: ${trust.config.summary}`,
    "",
    "## Runtime",
    "",
    `- Status: ${trust.runtime.status}`,
    `- Active alerts: ${trust.runtime.activeAlertCount}`,
    `- Unresolved alerts: ${trust.runtime.unresolvedAlertCount}`,
    `- Auto fixes: ${trust.runtime.autoFixCount}`,
    `- MCP state: ${trust.runtime.mcpState}`,
    `- Drift detected: ${trust.runtime.driftDetected}`,
    `- Summary: ${trust.runtime.summary}`,
    "",
    "## Approvals",
    "",
    `- Status: ${trust.approvals.status}`,
    `- Pending count: ${trust.approvals.pendingCount}`,
    `- Summary: ${trust.approvals.summary}`,
    ...(trust.approvals.pendingApprovals.length > 0
      ? ["", ...trust.approvals.pendingApprovals.map((approval) => `- ${approval.platform} · ${approval.postStatus} · ${approval.postId} · ${approval.excerpt}`)]
      : []),
    "",
    "## Governance",
    "",
    `- Status: ${trust.governance.status}`,
    `- Approval-required capability gates: ${trust.governance.approvalRequiredCapabilities.join(", ") || "none"}`,
    `- Summary: ${trust.governance.summary}`,
    "",
    "## Prioritized Blockers",
    "",
    ...(trust.prioritizedBlockers.length > 0
      ? trust.prioritizedBlockers.map((blocker) => `- ${blocker.label}: [priority ${blocker.priority}] ${blocker.status} - ${blocker.summary}`)
      : ["- none"]),
    "",
    "## Trend",
    "",
    `- Direction: ${trust.trend.direction}`,
    `- Warning audit events: ${trust.trend.warningAuditEvents}`,
    `- Critical audit events: ${trust.trend.criticalAuditEvents}`,
    `- Blocker count: ${trust.trend.blockerCount}`,
    `- Summary: ${trust.trend.summary}`,
    "",
    "## Artifact Paths",
    "",
    `- Markdown: ${trust.artifactPaths.markdown}`,
    `- JSON: ${trust.artifactPaths.json}`,
    `- Review: ${trust.artifactPaths.latestReview}`,
    `- Processes: ${trust.artifactPaths.processArtifacts}`,
    "",
  ].join("\n");
}