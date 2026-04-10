import type { BuilderConfigReadinessState } from "@/lib/builder/environment";
import { listBuilderCapabilities } from "@/lib/builder/capabilities";
import type { BuilderOperationalStateSummary } from "@/lib/builder/reconciliation";
import type {
  BuilderMcpSnapshotOverviewState,
  BuilderOperatorTrustApprovalState,
  BuilderOperatorTrustConfigState,
  BuilderOperatorTrustGovernanceState,
  BuilderOperatorTrustReviewState,
  BuilderOperatorTrustRuntimeState,
  BuilderOperatorTrustState,
  BuilderOperatorTrustStatus,
  BuilderStructuredReview,
} from "@/lib/builder/types";
import { listPendingApprovalSnapshots, type PendingApprovalSnapshot } from "@/lib/approvals";

export const BUILDER_OPERATOR_TRUST_MARKDOWN_PATH = ".builder/reports/operator-trust.md";
export const BUILDER_OPERATOR_TRUST_JSON_PATH = ".builder/reports/operator-trust.json";
export const BUILDER_LATEST_REVIEW_PATH = ".builder/reports/latest-review.md";
export const BUILDER_PROCESS_ARTIFACTS_PATH = ".builder/processes";

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

export function composeBuilderOperatorTrustState(args: {
  review: BuilderStructuredReview | null;
  configReadiness: BuilderConfigReadinessState;
  reconciliation: BuilderOperationalStateSummary;
  mcpSnapshot: BuilderMcpSnapshotOverviewState;
  approvals: PendingApprovalSnapshot[];
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
    "## Artifact Paths",
    "",
    `- Markdown: ${trust.artifactPaths.markdown}`,
    `- JSON: ${trust.artifactPaths.json}`,
    `- Review: ${trust.artifactPaths.latestReview}`,
    `- Processes: ${trust.artifactPaths.processArtifacts}`,
    "",
  ].join("\n");
}