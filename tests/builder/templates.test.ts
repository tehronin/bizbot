import fs from "fs";
import os from "os";
import path from "path";
import type { BuilderProject } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runNpmCreatePackage } from "@/lib/builder/adapters/npx";

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
import { bootstrapBuilderProject, BUILDER_TEMPLATE_VERIFICATION_CONTRACTS } from "@/lib/builder/templates";

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

    expect(bootstrap.files).toEqual(expect.arrayContaining([
      "projects/node-cli-test/package.json",
      "projects/node-cli-test/src/index.ts",
    ]));
    expect(packageJson.scripts.start).toBe("node dist/index.js");
    expect(packageJson.scripts.typecheck).toBe("tsc --noEmit -p tsconfig.json");
    expect(packageJson.devDependencies["@types/node"]).toBe("^24.0.0");
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
    ]));
    expect(packageJson.scripts.start).toBe("node dist/plugin.js");
    expect(packageJson.scripts.typecheck).toBe("tsc --noEmit -p tsconfig.json");
    expect(packageJson.devDependencies["@types/node"]).toBe("^24.0.0");
    expect(pluginSource).toContain("export function registerPlugin(): string");
    expect(pluginTest).toContain('expect(pluginName).toBe("plugin-package-test")');
  });

  it("bootstraps the next-app preset through create-next-app with the shared contract present", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const project = makeProject("next-app", "next-app-test");
    await bootstrapBuilderProject(project);

    expect(vi.mocked(runNpmCreatePackage)).toHaveBeenCalledWith("projects/next-app-test", "next-app@latest", [
      "--ts",
      "--eslint",
      "--app",
      "--src-dir",
      "--use-npm",
    ]);
    expect(BUILDER_TEMPLATE_VERIFICATION_CONTRACTS["next-app"]).toEqual(expect.objectContaining({
      runtimeEntrypoint: "src/app/page.tsx",
      requiredScripts: expect.arrayContaining(["build", "lint", "start"]),
    }));
  });

  it("bootstraps the vite-app preset through create-vite with the shared contract present", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const project = makeProject("vite-app", "vite-app-test");
    await bootstrapBuilderProject(project);

    expect(vi.mocked(runNpmCreatePackage)).toHaveBeenCalledWith("projects/vite-app-test", "vite@latest", [
      "--template",
      "react-ts",
    ]);
    expect(BUILDER_TEMPLATE_VERIFICATION_CONTRACTS["vite-app"]).toEqual(expect.objectContaining({
      runtimeEntrypoint: "src/main.tsx",
      requiredScripts: expect.arrayContaining(["build", "dev", "preview"]),
    }));
  });
});
