import type { BuilderProject } from "@prisma/client";
import type { BuilderProjectCommandExecution } from "@/lib/builder/commands";
import { createBuilderRun, completeBuilderRun } from "@/lib/builder/projects";
import { runNpxPackage } from "@/lib/builder/adapters/npx-run";

export async function recordBuilderGeneratorCommand(
  project: BuilderProject,
  input: { action: "run_generator"; generator: string; args?: string[] },
): Promise<BuilderProjectCommandExecution & { runId: string }> {
  const generator = input.generator.trim();
  if (!generator) {
    throw new Error("Generator package is required.");
  }

  const args = [generator, ...(input.args ?? [])];
  const result = await runNpxPackage(project.relativePath, args);
  const title = `Run generator: ${generator}`;

  const run = await createBuilderRun({
    projectId: project.id,
    kind: "GENERATOR",
    title,
    command: "npx",
    args,
  });

  await completeBuilderRun(run.id, {
    status: result.ok ? "SUCCEEDED" : "FAILED",
    stdout: result.stdout,
    stderr: result.stderr,
    summary: result.ok ? `${title} completed.` : `${title} failed with exit code ${result.exitCode ?? "unknown"}.`,
    metadata: {
      timedOut: result.timedOut,
      exitCode: result.exitCode,
      signal: result.signal,
      cwd: result.cwd,
    },
  });

  return {
    kind: "GENERATOR",
    title,
    command: "npx",
    args,
    result,
    runId: run.id,
  };
}