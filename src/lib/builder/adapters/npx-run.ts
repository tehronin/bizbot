import { runBuilderCommand, type BuilderCommandResult } from "@/lib/builder/workspace";

export async function runNpxPackage(cwd: string, args: string[]): Promise<BuilderCommandResult> {
  return runBuilderCommand("npx", args, { cwd, timeoutSeconds: 600 });
}