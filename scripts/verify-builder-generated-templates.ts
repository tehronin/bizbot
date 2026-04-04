import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BuilderProject } from "@prisma/client";
import { bootstrapBuilderProject } from "../src/lib/builder/templates";

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

function makeProject(template: "node-cli" | "plugin-package", slug: string): BuilderProject {
  return {
    id: `${template}-${slug}`,
    name: slug,
    slug,
    relativePath: `projects/${slug}`,
    template,
    packageManager: "NPM",
    gitInitialized: false,
    lifecycle: "DRAFT",
    lastRunStatus: "IDLE",
    context: null,
    latestSessionSummary: null,
    createdAt: new Date("2026-04-04T00:00:00.000Z"),
    updatedAt: new Date("2026-04-04T00:00:00.000Z"),
  };
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function verifyNodeCli(projectRoot: string): void {
  const packageJson = readJson<{
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(path.join(projectRoot, "package.json"));

  if (packageJson.scripts?.typecheck !== "tsc --noEmit -p tsconfig.json") {
    throw new Error("Expected node-cli scaffold to expose a deterministic typecheck script.");
  }
  if (packageJson.scripts?.start !== "node dist/index.js") {
    throw new Error("Expected node-cli scaffold to keep start pointing at dist output.");
  }
  if (packageJson.devDependencies?.["@types/node"] !== "^24.0.0") {
    throw new Error("Expected node-cli scaffold to include Node type definitions.");
  }
  if (!fs.existsSync(path.join(projectRoot, "src", "index.ts"))) {
    throw new Error("Expected node-cli scaffold to emit src/index.ts.");
  }
}

function verifyPluginPackage(projectRoot: string, slug: string): void {
  const packageJson = readJson<{
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(path.join(projectRoot, "package.json"));
  const pluginSource = fs.readFileSync(path.join(projectRoot, "src", "plugin.ts"), "utf8");
  const pluginTest = fs.readFileSync(path.join(projectRoot, "tests", "plugin.test.ts"), "utf8");

  if (packageJson.scripts?.typecheck !== "tsc --noEmit -p tsconfig.json") {
    throw new Error("Expected plugin-package scaffold to expose a deterministic typecheck script.");
  }
  if (packageJson.scripts?.start !== "node dist/plugin.js") {
    throw new Error("Expected plugin-package scaffold to keep start pointing at dist output.");
  }
  if (packageJson.devDependencies?.["@types/node"] !== "^24.0.0") {
    throw new Error("Expected plugin-package scaffold to include Node type definitions.");
  }
  if (!pluginSource.includes("export function registerPlugin(): string")) {
    throw new Error("Expected plugin-package scaffold to export registerPlugin.");
  }
  if (!pluginTest.includes(`expect(pluginName).toBe("${slug}")`)) {
    throw new Error("Expected plugin-package scaffold test to pin the generated plugin name.");
  }
}

async function verifyTemplate(template: "node-cli" | "plugin-package", slug: string): Promise<void> {
  const project = makeProject(template, slug);
  const bootstrap = await bootstrapBuilderProject(project);
  const projectRoot = path.join(process.env.BIZBOT_BUILDER_WORKSPACE_PATH!, project.relativePath.replace(/\//g, path.sep));

  console.log(`Scaffolded ${bootstrap.root}`);
  if (template === "node-cli") {
    verifyNodeCli(projectRoot);
  } else {
    verifyPluginPackage(projectRoot, slug);
  }

  run("npm", ["install", "--no-fund", "--no-audit"], projectRoot);
  run("npm", ["run", "typecheck"], projectRoot);
  run("npm", ["run", "build"], projectRoot);
}

async function main(): Promise<void> {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-builder-templates-"));
  process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";

  await verifyTemplate("node-cli", "node-cli-ci");
  await verifyTemplate("plugin-package", "plugin-package-ci");

  console.log("Builder generated template verification passed.");
}

void main();
