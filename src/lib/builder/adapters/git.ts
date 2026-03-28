import { runBuilderCommand, type BuilderCommandResult } from "@/lib/builder/workspace";

export async function gitInitRepository(cwd: string): Promise<BuilderCommandResult> {
  return runBuilderCommand("git", ["init"], { cwd });
}