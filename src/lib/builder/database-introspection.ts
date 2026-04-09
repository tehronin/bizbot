import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { appendBuilderCapabilityAuditEvent } from "@/lib/builder/audit";
import { getBuilderAllowedDatabases, getBuilderRepositoryRoot, resolveBuilderWorkspacePath } from "@/lib/builder/config";
import { readBuilderProjectEnvValue } from "@/lib/builder/environment";

export interface BuilderDatabaseFieldSummary {
  name: string;
  type: string;
  attributes: string[];
}

export interface BuilderDatabaseTableSummary {
  modelName: string;
  tableName: string;
  fields: BuilderDatabaseFieldSummary[];
}

export interface BuilderDatabaseSchemaSummary {
  provider: string | null;
  datasourceName: string | null;
  connectionTarget: string | null;
  migrationsPath: string | null;
  migrationsCount: number;
  tableCount: number;
  tables: Array<{ modelName: string; tableName: string; fieldCount: number }>;
  auditPath: string;
}

export interface BuilderDatabaseLiveProbeState {
  status: "succeeded" | "failed";
  source: "live";
  provider: string | null;
  connectionTarget: string | null;
  probedAt: string;
  summary: string;
  tableCount: number;
  tables: Array<{ modelName: string; tableName: string; fieldCount: number }>;
  auditPath: string;
  error?: string;
}

export interface BuilderDatabaseInspectionOverview {
  artifact: BuilderDatabaseSchemaSummary;
  latestLiveProbe: BuilderDatabaseLiveProbeState | null;
  driftSummary: BuilderDatabaseDriftSummary;
}

export interface BuilderDatabaseFieldCountMismatch {
  tableName: string;
  artifactFieldCount: number;
  liveFieldCount: number;
}

export interface BuilderDatabaseDriftSummary {
  status: "not_available" | "probe_failed" | "in_sync" | "drifted";
  summary: string;
  comparedAt: string | null;
  artifactTableCount: number;
  liveTableCount: number;
  missingInLive: string[];
  unexpectedLive: string[];
  fieldCountMismatches: BuilderDatabaseFieldCountMismatch[];
}

interface ParsedDatasource {
  datasourceName: string | null;
  provider: string | null;
  urlValue: string | null;
  urlEnvKey: string | null;
}

interface BuilderDatabaseInspectionContext {
  projectId: string;
  projectRelativePath: string;
  schemaPath: string;
  datasource: ParsedDatasource;
  connectionTarget: string | null;
  tables: BuilderDatabaseTableSummary[];
  migrations: string[];
}

function buildUnavailableSchemaSummary(projectRelativePath: string): BuilderDatabaseSchemaSummary {
  return {
    provider: null,
    datasourceName: null,
    connectionTarget: null,
    migrationsPath: null,
    migrationsCount: 0,
    tableCount: 0,
    tables: [],
    auditPath: path.posix.join(projectRelativePath, ".builder", "reports", "capability-audit.jsonl"),
  };
}

function getDatabaseLiveProbeRelativePath(projectRelativePath: string): string {
  return path.posix.join(projectRelativePath, ".builder", "reports", "database-live-probe.json");
}

function readProjectFile(projectRelativePath: string, relativePath: string): string | null {
  const absolutePath = resolveBuilderWorkspacePath(path.posix.join(projectRelativePath, relativePath));
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf-8") : null;
}

function writeProjectJsonFile(projectRelativePath: string, relativePath: string, value: unknown): void {
  const absolutePath = resolveBuilderWorkspacePath(path.posix.join(projectRelativePath, relativePath));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function parseDatasource(schema: string): ParsedDatasource {
  const blockMatch = schema.match(/datasource\s+(\w+)\s*\{([\s\S]*?)\n\}/m);
  if (!blockMatch) {
    return { datasourceName: null, provider: null, urlValue: null, urlEnvKey: null };
  }

  const body = blockMatch[2] ?? "";
  const provider = body.match(/provider\s*=\s*"([^"]+)"/)?.[1] ?? null;
  const urlEnvKey = body.match(/url\s*=\s*env\("([^"]+)"\)/)?.[1] ?? null;
  const urlValue = body.match(/url\s*=\s*"([^"]+)"/)?.[1] ?? null;
  return {
    datasourceName: blockMatch[1] ?? null,
    provider,
    urlValue,
    urlEnvKey,
  };
}

function parseModels(schema: string): BuilderDatabaseTableSummary[] {
  const matches = [...schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)];
  return matches.map((match) => {
    const modelName = match[1] ?? "Unknown";
    const body = match[2] ?? "";
    const tableName = body.match(/@@map\("([^"]+)"\)/)?.[1] ?? modelName;
    const fields = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("//") && !line.startsWith("@@"))
      .map((line) => {
        const [name, type, ...rest] = line.split(/\s+/);
        return { name, type, attributes: rest } satisfies BuilderDatabaseFieldSummary;
      })
      .filter((field) => Boolean(field.name) && Boolean(field.type));

    return {
      modelName,
      tableName,
      fields,
    };
  });
}

function listMigrationEntries(projectRelativePath: string): string[] {
  const migrationsDir = resolveBuilderWorkspacePath(path.posix.join(projectRelativePath, "prisma/migrations"));
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  return fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

function normalizeDatabaseTarget(projectRelativePath: string, datasource: ParsedDatasource): string | null {
  const resolvedUrl = datasource.urlEnvKey
    ? (readBuilderProjectEnvValue(projectRelativePath, datasource.urlEnvKey, { reveal: true }).value ?? process.env[datasource.urlEnvKey] ?? null)
    : datasource.urlValue;
  if (!resolvedUrl) {
    return null;
  }

  if (resolvedUrl.startsWith("file:")) {
    const fileTarget = resolvedUrl.slice(5);
    const absoluteTarget = path.resolve(resolveBuilderWorkspacePath(projectRelativePath), fileTarget);
    const relativeTarget = path.relative(resolveBuilderWorkspacePath(projectRelativePath), absoluteTarget).replace(/\\/g, "/");
    return `file:${relativeTarget}`;
  }

  try {
    const parsed = new URL(resolvedUrl);
    return parsed.host ? `${parsed.protocol}//${parsed.host}` : resolvedUrl;
  } catch {
    return datasource.provider === "sqlite" ? resolvedUrl : null;
  }
}

function assertDatabaseAllowed(projectRelativePath: string, datasource: ParsedDatasource, connectionTarget: string | null): void {
  if (!connectionTarget) {
    throw new Error("Builder DB inspection requires a resolved datasource URL from schema.prisma or project env.");
  }

  if ((datasource.provider === "sqlite" || connectionTarget.startsWith("file:")) && connectionTarget.startsWith("file:")) {
    return;
  }

  const allowed = getBuilderAllowedDatabases().map((entry) => entry.toLowerCase());
  if (allowed.length === 0) {
    throw new Error("No builder databases are allowed. Configure BIZBOT_BUILDER_ALLOWED_DATABASES.");
  }

  const normalizedTarget = connectionTarget.toLowerCase();
  const hostMatch = (() => {
    try {
      return new URL(connectionTarget).host.toLowerCase();
    } catch {
      return null;
    }
  })();

  const isAllowed = allowed.some((entry) => entry === normalizedTarget || entry === hostMatch);
  if (!isAllowed) {
    throw new Error(`Builder DB target is not allowlisted: ${connectionTarget}`);
  }
}

function loadInspectionContext(projectId: string, projectRelativePath: string): BuilderDatabaseInspectionContext {
  const schemaPath = path.posix.join(projectRelativePath, "prisma/schema.prisma");
  const schema = readProjectFile(projectRelativePath, "prisma/schema.prisma");
  if (!schema) {
    throw new Error("Builder DB inspection requires prisma/schema.prisma in the target project.");
  }

  const datasource = parseDatasource(schema);
  const connectionTarget = normalizeDatabaseTarget(projectRelativePath, datasource);
  assertDatabaseAllowed(projectRelativePath, datasource, connectionTarget);

  return {
    projectId,
    projectRelativePath,
    schemaPath,
    datasource,
    connectionTarget,
    tables: parseModels(schema),
    migrations: listMigrationEntries(projectRelativePath),
  };
}

function writeAudit(args: {
  context: BuilderDatabaseInspectionContext;
  outcomeStatus: "succeeded" | "failed" | "blocked" | "timed_out";
  metadata?: Record<string, unknown>;
}): string {
  return appendBuilderCapabilityAuditEvent({
    capabilityKey: "database_introspection",
    projectRelativePath: args.context.projectRelativePath,
    projectId: args.context.projectId,
    outcomeStatus: args.outcomeStatus,
    targets: [{ kind: "database", identifier: args.context.connectionTarget ?? "unresolved" }],
    metadata: args.metadata,
  }).auditPath;
}

function buildSchemaSummary(context: BuilderDatabaseInspectionContext, auditPath: string): BuilderDatabaseSchemaSummary {
  return {
    provider: context.datasource.provider,
    datasourceName: context.datasource.datasourceName,
    connectionTarget: context.connectionTarget,
    migrationsPath: context.migrations.length > 0 ? path.posix.join(context.projectRelativePath, "prisma/migrations") : null,
    migrationsCount: context.migrations.length,
    tableCount: context.tables.length,
    tables: context.tables.map((table) => ({ modelName: table.modelName, tableName: table.tableName, fieldCount: table.fields.length })),
    auditPath,
  };
}

function readLatestLiveProbe(projectRelativePath: string): BuilderDatabaseLiveProbeState | null {
  const absolutePath = resolveBuilderWorkspacePath(getDatabaseLiveProbeRelativePath(projectRelativePath));
  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf-8")) as BuilderDatabaseLiveProbeState;
  } catch {
    return null;
  }
}

function summarizeLiveProbe(tableCount: number, provider: string | null): string {
  if (tableCount === 0) {
    return `Live ${provider ?? "database"} probe completed with no visible models.`;
  }

  return `Live ${provider ?? "database"} probe found ${tableCount} table${tableCount === 1 ? "" : "s"}.`;
}

function summarizeDatabaseDrift(args: {
  missingInLive: string[];
  unexpectedLive: string[];
  fieldCountMismatches: BuilderDatabaseFieldCountMismatch[];
}): string {
  const parts: string[] = [];
  if (args.missingInLive.length > 0) {
    parts.push(`${args.missingInLive.length} missing in live`);
  }
  if (args.unexpectedLive.length > 0) {
    parts.push(`${args.unexpectedLive.length} unexpected live`);
  }
  if (args.fieldCountMismatches.length > 0) {
    parts.push(`${args.fieldCountMismatches.length} field-count mismatches`);
  }

  return parts.length > 0 ? `Database drift detected: ${parts.join(", ")}.` : "Live database matches Prisma artifact table shapes at the summary level.";
}

function buildDatabaseDriftSummary(args: {
  artifact: BuilderDatabaseSchemaSummary;
  latestLiveProbe: BuilderDatabaseLiveProbeState | null;
}): BuilderDatabaseDriftSummary {
  if (!args.latestLiveProbe) {
    return {
      status: "not_available",
      summary: "Run a live database probe to compare Prisma artifacts against the current database.",
      comparedAt: null,
      artifactTableCount: args.artifact.tableCount,
      liveTableCount: 0,
      missingInLive: [],
      unexpectedLive: [],
      fieldCountMismatches: [],
    };
  }

  if (args.latestLiveProbe.status !== "succeeded") {
    return {
      status: "probe_failed",
      summary: args.latestLiveProbe.error ?? "The latest live database probe failed, so no drift comparison is available.",
      comparedAt: args.latestLiveProbe.probedAt,
      artifactTableCount: args.artifact.tableCount,
      liveTableCount: args.latestLiveProbe.tableCount,
      missingInLive: [],
      unexpectedLive: [],
      fieldCountMismatches: [],
    };
  }

  const artifactByTableName = new Map(args.artifact.tables.map((table) => [table.tableName, table]));
  const liveByTableName = new Map(args.latestLiveProbe.tables.map((table) => [table.tableName, table]));
  const missingInLive = args.artifact.tables
    .filter((table) => !liveByTableName.has(table.tableName))
    .map((table) => table.tableName)
    .sort();
  const unexpectedLive = args.latestLiveProbe.tables
    .filter((table) => !artifactByTableName.has(table.tableName))
    .map((table) => table.tableName)
    .sort();
  const fieldCountMismatches = args.artifact.tables
    .flatMap((table) => {
      const liveTable = liveByTableName.get(table.tableName);
      if (!liveTable || liveTable.fieldCount === table.fieldCount) {
        return [];
      }
      return [{
        tableName: table.tableName,
        artifactFieldCount: table.fieldCount,
        liveFieldCount: liveTable.fieldCount,
      } satisfies BuilderDatabaseFieldCountMismatch];
    })
    .sort((left, right) => left.tableName.localeCompare(right.tableName));
  const status = missingInLive.length > 0 || unexpectedLive.length > 0 || fieldCountMismatches.length > 0 ? "drifted" : "in_sync";

  return {
    status,
    summary: summarizeDatabaseDrift({ missingInLive, unexpectedLive, fieldCountMismatches }),
    comparedAt: args.latestLiveProbe.probedAt,
    artifactTableCount: args.artifact.tableCount,
    liveTableCount: args.latestLiveProbe.tableCount,
    missingInLive,
    unexpectedLive,
    fieldCountMismatches,
  };
}

function runPrismaLiveIntrospection(context: BuilderDatabaseInspectionContext): string {
  const prismaCliScript = path.join(getBuilderRepositoryRoot(), "node_modules", "prisma", "build", "index.js");
  if (!fs.existsSync(prismaCliScript)) {
    throw new Error("Prisma CLI is not available in this BizBot workspace.");
  }

  const schemaAbsolutePath = resolveBuilderWorkspacePath(path.posix.join(context.projectRelativePath, "prisma/schema.prisma"));
  const projectRoot = resolveBuilderWorkspacePath(context.projectRelativePath);
  const result = spawnSync(process.execPath, [prismaCliScript, "db", "pull", "--print", "--schema", schemaAbsolutePath], {
    cwd: projectRoot,
    encoding: "utf-8",
    windowsHide: true,
    env: process.env,
  });

  if ((result.status ?? 1) !== 0) {
    throw new Error((result.stderr ?? result.stdout ?? "Prisma live introspection failed.").trim());
  }

  return result.stdout ?? "";
}

export function getBuilderDatabaseSchemaSummary(projectId: string, projectRelativePath: string): BuilderDatabaseSchemaSummary {
  const context = loadInspectionContext(projectId, projectRelativePath);
  const auditPath = writeAudit({
    context,
    outcomeStatus: "succeeded",
    metadata: { operation: "schema_summary", tableCount: context.tables.length, migrationsCount: context.migrations.length },
  });
  return buildSchemaSummary(context, auditPath);
}

export function listBuilderDatabaseTables(projectId: string, projectRelativePath: string): {
  provider: string | null;
  connectionTarget: string | null;
  tables: Array<{ modelName: string; tableName: string; fieldCount: number }>;
  auditPath: string;
} {
  const context = loadInspectionContext(projectId, projectRelativePath);
  const auditPath = writeAudit({
    context,
    outcomeStatus: "succeeded",
    metadata: { operation: "list_tables", tableCount: context.tables.length },
  });
  return {
    provider: context.datasource.provider,
    connectionTarget: context.connectionTarget,
    tables: context.tables.map((table) => ({ modelName: table.modelName, tableName: table.tableName, fieldCount: table.fields.length })),
    auditPath,
  };
}

export function describeBuilderDatabaseTable(projectId: string, projectRelativePath: string, name: string): {
  provider: string | null;
  connectionTarget: string | null;
  table: BuilderDatabaseTableSummary;
  auditPath: string;
} {
  const context = loadInspectionContext(projectId, projectRelativePath);
  const table = context.tables.find((entry) => entry.modelName === name || entry.tableName === name);
  if (!table) {
    const auditPath = writeAudit({
      context,
      outcomeStatus: "failed",
      metadata: { operation: "describe_table", requestedName: name, reason: "table_not_found" },
    });
    throw new Error(`Builder DB table not found: ${name}. Audit: ${auditPath}`);
  }

  const auditPath = writeAudit({
    context,
    outcomeStatus: "succeeded",
    metadata: { operation: "describe_table", requestedName: name, resolvedTable: table.tableName },
  });
  return {
    provider: context.datasource.provider,
    connectionTarget: context.connectionTarget,
    table,
    auditPath,
  };
}

export function listBuilderDatabaseMigrations(projectId: string, projectRelativePath: string): {
  provider: string | null;
  connectionTarget: string | null;
  migrationsPath: string | null;
  migrations: string[];
  auditPath: string;
} {
  const context = loadInspectionContext(projectId, projectRelativePath);
  const auditPath = writeAudit({
    context,
    outcomeStatus: "succeeded",
    metadata: { operation: "list_migrations", migrationsCount: context.migrations.length },
  });
  return {
    provider: context.datasource.provider,
    connectionTarget: context.connectionTarget,
    migrationsPath: context.migrations.length > 0 ? path.posix.join(projectRelativePath, "prisma/migrations") : null,
    migrations: context.migrations,
    auditPath,
  };
}

export function getBuilderDatabaseInspectionOverview(projectId: string, projectRelativePath: string): BuilderDatabaseInspectionOverview {
  try {
    const context = loadInspectionContext(projectId, projectRelativePath);
    const artifact = buildSchemaSummary(context, path.posix.join(projectRelativePath, ".builder", "reports", "capability-audit.jsonl"));
    const latestLiveProbe = readLatestLiveProbe(projectRelativePath);
    return {
      artifact,
      latestLiveProbe,
      driftSummary: buildDatabaseDriftSummary({ artifact, latestLiveProbe }),
    };
  } catch (error) {
    const artifact = buildUnavailableSchemaSummary(projectRelativePath);
    const latestLiveProbe = readLatestLiveProbe(projectRelativePath);
    return {
      artifact,
      latestLiveProbe,
      driftSummary: {
        status: "not_available",
        summary: error instanceof Error ? error.message : String(error),
        comparedAt: null,
        artifactTableCount: 0,
        liveTableCount: latestLiveProbe?.tableCount ?? 0,
        missingInLive: [],
        unexpectedLive: [],
        fieldCountMismatches: [],
      },
    };
  }
}

export function probeBuilderDatabaseLiveMetadata(projectId: string, projectRelativePath: string): BuilderDatabaseLiveProbeState {
  const context = loadInspectionContext(projectId, projectRelativePath);

  try {
    const liveSchema = runPrismaLiveIntrospection(context);
    const liveTables = parseModels(liveSchema);
    const auditPath = writeAudit({
      context,
      outcomeStatus: "succeeded",
      metadata: { operation: "live_probe", tableCount: liveTables.length, provider: context.datasource.provider },
    });
    const probe: BuilderDatabaseLiveProbeState = {
      status: "succeeded",
      source: "live",
      provider: context.datasource.provider,
      connectionTarget: context.connectionTarget,
      probedAt: new Date().toISOString(),
      summary: summarizeLiveProbe(liveTables.length, context.datasource.provider),
      tableCount: liveTables.length,
      tables: liveTables.map((table) => ({ modelName: table.modelName, tableName: table.tableName, fieldCount: table.fields.length })),
      auditPath,
    };
    writeProjectJsonFile(projectRelativePath, path.posix.join(".builder", "reports", "database-live-probe.json"), probe);
    return probe;
  } catch (error) {
    const auditPath = writeAudit({
      context,
      outcomeStatus: "failed",
      metadata: { operation: "live_probe", error: error instanceof Error ? error.message : String(error) },
    });
    const failedProbe: BuilderDatabaseLiveProbeState = {
      status: "failed",
      source: "live",
      provider: context.datasource.provider,
      connectionTarget: context.connectionTarget,
      probedAt: new Date().toISOString(),
      summary: "Live database probe failed.",
      tableCount: 0,
      tables: [],
      auditPath,
      error: error instanceof Error ? error.message : String(error),
    };
    writeProjectJsonFile(projectRelativePath, path.posix.join(".builder", "reports", "database-live-probe.json"), failedProbe);
    return failedProbe;
  }
}