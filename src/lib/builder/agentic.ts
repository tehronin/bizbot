import { createHash } from "crypto";
import type { BuilderCliProfile, BuilderProject, BuilderTaskSpecValidator } from "@prisma/client";
import { npmRunScript } from "@/lib/builder/adapters/npm";
import { pnpmRunScript } from "@/lib/builder/adapters/pnpm";
import { getBuilderCliProfile } from "@/lib/builder/cli-profiles";
import { getBuilderConfig } from "@/lib/builder/config";
import {
  buildBuilderLoopSummary,
  buildRepairPrompt,
  buildVerificationOutcomeSignature,
  decideBuilderLoopReviewVerdict,
} from "@/lib/builder/loop-review";
import {
  listBuilderFilesRecursive,
  readBuilderFile,
  runBuilderCliCommand,
  type BuilderCommandResult,
} from "@/lib/builder/workspace";

const MAX_AGENTIC_ITERATIONS = 3;
const MAX_CHANGED_FILES = 20;
const MAX_SNAPSHOT_ENTRIES = 200;
const MAX_METADATA_OUTPUT_CHARS = 2_000;
const VERIFICATION_SCRIPT_ORDER = ["build", "test", "lint"] as const;

export interface BuilderAgenticTaskInput {
  profile?: string;
  prompt: string;
  model?: string;
  args?: string[];
}

export interface BuilderAgenticTaskExecution {
  profile: BuilderCliProfile;
  command: string;
  args: string[];
}

export interface BuilderAgenticVerificationStep {
  script: string;
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export interface BuilderAgenticVerificationReport {
  scripts: string[];
  steps: BuilderAgenticVerificationStep[];
  passed: boolean;
  skipped: boolean;
  summary: string;
}

export interface BuilderAgenticIteration {
  iteration: number;
  prompt: string;
  command: string;
  args: string[];
  actResult: {
    ok: boolean;
    exitCode: number | null;
    timedOut: boolean;
    cwd: string;
    stdout: string;
    stderr: string;
  };
  verification: BuilderAgenticVerificationReport;
  review: {
    verdict: "complete" | "retry" | "blocked" | "max_iterations" | "cancelled";
    reason: string;
  };
  changedFiles: string[];
}

export interface BuilderAgenticLoopMetadata {
  maxIterations: number;
  finalVerdict?: "complete" | "blocked" | "max_iterations" | "cancelled";
  verified: boolean;
  verificationSkipped: boolean;
  selectedScripts: string[];
  summary: string;
  iterations: BuilderAgenticIteration[];
  currentIteration?: number;
  phase?: "acting" | "verifying" | "reviewing" | "complete";
}

export interface BuilderAgenticTaskResult {
  profile: BuilderCliProfile;
  command: string;
  args: string[];
  result: BuilderCommandResult;
  loop: BuilderAgenticLoopMetadata;
}

export interface BuilderAgenticProgressEvent {
  loop: BuilderAgenticLoopMetadata;
  latestResult?: Pick<BuilderCommandResult, "stdout" | "stderr" | "ok" | "exitCode" | "timedOut">;
}

export interface BuilderVerificationPolicy {
  mode?: "analysis_only" | "scaffold" | "implementation" | "verification";
  validators?: BuilderTaskSpecValidator[];
}

export interface BuilderAgenticTaskOptions {
  onProgress?: (event: BuilderAgenticProgressEvent) => Promise<void> | void;
  signal?: AbortSignal;
  onStdoutChunk?: (chunk: string) => Promise<void> | void;
  onStderrChunk?: (chunk: string) => Promise<void> | void;
  verification?: BuilderVerificationPolicy;
}

interface BuilderWorkspaceSnapshot {
  fingerprint: string;
  entries: Map<string, string>;
}

function isProfileAvailable(profile: BuilderCliProfile): boolean {
  const metadata = (profile.metadata ?? {}) as Record<string, unknown>;
  return metadata.available === true;
}

function getAvailabilityReason(profile: BuilderCliProfile): string {
  const metadata = (profile.metadata ?? {}) as Record<string, unknown>;
  return typeof metadata.availabilityReason === "string"
    ? metadata.availabilityReason
    : `Builder CLI profile is unavailable: ${profile.displayName}`;
}

function isProfileReady(profile: BuilderCliProfile): boolean {
  const metadata = (profile.metadata ?? {}) as Record<string, unknown>;
  return metadata.ready === true;
}

function getReadinessReason(profile: BuilderCliProfile): string {
  const metadata = (profile.metadata ?? {}) as Record<string, unknown>;
  return typeof metadata.readinessReason === "string"
    ? metadata.readinessReason
    : `Builder CLI profile is not ready: ${profile.displayName}`;
}

function sanitizePrompt(prompt: string): string {
  return prompt.trim();
}

function truncateForMetadata(value: string): string {
  if (value.length <= MAX_METADATA_OUTPUT_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_METADATA_OUTPUT_CHARS)}\n[truncated ${value.length - MAX_METADATA_OUTPUT_CHARS} chars]`;
}

function getProjectPackageJsonPath(project: BuilderProject): string {
  return `${project.relativePath.replace(/\/$/, "")}/package.json`;
}

function listVerificationScripts(project: BuilderProject): string[] {
  try {
    const raw = readBuilderFile(getProjectPackageJsonPath(project));
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    const scripts = parsed?.scripts;
    if (!scripts || typeof scripts !== "object") {
      return [];
    }

    return VERIFICATION_SCRIPT_ORDER.filter((script) => typeof scripts[script] === "string");
  } catch {
    return [];
  }
}

async function runVerificationScript(
  project: BuilderProject,
  script: string,
  options: Pick<BuilderAgenticTaskOptions, "signal" | "onStdoutChunk" | "onStderrChunk"> & { env?: NodeJS.ProcessEnv },
): Promise<BuilderCommandResult> {
  const commandOptions: {
    signal?: AbortSignal;
    onStdoutChunk?: (chunk: string) => void | Promise<void>;
    onStderrChunk?: (chunk: string) => void | Promise<void>;
    env?: NodeJS.ProcessEnv;
  } = script === "test"
    ? {
      ...options,
      env: {
        ...options.env,
        NODE_ENV: "test",
      } as NodeJS.ProcessEnv,
    }
    : options;

  return project.packageManager === "PNPM"
    ? pnpmRunScript(project.relativePath, script, [], commandOptions)
    : npmRunScript(project.relativePath, script, [], commandOptions);
}

async function runProjectVerification(
  project: BuilderProject,
  options: Pick<BuilderAgenticTaskOptions, "signal" | "onStdoutChunk" | "onStderrChunk">,
): Promise<BuilderAgenticVerificationReport> {
  if (options.signal?.aborted) {
    return {
      scripts: [],
      steps: [],
      passed: false,
      skipped: false,
      summary: "Verification cancelled.",
    };
  }

  const scripts = listVerificationScripts(project);
  if (scripts.length === 0) {
    return {
      scripts: [],
      steps: [],
      passed: true,
      skipped: true,
      summary: "No build/test/lint scripts found; verification skipped.",
    };
  }

  const steps: BuilderAgenticVerificationStep[] = [];
  for (const script of scripts) {
    const result = await runVerificationScript(project, script, options);
    steps.push({
      script,
      ok: result.ok,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stdout: truncateForMetadata(result.stdout),
      stderr: truncateForMetadata(result.stderr),
    });

    if (!result.ok) {
      return {
        scripts,
        steps,
        passed: false,
        skipped: false,
        summary: `${script} failed during verification.`,
      };
    }
  }

  return {
    scripts,
    steps,
    passed: true,
    skipped: false,
    summary: `Verification passed: ${scripts.join(", ")}.`,
  };
}

function buildSnapshotFingerprint(entries: Map<string, string>): string {
  const hash = createHash("sha1");
  for (const [key, value] of Array.from(entries.entries()).sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(key);
    hash.update("\0");
    hash.update(value);
    hash.update("\0");
  }

  return hash.digest("hex");
}

function snapshotWorkspace(project: BuilderProject): BuilderWorkspaceSnapshot {
  const entries = new Map<string, string>();
  const paths = listBuilderFilesRecursive(project.relativePath, MAX_SNAPSHOT_ENTRIES);

  for (const entryPath of paths) {
    try {
      entries.set(entryPath, readBuilderFile(entryPath));
    } catch {
      entries.set(entryPath, "<non-text-or-directory>");
    }
  }

  return {
    fingerprint: buildSnapshotFingerprint(entries),
    entries,
  };
}

function diffWorkspaceSnapshots(previous: BuilderWorkspaceSnapshot, next: BuilderWorkspaceSnapshot): string[] {
  const changed = new Set<string>();

  for (const [entryPath, value] of previous.entries.entries()) {
    if (!next.entries.has(entryPath) || next.entries.get(entryPath) !== value) {
      changed.add(entryPath);
    }
  }

  for (const [entryPath, value] of next.entries.entries()) {
    if (!previous.entries.has(entryPath) || previous.entries.get(entryPath) !== value) {
      changed.add(entryPath);
    }
  }

  return Array.from(changed)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_CHANGED_FILES);
}

function buildProgressLoop(args: {
  phase: BuilderAgenticLoopMetadata["phase"];
  currentIteration: number;
  iterations: BuilderAgenticIteration[];
  summary: string;
  selectedScripts: string[];
}): BuilderAgenticLoopMetadata {
  return {
    maxIterations: MAX_AGENTIC_ITERATIONS,
    verified: false,
    verificationSkipped: false,
    selectedScripts: args.selectedScripts,
    summary: args.summary,
    iterations: args.iterations,
    currentIteration: args.currentIteration,
    phase: args.phase,
  };
}

async function emitProgress(
  onProgress: BuilderAgenticTaskOptions["onProgress"],
  event: BuilderAgenticProgressEvent,
): Promise<void> {
  if (!onProgress) {
    return;
  }

  await onProgress(event);
}

export async function buildBuilderAgenticExecution(
  project: BuilderProject,
  input: BuilderAgenticTaskInput,
): Promise<BuilderAgenticTaskExecution> {
  const profileKey = input.profile?.trim();
  const prompt = sanitizePrompt(input.prompt);
  if (!profileKey) {
    throw new Error("No Builder agentic profile was selected. Choose an enabled CLI profile before running an agentic Builder task.");
  }
  if (!prompt) {
    throw new Error("Agentic builder prompt is required.");
  }

  const profile = await getBuilderCliProfile(profileKey);
  if (!profile.enabled) {
    throw new Error(`Builder CLI profile is disabled: ${profile.displayName}`);
  }
  if (!profile.supportsNonInteractive) {
    throw new Error(`Builder CLI profile does not support non-interactive execution: ${profile.displayName}`);
  }
  if (!isProfileAvailable(profile)) {
    throw new Error(getAvailabilityReason(profile));
  }
  if (!isProfileReady(profile)) {
    throw new Error(getReadinessReason(profile));
  }

  switch (profile.key) {
    case "codex": {
      const args = [
        "exec",
        "--full-auto",
        "--sandbox",
        "workspace-write",
        "--skip-git-repo-check",
        "--color",
        "never",
        ...(input.model?.trim() ? ["--model", input.model.trim()] : []),
        ...(input.args ?? []),
        prompt,
      ];
      return {
        profile,
        command: profile.command,
        args,
      };
    }
    default:
      throw new Error(`Builder CLI profile is not wired for execution yet: ${profile.displayName}`);
  }
}

export async function executeBuilderAgenticTask(
  project: BuilderProject,
  input: BuilderAgenticTaskInput,
  options: BuilderAgenticTaskOptions = {},
) : Promise<BuilderAgenticTaskResult> {
  const config = getBuilderConfig();
  const basePrompt = sanitizePrompt(input.prompt);
  let currentPrompt = basePrompt;
  let previousSnapshot = snapshotWorkspace(project);
  let previousVerificationSignature: string | null = null;
  let lastExecution: BuilderAgenticTaskExecution | null = null;
  let lastResult: BuilderCommandResult | null = null;
  let lastVerification: BuilderAgenticVerificationReport | null = null;
  const iterations: BuilderAgenticIteration[] = [];
  const selectedScripts = listVerificationScripts(project);

  for (let iteration = 1; iteration <= MAX_AGENTIC_ITERATIONS; iteration += 1) {
    await emitProgress(options.onProgress, {
      loop: buildProgressLoop({
        phase: "acting",
        currentIteration: iteration,
        iterations,
        selectedScripts,
        summary: `Running builder attempt ${iteration} of ${MAX_AGENTIC_ITERATIONS}.`,
      }),
    });

    const execution = await buildBuilderAgenticExecution(project, {
      ...input,
      prompt: currentPrompt,
    });
    const result = await runBuilderCliCommand(execution.command, execution.args, {
      cwd: project.relativePath,
      timeoutSeconds: config.agenticTimeoutSeconds,
      signal: options.signal,
      onStdoutChunk: options.onStdoutChunk,
      onStderrChunk: options.onStderrChunk,
    });

    await emitProgress(options.onProgress, {
      loop: buildProgressLoop({
        phase: "verifying",
        currentIteration: iteration,
        iterations,
        selectedScripts,
        summary: `Builder attempt ${iteration} finished; running verification.`,
      }),
      latestResult: {
        stdout: result.stdout,
        stderr: result.stderr,
        ok: result.ok,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      },
    });

    const nextSnapshot = snapshotWorkspace(project);
    const changedFiles = diffWorkspaceSnapshots(previousSnapshot, nextSnapshot);
    const verification = await runProjectVerification(project, {
      signal: options.signal,
      onStdoutChunk: options.onStdoutChunk,
      onStderrChunk: options.onStderrChunk,
    });
    const verificationSignature = buildVerificationOutcomeSignature(verification);
    const review = decideBuilderLoopReviewVerdict({
      iteration,
      maxIterations: MAX_AGENTIC_ITERATIONS,
      actResult: result,
      verification,
      changedFiles,
      previousVerificationSignature,
      currentVerificationSignature: verificationSignature,
    });

    iterations.push({
      iteration,
      prompt: currentPrompt,
      command: execution.command,
      args: execution.args,
      actResult: {
        ok: result.ok,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        cwd: result.cwd,
        stdout: truncateForMetadata(result.stdout),
        stderr: truncateForMetadata(result.stderr),
      },
      verification,
      review,
      changedFiles,
    });

    const reviewLoop = buildProgressLoop({
      phase: review.verdict === "complete" || review.verdict === "cancelled" ? "complete" : "reviewing",
      currentIteration: iteration,
      iterations,
      selectedScripts: verification.scripts,
      summary: review.reason,
    });
    if (review.verdict === "complete") {
      reviewLoop.finalVerdict = "complete";
      reviewLoop.verified = !verification.skipped;
      reviewLoop.verificationSkipped = verification.skipped;
    } else if (review.verdict === "cancelled") {
      reviewLoop.finalVerdict = "cancelled";
    }

    await emitProgress(options.onProgress, {
      loop: reviewLoop,
      latestResult: {
        stdout: result.stdout,
        stderr: result.stderr,
        ok: result.ok,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      },
    });

    lastExecution = execution;
    lastResult = result;
    lastVerification = verification;

    if (review.verdict === "complete") {
      const loop: BuilderAgenticLoopMetadata = {
        maxIterations: MAX_AGENTIC_ITERATIONS,
        finalVerdict: "complete",
        verified: !verification.skipped,
        verificationSkipped: verification.skipped,
        selectedScripts: verification.scripts,
        summary: "",
        iterations,
      };
      loop.summary = buildBuilderLoopSummary(loop);

      return {
        profile: execution.profile,
        command: execution.command,
        args: execution.args,
        result,
        loop,
      };
    }

    if (review.verdict === "cancelled") {
      const loop: BuilderAgenticLoopMetadata = {
        maxIterations: MAX_AGENTIC_ITERATIONS,
        finalVerdict: "cancelled",
        verified: false,
        verificationSkipped: verification.skipped,
        selectedScripts: verification.scripts,
        summary: "",
        iterations,
      };
      loop.summary = buildBuilderLoopSummary(loop);

      return {
        profile: execution.profile,
        command: execution.command,
        args: execution.args,
        result,
        loop,
      };
    }

    previousVerificationSignature = verificationSignature;
    previousSnapshot = nextSnapshot;

    if (review.verdict !== "retry") {
      break;
    }

    currentPrompt = buildRepairPrompt(basePrompt, iteration, result, verification, changedFiles);
  }

  if (!lastExecution || !lastResult || !lastVerification) {
    throw new Error("Builder loop did not execute any iterations.");
  }

  const finalIteration = iterations[iterations.length - 1];
  const loop: BuilderAgenticLoopMetadata = {
    maxIterations: MAX_AGENTIC_ITERATIONS,
    finalVerdict: finalIteration?.review.verdict === "max_iterations" ? "max_iterations" : "blocked",
    verified: false,
    verificationSkipped: lastVerification.skipped,
    selectedScripts: lastVerification.scripts,
    summary: "",
    iterations,
  };
  loop.summary = buildBuilderLoopSummary(loop);

  return {
    profile: lastExecution.profile,
    command: lastExecution.command,
    args: lastExecution.args,
    result: lastResult,
    loop,
  };
}