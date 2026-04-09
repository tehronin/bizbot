import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeBuilderDatabaseTable,
  getBuilderDatabaseSchemaSummary,
  listBuilderDatabaseMigrations,
  listBuilderDatabaseTables,
} from "@/lib/builder/database-introspection";

function createTempBuilderWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-builder-db-"));
}

function seedPrismaProject(workspaceRoot: string, schema: string): void {
  const projectRoot = path.join(workspaceRoot, "projects", "demo", "prisma");
  fs.mkdirSync(path.join(projectRoot, "migrations", "20260409110000_init"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "schema.prisma"), schema, "utf-8");
  fs.writeFileSync(path.join(projectRoot, "migrations", "20260409110000_init", "migration.sql"), "-- init\n", "utf-8");
}

afterEach(() => {
  delete process.env.BIZBOT_BUILDER_WORKSPACE_PATH;
  delete process.env.BIZBOT_BUILDER_ALLOWED_DATABASES;
});

describe("builder database introspection", () => {
  it("summarizes sqlite schema artifacts and writes capability audit logs", () => {
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
      '  @@map("users")',
      '}',
      '',
      'model Post {',
      '  id     Int    @id @default(autoincrement())',
      '  title  String',
      '}',
      '',
    ].join("\n"));

    const summary = getBuilderDatabaseSchemaSummary("project-1", "projects/demo");
    const tables = listBuilderDatabaseTables("project-1", "projects/demo");
    const described = describeBuilderDatabaseTable("project-1", "projects/demo", "users");
    const migrations = listBuilderDatabaseMigrations("project-1", "projects/demo");

    expect(summary.provider).toBe("sqlite");
    expect(summary.connectionTarget).toBe("file:dev.db");
    expect(summary.tableCount).toBe(2);
    expect(tables.tables.map((entry) => entry.tableName)).toEqual(["users", "Post"]);
    expect(described.table.modelName).toBe("User");
    expect(described.table.fields.map((field) => field.name)).toContain("email");
    expect(migrations.migrations).toEqual(["20260409110000_init"]);
    expect(fs.readFileSync(path.join(workspaceRoot, summary.auditPath), "utf-8")).toContain('"capabilityKey":"database_introspection"');
  });

  it("requires remote database targets to be explicitly allowlisted", () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    seedPrismaProject(workspaceRoot, [
      'datasource db {',
      '  provider = "postgresql"',
      '  url      = env("DATABASE_URL")',
      '}',
      '',
      'model Account {',
      '  id Int @id',
      '}',
      '',
    ].join("\n"));
    fs.writeFileSync(path.join(workspaceRoot, "projects", "demo", ".env.local"), "DATABASE_URL=postgresql://db.example.com:5432/app\n", "utf-8");

    expect(() => getBuilderDatabaseSchemaSummary("project-1", "projects/demo")).toThrow("No builder databases are allowed");

    process.env.BIZBOT_BUILDER_ALLOWED_DATABASES = "db.example.com:5432";
    const summary = getBuilderDatabaseSchemaSummary("project-1", "projects/demo");

    expect(summary.connectionTarget).toBe("postgresql://db.example.com:5432");
    expect(summary.tableCount).toBe(1);
  });
});