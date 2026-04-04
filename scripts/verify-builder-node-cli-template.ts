import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scaffoldBuilderNodePackage } from "../src/lib/builder/workspace";

function run(command: string, args: string[], cwd: string): void {
  const result = process.platform === "win32" && command === "npm"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", command, ...args], {
      cwd,
      stdio: "inherit",
    })
    : spawnSync(command, args, {
      cwd,
      stdio: "inherit",
    });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-builder-template-"));
process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

const scaffold = scaffoldBuilderNodePackage({
  projectDir: "projects/node-cli-ci",
  packageName: "node-cli-ci",
  description: "CI verification scaffold for the Builder node-cli template.",
});

const projectRoot = path.join(workspaceRoot, "projects", "node-cli-ci");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};

if (packageJson.scripts?.typecheck !== "tsc --noEmit -p tsconfig.json") {
  throw new Error("Expected node-cli scaffold to expose a deterministic typecheck script.");
}
if (packageJson.scripts?.start !== "node dist/index.js") {
  throw new Error("Expected node-cli scaffold to keep start pointing at dist output.");
}
if (packageJson.devDependencies?.["@types/node"] !== "^24.0.0") {
  throw new Error("Expected node-cli scaffold to include Node type definitions for runtime-oriented TypeScript code.");
}

console.log(`Scaffolded ${scaffold.root}`);
run("npm", ["install", "--no-fund", "--no-audit"], projectRoot);
run("npm", ["run", "typecheck"], projectRoot);
run("npm", ["run", "build"], projectRoot);

console.log("node-cli Builder template verification passed.");