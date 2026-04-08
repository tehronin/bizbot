import { runBuilderCliCommand, type BuilderCommandResult } from "@/lib/builder/workspace";
export { runNpxPackage } from "@/lib/builder/adapters/npx-run";

export async function runNpmCreatePackage(
  cwd: string,
  initializer: string,
  args: string[],
): Promise<BuilderCommandResult> {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  return runBuilderCliCommand(npmCommand, ["create", initializer, ".", "--", ...args], {
    cwd,
    timeoutSeconds: 600,
  });
}