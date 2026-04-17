import type { BuilderTask, BuilderTaskStage, BuilderTaskStatus } from "@prisma/client";
import type { BuilderAgenticLoopMetadata } from "@/lib/builder/agentic";
import type { BuilderConfigReadinessState } from "@/lib/builder/environment";
import type { BuilderArchitectureReconciliationState, BuilderStructuredCheckSummary, BuilderStructuredReview, BuilderStructuredValidationSummary } from "@/lib/builder/types";

function summarizeScript(loop: BuilderAgenticLoopMetadata, scriptName: "build" | "test" | "lint"): BuilderStructuredCheckSummary {
  for (const iteration of loop.iterations) {
    const step = iteration.verification.steps.find((candidate) => candidate.script === scriptName);
    if (step) {
      return {
        passed: step.ok,
        exitCode: step.exitCode,
        summary: step.ok ? `${scriptName} passed.` : `${scriptName} failed${step.exitCode !== null ? ` (${step.exitCode})` : ""}.`,
      };
    }
  }

  return {
    passed: null,
    exitCode: null,
    summary: null,
  };
}

function summarizeValidation(loop: BuilderAgenticLoopMetadata): BuilderStructuredValidationSummary {
  return {
    passed: loop.finalVerdict === "complete",
    skipped: loop.verificationSkipped,
    summary: loop.summary,
    scripts: loop.selectedScripts,
  };
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function collectFilesChanged(loop: BuilderAgenticLoopMetadata): string[] {
  return unique(loop.iterations.flatMap((iteration) => iteration.changedFiles));
}

function collectCommands(loop: BuilderAgenticLoopMetadata): string[] {
  return unique(loop.iterations.map((iteration) => [iteration.command, ...iteration.args].join(" ")));
}

export function buildBuilderStructuredReview(args: {
  task: BuilderTask;
  projectId: string;
  status: BuilderTaskStatus | string;
  stage: BuilderTaskStage | string;
  loop: BuilderAgenticLoopMetadata;
  config?: BuilderConfigReadinessState;
  vcs?: BuilderStructuredReview["vcs"];
  process?: BuilderStructuredReview["process"];
  audit?: BuilderStructuredReview["audit"];
  database?: BuilderStructuredReview["database"];
  runtime?: BuilderStructuredReview["runtime"];
  containerStage?: BuilderStructuredReview["containerStage"];
  architecture?: BuilderArchitectureReconciliationState;
  adrAdjudication?: BuilderStructuredReview["adrAdjudication"];
}): BuilderStructuredReview {
  const filesChanged = collectFilesChanged(args.loop);
  const commandsExecuted = collectCommands(args.loop);
  const build = summarizeScript(args.loop, "build");
  const tests = summarizeScript(args.loop, "test");
  const lint = summarizeScript(args.loop, "lint");
  const containerSummary = args.containerStage && args.containerStage.status !== "skipped"
    ? args.containerStage.summary
    : null;
  const summary = [args.loop.summary, containerSummary].filter(Boolean).join(" ");
  const risks = args.status === "SUCCEEDED"
    ? []
    : [
        args.loop.iterations.at(-1)?.review.reason ?? "Builder task did not complete cleanly.",
        ...(args.containerStage && ["failed", "blocked"].includes(args.containerStage.status)
          ? [args.containerStage.summary]
          : []),
      ];
  const nextSteps = args.status === "SUCCEEDED"
    ? []
    : [
        ...unique(args.loop.iterations.flatMap((iteration) => iteration.changedFiles.slice(0, 3)).slice(0, 5)).map((file) => `Inspect and finish work around ${file}.`),
        ...(args.containerStage && ["failed", "blocked"].includes(args.containerStage.status)
          ? ["Inspect the Docker-ready container stage contract, compose service, and in-container verification scripts."]
          : []),
        ...(args.adrAdjudication?.overallVerdict === "escalate" && args.adrAdjudication.escalationReason
          ? [args.adrAdjudication.escalationReason]
          : []),
      ];

  return {
    taskId: args.task.id,
    projectId: args.projectId,
    status: args.status,
    stage: args.stage,
    summary,
    filesChanged,
    commandsExecuted,
    validation: summarizeValidation(args.loop),
    tests,
    lint,
    build,
    config: args.config ? {
      schemaAvailable: args.config.schemaAvailable,
      projectReady: args.config.projectReady,
      executionReady: args.config.executionReady,
      missingProjectKeys: [...args.config.missingProjectKeys],
      missingExecutionKeys: [...args.config.missingExecutionKeys],
      malformedEntries: [...args.config.malformedEntries],
      summary: args.config.summary,
    } : undefined,
    vcs: args.vcs,
    process: args.process,
    audit: args.audit,
    database: args.database,
    runtime: args.runtime,
    containerStage: args.containerStage,
    risks,
    nextSteps,
    architecture: args.architecture,
    adrAdjudication: args.adrAdjudication,
    updatedAt: new Date().toISOString(),
  };
}

export function renderBuilderReviewMarkdown(review: BuilderStructuredReview): string {
  const lines = [
    `# Builder Review`,
    "",
    `- Task: ${review.taskId}`,
    `- Project: ${review.projectId}`,
    `- Status: ${review.status}`,
    `- Stage: ${review.stage}`,
    `- Updated: ${review.updatedAt}`,
    "",
    `## Summary`,
    "",
    review.summary,
    "",
    `## Validation`,
    "",
    `- Passed: ${review.validation.passed}`,
    `- Skipped: ${review.validation.skipped}`,
    `- Scripts: ${review.validation.scripts.join(", ") || "none"}`,
    `- Summary: ${review.validation.summary}`,
    "",
    `## Configuration`,
    "",
    ...(review.config
      ? [
          `- Schema available: ${review.config.schemaAvailable}`,
          `- Project ready: ${review.config.projectReady}`,
          `- Execution ready: ${review.config.executionReady}`,
          `- Missing project keys: ${review.config.missingProjectKeys.join(", ") || "none"}`,
          `- Missing execution keys: ${review.config.missingExecutionKeys.join(", ") || "none"}`,
          `- Malformed entries: ${review.config.malformedEntries.length}`,
          `- Summary: ${review.config.summary}`,
        ]
      : ["- none"]),
    "",
    `## Version Control`,
    "",
    ...(review.vcs
      ? [
          `- Summary: ${review.vcs.summary}`,
          `- Branch: ${review.vcs.currentBranch ?? "none"}`,
          `- Head commit: ${review.vcs.headCommitSha ?? "none"}`,
          `- Ahead/behind: ${review.vcs.ahead}/${review.vcs.behind}`,
          `- Dirty: ${review.vcs.dirty}`,
          `- Staged: ${review.vcs.stagedCount}`,
          `- Unstaged: ${review.vcs.unstagedCount}`,
          `- Untracked: ${review.vcs.untrackedCount}`,
          `- Conflicted: ${review.vcs.conflictedCount}`,
          `- Stashes: ${review.vcs.stashCount}`,
          `- Tags: ${review.vcs.tagCount}`,
          `- Remotes: ${review.vcs.remoteCount}`,
          `- Remote names: ${review.vcs.remoteNames.join(", ") || "none"}`,
          `- Pending push: ${review.vcs.pendingPush}`,
          `- Pending push context: ${review.vcs.pendingPushContext ?? "none"}`,
          `- Audit: ${review.vcs.auditPath ?? "none"}`,
        ]
      : ["- none"]),
    "",
    `## Process Lifecycle`,
    "",
    ...(review.process
      ? [
          `- Summary: ${review.process.summary}`,
          `- Managed processes: ${review.process.managedCount}`,
          `- Running: ${review.process.runningCount}`,
          `- Failed: ${review.process.failedCount}`,
          `- Timed out: ${review.process.timedOutCount}`,
          `- Cancelled: ${review.process.cancelledCount}`,
          `- Recent process ids: ${review.process.recentProcessIds.join(", ") || "none"}`,
        ]
      : ["- none"]),
    "",
    `## Capability Audit`,
    "",
    ...(review.audit
      ? [
          `- Summary: ${review.audit.summary}`,
          `- Audit path: ${review.audit.auditPath ?? "none"}`,
          `- Total events: ${review.audit.totalEvents}`,
          `- Notable events: ${review.audit.notableEvents.map((entry) => `${entry.capabilityKey}:${entry.outcomeStatus}`).join(", ") || "none"}`,
        ]
      : ["- none"]),
    "",
    `## Database Inspection`,
    "",
    ...(review.database
      ? [
          `- Summary: ${review.database.summary}`,
          `- Status: ${review.database.status}`,
          `- Provider: ${review.database.provider ?? "none"}`,
          `- Artifact/live tables: ${review.database.artifactTableCount}/${review.database.liveTableCount}`,
          `- Latest live probe: ${review.database.latestProbeAt ?? "none"}`,
          `- Audit: ${review.database.auditPath ?? "none"}`,
        ]
      : ["- none"]),
    "",
    `## ADR Adjudication`,
    "",
    ...(review.adrAdjudication
      ? [
          `- Verdict: ${review.adrAdjudication.overallVerdict}`,
          `- Summary: ${review.adrAdjudication.summary}`,
          `- Relevant families: ${review.adrAdjudication.relevantFamilies.join(", ") || "none"}`,
          `- Relevant stale keys: ${review.adrAdjudication.staleRelevantKeys.join(", ") || "none"}`,
          `- Update keys: ${review.adrAdjudication.updateDecisionKeys.join(", ") || "none"}`,
          `- Retire keys: ${review.adrAdjudication.retireDecisionKeys.join(", ") || "none"}`,
          `- Escalation: ${review.adrAdjudication.escalationReason ?? "none"}`,
        ]
      : ["- none"]),
    "",
    `## Runtime Inspection`,
    "",
    ...(review.runtime
      ? [
          `- Summary: ${review.runtime.summary}`,
          `- Total services: ${review.runtime.totalServices}`,
          `- Running: ${review.runtime.runningServices}`,
          `- Failed: ${review.runtime.failedServices}`,
          `- Managed: ${review.runtime.managedServices}`,
          `- Prominent services: ${review.runtime.prominentServiceIds.join(", ") || "none"}`,
        ]
      : ["- none"]),
    "",
    `## Container Stage`,
    "",
    ...(review.containerStage
      ? [
          `- Available: ${review.containerStage.available}`,
          `- Status: ${review.containerStage.status}`,
          `- Summary: ${review.containerStage.summary}`,
          `- Service: ${review.containerStage.serviceId ?? "none"}`,
          `- Container: ${review.containerStage.containerId ?? "none"}`,
          `- Working directory: ${review.containerStage.workingDirectory ?? "none"}`,
          `- Started by review: ${review.containerStage.startedService}`,
          `- Stopped by review: ${review.containerStage.stoppedService}`,
          `- File checks: ${review.containerStage.fileChecks.filter((entry) => entry.exists).length}/${review.containerStage.fileChecks.length}`,
          `- Script checks: ${review.containerStage.scriptChecks.filter((entry) => entry.passed).length}/${review.containerStage.scriptChecks.length}`,
        ]
      : ["- none"]),
    "",
    `## Files Changed`,
    "",
    ...(review.filesChanged.length > 0 ? review.filesChanged.map((file) => `- ${file}`) : ["- none"]),
    "",
    `## Commands Executed`,
    "",
    ...(review.commandsExecuted.length > 0 ? review.commandsExecuted.map((command) => `- ${command}`) : ["- none"]),
    "",
    `## Risks`,
    "",
    ...(review.risks.length > 0 ? review.risks.map((risk) => `- ${risk}`) : ["- none"]),
    "",
    `## Next Steps`,
    "",
    ...(review.nextSteps.length > 0 ? review.nextSteps.map((step) => `- ${step}`) : ["- none"]),
    "",
    `## Architecture Reconciliation`,
    "",
    ...(review.architecture
      ? [
          `- Active keys: ${review.architecture.activeKeys.join(", ") || "none"}`,
          `- Stale keys: ${review.architecture.staleKeys.join(", ") || "none"}`,
          `- Reconfirmed stale keys: ${review.architecture.reconfirmedStaleKeys.join(", ") || "none"}`,
          `- Addressed stale keys: ${review.architecture.addressedStaleKeys.join(", ") || "none"}`,
          `- Missing stale keys: ${review.architecture.missingStaleKeys.join(", ") || "none"}`,
          `- Unreferenced active keys: ${review.architecture.unreferencedActiveKeys.join(", ") || "none"}`,
          `- Conflicting decision keys: ${review.architecture.conflictingDecisionKeys.join(", ") || "none"}`,
          `- New decision keys: ${review.architecture.newDecisionKeys.join(", ") || "none"}`,
          `- Retired decision keys: ${review.architecture.retiredDecisionKeys.join(", ") || "none"}`,
        ]
      : ["- none"]),
    "",
  ];

  return lines.join("\n");
}