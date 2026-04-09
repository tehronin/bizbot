import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
}));

vi.mock("child_process", () => ({
  spawnSync: mocks.spawnSync,
}));

import { getBuilderDatabaseInspectionOverview, probeBuilderDatabaseLiveMetadata } from "@/lib/builder/database-introspection";

function createTempBuilderWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-builder-db-live-"));
}

function seedPrismaProject(workspaceRoot: string, schema: string): void {
  const projectRoot = path.join(workspaceRoot, "projects", "demo", "prisma");
  fs.mkdirSync(path.join(projectRoot, "migrations", "20260409110000_init"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "schema.prisma"), schema, "utf-8");
  fs.writeFileSync(path.join(projectRoot, "migrations", "20260409110000_init", "migration.sql"), "-- init\n", "utf-8");
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.BIZBOT_BUILDER_WORKSPACE_PATH;
  delete process.env.BIZBOT_BUILDER_ALLOWED_DATABASES;
});

describe("builder database live probe", () => {
  it("captures a live prisma introspection probe and persists the latest report", () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    seedPrismaProject(workspaceRoot, [
      'datasource db {',
      '  provider = "sqlite"',
      '  url      = "file:./dev.db"',
      '}',
      '',
      'model User {',
      '  id    Int    @id @default(autoincrement())',
      '  email String @unique',
      '}',
      '',
    ].join("\n"));

    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: [
        'datasource db {',
        '  provider = "sqlite"',
        '  url      = "file:./dev.db"',
        '}',
        '',
        'model User {',
        '  id    Int    @id @default(autoincrement())',
        '  email String @unique',
        '}',
        '',
        'model Post {',
        '  id    Int    @id @default(autoincrement())',
        '  title String',
        '}',
      ].join("\n"),
      stderr: "",
    });

    const probe = probeBuilderDatabaseLiveMetadata("project-1", "projects/demo");
    const overview = getBuilderDatabaseInspectionOverview("project-1", "projects/demo");

    expect(probe.status).toBe("succeeded");
    expect(probe.tableCount).toBe(2);
    expect(probe.tables.map((entry) => entry.tableName)).toEqual(["User", "Post"]);
    expect(overview.driftSummary.status).toBe("drifted");
    expect(overview.driftSummary.unexpectedLive).toEqual(["Post"]);
    expect(fs.existsSync(path.join(workspaceRoot, "projects", "demo", ".builder", "reports", "database-live-probe.json"))).toBe(true);
  });
});