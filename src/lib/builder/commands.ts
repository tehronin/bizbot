import type { BuilderProject, BuilderRunKind } from "@prisma/client";
import { gitInitRepository } from "@/lib/builder/adapters/git";
import { buildBuilderAgenticExecution, executeBuilderAgenticTask } from "@/lib/builder/agentic";
import { npmInstall, npmRunScript } from "@/lib/builder/adapters/npm";
import { pnpmInstall, pnpmRunScript } from "@/lib/builder/adapters/pnpm";
import { runNpxPackage } from "@/lib/builder/adapters/npx";
import { completeBuilderRun, createBuilderRun, getBuilderRun, updateBuilderProject, updateBuilderRun } from "@/lib/builder/projects";
import { cancelBuilderRunController, registerBuilderRunController, unregisterBuilderRunController } from "@/lib/builder/session";
import { updateBuilderTask } from "@/lib/builder/tasks";
import type { BuilderCommandResult } from "@/lib/builder/workspace";

const MAX_PROGRESS_OUTPUT_CHARS = 24_000;
const PROGRESS_FLUSH_INTERVAL_MS = 250;

export type BuilderProjectCommandInput =
  | { action: "initialize_git" }
  | { action: "install_dependencies"; packages?: string[]; dev?: boolean }
  | { action: "add_dependency"; packages: string[]; dev?: boolean }
  | { action: "run_script"; script: string; args?: string[] }
  | { action: "run_generator"; generator: string; args?: string[] }
  | { action: "run_agentic_task"; profile?: string; prompt: string; model?: string; args?: string[] };

export interface BuilderProjectCommandExecution {
  kind: BuilderRunKind;
  title: string;
  command: string;
  args: string[];
  result: BuilderCommandResult;
  summary?: string;
  finalStatus?: "SUCCEEDED" | "FAILED" | "CANCELLED";
  projectUpdates?: { gitInitialized?: boolean };
  metadata?: Record<string, unknown>;
}

export interface BuilderProjectCommandLaunch {
  runId: string;
  title: string;
  command: string;
  args: string[];
  status: "RUNNING";
}

function getAgenticFinalStatus(finalVerdict: string | undefined): "SUCCEEDED" | "FAILED" | "CANCELLED" {
  if (finalVerdict === "complete") {
    return "SUCCEEDED";
  }
  if (finalVerdict === "cancelled") {
    return "CANCELLED";
  }
  return "FAILED";
}

function appendProgressOutput(current: string, chunk: string): string {
  if (current.length >= MAX_PROGRESS_OUTPUT_CHARS) {
    return current;
  }

  const next = `${current}${chunk}`;
  if (next.length <= MAX_PROGRESS_OUTPUT_CHARS) {
    return next;
  }

  return `${next.slice(0, MAX_PROGRESS_OUTPUT_CHARS)}\n[truncated output]`;
}

function assertPackages(packages: string[] | undefined, message: string): string[] {
  const filtered = (packages ?? []).map((value) => value.trim()).filter(Boolean);
  if (filtered.length === 0) {
    throw new Error(message);
  }
  return filtered;
}

async function installForProject(project: BuilderProject, packages?: string[], options?: { dev?: boolean }): Promise<BuilderCommandResult> {
  return project.packageManager === "PNPM"
    ? pnpmInstall(project.relativePath, packages, options)
    : npmInstall(project.relativePath, packages, options);
}

async function runScriptForProject(project: BuilderProject, script: string, extraArgs?: string[]): Promise<BuilderCommandResult> {
  return project.packageManager === "PNPM"
    ? pnpmRunScript(project.relativePath, script, extraArgs)
    : npmRunScript(project.relativePath, script, extraArgs);
}

export async function executeBuilderProjectCommand(
  project: BuilderProject,
  input: BuilderProjectCommandInput,
): Promise<BuilderProjectCommandExecution> {
  switch (input.action) {
    case "initialize_git": {
      const result = await gitInitRepository(project.relativePath);
      return {
        kind: "GIT_INIT",
        title: "Initialize git repository",
        command: "git",
        args: ["init"],
        result,
        projectUpdates: result.ok ? { gitInitialized: true } : undefined,
      };
    }
    case "install_dependencies": {
      const packages = input.packages?.map((value) => value.trim()).filter(Boolean);
      const result = await installForProject(project, packages, { dev: input.dev });
      return {
        kind: "INSTALL",
        title: packages && packages.length > 0 ? `Install ${packages.join(", ")}` : "Install project dependencies",
        command: project.packageManager === "PNPM" ? "pnpm" : "npm",
        args: project.packageManager === "PNPM"
          ? [packages && packages.length > 0 ? "add" : "install", ...(input.dev ? ["--save-dev"] : []), ...(packages ?? [])]
          : ["install", ...(input.dev ? ["--save-dev"] : []), ...(packages ?? [])],
        result,
      };
    }
    case "add_dependency": {
      const packages = assertPackages(input.packages, "Packages are required to add dependencies.");
      const result = await installForProject(project, packages, { dev: input.dev });
      return {
        kind: "INSTALL",
        title: `Add dependencies: ${packages.join(", ")}`,
        command: project.packageManager === "PNPM" ? "pnpm" : "npm",
        args: project.packageManager === "PNPM"
          ? ["add", ...(input.dev ? ["--save-dev"] : []), ...packages]
          : ["install", ...(input.dev ? ["--save-dev"] : []), ...packages],
        result,
      };
    }
    case "run_script": {
      const script = input.script.trim();
      if (!script) {
        throw new Error("Script name is required.");
      }
      const result = await runScriptForProject(project, script, input.args ?? []);
      return {
        kind: "SCRIPT",
        title: `Run script: ${script}`,
        command: project.packageManager === "PNPM" ? "pnpm" : "npm",
        args: project.packageManager === "PNPM" ? [script, ...(input.args ?? [])] : ["run", script, ...(input.args ?? [])],
        result,
      };
    }
    case "run_generator": {
      const generator = input.generator.trim();
      if (!generator) {
        throw new Error("Generator package is required.");
      }
      const args = [generator, ...(input.args ?? [])];
      const result = await runNpxPackage(project.relativePath, args);
      return {
        kind: "GENERATOR",
        title: `Run generator: ${generator}`,
        command: "npx",
        args,
        result,
      };
    }
    case "run_agentic_task": {
      const execution = await executeBuilderAgenticTask(project, input);
      return {
        kind: "AGENTIC",
        title: `Run ${execution.profile.displayName} task`,
        command: execution.command,
        args: execution.args,
        result: execution.result,
        summary: execution.loop.summary,
        finalStatus: getAgenticFinalStatus(execution.loop.finalVerdict),
        metadata: {
          profileKey: execution.profile.key,
          profileLabel: execution.profile.displayName,
          requestedModel: input.model?.trim() || null,
          loop: execution.loop,
        },
      };
    }
  }
}

export async function recordBuilderProjectCommand(
  project: BuilderProject,
  input: BuilderProjectCommandInput,
): Promise<BuilderProjectCommandExecution & { runId: string }> {
  const execution = await executeBuilderProjectCommand(project, input);
  const run = await createBuilderRun({
    projectId: project.id,
    kind: execution.kind,
    title: execution.title,
    command: execution.command,
    args: execution.args,
    metadata: execution.metadata,
  });

  if (execution.projectUpdates) {
    await updateBuilderProject(project.id, execution.projectUpdates);
  }

  await completeBuilderRun(run.id, {
    status: execution.finalStatus ?? (execution.result.ok ? "SUCCEEDED" : "FAILED"),
    stdout: execution.result.stdout,
    stderr: execution.result.stderr,
    summary: execution.summary ?? (execution.result.ok ? `${execution.title} completed.` : `${execution.title} failed with exit code ${execution.result.exitCode ?? "unknown"}.`),
    metadata: {
      ...execution.metadata,
      timedOut: execution.result.timedOut,
      exitCode: execution.result.exitCode,
      signal: execution.result.signal,
      cwd: execution.result.cwd,
    },
  });

  return { ...execution, runId: run.id };
}

export async function launchBuilderProjectCommand(
  project: BuilderProject,
  input: Extract<BuilderProjectCommandInput, { action: "run_agentic_task" }>,
): Promise<BuilderProjectCommandLaunch> {
  const preview = await buildBuilderAgenticExecution(project, input);
  const title = `Run ${preview.profile.displayName} task`;
  const baseMetadata = {
    profileKey: preview.profile.key,
    profileLabel: preview.profile.displayName,
    requestedModel: input.model?.trim() || null,
  };

  const run = await createBuilderRun({
    projectId: project.id,
    kind: "AGENTIC",
    title,
    command: preview.command,
    args: preview.args,
    metadata: {
      ...baseMetadata,
      loop: {
        maxIterations: 3,
        summary: "Queued builder task.",
        iterations: [],
      },
    },
  });

  const abortController = new AbortController();
  registerBuilderRunController(run.id, abortController);

  let streamedStdout = "";
  let streamedStderr = "";
  let latestLoop: Record<string, unknown> | undefined;
  let latestSummary = "Queued builder task.";
  let flushTimer: NodeJS.Timeout | null = null;
  let flushPromise: Promise<void> | null = null;

  const flushProgress = async (): Promise<void> => {
    if (flushPromise) {
      await flushPromise;
      return;
    }

    flushPromise = updateBuilderRun(run.id, {
      stdout: streamedStdout || undefined,
      stderr: streamedStderr || undefined,
      summary: latestSummary,
      metadata: {
        ...baseMetadata,
        ...(latestLoop ? { loop: latestLoop } : {}),
      },
    }).then(() => undefined).finally(() => {
      flushPromise = null;
    });

    await flushPromise;
  };

  const scheduleFlush = (): void => {
    if (flushTimer) {
      return;
    }

    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushProgress();
    }, PROGRESS_FLUSH_INTERVAL_MS);
  };

  void executeBuilderAgenticTask(project, input, {
    signal: abortController.signal,
    onStdoutChunk: async (chunk) => {
      streamedStdout = appendProgressOutput(streamedStdout, chunk);
      scheduleFlush();
    },
    onStderrChunk: async (chunk) => {
      streamedStderr = appendProgressOutput(streamedStderr, chunk);
      scheduleFlush();
    },
    onProgress: async ({ loop, latestResult }) => {
      latestLoop = loop as unknown as Record<string, unknown>;
      latestSummary = loop.summary;
      if (latestResult?.stdout !== undefined) {
        streamedStdout = latestResult.stdout;
      }
      if (latestResult?.stderr !== undefined) {
        streamedStderr = latestResult.stderr;
      }
      scheduleFlush();
    },
  }).then(async (execution) => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flushProgress();
    await completeBuilderRun(run.id, {
      status: getAgenticFinalStatus(execution.loop.finalVerdict),
      stdout: execution.result.stdout,
      stderr: execution.result.stderr,
      summary: execution.loop.summary,
      metadata: {
        ...baseMetadata,
        loop: execution.loop,
        timedOut: execution.result.timedOut,
        exitCode: execution.result.exitCode,
        signal: execution.result.signal,
        cwd: execution.result.cwd,
      },
    });
    unregisterBuilderRunController(run.id);
  }).catch(async (error) => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flushProgress();
    await completeBuilderRun(run.id, {
      status: abortController.signal.aborted ? "CANCELLED" : "FAILED",
      stderr: String(error),
      summary: abortController.signal.aborted ? `${title} cancelled.` : `${title} failed: ${String(error)}`,
      metadata: {
        ...baseMetadata,
        ...(latestLoop ? { loop: latestLoop } : {}),
      },
    });
    unregisterBuilderRunController(run.id);
  });

  return {
    runId: run.id,
    title,
    command: preview.command,
    args: preview.args,
    status: "RUNNING",
  };
}

export async function cancelBuilderProjectRun(runId: string): Promise<{ runId: string; status: "CANCELLED" | "NOT_RUNNING" }> {
  const cancelled = cancelBuilderRunController(runId);
  const run = await getBuilderRun(runId);
  if (run.status !== "RUNNING") {
    return { runId, status: "NOT_RUNNING" };
  }

  if (cancelled) {
    await updateBuilderRun(runId, {
      summary: "Cancellation requested.",
    });
    return { runId, status: "CANCELLED" };
  }

  await completeBuilderRun(runId, {
    status: "CANCELLED",
    summary: "Cancelled after the live Builder controller was no longer attached to this run.",
    metadata: {
      ...(run.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata) ? run.metadata as Record<string, unknown> : {}),
      cancellationReason: "missing_live_controller",
    },
  });

  if (run.taskId) {
    await updateBuilderTask(run.taskId, {
      status: "CANCELLED",
      summary: "Cancelled after the live Builder controller was no longer attached to the run.",
    }).catch(() => undefined);
  }

  return { runId, status: "CANCELLED" };
}