import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { appendBuilderFile, deleteBuilderPath, listBuilderScaffoldBlockingEntries, moveBuilderPath, scaffoldBuilderNodePackage, writeBuilderFile } from "@/lib/builder/workspace";

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

    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const tsconfig = JSON.parse(fs.readFileSync(path.join(projectRoot, "tsconfig.json"), "utf-8")) as {
      compilerOptions: { rootDir: string };
      include: string[];
    };

    expect(packageJson.scripts.build).toBe("tsc -p tsconfig.json");
    expect(packageJson.scripts.typecheck).toBe("tsc --noEmit -p tsconfig.json");
    expect(packageJson.scripts.start).toBe("node dist/index.js");
    expect(packageJson.devDependencies["@types/node"]).toBe("^24.0.0");
    expect(tsconfig.compilerOptions.rootDir).toBe("src");
    expect(tsconfig.include).toEqual(["src/**/*"]);
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

  it("emits dist-based start scripts for custom src entrypoints", () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const scaffold = scaffoldBuilderNodePackage({
      projectDir: "projects/plugin-demo",
      packageName: "plugin-demo",
      description: "Plugin demo package",
      entrypoint: "src/plugin.ts",
    });

    const projectRoot = path.join(workspaceRoot, "projects", "plugin-demo");
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
    };

    expect(scaffold.files).toEqual(expect.arrayContaining([
      "projects/plugin-demo/src/plugin.ts",
    ]));
    expect(packageJson.scripts.start).toBe("node dist/plugin.js");
  });

  it("emits workspace audit artifacts for file mutations and keeps protected paths blocked", () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const writeResult = writeBuilderFile("projects/demo/notes.txt", "hello\n");
    const appendResult = appendBuilderFile("projects/demo/notes.txt", "world\n");
    const moveResult = moveBuilderPath("projects/demo/notes.txt", "projects/demo/archive/notes.txt");
    const deleteResult = deleteBuilderPath("projects/demo/archive/notes.txt");

    expect(fs.existsSync(path.join(workspaceRoot, writeResult.auditPath))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, appendResult.auditPath))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, moveResult.auditPath))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, deleteResult.auditPath))).toBe(true);
    expect(() => writeBuilderFile("projects/demo/node_modules/blocked.txt", "nope"))
      .toThrow("protected builder segment");

    const auditPath = path.join(workspaceRoot, "projects/demo/.builder/reports/capability-audit.jsonl");
    const auditLines = fs.readFileSync(auditPath, "utf-8").trim().split(/\r?\n/).map((line) => JSON.parse(line) as {
      outcomeStatus: string;
      metadata?: { operation?: string; reason?: string };
    });
    expect(auditLines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        outcomeStatus: "blocked",
        metadata: expect.objectContaining({ operation: "write_file", reason: "protected_segment" }),
      }),
    ]));
  });

  it("emits failed audit artifacts when workspace moves are rejected", () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    expect(() => moveBuilderPath("projects/demo/missing.txt", "projects/demo/archive/missing.txt"))
      .toThrow("Path not found");

    const auditPath = path.join(workspaceRoot, "projects/demo/.builder/reports/capability-audit.jsonl");
    expect(fs.existsSync(auditPath)).toBe(true);
    const auditLines = fs.readFileSync(auditPath, "utf-8").trim().split(/\r?\n/).map((line) => JSON.parse(line) as {
      outcomeStatus: string;
      metadata?: { operation?: string; reason?: string };
    });
    expect(auditLines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        outcomeStatus: "failed",
        metadata: expect.objectContaining({ operation: "move_path", reason: "source_missing" }),
      }),
    ]));
  });
});