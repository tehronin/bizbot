DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'BuilderRunKind' AND e.enumlabel = 'ORCHESTRATION') THEN
    ALTER TYPE "BuilderRunKind" ADD VALUE 'ORCHESTRATION';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BuilderTaskStatus') THEN
    CREATE TYPE "BuilderTaskStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BuilderTaskStage') THEN
    CREATE TYPE "BuilderTaskStage" AS ENUM ('PLANNING', 'IMPLEMENTING', 'TESTING', 'REVIEW', 'DOCUMENTING', 'DONE');
  END IF;
END $$;

ALTER TABLE "BuilderProject"
  ADD COLUMN IF NOT EXISTS "context" JSONB,
  ADD COLUMN IF NOT EXISTS "latestSessionSummary" TEXT;

ALTER TABLE "BuilderRun"
  ADD COLUMN IF NOT EXISTS "taskId" TEXT;

CREATE TABLE IF NOT EXISTS "BuilderTask" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" "BuilderTaskStatus" NOT NULL DEFAULT 'PENDING',
  "stage" "BuilderTaskStage" NOT NULL DEFAULT 'PLANNING',
  "acceptanceCriteria" JSONB,
  "summary" TEXT,
  "parentTaskId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BuilderTask_projectId_fkey'
  ) THEN
    ALTER TABLE "BuilderTask"
      ADD CONSTRAINT "BuilderTask_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "BuilderProject"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BuilderTask_parentTaskId_fkey'
  ) THEN
    ALTER TABLE "BuilderTask"
      ADD CONSTRAINT "BuilderTask_parentTaskId_fkey"
      FOREIGN KEY ("parentTaskId") REFERENCES "BuilderTask"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BuilderRun_taskId_fkey'
  ) THEN
    ALTER TABLE "BuilderRun"
      ADD CONSTRAINT "BuilderRun_taskId_fkey"
      FOREIGN KEY ("taskId") REFERENCES "BuilderTask"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "BuilderRun_taskId_startedAt_idx"
  ON "BuilderRun" ("taskId", "startedAt");

CREATE INDEX IF NOT EXISTS "BuilderTask_projectId_status_updatedAt_idx"
  ON "BuilderTask" ("projectId", "status", "updatedAt");

CREATE INDEX IF NOT EXISTS "BuilderTask_projectId_stage_updatedAt_idx"
  ON "BuilderTask" ("projectId", "stage", "updatedAt");
