import { Client } from "pg";
import type { ExternalDataSource } from "@prisma/client";
import type { CreeperPostgresSslMode, CreeperSourceTestResult } from "@/lib/creeper/types";

interface PostgresPrivilegeAssessmentRow {
  currentDatabase: string;
  currentUser: string;
  serverVersion: string;
  transactionReadOnly: string;
  reachableSchemasCount: string | number;
  canCreateDatabaseObjects: boolean;
  canWriteTables: boolean;
  ownsNonSystemSchemas: boolean;
  ownsNonSystemRelations: boolean;
}

function buildSslConfig(sslMode: CreeperPostgresSslMode, sslRejectUnauthorized: boolean, host: string) {
  if (sslMode === "disable") {
    return false;
  }

  return {
    rejectUnauthorized: sslRejectUnauthorized,
    servername: sslMode === "verify-full" ? host : undefined,
  };
}

export function createExternalPostgresClient(source: ExternalDataSource, password: string): Client {
  return new Client({
    host: source.host,
    port: source.port,
    database: source.databaseName,
    user: source.username,
    password,
    ssl: buildSslConfig(source.sslMode as CreeperPostgresSslMode, source.sslRejectUnauthorized, source.host),
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    query_timeout: 15_000,
    application_name: "bizbot-creeper",
  });
}

export async function testExternalPostgresConnection(source: ExternalDataSource, password: string): Promise<CreeperSourceTestResult> {
  const client = createExternalPostgresClient(source, password);
  const startedAt = Date.now();

  try {
    await client.connect();
    const latencyMs = Date.now() - startedAt;

    const privilegeResult = await client.query<PostgresPrivilegeAssessmentRow>(`
      WITH non_system_schemas AS (
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name <> 'information_schema'
          AND schema_name NOT LIKE 'pg_%'
      )
      SELECT
        current_database() AS "currentDatabase",
        current_user AS "currentUser",
        current_setting('server_version') AS "serverVersion",
        current_setting('transaction_read_only', true) AS "transactionReadOnly",
        (
          SELECT COUNT(*)
          FROM non_system_schemas
        ) AS "reachableSchemasCount",
        (
          has_database_privilege(current_user, current_database(), 'CREATE')
          OR EXISTS(
            SELECT 1
            FROM non_system_schemas
            WHERE has_schema_privilege(current_user, schema_name, 'CREATE')
          )
        ) AS "canCreateDatabaseObjects",
        EXISTS(
          SELECT 1
          FROM information_schema.table_privileges privileges
          JOIN non_system_schemas schemas ON schemas.schema_name = privileges.table_schema
          WHERE privileges.grantee = current_user
            AND privileges.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
        ) AS "canWriteTables",
        EXISTS(
          SELECT 1
          FROM pg_namespace namespace
          WHERE namespace.nspname <> 'information_schema'
            AND namespace.nspname NOT LIKE 'pg_%'
            AND pg_get_userbyid(namespace.nspowner) = current_user
        ) AS "ownsNonSystemSchemas",
        EXISTS(
          SELECT 1
          FROM pg_class relation
          JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname <> 'information_schema'
            AND namespace.nspname NOT LIKE 'pg_%'
            AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
            AND pg_get_userbyid(relation.relowner) = current_user
        ) AS "ownsNonSystemRelations"
    `);

    const row = privilegeResult.rows[0];
    if (!row) {
      throw new Error("Source connection test did not return a privilege assessment.");
    }

    const reasons: string[] = [];
    const transactionReadOnly = row.transactionReadOnly === "on";

    if (!transactionReadOnly) {
      reasons.push("session is not marked transaction_read_only");
    }
    if (row.canCreateDatabaseObjects) {
      reasons.push("role can create database or schema objects");
    }
    if (row.canWriteTables) {
      reasons.push("role has write privileges on one or more non-system tables");
    }
    if (row.ownsNonSystemSchemas) {
      reasons.push("role owns one or more non-system schemas");
    }
    if (row.ownsNonSystemRelations) {
      reasons.push("role owns one or more non-system relations");
    }

    return {
      ok: reasons.length === 0,
      serverVersion: row.serverVersion,
      currentDatabase: row.currentDatabase,
      currentUser: row.currentUser,
      readOnlyAssessment: {
        ok: reasons.length === 0,
        transactionReadOnly,
        canCreateDatabaseObjects: row.canCreateDatabaseObjects,
        canWriteTables: row.canWriteTables,
        ownsNonSystemSchemas: row.ownsNonSystemSchemas,
        ownsNonSystemRelations: row.ownsNonSystemRelations,
        reasons,
      },
      reachableSchemasCount: Number(row.reachableSchemasCount) || 0,
      latencyMs,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}
