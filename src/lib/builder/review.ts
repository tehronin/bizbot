import type { BuilderTask, BuilderTaskStage, BuilderTaskStatus } from "@prisma/client";
import type { BuilderAgenticLoopMetadata } from "@/lib/builder/agentic";
import type { BuilderStructuredCheckSummary, BuilderStructuredReview, BuilderStructuredValidationSummary } from "@/lib/builder/types";

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
    risks,
    nextSteps,
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
  ];

  return lines.join("\n");
}