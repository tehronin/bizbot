import type { BuilderProject, BuilderRunKind } from "@prisma/client";
import { gitInitRepository } from "@/lib/builder/adapters/git";
import { executeBuilderAgenticTask } from "@/lib/builder/agentic";
import { npmInstall, npmRunScript } from "@/lib/builder/adapters/npm";
import { pnpmInstall, pnpmRunScript } from "@/lib/builder/adapters/pnpm";
import { runNpxPackage } from "@/lib/builder/adapters/npx";
import { completeBuilderRun, createBuilderRun, updateBuilderProject } from "@/lib/builder/projects";
import type { BuilderCommandResult } from "@/lib/builder/workspace";

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
  projectUpdates?: { gitInitialized?: boolean };
  metadata?: Record<string, unknown>;
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
        metadata: {
          profileKey: execution.profile.key,
          profileLabel: execution.profile.displayName,
          requestedModel: input.model?.trim() || null,
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
    status: execution.result.ok ? "SUCCEEDED" : "FAILED",
    stdout: execution.result.stdout,
    stderr: execution.result.stderr,
    summary: execution.result.ok ? `${execution.title} completed.` : `${execution.title} failed with exit code ${execution.result.exitCode ?? "unknown"}.`,
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