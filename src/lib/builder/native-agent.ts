import { createHash } from "crypto";
import { existsSync } from "fs";
import path from "path";
import type { BuilderProject } from "@prisma/client";
import type { AgentExecutionEvent } from "@/lib/agent/executor";
import { getBuilderConfig, resolveBuilderWorkspacePath } from "@/lib/builder/config";
import { npmInstall, npmRunScript } from "@/lib/builder/adapters/npm";
import { pnpmInstall, pnpmRunScript } from "@/lib/builder/adapters/pnpm";
import {
  buildBuilderLoopSummary,
  buildRepairPrompt,
  buildVerificationOutcomeSignature,
  decideBuilderLoopReviewVerdict,
} from "@/lib/builder/loop-review";
import {
  listBuilderFilesRecursive,
  readBuilderFile,
  type BuilderCommandResult,
} from "@/lib/builder/workspace";
import type {
  BuilderAgenticIteration,
  BuilderAgenticLoopMetadata,
  BuilderAgenticProgressEvent,
  BuilderAgenticTaskOptions,
  BuilderAgenticUsageSummary,
  BuilderAgenticVerificationReport,
  BuilderAgenticVerificationStep,
} from "@/lib/builder/agentic";

const MAX_CHANGED_FILES = 20;
const MAX_SNAPSHOT_ENTRIES = 200;
const MAX_METADATA_OUTPUT_CHARS = 2_000;
const MAX_CAPTURED_OUTPUT_CHARS = 24_000;
const VERIFICATION_SCRIPT_ORDER = ["typecheck", "build", "test", "lint"] as const;
const VALIDATOR_SCRIPT_MAP = {
  TYPECHECK: ["typecheck"],
  BUILD: ["build"],
  TEST: ["test"],
  LINT: ["lint"],
} as const;

type VerificationScriptName = typeof VERIFICATION_SCRIPT_ORDER[number];

interface BuilderWorkspaceSnapshot {
  fingerprint: string;
  entries: Map<string, string>;
}

interface NativeBuilderTaskInput {
  prompt: string;
  builderMcpContext?: {
    projectId: string;
    builderRunId: string;
    taskId?: string | null;
    taskSpecId?: string | null;
    validatorContext?: string[];
    activeAdrDecisionKeys?: string[];
    ontologyHints?: string[];
  };
}

interface NativeBuilderTaskResult {
  result: BuilderCommandResult;
  loop: BuilderAgenticLoopMetadata;
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

function appendBoundedOutput(current: string, chunk: string): string {
  if (current.length >= MAX_CAPTURED_OUTPUT_CHARS) {
    return current;
  }

  const next = `${current}${chunk}`;
  if (next.length <= MAX_CAPTURED_OUTPUT_CHARS) {
    return next;
  }

  return `${next.slice(0, MAX_CAPTURED_OUTPUT_CHARS)}\n[truncated output]`;
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

function getProjectPackageJsonPath(project: BuilderProject): string {
  return `${project.relativePath.replace(/\/$/, "")}/package.json`;
}

function listAvailableVerificationScripts(project: BuilderProject): VerificationScriptName[] {
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

function normalizeVerificationValidators(validators?: readonly string[]): string[] {
  return Array.from(new Set((validators ?? [])
    .map((validator) => String(validator).trim().toUpperCase())
    .filter(Boolean)));
}

function resolveVerificationPlan(project: BuilderProject, options: BuilderAgenticTaskOptions): {
  scripts: VerificationScriptName[];
  skipped: boolean;
  summary?: string;
} {
  const availableScripts = listAvailableVerificationScripts(project);
  const mode = options.verification?.mode;
  const validators = normalizeVerificationValidators(options.verification?.validators);

  if (mode === "analysis_only") {
    return {
      scripts: [],
      skipped: true,
      summary: "Verification skipped for analysis_only task; defer validation to manual review.",
    };
  }

  if (validators.length === 0) {
    return {
      scripts: availableScripts,
      skipped: false,
    };
  }

  const deterministicValidators = validators.filter((validator) => validator !== "MANUAL_REVIEW");
  if (deterministicValidators.length === 0) {
    return {
      scripts: [],
      skipped: true,
      summary: "Verification skipped because the task only requires manual_review.",
    };
  }

  const requiredScripts = new Set<VerificationScriptName>();
  for (const validator of deterministicValidators) {
    for (const script of VALIDATOR_SCRIPT_MAP[validator as keyof typeof VALIDATOR_SCRIPT_MAP] ?? []) {
      if (availableScripts.includes(script)) {
        requiredScripts.add(script);
      }
    }
  }

  const scripts = VERIFICATION_SCRIPT_ORDER.filter((script) => requiredScripts.has(script));
  if (scripts.length === 0) {
    return {
      scripts: [],
      skipped: true,
      summary: `Verification skipped because no matching scripts were found for validators: ${deterministicValidators.map((validator) => validator.toLowerCase()).join(", ")}.`,
    };
  }

  return {
    scripts,
    skipped: false,
  };
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
  options: BuilderAgenticTaskOptions,
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

  const plan = resolveVerificationPlan(project, options);
  if (plan.skipped) {
    return {
      scripts: plan.scripts,
      steps: [],
      passed: true,
      skipped: true,
      summary: plan.summary ?? "Verification skipped.",
    };
  }

  const scripts = plan.scripts;
  if (scripts.length === 0) {
    return {
      scripts: [],
      steps: [],
      passed: true,
      skipped: true,
      summary: "No matching deterministic verification scripts found; verification skipped.",
    };
  }

  const nodeModulesPath = path.join(resolveBuilderWorkspacePath(project.relativePath), "node_modules");
  if (!existsSync(nodeModulesPath)) {
    const installResult = project.packageManager === "PNPM"
      ? await pnpmInstall(project.relativePath)
      : await npmInstall(project.relativePath);
    if (!installResult.ok) {
      return {
        scripts,
        steps: [{
          script: "install",
          ok: false,
          exitCode: installResult.exitCode,
          timedOut: installResult.timedOut,
          stdout: truncateForMetadata(installResult.stdout),
          stderr: truncateForMetadata(installResult.stderr),
        }],
        passed: false,
        skipped: false,
        summary: "Dependency installation failed before verification could run.",
      };
    }
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

function buildProgressLoop(args: {
  maxIterations: number;
  phase: BuilderAgenticLoopMetadata["phase"];
  currentIteration: number;
  iterations: BuilderAgenticIteration[];
  summary: string;
  selectedScripts: string[];
  usage?: BuilderAgenticUsageSummary;
}): BuilderAgenticLoopMetadata {
  return {
    maxIterations: args.maxIterations,
    verified: false,
    verificationSkipped: false,
    selectedScripts: args.selectedScripts,
    summary: args.summary,
    iterations: args.iterations,
    ...(args.usage ? { usage: args.usage } : {}),
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

async function emitLiveExecutionProgress(args: {
  onProgress: BuilderAgenticTaskOptions["onProgress"];
  maxIterations: number;
  iteration: number;
  iterations: BuilderAgenticIteration[];
  selectedScripts: string[];
  stdout: string;
  stderr: string;
  usage?: BuilderAgenticUsageSummary;
  summary?: string;
}): Promise<void> {
  await emitProgress(args.onProgress, {
    loop: buildProgressLoop({
      maxIterations: args.maxIterations,
      phase: "acting",
      currentIteration: args.iteration,
      iterations: args.iterations,
      selectedScripts: args.selectedScripts,
      usage: args.usage,
      summary: args.summary ?? `Native builder attempt ${args.iteration} is running.`,
    }),
    latestResult: {
      stdout: args.stdout,
      stderr: args.stderr,
      ok: false,
      exitCode: null,
      timedOut: false,
    },
  });
}

function emptyUsageSummary(): BuilderAgenticUsageSummary {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedPromptTokens: 0,
    requestCount: 0,
  };
}

function addUsageSummary(left: BuilderAgenticUsageSummary, right: BuilderAgenticUsageSummary): BuilderAgenticUsageSummary {
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    cachedPromptTokens: left.cachedPromptTokens + right.cachedPromptTokens,
    requestCount: left.requestCount + right.requestCount,
  };
}

function buildNativeBuilderMessage(project: BuilderProject, prompt: string): string {
  return [
    prompt,
    "",
    `Builder project id: ${project.id}`,
    `Builder project path: ${project.relativePath}`,
    "Operate only on this Builder project.",
    "Use builder_get_project first if you need project context, then use this exact projectId for all project-scoped builder_* tool calls.",
    "Do not call builder_plan_task, builder_continue_task, or builder_run_agentic_task.",
    "The outer Builder loop runs deterministic verification after you finish. Do not run build, test, lint, dev, or other validation scripts yourself unless the user explicitly asked you to change or inspect those scripts.",
    "Prefer the minimum tool sequence needed for the request. If the request names a specific file, inspect that file directly instead of broadly exploring the workspace.",
    "For file-edit tasks, prefer builder_read_file followed by builder_write_file. Once the requested content is present, stop using tools and return a concise implementation summary.",
    "If the requested change is already present, do not keep exploring. State that the workspace already satisfies the request and stop.",
      "Treat the [Plan Adherence] section in the prompt as a hard boundary. Do not broaden the task beyond its listed mode, decision keys, and directives.",
  ].join("\n");
}

function buildNativeResult(args: {
  project: BuilderProject;
  stdout: string;
  stderr: string;
  ok: boolean;
  timedOut: boolean;
  cancelled: boolean;
}): BuilderCommandResult {
  return {
    ok: args.ok,
    command: "bizbot-agent",
    args: ["builder_operator", args.project.id],
    cwd: args.project.relativePath,
    exitCode: args.ok ? 0 : null,
    signal: null,
    stdout: args.stdout,
    stderr: args.stderr,
    timedOut: args.timedOut,
    cancelled: args.cancelled,
  };
}

async function streamStdout(chunk: string, options: BuilderAgenticTaskOptions): Promise<void> {
  await options.onStdoutChunk?.(chunk);
}

async function streamStderr(chunk: string, options: BuilderAgenticTaskOptions): Promise<void> {
  await options.onStderrChunk?.(chunk);
}

export async function executeNativeBuilderTask(
  project: BuilderProject,
  input: NativeBuilderTaskInput,
  options: BuilderAgenticTaskOptions = {},
): Promise<NativeBuilderTaskResult> {
  const config = getBuilderConfig();
  const maxIterations = config.agenticMaxIterations;
  const basePrompt = sanitizePrompt(input.prompt);
  if (!basePrompt) {
    throw new Error("Builder task prompt is required.");
  }

  let currentPrompt = basePrompt;
  let previousSnapshot = snapshotWorkspace(project);
  let previousVerificationSignature: string | null = null;
  let lastResult: BuilderCommandResult | null = null;
  let lastVerification: BuilderAgenticVerificationReport | null = null;
  const iterations: BuilderAgenticIteration[] = [];
  const selectedScripts = resolveVerificationPlan(project, options).scripts;
  let aggregateUsage = emptyUsageSummary();
  let executeAgentConversation: ((typeof import("@/lib/agent/executor"))["executeAgentConversation"]) | null = null;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    await emitProgress(options.onProgress, {
      loop: buildProgressLoop({
        maxIterations,
        phase: "acting",
        currentIteration: iteration,
        iterations,
        selectedScripts,
        usage: aggregateUsage,
        summary: `Running native builder attempt ${iteration} of ${maxIterations}.`,
      }),
    });

    const executionSignal = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      executionSignal.abort(new Error("Builder agent timed out"));
    }, config.agenticTimeoutSeconds * 1000);
    const abortListener = () => executionSignal.abort(options.signal?.reason ?? new Error("Builder run was cancelled"));
    if (options.signal) {
      if (options.signal.aborted) {
        abortListener();
      } else {
        options.signal.addEventListener("abort", abortListener, { once: true });
      }
    }

    let stdout = "";
    let stderr = "";
    let reply = "";
    let provider = "unknown";
    let model = "unknown";
    let cancelled = false;
    let ok = false;
    let iterationUsage = emptyUsageSummary();

    const appendStdout = async (line: string) => {
      stdout = appendBoundedOutput(stdout, line);
      await streamStdout(line, options);
      await emitLiveExecutionProgress({
        onProgress: options.onProgress,
        maxIterations,
        iteration,
        iterations,
        selectedScripts,
        stdout,
        stderr,
        usage: addUsageSummary(aggregateUsage, iterationUsage),
      });
    };
    const appendStderr = async (line: string) => {
      stderr = appendBoundedOutput(stderr, line);
      await streamStderr(line, options);
      await emitLiveExecutionProgress({
        onProgress: options.onProgress,
        maxIterations,
        iteration,
        iterations,
        selectedScripts,
        stdout,
        stderr,
        usage: addUsageSummary(aggregateUsage, iterationUsage),
      });
    };

    try {
      await appendStdout(`[status] Starting native builder attempt ${iteration} of ${maxIterations}.\n`);
      if (!executeAgentConversation) {
        await appendStdout("[status] Loading shared agent executor.\n");
        ({ executeAgentConversation } = await import("@/lib/agent/executor"));
      }
      await appendStdout("[status] Dispatching builder operator conversation.\n");

      const agentResult = await executeAgentConversation({
        message: buildNativeBuilderMessage(project, currentPrompt),
        forcedProfile: "builder_operator",
        builderMcpContext: input.builderMcpContext,
        signal: executionSignal.signal,
        onEvent: async (event: AgentExecutionEvent) => {
          if (event.type === "meta") {
            provider = event.provider;
            model = event.model;
            await appendStdout(`[meta] ${event.profile} via ${event.provider}/${event.model}\n`);
            return;
          }
          if (event.type === "status") {
            await appendStdout(`[status] ${event.message}\n`);
            return;
          }
          if (event.type === "usage") {
            iterationUsage = addUsageSummary(iterationUsage, {
              promptTokens: event.promptTokens,
              completionTokens: event.completionTokens,
              totalTokens: event.totalTokens,
              cachedPromptTokens: event.cachedPromptTokens,
              requestCount: event.requestCount,
            });
            await appendStdout(`[usage] requests=${event.requestCount} total_tokens=${event.totalTokens}\n`);
            return;
          }
          if (event.type === "tool_call") {
            await appendStdout(`[tool_call] ${event.name} ${JSON.stringify(event.args)}\n`);
            return;
          }
          if (event.type === "tool_result") {
            await appendStdout(`[tool_result] ${event.name} ${truncateForMetadata(event.result)}\n`);
            return;
          }
          if (event.type === "assistant_message") {
            reply = event.content;
            await appendStdout(`[assistant] ${event.content}\n`);
            return;
          }
          if (event.type === "done") {
            reply = event.reply;
            return;
          }
          if (event.type === "error") {
            await appendStderr(`[error] ${event.error}\n`);
          }
        },
      });

      provider = agentResult.provider;
      model = agentResult.model;
      reply = agentResult.reply;
      ok = true;
    } catch (error) {
      cancelled = executionSignal.signal.aborted;
      await appendStderr(`${String(error)}\n`);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortListener);
    }

    const result = buildNativeResult({
      project,
      stdout: appendBoundedOutput(stdout, ok && reply ? `[final] ${reply}\n` : `provider=${provider} model=${model}\n`),
      stderr,
      ok,
      timedOut,
      cancelled,
    });

    await emitProgress(options.onProgress, {
      loop: buildProgressLoop({
        maxIterations,
        phase: "verifying",
        currentIteration: iteration,
        iterations,
        selectedScripts,
        usage: addUsageSummary(aggregateUsage, iterationUsage),
        summary: `Native builder attempt ${iteration} finished; running verification.`,
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
    const verification = await runProjectVerification(project, options);
    const verificationSignature = buildVerificationOutcomeSignature(verification);
    const review = decideBuilderLoopReviewVerdict({
      iteration,
      maxIterations,
      actResult: result,
      verification,
      changedFiles,
      previousVerificationSignature,
      currentVerificationSignature: verificationSignature,
    });
    aggregateUsage = addUsageSummary(aggregateUsage, iterationUsage);

    iterations.push({
      iteration,
      prompt: currentPrompt,
      command: `bizbot-agent:${provider}`,
      args: ["builder_operator", project.id, model],
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
      provider,
      model,
      usage: iterationUsage,
    });

    const reviewLoop = buildProgressLoop({
      maxIterations,
      phase: review.verdict === "complete" || review.verdict === "cancelled" ? "complete" : "reviewing",
      currentIteration: iteration,
      iterations,
      selectedScripts: verification.scripts,
      usage: aggregateUsage,
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

    lastResult = result;
    lastVerification = verification;

    if (review.verdict === "complete") {
      const loop: BuilderAgenticLoopMetadata = {
        maxIterations,
        finalVerdict: "complete",
        verified: !verification.skipped,
        verificationSkipped: verification.skipped,
        selectedScripts: verification.scripts,
        summary: "",
        iterations,
        usage: aggregateUsage,
      };
      loop.summary = buildBuilderLoopSummary(loop);
      return { result, loop };
    }

    if (review.verdict === "cancelled") {
      const loop: BuilderAgenticLoopMetadata = {
        maxIterations,
        finalVerdict: "cancelled",
        verified: false,
        verificationSkipped: verification.skipped,
        selectedScripts: verification.scripts,
        summary: "",
        iterations,
        usage: aggregateUsage,
      };
      loop.summary = buildBuilderLoopSummary(loop);
      return { result, loop };
    }

    if (review.verdict !== "retry") {
      const loop: BuilderAgenticLoopMetadata = {
        maxIterations,
        finalVerdict: review.verdict === "max_iterations" ? "max_iterations" : "blocked",
        verified: false,
        verificationSkipped: verification.skipped,
        selectedScripts: verification.scripts,
        summary: "",
        iterations,
        usage: aggregateUsage,
      };
      loop.summary = buildBuilderLoopSummary(loop);
      return { result, loop };
    }

    currentPrompt = buildRepairPrompt(basePrompt, iteration, result, verification, changedFiles);
    previousSnapshot = nextSnapshot;
    previousVerificationSignature = verificationSignature;
  }

  const fallbackResult = lastResult ?? buildNativeResult({
    project,
    stdout: "",
    stderr: "Builder loop exited before producing a result.",
    ok: false,
    timedOut: false,
    cancelled: false,
  });
  const fallbackVerification = lastVerification ?? {
    scripts: [],
    steps: [],
    passed: false,
    skipped: false,
    summary: "Verification did not run.",
  };

  const loop: BuilderAgenticLoopMetadata = {
    maxIterations,
    finalVerdict: fallbackResult.cancelled ? "cancelled" : "max_iterations",
    verified: false,
    verificationSkipped: fallbackVerification.skipped,
    selectedScripts: fallbackVerification.scripts,
    summary: "",
    iterations,
    usage: aggregateUsage,
  };
  loop.summary = buildBuilderLoopSummary(loop);

  return {
    result: fallbackResult,
    loop,
  };
}