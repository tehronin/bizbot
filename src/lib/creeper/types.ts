export const CREEPER_POSTGRES_SSL_MODES = ["disable", "prefer", "require", "verify-ca", "verify-full"] as const;

export type CreeperPostgresSslMode = typeof CREEPER_POSTGRES_SSL_MODES[number];

export interface CreeperMaskedConnectionSummary {
  label: string;
  host: string;
  port: number;
  database: string;
  username: string;
  sslMode: CreeperPostgresSslMode;
  sslRejectUnauthorized: boolean;
  allowedSchemas: string[];
}

export interface CreeperReadOnlyAssessment {
  ok: boolean;
  transactionReadOnly: boolean;
  canCreateDatabaseObjects: boolean;
  canWriteTables: boolean;
  ownsNonSystemSchemas: boolean;
  ownsNonSystemRelations: boolean;
  reasons: string[];
}

export interface CreeperSourceTestResult {
  ok: boolean;
  serverVersion: string;
  currentDatabase: string;
  currentUser: string;
  readOnlyAssessment: CreeperReadOnlyAssessment;
  reachableSchemasCount: number;
  latencyMs: number;
}

export interface CreeperProfileSummary {
  schemaCount: number;
  tableCount: number;
  columnCount: number;
  flaggedTableCount: number;
  skippedTableCount: number;
}
