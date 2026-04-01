CREATE TABLE IF NOT EXISTS "OntologyEntity" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "scope" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "canonicalKey" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "description" TEXT NULL,
  "attributes" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "status" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "OntologyRelation" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "scope" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "subjectEntityId" TEXT NOT NULL REFERENCES "OntologyEntity"("id") ON DELETE CASCADE,
  "objectEntityId" TEXT NOT NULL REFERENCES "OntologyEntity"("id") ON DELETE CASCADE,
  "attributes" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "source" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "OntologyAlias" (
  "id" TEXT PRIMARY KEY,
  "entityId" TEXT NOT NULL REFERENCES "OntologyEntity"("id") ON DELETE CASCADE,
  "scope" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "normalizedValue" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "OntologyEvidence" (
  "id" TEXT PRIMARY KEY,
  "entityId" TEXT NULL REFERENCES "OntologyEntity"("id") ON DELETE CASCADE,
  "relationId" TEXT NULL REFERENCES "OntologyRelation"("id") ON DELETE CASCADE,
  "sourceKind" TEXT NOT NULL,
  "sourceRef" TEXT NOT NULL,
  "approvalMarker" TEXT NULL,
  "note" TEXT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "OntologyEvidence_exactly_one_target"
    CHECK ((CASE WHEN "entityId" IS NULL THEN 0 ELSE 1 END) + (CASE WHEN "relationId" IS NULL THEN 0 ELSE 1 END) = 1)
);

CREATE INDEX IF NOT EXISTS "OntologyEntity_user_scope_type_key_idx"
  ON "OntologyEntity" ("userId", "scope", "type", "canonicalKey");

CREATE INDEX IF NOT EXISTS "OntologyEntity_scope_type_key_idx"
  ON "OntologyEntity" ("scope", "type", "canonicalKey");

CREATE INDEX IF NOT EXISTS "OntologyEntity_status_scope_idx"
  ON "OntologyEntity" ("status", "scope");

CREATE INDEX IF NOT EXISTS "OntologyRelation_user_scope_type_idx"
  ON "OntologyRelation" ("userId", "scope", "type");

CREATE INDEX IF NOT EXISTS "OntologyRelation_subject_type_idx"
  ON "OntologyRelation" ("subjectEntityId", "type");

CREATE INDEX IF NOT EXISTS "OntologyRelation_object_type_idx"
  ON "OntologyRelation" ("objectEntityId", "type");

CREATE INDEX IF NOT EXISTS "OntologyRelation_active_scope_idx"
  ON "OntologyRelation" ("isActive", "scope");

CREATE INDEX IF NOT EXISTS "OntologyAlias_scope_normalized_idx"
  ON "OntologyAlias" ("scope", "normalizedValue");

CREATE INDEX IF NOT EXISTS "OntologyAlias_entity_kind_idx"
  ON "OntologyAlias" ("entityId", "kind");

CREATE INDEX IF NOT EXISTS "OntologyEvidence_entity_idx"
  ON "OntologyEvidence" ("entityId");

CREATE INDEX IF NOT EXISTS "OntologyEvidence_relation_idx"
  ON "OntologyEvidence" ("relationId");

CREATE INDEX IF NOT EXISTS "OntologyEvidence_source_idx"
  ON "OntologyEvidence" ("sourceKind", "sourceRef");