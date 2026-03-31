import { runBuilderCommand, type BuilderCommandOptions, type BuilderCommandResult } from "@/lib/builder/workspace";

export async function npmInstall(cwd: string, packages?: string[], options?: { dev?: boolean }): Promise<BuilderCommandResult> {
  const args = ["install", ...(options?.dev ? ["--save-dev"] : []), ...(packages ?? [])];
  return runBuilderCommand("npm", args, { cwd });
}

export async function npmRunScript(cwd: string, script: string, extraArgs: string[] = [], options?: Omit<BuilderCommandOptions, "cwd">): Promise<BuilderCommandResult> {
  return runBuilderCommand("npm", ["run", script, ...extraArgs], { cwd, ...options });
}