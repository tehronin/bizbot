import { ExternalDataSourceStatus, Prisma, SourceScanStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { createExternalPostgresClient } from "@/lib/creeper/postgres";
import { getCreeperConnectedSource, normalizeAllowedSchemas } from "@/lib/creeper/sources";
import type { CreeperProfileSummary } from "@/lib/creeper/types";

interface ProfileSourceOptions {
  sourceId: string;
  schemaAllowlist?: string[];
  maxTables?: number;
  includeRowEstimates?: boolean;
}

interface ProfiledSchemaRow {
  schemaName: string;
  tableCount: number;
  viewCount: number;
}

interface ProfiledTableRow {
  schemaName: string;
  tableName: string;
  tableType: string;
  estimatedRowCount: number | null;
}

interface ProfiledColumnRow {
  columnName: string;
  dataType: string;
  isNullable: boolean;
  isArray: boolean;
  isJson: boolean;
  distinctEstimate: number | null;
  nullFraction: number | null;
  avgWidth: number | null;
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function normalizeMaxTables(value: number | undefined): number {
  if (value === undefined) {
    return 50;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("maxTables must be a positive integer.");
  }
  return Math.min(value, 200);
}

function getSourceAllowedSchemas(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [];
  }

  const allowedSchemas = (metadata as { allowedSchemas?: unknown }).allowedSchemas;
  return Array.isArray(allowedSchemas) ? normalizeAllowedSchemas(allowedSchemas as string[]) : [];
}

function resolveAllowedSchemas(sourceMetadata: unknown, requestedAllowlist: string[] | undefined): string[] {
  const sourceAllowedSchemas = getSourceAllowedSchemas(sourceMetadata);
  const requested = normalizeAllowedSchemas(requestedAllowlist);

  if (sourceAllowedSchemas.length === 0) {
    return requested;
  }
  if (requested.length === 0) {
    return sourceAllowedSchemas;
  }

  return requested.filter((schema) => sourceAllowedSchemas.includes(schema));
}

function inferColumnTags(columnName: string, dataType: string): string[] {
  const lowerName = columnName.toLowerCase();
  const tags: string[] = [];

  if (/email|phone|address|ssn|tax|dob|birth|token|secret|password|key/.test(lowerName)) {
    tags.push("sensitive");
  }
  if (/created|updated|deleted|timestamp|time|date/.test(lowerName)) {
    tags.push("temporal");
  }
  if (/name|title|description|summary|note|comment|message/.test(lowerName)) {
    tags.push("descriptive");
  }
  if (/json|jsonb/i.test(dataType)) {
    tags.push("json");
  }

  return tags;
}

function inferColumnSensitivity(columnName: string): { level: "low" | "medium" | "high"; reasons: string[] } {
  const lowerName = columnName.toLowerCase();
  const reasons: string[] = [];

  if (/password|secret|token|session|cookie|api[_-]?key|private[_-]?key/.test(lowerName)) {
    reasons.push("credential-like column name");
  }
  if (/email|phone|address|dob|birth|ssn|tax|payment|card/.test(lowerName)) {
    reasons.push("likely personal or regulated data");
  }

  if (reasons.length >= 2) {
    return { level: "high", reasons };
  }
  if (reasons.length === 1) {
    return { level: "medium", reasons };
  }
  return { level: "low", reasons: [] };
}

function classifyTable(tableName: string, columns: ProfiledColumnRow[]): { kind: string; sensitivity: string } {
  const lowerName = tableName.toLowerCase();
  const hasSensitiveColumns = columns.some((column) => inferColumnSensitivity(column.columnName).level !== "low");

  if (/_?events?$|_?logs?$|activities?/.test(lowerName)) {
    return { kind: "event", sensitivity: hasSensitiveColumns ? "review" : "standard" };
  }
  if (/_?map$|_?join$|_?links?$/.test(lowerName)) {
    return { kind: "relation", sensitivity: hasSensitiveColumns ? "review" : "standard" };
  }
  if (/settings|config|secret|credential/.test(lowerName)) {
    return { kind: "operational", sensitivity: "review" };
  }

  return { kind: "entity", sensitivity: hasSensitiveColumns ? "review" : "standard" };
}

function computeIngestionScore(table: ProfiledTableRow, columns: ProfiledColumnRow[]): number {
  let score = 0.35;
  if ((table.estimatedRowCount ?? 0) > 0 && (table.estimatedRowCount ?? 0) < 2_000_000) {
    score += 0.15;
  }
  if (columns.some((column) => /name|title|description|summary|note|message/i.test(column.columnName))) {
    score += 0.2;
  }
  if (columns.some((column) => /id$/i.test(column.columnName))) {
    score += 0.15;
  }
  if (columns.some((column) => inferColumnSensitivity(column.columnName).level === "high")) {
    score -= 0.15;
  }

  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

async function fetchProfiledSchemas(client: ReturnType<typeof createExternalPostgresClient>, allowedSchemas: string[]): Promise<ProfiledSchemaRow[]> {
  const values: unknown[] = [];
  const filter = allowedSchemas.length > 0
    ? ` AND namespace.nspname = ANY($${values.push(allowedSchemas)}::text[])`
    : "";

  const result = await client.query<ProfiledSchemaRow>(`
    SELECT
      namespace.nspname AS "schemaName",
      COUNT(*) FILTER (WHERE relation.relkind IN ('r', 'p'))::int AS "tableCount",
      COUNT(*) FILTER (WHERE relation.relkind IN ('v', 'm'))::int AS "viewCount"
    FROM pg_namespace namespace
    LEFT JOIN pg_class relation
      ON relation.relnamespace = namespace.oid
      AND relation.relkind IN ('r', 'p', 'v', 'm')
    WHERE namespace.nspname <> 'information_schema'
      AND namespace.nspname NOT LIKE 'pg_%'
      ${filter}
    GROUP BY namespace.nspname
    ORDER BY namespace.nspname
  `, values);

  return result.rows;
}

async function fetchProfiledTables(
  client: ReturnType<typeof createExternalPostgresClient>,
  allowedSchemas: string[],
  maxTables: number,
): Promise<ProfiledTableRow[]> {
  const values: unknown[] = [maxTables];
  const filter = allowedSchemas.length > 0
    ? ` AND tables.table_schema = ANY($${values.push(allowedSchemas)}::text[])`
    : "";

  const result = await client.query<ProfiledTableRow>(`
    SELECT
      tables.table_schema AS "schemaName",
      tables.table_name AS "tableName",
      tables.table_type AS "tableType",
      CASE WHEN relation.reltuples < 0 THEN NULL ELSE relation.reltuples::bigint END AS "estimatedRowCount"
    FROM information_schema.tables tables
    JOIN pg_namespace namespace ON namespace.nspname = tables.table_schema
    JOIN pg_class relation ON relation.relnamespace = namespace.oid AND relation.relname = tables.table_name
    WHERE tables.table_schema <> 'information_schema'
      AND tables.table_schema NOT LIKE 'pg_%'
      AND tables.table_type IN ('BASE TABLE', 'VIEW')
      ${filter}
    ORDER BY COALESCE(relation.reltuples, 0) DESC, tables.table_schema, tables.table_name
    LIMIT $1
  `, values);

  return result.rows.map((row) => ({
    ...row,
    estimatedRowCount: typeof row.estimatedRowCount === "number" ? row.estimatedRowCount : null,
  }));
}

async function fetchPrimaryKey(client: ReturnType<typeof createExternalPostgresClient>, schemaName: string, tableName: string): Promise<unknown> {
  const result = await client.query<{ columnName: string }>(`
    SELECT attribute.attname AS "columnName"
    FROM pg_index index_def
    JOIN pg_class relation ON relation.oid = index_def.indrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid AND attribute.attnum = ANY(index_def.indkey)
    WHERE namespace.nspname = $1
      AND relation.relname = $2
      AND index_def.indisprimary = true
    ORDER BY attribute.attnum
  `, [schemaName, tableName]);

  return result.rows.length > 0 ? result.rows.map((row) => row.columnName) : null;
}

async function fetchForeignKeys(client: ReturnType<typeof createExternalPostgresClient>, schemaName: string, tableName: string): Promise<unknown> {
  const result = await client.query<{
    constraintName: string;
    columnName: string;
    foreignSchemaName: string;
    foreignTableName: string;
    foreignColumnName: string;
  }>(`
    SELECT
      source.constraint_name AS "constraintName",
      source.column_name AS "columnName",
      foreign_columns.table_schema AS "foreignSchemaName",
      foreign_columns.table_name AS "foreignTableName",
      foreign_columns.column_name AS "foreignColumnName"
    FROM information_schema.table_constraints constraints
    JOIN information_schema.key_column_usage source
      ON source.constraint_name = constraints.constraint_name
      AND source.constraint_schema = constraints.constraint_schema
    JOIN information_schema.referential_constraints references_link
      ON references_link.constraint_name = constraints.constraint_name
      AND references_link.constraint_schema = constraints.constraint_schema
    JOIN information_schema.key_column_usage foreign_columns
      ON foreign_columns.constraint_name = references_link.unique_constraint_name
      AND foreign_columns.constraint_schema = references_link.unique_constraint_schema
      AND foreign_columns.ordinal_position = source.ordinal_position
    WHERE constraints.constraint_type = 'FOREIGN KEY'
      AND constraints.table_schema = $1
      AND constraints.table_name = $2
    ORDER BY source.constraint_name, source.ordinal_position
  `, [schemaName, tableName]);

  return result.rows;
}

async function fetchIndexes(client: ReturnType<typeof createExternalPostgresClient>, schemaName: string, tableName: string): Promise<unknown> {
  const result = await client.query<{ indexname: string; indexdef: string }>(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = $1
      AND tablename = $2
    ORDER BY indexname
  `, [schemaName, tableName]);

  return result.rows;
}

async function fetchColumns(client: ReturnType<typeof createExternalPostgresClient>, schemaName: string, tableName: string): Promise<ProfiledColumnRow[]> {
  const result = await client.query<ProfiledColumnRow>(`
    SELECT
      columns.column_name AS "columnName",
      columns.data_type AS "dataType",
      (columns.is_nullable = 'YES') AS "isNullable",
      (columns.data_type = 'ARRAY') AS "isArray",
      (columns.data_type IN ('json', 'jsonb')) AS "isJson",
      CASE
        WHEN stats.n_distinct IS NULL THEN NULL
        ELSE stats.n_distinct::double precision
      END AS "distinctEstimate",
      CASE
        WHEN stats.null_frac IS NULL THEN NULL
        ELSE stats.null_frac::double precision
      END AS "nullFraction",
      CASE
        WHEN stats.avg_width IS NULL THEN NULL
        ELSE stats.avg_width::double precision
      END AS "avgWidth"
    FROM information_schema.columns columns
    LEFT JOIN pg_stats stats
      ON stats.schemaname = columns.table_schema
      AND stats.tablename = columns.table_name
      AND stats.attname = columns.column_name
    WHERE columns.table_schema = $1
      AND columns.table_name = $2
    ORDER BY columns.ordinal_position
  `, [schemaName, tableName]);

  return result.rows;
}

export async function profileCreeperSource(options: ProfileSourceOptions): Promise<{
  scanId: string;
  summary: CreeperProfileSummary;
  profiledSchemas: string[];
  profiledTables: string[];
  flaggedTables: string[];
  skippedTables: string[];
}> {
  const maxTables = normalizeMaxTables(options.maxTables);
  const connectedSource = await getCreeperConnectedSource(options.sourceId);
  const allowedSchemas = resolveAllowedSchemas(connectedSource.source.metadata, options.schemaAllowlist);

  const scan = await db.sourceScan.create({
    data: {
      sourceId: connectedSource.source.id,
      status: SourceScanStatus.RUNNING,
      scanConfig: toJsonInput({
        allowedSchemas,
        maxTables,
        includeRowEstimates: options.includeRowEstimates ?? true,
      }),
    },
  });

  const client = createExternalPostgresClient(connectedSource.source, connectedSource.password);

  try {
    await client.connect();

    const schemaRows = await fetchProfiledSchemas(client, allowedSchemas);
    const tableRows = await fetchProfiledTables(client, allowedSchemas, maxTables);
    const profiledSchemas = schemaRows.map((row) => row.schemaName);
    const profiledTables = tableRows.map((row) => `${row.schemaName}.${row.tableName}`);
    const flaggedTables: string[] = [];
    const skippedTables: string[] = [];
    let columnCount = 0;

    await db.$transaction(async (tx) => {
      for (const schemaRow of schemaRows) {
        await tx.sourceSchemaProfile.create({
          data: {
            scanId: scan.id,
            schemaName: schemaRow.schemaName,
            tableCount: schemaRow.tableCount,
            viewCount: schemaRow.viewCount,
          },
        });
      }

      for (const tableRow of tableRows) {
        const columns = await fetchColumns(client, tableRow.schemaName, tableRow.tableName);
        columnCount += columns.length;
        const classification = classifyTable(tableRow.tableName, columns);
        const hasSensitiveColumns = columns.some((column) => inferColumnSensitivity(column.columnName).level !== "low");
        if (hasSensitiveColumns || classification.sensitivity === "review") {
          flaggedTables.push(`${tableRow.schemaName}.${tableRow.tableName}`);
        }

        const tableProfile = await tx.sourceTableProfile.create({
          data: {
            scanId: scan.id,
            schemaName: tableRow.schemaName,
            tableName: tableRow.tableName,
            tableType: tableRow.tableType,
            estimatedRowCount: options.includeRowEstimates === false ? null : tableRow.estimatedRowCount,
            primaryKey: toJsonInput(await fetchPrimaryKey(client, tableRow.schemaName, tableRow.tableName)),
            foreignKeys: toJsonInput(await fetchForeignKeys(client, tableRow.schemaName, tableRow.tableName)),
            indexes: toJsonInput(await fetchIndexes(client, tableRow.schemaName, tableRow.tableName)),
            sampleSummary: toJsonInput({
              profiledColumnCount: columns.length,
            }),
            classification: toJsonInput(classification),
            ingestionScore: computeIngestionScore(tableRow, columns),
          },
        });

        for (const column of columns) {
          const sensitivity = inferColumnSensitivity(column.columnName);
          await tx.sourceColumnProfile.create({
            data: {
              tableProfileId: tableProfile.id,
              columnName: column.columnName,
              dataType: column.dataType,
              isNullable: column.isNullable,
              isArray: column.isArray,
              isJson: column.isJson,
              distinctEstimate: column.distinctEstimate,
              nullFraction: column.nullFraction,
              avgWidth: column.avgWidth,
              semanticTags: toJsonInput(inferColumnTags(column.columnName, column.dataType)),
              sensitivity: toJsonInput(sensitivity),
              sampleValues: toJsonInput([]),
            },
          });
        }
      }
    });

    const summary: CreeperProfileSummary = {
      schemaCount: schemaRows.length,
      tableCount: tableRows.length,
      columnCount,
      flaggedTableCount: flaggedTables.length,
      skippedTableCount: skippedTables.length,
    };

    await db.sourceScan.update({
      where: { id: scan.id },
      data: {
        status: SourceScanStatus.SUCCEEDED,
        startedAt: scan.startedAt ?? scan.createdAt,
        completedAt: new Date(),
        summary: toJsonInput(summary),
      },
    });

    await db.externalDataSource.update({
      where: { id: connectedSource.source.id },
      data: {
        status: ExternalDataSourceStatus.PROFILED,
        lastProfiledAt: new Date(),
      },
    });

    return {
      scanId: scan.id,
      summary,
      profiledSchemas,
      profiledTables,
      flaggedTables,
      skippedTables,
    };
  } catch (error) {
    await db.sourceScan.update({
      where: { id: scan.id },
      data: {
        status: SourceScanStatus.FAILED,
        completedAt: new Date(),
        errorText: error instanceof Error ? error.message : String(error),
      },
    });
    await db.externalDataSource.update({
      where: { id: connectedSource.source.id },
      data: {
        status: ExternalDataSourceStatus.FAILED,
      },
    });
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function listCreeperSourceAssets(sourceId: string, options?: {
  schema?: string;
  includeColumns?: boolean;
  includeStats?: boolean;
}) {
  const source = await db.externalDataSource.findUnique({
    where: { id: sourceId },
    select: {
      id: true,
      label: true,
      status: true,
    },
  });

  if (!source) {
    throw new Error(`Unknown source '${sourceId}'.`);
  }

  const latestScan = await db.sourceScan.findFirst({
    where: {
      sourceId,
      status: SourceScanStatus.SUCCEEDED,
    },
    orderBy: {
      createdAt: "desc",
    },
    include: {
      schemaProfiles: {
        where: options?.schema ? { schemaName: options.schema } : undefined,
        orderBy: { schemaName: "asc" },
      },
      tableProfiles: {
        where: options?.schema ? { schemaName: options.schema } : undefined,
        orderBy: [
          { schemaName: "asc" },
          { tableName: "asc" },
        ],
        include: options?.includeColumns
          ? {
            columns: {
              orderBy: { columnName: "asc" },
            },
          }
          : undefined,
      },
    },
  });

  if (!latestScan) {
    return {
      sourceId: source.id,
      sourceLabel: source.label,
      sourceStatus: source.status,
      latestScanId: null,
      schemas: [],
      tables: [],
    };
  }

  return {
    sourceId: source.id,
    sourceLabel: source.label,
    sourceStatus: source.status,
    latestScanId: latestScan.id,
    latestScanCreatedAt: latestScan.createdAt.toISOString(),
    schemas: latestScan.schemaProfiles.map((schemaProfile) => ({
      schemaName: schemaProfile.schemaName,
      tableCount: schemaProfile.tableCount,
      viewCount: schemaProfile.viewCount,
    })),
    tables: latestScan.tableProfiles.map((tableProfile) => {
      const serializedTable = {
        schemaName: tableProfile.schemaName,
        tableName: tableProfile.tableName,
        tableType: tableProfile.tableType,
        ...(options?.includeStats ? {
          estimatedRowCount: tableProfile.estimatedRowCount,
          ingestionScore: tableProfile.ingestionScore,
          classification: tableProfile.classification,
        } : {}),
      };

      if (!options?.includeColumns || !("columns" in tableProfile) || !Array.isArray(tableProfile.columns)) {
        return serializedTable;
      }

      return {
        ...serializedTable,
        columns: tableProfile.columns.map((column) => ({
          columnName: column.columnName,
          dataType: column.dataType,
          isNullable: column.isNullable,
          isArray: column.isArray,
          isJson: column.isJson,
          ...(options?.includeStats ? {
            distinctEstimate: column.distinctEstimate,
            nullFraction: column.nullFraction,
            avgWidth: column.avgWidth,
            semanticTags: column.semanticTags,
            sensitivity: column.sensitivity,
          } : {}),
        })),
      };
    }),
  };
}
