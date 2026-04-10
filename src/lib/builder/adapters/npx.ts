import { runBuilderCliCommand, type BuilderCommandResult } from "@/lib/builder/workspace";
export { runNpxPackage } from "@/lib/builder/adapters/npx-run";

export async function runNpmCreatePackage(
  cwd: string,
  initializer: string,
  targetDir: string,
  args: string[],
): Promise<BuilderCommandResult> {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = await runBuilderCliCommand(npmCommand, ["create", initializer, targetDir, "--", ...args], {
    cwd,
    timeoutSeconds: 600,
  });

  if (!result.ok) {
    const failureReason = result.timedOut
      ? "timed out"
      : result.cancelled
        ? "was cancelled"
        : `failed with exit code ${result.exitCode ?? "unknown"}`;
    const stderr = result.stderr.trim();
    throw new Error(`npm create ${initializer} ${failureReason}.${stderr ? `\n${stderr}` : ""}`);
  }

  return result;
}