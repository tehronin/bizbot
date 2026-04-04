import type {
  BuilderAgenticLoopMetadata,
  BuilderAgenticVerificationReport,
} from "@/lib/builder/agentic";
import type { BuilderCommandResult } from "@/lib/builder/workspace";

const LOW_SIGNAL_CHANGE_PATTERNS = [
  /(^|\/)\.builder(\/|$)/,
  /(^|\/)dist(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)(package-lock\.json|pnpm-lock\.ya?ml|yarn\.lock|bun\.lockb?)$/,
];

function summarizeCommandResult(result: BuilderCommandResult): string {
  if (result.cancelled) {
    return "agent execution was cancelled";
  }
  if (result.ok) {
    return "agent execution completed successfully";
  }
  if (result.timedOut) {
    return "agent execution timed out";
  }

  return "agent execution failed";
}

function summarizeVerificationDetails(verification: BuilderAgenticVerificationReport): string {
  if (verification.steps.length === 0) {
    return verification.summary;
  }

  return verification.steps
    .map((step) => `${step.script}: ${step.ok ? "passed" : `failed (exit ${step.exitCode ?? "unknown"})`}`)
    .join("; ");
}

function extractFailureExcerpt(verification: BuilderAgenticVerificationReport): string | null {
  const failedStep = verification.steps.find((step) => !step.ok);
  const source = failedStep?.stderr || failedStep?.stdout || verification.summary;
  const line = source
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);

  if (!line) {
    return null;
  }

  const normalized = line.replace(/\s+/g, " ");
  return normalized.length > 240 ? `${normalized.slice(0, 239)}...` : normalized;
}

function isLowSignalChangedFile(filePath: string): boolean {
  return LOW_SIGNAL_CHANGE_PATTERNS.some((pattern) => pattern.test(filePath));
}

function hasSubstantiveChanges(changedFiles: string[]): boolean {
  return changedFiles.some((filePath) => !isLowSignalChangedFile(filePath));
}

export function buildVerificationOutcomeSignature(verification: BuilderAgenticVerificationReport): string {
  return JSON.stringify({
    skipped: verification.skipped,
    passed: verification.passed,
    summary: verification.summary,
    steps: verification.steps.map((step) => ({
      script: step.script,
      ok: step.ok,
      exitCode: step.exitCode,
      timedOut: step.timedOut,
      excerpt: (step.stderr || step.stdout || "")
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find(Boolean) ?? "",
    })),
  });
}

export function buildRepairPrompt(
  basePrompt: string,
  iteration: number,
  actResult: BuilderCommandResult,
  verification: BuilderAgenticVerificationReport,
  changedFiles: string[],
): string {
  const changedFilesText = changedFiles.length > 0 ? changedFiles.join(", ") : "none recorded";
  const failureExcerpt = extractFailureExcerpt(verification);

  return [
    basePrompt,
    "",
    `Previous builder attempt ${iteration} did not finish cleanly. Review the current workspace, then make the smallest changes needed to satisfy the original request.`,
    "",
    `Attempt result: ${summarizeCommandResult(actResult)}.`,
    `Verification: ${summarizeVerificationDetails(verification)}.`,
    failureExcerpt ? `Failure excerpt: ${failureExcerpt}.` : null,
    `Changed files detected: ${changedFilesText}.`,
    "",
    "Do not restate the plan. Apply fixes and leave the project in a verifiable state.",
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function decideBuilderLoopReviewVerdict(args: {
  iteration: number;
  maxIterations: number;
  actResult: BuilderCommandResult;
  verification: BuilderAgenticVerificationReport;
  changedFiles: string[];
  previousVerificationSignature: string | null;
  currentVerificationSignature: string;
}): { verdict: "complete" | "retry" | "blocked" | "max_iterations" | "cancelled"; reason: string } {
  const {
    iteration,
    maxIterations,
    actResult,
    verification,
    changedFiles,
    previousVerificationSignature,
    currentVerificationSignature,
  } = args;
  const substantiveChanges = hasSubstantiveChanges(changedFiles);

  if (actResult.cancelled) {
    return { verdict: "cancelled", reason: actResult.timedOut ? "Builder agent timed out." : "Builder run was cancelled." };
  }

  if (verification.passed) {
    return {
      verdict: "complete",
      reason: verification.skipped
        ? "Builder agent finished and no deterministic verification scripts were available."
        : "Verification scripts passed.",
    };
  }

  if (actResult.timedOut) {
    return { verdict: "blocked", reason: "Builder agent timed out before verification passed." };
  }

  if (changedFiles.length === 0) {
    return { verdict: "blocked", reason: "Verification failed and the builder loop did not detect workspace changes." };
  }

  if (previousVerificationSignature === currentVerificationSignature) {
    return {
      verdict: "blocked",
      reason: substantiveChanges
        ? "Builder loop hit the same verification failure twice without improving verification output."
        : "Builder loop repeated the same verification failure after only generated or bookkeeping changes.",
    };
  }

  if (!substantiveChanges && !actResult.ok) {
    return { verdict: "blocked", reason: "Builder agent failed without making substantive workspace changes." };
  }

  if (iteration >= maxIterations) {
    return { verdict: "max_iterations", reason: "Builder loop reached the maximum retry count." };
  }

  return {
    verdict: "retry",
    reason: substantiveChanges
      ? "Verification failed after substantive workspace changes; retrying with the current workspace and failure details."
      : "Verification failed after low-signal workspace changes; retrying once with the specific failure details.",
  };
}

export function buildBuilderLoopSummary(loop: BuilderAgenticLoopMetadata): string {
  if (loop.finalVerdict === "complete") {
    return `Builder loop completed after ${loop.iterations.length} iteration${loop.iterations.length === 1 ? "" : "s"}. ${loop.verified ? "Verification passed." : "Verification was skipped."}`;
  }

  if (loop.finalVerdict === "cancelled") {
    return `Builder loop cancelled after ${loop.iterations.length} iteration${loop.iterations.length === 1 ? "" : "s"}.`;
  }

  const lastIteration = loop.iterations[loop.iterations.length - 1];
  return `Builder loop stopped after ${loop.iterations.length} iteration${loop.iterations.length === 1 ? "" : "s"}: ${lastIteration?.review.reason ?? "unknown outcome"}`;
}