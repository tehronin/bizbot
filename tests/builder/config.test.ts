import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { getBuilderConfig, resolveBuilderWorkspacePath } from "@/lib/builder/config";

function createTempBuilderWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-builder-config-"));
}

afterEach(() => {
  delete process.env.BIZBOT_BUILDER_WORKSPACE_PATH;
  delete process.env.BIZBOT_BUILDER_ALLOWED_COMMANDS;
  delete process.env.BIZBOT_BUILDER_DEFAULT_TEMPLATE;
  delete process.env.BIZBOT_BUILDER_DEFAULT_PACKAGE_MANAGER;
  delete process.env.BIZBOT_BUILDER_INIT_GIT;
  delete process.env.BIZBOT_BUILDER_INSTALL_DEPS;
  delete process.env.BIZBOT_BUILDER_DEFAULT_AGENTIC_PROFILE;
  delete process.env.BIZBOT_BUILDER_AGENTIC_TIMEOUT_SECONDS;
});

describe("builder config", () => {
  it("fails closed when the builder workspace overlaps the BizBot repository", () => {
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = process.cwd();

    const config = getBuilderConfig();

    expect(config.safe).toBe(false);
    expect(config.reason).toContain("overlaps the BizBot repository");
  });

  it("reads builder defaults and resolves workspace-relative paths from one place", () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    process.env.BIZBOT_BUILDER_ALLOWED_COMMANDS = "npm,pnpm,npx,git";
    process.env.BIZBOT_BUILDER_DEFAULT_TEMPLATE = "vite-app";
    process.env.BIZBOT_BUILDER_DEFAULT_PACKAGE_MANAGER = "PNPM";
    process.env.BIZBOT_BUILDER_INIT_GIT = "false";
    process.env.BIZBOT_BUILDER_INSTALL_DEPS = "true";
    process.env.BIZBOT_BUILDER_DEFAULT_AGENTIC_PROFILE = "";
    process.env.BIZBOT_BUILDER_AGENTIC_TIMEOUT_SECONDS = "1200";

    const config = getBuilderConfig();

    expect(config.safe).toBe(true);
    expect(config.workspaceRoot).toBe(path.resolve(workspaceRoot));
    expect(config.projectsRoot).toBe(path.resolve(workspaceRoot, "projects"));
    expect(config.allowedCommands).toEqual(["npm", "pnpm", "npx", "git"]);
    expect(config.defaultTemplate).toBe("vite-app");
    expect(config.defaultPackageManager).toBe("PNPM");
    expect(config.initializeGitByDefault).toBe(false);
    expect(config.installDependenciesByDefault).toBe(true);
    expect(config.defaultAgenticProfile).toBe("");
    expect(config.agenticTimeoutSeconds).toBe(1200);
    expect(resolveBuilderWorkspacePath("projects/demo")).toBe(path.resolve(workspaceRoot, "projects", "demo"));
  });
});