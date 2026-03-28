import { runBuilderCommand, type BuilderCommandResult } from "@/lib/builder/workspace";

export async function pnpmInstall(cwd: string, packages?: string[], options?: { dev?: boolean }): Promise<BuilderCommandResult> {
  const args = [packages && packages.length > 0 ? "add" : "install", ...(options?.dev ? ["--save-dev"] : []), ...(packages ?? [])];
  return runBuilderCommand("pnpm", args, { cwd });
}

export async function pnpmRunScript(cwd: string, script: string, extraArgs: string[] = []): Promise<BuilderCommandResult> {
  return runBuilderCommand("pnpm", [script, ...extraArgs], { cwd });
}