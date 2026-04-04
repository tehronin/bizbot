import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { listBuilderScaffoldBlockingEntries, scaffoldBuilderNodePackage } from "@/lib/builder/workspace";

function createTempBuilderWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-builder-workspace-"));
}

afterEach(() => {
  delete process.env.BIZBOT_BUILDER_WORKSPACE_PATH;
});

describe("builder workspace scaffold guards", () => {
  it("ignores Builder-managed projection files when checking scaffold emptiness", () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const projectRoot = path.join(workspaceRoot, "projects", "demo");
    fs.mkdirSync(path.join(projectRoot, ".builder"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "# Builder Project Instructions\n", "utf-8");

    expect(listBuilderScaffoldBlockingEntries("projects/demo")).toEqual([]);

    const scaffold = scaffoldBuilderNodePackage({
      projectDir: "projects/demo",
      packageName: "demo",
      description: "Demo package",
    });

    expect(scaffold.files).toEqual(expect.arrayContaining([
      "projects/demo/package.json",
      "projects/demo/src/index.ts",
    ]));
  });

  it("still blocks scaffolding when real project files already exist", () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const projectRoot = path.join(workspaceRoot, "projects", "demo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "README.md"), "existing\n", "utf-8");

    expect(listBuilderScaffoldBlockingEntries("projects/demo")).toEqual(["README.md"]);
    expect(() => scaffoldBuilderNodePackage({
      projectDir: "projects/demo",
      packageName: "demo",
      description: "Demo package",
    })).toThrow("Builder scaffold target is not empty");
  });
});