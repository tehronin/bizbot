import fs from "fs";
import os from "os";
import path from "path";
import type { BuilderProject } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runNpmCreatePackage } from "@/lib/builder/adapters/npx";
import { BUILDER_TEMPLATE_VERIFICATION_CONTRACTS } from "@/lib/builder/template-presets";

vi.mock("@/lib/db", () => ({
  db: {
    builderTemplatePreset: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/builder/adapters/npx", () => ({
  runNpmCreatePackage: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/agent/runtime", () => ({
  getAgentRuntimeConfig: () => ({ autonomyPreset: "approval_all_posts" }),
  getAgentCapabilities: () => ({ promptAssembly: true, toolExecution: true }),
}));
vi.mock("@/lib/mcp/tool-presentation", () => ({
  MCP_AGENT_PROFILE: "builder_operator",
}));
vi.mock("@/lib/mcp/client", () => ({
  getMcpClientPrompts: () => [],
  getMcpClientResources: () => [],
}));
vi.mock("@/lib/mcp/preview-catalog", () => ({
  listCurrentMcpToolDescriptors: () => [],
  listBizBotPromptDefinitions: () => [],
  listBizBotResourceDefinitions: () => [],
}));
vi.mock("@/lib/platform/contract", () => ({
  buildBizBotPlatformContractSnapshot: () => ({
    version: "v1",
    compatibilityPolicyVersion: "v1",
    mcpLane: "builder_operator",
    blockedTools: [],
    promptsAreServerOwned: true,
    resourcesAreServerOwned: true,
    importedCatalogs: { prompts: true, resources: true },
    toolOwnershipRequired: true,
    laneBoundedExposure: true,
  }),
  classifyBizBotContractDrift: () => ({
    level: "internal_only",
    requiresVersionBump: false,
    summary: "none",
  }),
}));
vi.mock("@/lib/mcp/jobs", () => ({
  enqueueMcpCleanupJob: vi.fn(),
  enqueueMcpEmbeddingJob: vi.fn(),
  shouldEnqueueMcpSnapshotJobs: () => false,
}));
vi.mock("@/lib/embeddings/embed", () => ({
  embed: vi.fn(),
  formatEmbedding: vi.fn(),
}));
import { bootstrapBuilderProject } from "@/lib/builder/template-bootstrap";

function createTempBuilderWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-builder-templates-"));
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

afterEach(() => {
  delete process.env.BIZBOT_BUILDER_WORKSPACE_PATH;
  vi.clearAllMocks();
});

describe("builder template bootstraps", () => {
  it("bootstraps the node-cli preset with dist-based scripts", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const project = makeProject("node-cli", "node-cli-test");
    const bootstrap = await bootstrapBuilderProject(project);
    const projectRoot = path.join(workspaceRoot, "projects", "node-cli-test");
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const composeFile = fs.readFileSync(path.join(projectRoot, "compose.yml"), "utf8");

    expect(bootstrap.files).toEqual(expect.arrayContaining([
      "projects/node-cli-test/package.json",
      "projects/node-cli-test/src/index.ts",
      "projects/node-cli-test/Dockerfile",
      "projects/node-cli-test/compose.yml",
      "projects/node-cli-test/.dockerignore",
      "projects/node-cli-test/.builder/mcp-policy.json",
    ]));
    expect(packageJson.scripts.start).toBe("node dist/index.js");
    expect(packageJson.scripts.typecheck).toBe("tsc --noEmit -p tsconfig.json");
    expect(packageJson.devDependencies["@types/node"]).toBe("^24.0.0");
    expect(composeFile).toContain('bizbot.builder.managed: "true"');
    expect(composeFile).toContain(`bizbot.builder.project_id: "${project.id}"`);
    expect(composeFile).toContain('bizbot.builder.service_id: "compose:compose.yml:app"');
    expect(BUILDER_TEMPLATE_VERIFICATION_CONTRACTS["node-cli"].containerStage).toEqual(expect.objectContaining({
      composeFile: "compose.yml",
      serviceName: "app",
      workingDirectory: "/workspace",
      verificationScripts: ["typecheck", "build"],
    }));
  });

  it("bootstraps the plugin-package preset with plugin entrypoint and focused test", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const project = makeProject("plugin-package", "plugin-package-test");
    const bootstrap = await bootstrapBuilderProject(project);
    const projectRoot = path.join(workspaceRoot, "projects", "plugin-package-test");
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const pluginSource = fs.readFileSync(path.join(projectRoot, "src", "plugin.ts"), "utf8");
    const pluginTest = fs.readFileSync(path.join(projectRoot, "tests", "plugin.test.ts"), "utf8");

    expect(bootstrap.files).toEqual(expect.arrayContaining([
      "projects/plugin-package-test/src/plugin.ts",
      "projects/plugin-package-test/tests/plugin.test.ts",
      "projects/plugin-package-test/Dockerfile",
      "projects/plugin-package-test/compose.yml",
      "projects/plugin-package-test/.builder/mcp-policy.json",
    ]));
    expect(packageJson.scripts.start).toBe("node dist/plugin.js");
    expect(packageJson.scripts.typecheck).toBe("tsc --noEmit -p tsconfig.json");
    expect(packageJson.devDependencies["@types/node"]).toBe("^24.0.0");
    expect(pluginSource).toContain("export function registerPlugin(): string");
    expect(pluginTest).toContain('expect(pluginName).toBe("plugin-package-test")');
    expect(BUILDER_TEMPLATE_VERIFICATION_CONTRACTS["plugin-package"].containerStage).toEqual(expect.objectContaining({
      composeFile: "compose.yml",
      serviceName: "app",
      verificationScripts: ["typecheck", "build", "test"],
    }));
  });

  it("bootstraps the next-app preset through create-next-app with the shared contract present", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const project = makeProject("next-app", "next-app-test");
    await bootstrapBuilderProject(project);

    expect(vi.mocked(runNpmCreatePackage)).toHaveBeenCalledWith("projects", "next-app@latest", "next-app-test", [
      "--ts",
      "--eslint",
      "--app",
      "--src-dir",
      "--use-npm",
    ]);
    expect(BUILDER_TEMPLATE_VERIFICATION_CONTRACTS["next-app"]).toEqual(expect.objectContaining({
      requiredFiles: expect.arrayContaining([".builder/mcp-policy.json", "Dockerfile", "compose.yml", ".dockerignore"]),
      runtimeEntrypoint: "src/app/page.tsx",
      requiredScripts: expect.arrayContaining(["build", "lint", "start"]),
      containerStage: expect.objectContaining({
        composeFile: "compose.yml",
        serviceName: "app",
        verificationScripts: ["build", "lint"],
      }),
    }));
    expect(fs.existsSync(path.join(workspaceRoot, "projects", "next-app-test", ".builder", "mcp-policy.json"))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, "projects", "next-app-test", "Dockerfile"))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, "projects", "next-app-test", "compose.yml"))).toBe(true);
  });

  it("bootstraps the vite-app preset through create-vite with the shared contract present", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const project = makeProject("vite-app", "vite-app-test");
    await bootstrapBuilderProject(project);

    expect(vi.mocked(runNpmCreatePackage)).toHaveBeenCalledWith("projects", "vite@latest", "vite-app-test", [
      "--template",
      "react-ts",
      "--no-interactive",
    ]);
    expect(BUILDER_TEMPLATE_VERIFICATION_CONTRACTS["vite-app"]).toEqual(expect.objectContaining({
      requiredFiles: expect.arrayContaining([".builder/mcp-policy.json", "Dockerfile", "compose.yml", ".dockerignore"]),
      runtimeEntrypoint: "src/main.tsx",
      requiredScripts: expect.arrayContaining(["build", "dev", "preview"]),
      containerStage: expect.objectContaining({
        composeFile: "compose.yml",
        serviceName: "app",
        verificationScripts: ["build"],
      }),
    }));
    expect(fs.existsSync(path.join(workspaceRoot, "projects", "vite-app-test", ".builder", "mcp-policy.json"))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, "projects", "vite-app-test", "Dockerfile"))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, "projects", "vite-app-test", "compose.yml"))).toBe(true);
  });
});
