import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BUILDER_TEMPLATE_VERIFICATION_CONTRACTS, type BuilderTemplateVerificationContract } from "../src/lib/builder/template-presets";
import {
  bootstrapBuilderProject,
} from "../src/lib/builder/template-bootstrap";

type BuilderProject = Parameters<typeof bootstrapBuilderProject>[0];

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

function makeProject(template: "node-cli" | "plugin-package" | "vite-app" | "next-app", slug: string): BuilderProject {
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

function verifyRequiredFiles(projectRoot: string, contract: BuilderTemplateVerificationContract): void {
  for (const requiredFile of contract.requiredFiles) {
    if (!fs.existsSync(path.join(projectRoot, requiredFile))) {
      throw new Error(`Expected scaffold to include ${requiredFile}.`);
    }
  }
}

function verifyMcpPolicy(projectRoot: string, template: string): void {
  const policy = readJson<{
    version: number;
    template: string;
    packageManager: string;
    expectedMcpContractHash: string;
    policyHashVersion: number;
    allowedToolCategories: string[];
    decisionKeys: string[];
  }>(path.join(projectRoot, ".builder", "mcp-policy.json"));

  if (policy.version !== 1 || policy.policyHashVersion !== 1) {
    throw new Error("Expected scaffolded MCP policy artifact to use version 1.");
  }
  if (policy.template !== template) {
    throw new Error(`Expected scaffolded MCP policy artifact to record template ${template}.`);
  }
  if (!policy.expectedMcpContractHash || policy.expectedMcpContractHash.length < 32) {
    throw new Error("Expected scaffolded MCP policy artifact to include a deterministic MCP contract hash.");
  }
  if (!policy.allowedToolCategories.includes("builder_scaffold")) {
    throw new Error("Expected scaffolded MCP policy artifact to include builder_scaffold among allowed tool categories.");
  }
  if (!policy.decisionKeys.includes("mcp_control_plane")) {
    throw new Error("Expected scaffolded MCP policy artifact to seed mcp_control_plane governance.");
  }
}

function verifyRequiredPackageJsonFields(
  projectRoot: string,
  contract: BuilderTemplateVerificationContract,
): { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } {
  const packageJson = readJson<{
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(path.join(projectRoot, "package.json"));

  for (const script of contract.requiredScripts) {
    if (!packageJson.scripts?.[script]) {
      throw new Error(`Expected scaffold to expose a ${script} script.`);
    }
  }
  for (const dependency of contract.requiredDependencies ?? []) {
    if (!packageJson.dependencies?.[dependency]) {
      throw new Error(`Expected scaffold to include dependency ${dependency}.`);
    }
  }
  for (const dependency of contract.requiredDevDependencies ?? []) {
    if (!packageJson.devDependencies?.[dependency]) {
      throw new Error(`Expected scaffold to include devDependency ${dependency}.`);
    }
  }

  return packageJson;
}

function verifyNodeCli(projectRoot: string): void {
  const contract = BUILDER_TEMPLATE_VERIFICATION_CONTRACTS["node-cli"];
  verifyRequiredFiles(projectRoot, contract);
  verifyRequiredPackageJsonFields(projectRoot, contract);
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
  const contract = BUILDER_TEMPLATE_VERIFICATION_CONTRACTS["plugin-package"];
  const packageJson = verifyRequiredPackageJsonFields(projectRoot, contract);
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

function verifyNextApp(projectRoot: string): void {
  const contract = BUILDER_TEMPLATE_VERIFICATION_CONTRACTS["next-app"];
  verifyRequiredFiles(projectRoot, contract);
  verifyRequiredPackageJsonFields(projectRoot, contract);
  verifyMcpPolicy(projectRoot, "next-app");
}

function verifyViteApp(projectRoot: string): void {
  const contract = BUILDER_TEMPLATE_VERIFICATION_CONTRACTS["vite-app"];
  verifyRequiredFiles(projectRoot, contract);
  verifyRequiredPackageJsonFields(projectRoot, contract);
  verifyMcpPolicy(projectRoot, "vite-app");
}

function verifyTemplateContract(template: "node-cli" | "plugin-package" | "vite-app" | "next-app", projectRoot: string, slug: string): void {
  if (template === "node-cli") {
    verifyNodeCli(projectRoot);
    verifyMcpPolicy(projectRoot, template);
    return;
  }
  if (template === "plugin-package") {
    verifyPluginPackage(projectRoot, slug);
    verifyMcpPolicy(projectRoot, template);
    return;
  }
  if (template === "vite-app") {
    verifyViteApp(projectRoot);
    return;
  }
  verifyNextApp(projectRoot);
}

async function verifyTemplate(template: "node-cli" | "plugin-package" | "vite-app" | "next-app", slug: string): Promise<void> {
  const project = makeProject(template, slug);
  const bootstrap = await bootstrapBuilderProject(project);
  const projectRoot = path.join(process.env.BIZBOT_BUILDER_WORKSPACE_PATH!, project.relativePath.replace(/\//g, path.sep));
  const contract = BUILDER_TEMPLATE_VERIFICATION_CONTRACTS[template];

  console.log(`Scaffolded ${bootstrap.root}`);
  verifyTemplateContract(template, projectRoot, slug);

  for (const check of contract.deterministicChecks) {
    if (check.runner === "npm") {
      run("npm", check.args, projectRoot);
      continue;
    }
    run("npx", check.args, projectRoot);
  }
}

async function main(): Promise<void> {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-builder-templates-"));
  process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";

  await verifyTemplate("node-cli", "node-cli-ci");
  await verifyTemplate("plugin-package", "plugin-package-ci");
  await verifyTemplate("vite-app", "vite-app-ci");
  await verifyTemplate("next-app", "next-app-ci");

  console.log("Builder generated template verification passed.");
}

void main();
