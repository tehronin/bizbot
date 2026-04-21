CREATE TYPE "ExternalDataSourceType" AS ENUM ('POSTGRES');
CREATE TYPE "ExternalDataSourceStatus" AS ENUM ('PENDING', 'READY', 'PROFILED', 'DISCONNECTED', 'FAILED', 'ARCHIVED');
CREATE TYPE "SourceScanStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "CompanyIngestionPlanStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED', 'ARCHIVED');
CREATE TYPE "CompanyIngestionRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL', 'CANCELLED');
CREATE TYPE "CompanyChunkKind" AS ENUM ('ROW', 'ENTITY', 'EVENT_ROLLUP', 'TEXT_WINDOW', 'JSON_SUMMARY', 'RELATION_SUMMARY');
CREATE TYPE "CompanyEntityLinkType" AS ENUM ('EXPLICIT', 'INFERRED');

CREATE TABLE "CompanyProfile" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL,
  "ontologyConfig" JSONB,
  "retrievalConfig" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CompanyProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalDataSource" (
  "id" TEXT NOT NULL,
  "type" "ExternalDataSourceType" NOT NULL,
  "label" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "port" INTEGER NOT NULL,
  "databaseName" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "sslMode" TEXT NOT NULL,
  "sslRejectUnauthorized" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "status" "ExternalDataSourceStatus" NOT NULL DEFAULT 'PENDING',
  "lastTestedAt" TIMESTAMP(3),
  "lastProfiledAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExternalDataSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalDataSourceSecret" (
  "sourceId" TEXT NOT NULL,
  "encryptedPassword" TEXT NOT NULL,
  "encryptionKeyVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExternalDataSourceSecret_pkey" PRIMARY KEY ("sourceId")
);

CREATE TABLE "CompanyProfileSource" (
  "id" TEXT NOT NULL,
  "companyProfileId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "role" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CompanyProfileSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceScan" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "status" "SourceScanStatus" NOT NULL DEFAULT 'QUEUED',
  "startedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "summary" JSONB,
  "errorText" TEXT,
  "scanConfig" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SourceScan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceSchemaProfile" (
  "id" TEXT NOT NULL,
  "scanId" TEXT NOT NULL,
  "schemaName" TEXT NOT NULL,
  "tableCount" INTEGER NOT NULL,
  "viewCount" INTEGER NOT NULL,
  "metadata" JSONB,

  CONSTRAINT "SourceSchemaProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceTableProfile" (
  "id" TEXT NOT NULL,
  "scanId" TEXT NOT NULL,
  "schemaName" TEXT NOT NULL,
  "tableName" TEXT NOT NULL,
  "tableType" TEXT NOT NULL,
  "estimatedRowCount" INTEGER,
  "exactRowCount" INTEGER,
  "primaryKey" JSONB,
  "foreignKeys" JSONB,
  "indexes" JSONB,
  "sampleSummary" JSONB,
  "classification" JSONB,
  "ingestionScore" DOUBLE PRECISION,
  "metadata" JSONB,

  CONSTRAINT "SourceTableProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceColumnProfile" (
  "id" TEXT NOT NULL,
  "tableProfileId" TEXT NOT NULL,
  "columnName" TEXT NOT NULL,
  "dataType" TEXT NOT NULL,
  "isNullable" BOOLEAN NOT NULL,
  "isArray" BOOLEAN NOT NULL,
  "isJson" BOOLEAN NOT NULL,
  "distinctEstimate" DOUBLE PRECISION,
  "nullFraction" DOUBLE PRECISION,
  "avgWidth" DOUBLE PRECISION,
  "semanticTags" JSONB,
  "sensitivity" JSONB,
  "sampleValues" JSONB,
  "metadata" JSONB,

  CONSTRAINT "SourceColumnProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyIngestionPlan" (
  "id" TEXT NOT NULL,
  "companyProfileId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "status" "CompanyIngestionPlanStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL,
  "businessGoal" TEXT,
  "selectedTables" JSONB NOT NULL,
  "selectedColumns" JSONB NOT NULL,
  "redactionPolicy" JSONB NOT NULL,
  "chunkingPolicy" JSONB NOT NULL,
  "embeddingPolicy" JSONB NOT NULL,
  "ontologyPolicy" JSONB NOT NULL,
  "graphPolicy" JSONB NOT NULL,
  "retrievalPolicy" JSONB NOT NULL,
  "plannerNotes" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CompanyIngestionPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyIngestionRun" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "status" "CompanyIngestionRunStatus" NOT NULL DEFAULT 'QUEUED',
  "mode" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "counters" JSONB NOT NULL,
  "errorText" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CompanyIngestionRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyKnowledgeChunk" (
  "id" TEXT NOT NULL,
  "companyProfileId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "schemaName" TEXT NOT NULL,
  "tableName" TEXT NOT NULL,
  "sourcePrimaryKey" JSONB,
  "chunkKind" "CompanyChunkKind" NOT NULL,
  "title" TEXT,
  "content" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "tokenEstimate" INTEGER,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CompanyKnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyKnowledgeEmbedding" (
  "id" TEXT NOT NULL,
  "chunkId" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "dimensions" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CompanyKnowledgeEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyEntity" (
  "id" TEXT NOT NULL,
  "companyProfileId" TEXT NOT NULL,
  "canonicalName" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "sourceConfidence" DOUBLE PRECISION NOT NULL,
  "attributes" JSONB NOT NULL,
  "sourceRefs" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CompanyEntity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyRelation" (
  "id" TEXT NOT NULL,
  "companyProfileId" TEXT NOT NULL,
  "fromEntityId" TEXT NOT NULL,
  "toEntityId" TEXT NOT NULL,
  "relationType" TEXT NOT NULL,
  "linkType" "CompanyEntityLinkType" NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "sourceRefs" JSONB NOT NULL,
  "attributes" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CompanyRelation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyRetrievalAudit" (
  "id" TEXT NOT NULL,
  "companyProfileId" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "retrievedChunkIds" JSONB NOT NULL,
  "retrievedEntityIds" JSONB,
  "answerSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CompanyRetrievalAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyProfile_slug_key" ON "CompanyProfile"("slug");
CREATE INDEX "CompanyProfile_status_updatedAt_idx" ON "CompanyProfile"("status", "updatedAt");

CREATE INDEX "ExternalDataSource_status_updatedAt_idx" ON "ExternalDataSource"("status", "updatedAt");
CREATE INDEX "ExternalDataSource_host_databaseName_idx" ON "ExternalDataSource"("host", "databaseName");

CREATE UNIQUE INDEX "CompanyProfileSource_companyProfileId_sourceId_key" ON "CompanyProfileSource"("companyProfileId", "sourceId");
CREATE INDEX "CompanyProfileSource_companyProfileId_isPrimary_idx" ON "CompanyProfileSource"("companyProfileId", "isPrimary");
CREATE INDEX "CompanyProfileSource_sourceId_createdAt_idx" ON "CompanyProfileSource"("sourceId", "createdAt");

CREATE INDEX "SourceScan_sourceId_createdAt_idx" ON "SourceScan"("sourceId", "createdAt");
CREATE INDEX "SourceScan_sourceId_status_createdAt_idx" ON "SourceScan"("sourceId", "status", "createdAt");

CREATE UNIQUE INDEX "SourceSchemaProfile_scanId_schemaName_key" ON "SourceSchemaProfile"("scanId", "schemaName");
CREATE INDEX "SourceSchemaProfile_schemaName_idx" ON "SourceSchemaProfile"("schemaName");

CREATE UNIQUE INDEX "SourceTableProfile_scanId_schemaName_tableName_key" ON "SourceTableProfile"("scanId", "schemaName", "tableName");
CREATE INDEX "SourceTableProfile_schemaName_tableName_idx" ON "SourceTableProfile"("schemaName", "tableName");
CREATE INDEX "SourceTableProfile_scanId_ingestionScore_idx" ON "SourceTableProfile"("scanId", "ingestionScore");

CREATE UNIQUE INDEX "SourceColumnProfile_tableProfileId_columnName_key" ON "SourceColumnProfile"("tableProfileId", "columnName");
CREATE INDEX "SourceColumnProfile_columnName_idx" ON "SourceColumnProfile"("columnName");

CREATE UNIQUE INDEX "CompanyIngestionPlan_companyProfileId_version_key" ON "CompanyIngestionPlan"("companyProfileId", "version");
CREATE INDEX "CompanyIngestionPlan_companyProfileId_status_updatedAt_idx" ON "CompanyIngestionPlan"("companyProfileId", "status", "updatedAt");
CREATE INDEX "CompanyIngestionPlan_sourceId_status_updatedAt_idx" ON "CompanyIngestionPlan"("sourceId", "status", "updatedAt");

CREATE INDEX "CompanyIngestionRun_planId_createdAt_idx" ON "CompanyIngestionRun"("planId", "createdAt");
CREATE INDEX "CompanyIngestionRun_status_updatedAt_idx" ON "CompanyIngestionRun"("status", "updatedAt");
CREATE INDEX "CompanyIngestionRun_startedAt_completedAt_idx" ON "CompanyIngestionRun"("startedAt", "completedAt");

CREATE INDEX "CompanyKnowledgeChunk_companyProfileId_createdAt_idx" ON "CompanyKnowledgeChunk"("companyProfileId", "createdAt");
CREATE INDEX "CompanyKnowledgeChunk_sourceId_schemaName_tableName_idx" ON "CompanyKnowledgeChunk"("sourceId", "schemaName", "tableName");
CREATE INDEX "CompanyKnowledgeChunk_runId_createdAt_idx" ON "CompanyKnowledgeChunk"("runId", "createdAt");
CREATE INDEX "CompanyKnowledgeChunk_contentHash_idx" ON "CompanyKnowledgeChunk"("contentHash");

CREATE UNIQUE INDEX "CompanyKnowledgeEmbedding_chunkId_key" ON "CompanyKnowledgeEmbedding"("chunkId");

CREATE INDEX "CompanyEntity_companyProfileId_entityType_canonicalName_idx" ON "CompanyEntity"("companyProfileId", "entityType", "canonicalName");
CREATE INDEX "CompanyEntity_companyProfileId_updatedAt_idx" ON "CompanyEntity"("companyProfileId", "updatedAt");

CREATE INDEX "CompanyRelation_companyProfileId_relationType_createdAt_idx" ON "CompanyRelation"("companyProfileId", "relationType", "createdAt");
CREATE INDEX "CompanyRelation_fromEntityId_relationType_idx" ON "CompanyRelation"("fromEntityId", "relationType");
CREATE INDEX "CompanyRelation_toEntityId_relationType_idx" ON "CompanyRelation"("toEntityId", "relationType");

CREATE INDEX "CompanyRetrievalAudit_companyProfileId_createdAt_idx" ON "CompanyRetrievalAudit"("companyProfileId", "createdAt");

ALTER TABLE "ExternalDataSourceSecret"
ADD CONSTRAINT "ExternalDataSourceSecret_sourceId_fkey"
FOREIGN KEY ("sourceId") REFERENCES "ExternalDataSource"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyProfileSource"
ADD CONSTRAINT "CompanyProfileSource_companyProfileId_fkey"
FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyProfileSource"
ADD CONSTRAINT "CompanyProfileSource_sourceId_fkey"
FOREIGN KEY ("sourceId") REFERENCES "ExternalDataSource"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SourceScan"
ADD CONSTRAINT "SourceScan_sourceId_fkey"
FOREIGN KEY ("sourceId") REFERENCES "ExternalDataSource"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SourceSchemaProfile"
ADD CONSTRAINT "SourceSchemaProfile_scanId_fkey"
FOREIGN KEY ("scanId") REFERENCES "SourceScan"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SourceTableProfile"
ADD CONSTRAINT "SourceTableProfile_scanId_fkey"
FOREIGN KEY ("scanId") REFERENCES "SourceScan"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SourceColumnProfile"
ADD CONSTRAINT "SourceColumnProfile_tableProfileId_fkey"
FOREIGN KEY ("tableProfileId") REFERENCES "SourceTableProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyIngestionPlan"
ADD CONSTRAINT "CompanyIngestionPlan_companyProfileId_fkey"
FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyIngestionPlan"
ADD CONSTRAINT "CompanyIngestionPlan_sourceId_fkey"
FOREIGN KEY ("sourceId") REFERENCES "ExternalDataSource"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyIngestionRun"
ADD CONSTRAINT "CompanyIngestionRun_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "CompanyIngestionPlan"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyKnowledgeChunk"
ADD CONSTRAINT "CompanyKnowledgeChunk_companyProfileId_fkey"
FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyKnowledgeChunk"
ADD CONSTRAINT "CompanyKnowledgeChunk_sourceId_fkey"
FOREIGN KEY ("sourceId") REFERENCES "ExternalDataSource"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyKnowledgeChunk"
ADD CONSTRAINT "CompanyKnowledgeChunk_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "CompanyIngestionRun"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyKnowledgeEmbedding"
ADD CONSTRAINT "CompanyKnowledgeEmbedding_chunkId_fkey"
FOREIGN KEY ("chunkId") REFERENCES "CompanyKnowledgeChunk"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyEntity"
ADD CONSTRAINT "CompanyEntity_companyProfileId_fkey"
FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyRelation"
ADD CONSTRAINT "CompanyRelation_companyProfileId_fkey"
FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyRelation"
ADD CONSTRAINT "CompanyRelation_fromEntityId_fkey"
FOREIGN KEY ("fromEntityId") REFERENCES "CompanyEntity"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyRelation"
ADD CONSTRAINT "CompanyRelation_toEntityId_fkey"
FOREIGN KEY ("toEntityId") REFERENCES "CompanyEntity"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyRetrievalAudit"
ADD CONSTRAINT "CompanyRetrievalAudit_companyProfileId_fkey"
FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyKnowledgeEmbedding"
ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS "CompanyKnowledgeEmbedding_embedding_idx"
ON "CompanyKnowledgeEmbedding"
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
