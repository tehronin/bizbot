import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readBuilderProjectEnvValue,
  syncBuilderProjectEnvExample,
  validateBuilderProjectEnv,
  writeBuilderProjectEnvFileEntry,
} from "@/lib/builder/environment";

function createTempBuilderWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-builder-env-"));
}

function writeProjectFile(workspaceRoot: string, relativePath: string, content: string): void {
  const targetPath = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, "utf-8");
}

afterEach(() => {
  delete process.env.BIZBOT_BUILDER_WORKSPACE_PATH;
  delete process.env.DATABASE_URL;
  delete process.env.API_KEY;
  delete process.env.NEW_SECRET;
});

describe("builder environment", () => {
  it("distinguishes project-local readiness from execution readiness when host env fills a gap", () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    process.env.DATABASE_URL = "postgres://builder-host";

    writeProjectFile(workspaceRoot, "projects/demo/.env.example", "DATABASE_URL=\nAPI_KEY=\n");
    writeProjectFile(workspaceRoot, "projects/demo/.env", "API_KEY=project-key\n");

    const readiness = validateBuilderProjectEnv("projects/demo");

    expect(readiness.schemaAvailable).toBe(true);
    expect(readiness.projectReady).toBe(false);
    expect(readiness.executionReady).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, readiness.auditPath))).toBe(true);
    expect(readiness.missingProjectKeys).toEqual(["DATABASE_URL"]);
    expect(readiness.missingExecutionKeys).toEqual([]);
    expect(readiness.keys).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "DATABASE_URL", projectSource: null, executionSource: "host_env" }),
      expect.objectContaining({ key: "API_KEY", projectSource: ".env", executionSource: ".env" }),
    ]));
  });

  it("returns redacted env reads by default with source attribution", () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    process.env.API_KEY = "super-secret-token";

    const result = readBuilderProjectEnvValue("projects/demo", "API_KEY");

    expect(result.present).toBe(true);
    expect(result.source).toBe("host_env");
    expect(result.redactedValue).not.toBe("super-secret-token");
    expect(fs.existsSync(path.join(workspaceRoot, result.auditPath))).toBe(true);
    expect(result).not.toHaveProperty("value");
  });

  it("writes project-local env entries and upgrades readiness", () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    writeProjectFile(workspaceRoot, "projects/demo/.env.example", "DATABASE_URL=\n");

    const before = validateBuilderProjectEnv("projects/demo");
    expect(before.executionReady).toBe(false);

    const writeResult = writeBuilderProjectEnvFileEntry("projects/demo", {
      key: "DATABASE_URL",
      value: "postgres://project-local",
    });
    const after = validateBuilderProjectEnv("projects/demo");

    expect(writeResult.path).toBe(".env.local");
    expect(fs.existsSync(path.join(workspaceRoot, writeResult.auditPath))).toBe(true);
    expect(after.projectReady).toBe(true);
    expect(after.executionReady).toBe(true);
    expect(fs.readFileSync(path.join(workspaceRoot, "projects/demo/.env.local"), "utf-8")).toContain("DATABASE_URL=postgres://project-local");
  });

  it("detects malformed env entries and syncs missing example keys", () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    writeProjectFile(workspaceRoot, "projects/demo/.env.example", "API_KEY=\n");
    writeProjectFile(workspaceRoot, "projects/demo/.env.local", "NEW_SECRET=value\nNOT VALID\n");

    const readiness = validateBuilderProjectEnv("projects/demo");
    const syncResult = syncBuilderProjectEnvExample("projects/demo");
    const syncedExample = fs.readFileSync(path.join(workspaceRoot, "projects/demo/.env.example"), "utf-8");

    expect(readiness.malformedEntries).toEqual([
      expect.objectContaining({ path: ".env.local", line: 2 }),
    ]);
    expect(syncResult.addedKeys).toEqual(["NEW_SECRET"]);
    expect(fs.existsSync(path.join(workspaceRoot, syncResult.auditPath))).toBe(true);
    expect(syncedExample).toContain("API_KEY=");
    expect(syncedExample).toContain("NEW_SECRET=");
  });

  it("emits a blocked audit event when env writes are rejected", () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    expect(() => writeBuilderProjectEnvFileEntry("projects/demo", {
      key: "NOT VALID",
      value: "secret",
    })).toThrow("Environment key must be a valid shell identifier");

    const auditPath = path.join(workspaceRoot, "projects/demo/.builder/reports/capability-audit.jsonl");
    expect(fs.existsSync(auditPath)).toBe(true);
    const auditLines = fs.readFileSync(auditPath, "utf-8").trim().split(/\r?\n/).map((line) => JSON.parse(line) as {
      outcomeStatus: string;
      metadata?: { operation?: string; reason?: string };
    });
    expect(auditLines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        outcomeStatus: "blocked",
        metadata: expect.objectContaining({ operation: "write_env_file_entry", reason: "invalid_key" }),
      }),
    ]));
  });
});