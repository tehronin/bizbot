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
  architecture?: BuilderArchitectureReconciliationState;
}): BuilderStructuredReview {
  const filesChanged = collectFilesChanged(args.loop);
  const commandsExecuted = collectCommands(args.loop);
  const build = summarizeScript(args.loop, "build");
  const tests = summarizeScript(args.loop, "test");
  const lint = summarizeScript(args.loop, "lint");
  const risks = args.status === "SUCCEEDED"
    ? []
    : [args.loop.iterations.at(-1)?.review.reason ?? "Builder task did not complete cleanly."];
  const nextSteps = args.status === "SUCCEEDED"
    ? []
    : unique(args.loop.iterations.flatMap((iteration) => iteration.changedFiles.slice(0, 3)).slice(0, 5)).map((file) => `Inspect and finish work around ${file}.`);

  return {
    taskId: args.task.id,
    projectId: args.projectId,
    status: args.status,
    stage: args.stage,
    summary: args.loop.summary,
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
    risks,
    nextSteps,
    architecture: args.architecture,
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