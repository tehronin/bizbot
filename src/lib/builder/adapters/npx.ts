import fs from "fs";
import path from "path";
import { runBuilderCliCommand, runBuilderCommand, type BuilderCommandResult } from "@/lib/builder/workspace";

function resolveNpmCliPath(): string {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    const normalizedExecPath = npmExecPath.endsWith("npx-cli.js")
      ? npmExecPath.replace(/npx-cli\.js$/, "npm-cli.js")
      : npmExecPath;
    if (fs.existsSync(normalizedExecPath)) {
      return normalizedExecPath;
    }
  }

  const candidates = [
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Unable to resolve npm CLI path for Builder scaffold commands.");
}

export async function runNpxPackage(cwd: string, args: string[]): Promise<BuilderCommandResult> {
  return runBuilderCommand("npx", args, { cwd, timeoutSeconds: 600 });
}

export async function runNpmCreatePackage(
  cwd: string,
  initializer: string,
  args: string[],
): Promise<BuilderCommandResult> {
  return runBuilderCliCommand(process.execPath, [resolveNpmCliPath(), "create", initializer, ".", "--", ...args], {
    cwd,
    timeoutSeconds: 600,
  });
}