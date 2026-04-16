-- CreateEnum
CREATE TYPE "BuilderInteractionKind" AS ENUM (
  'MCP_POLICY_RECONCILIATION',
  'MCP_CONTRACT_DRIFT',
  'DEPENDENCY_CONTRACT_DRIFT',
  'FILE_TOPOLOGY_CONTRACT_DRIFT'
);

-- CreateEnum
CREATE TYPE "BuilderInteractionStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'RESOLVED'
);

-- CreateTable
CREATE TABLE "BuilderInteraction" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "conversationId" TEXT,
  "runId" TEXT,
  "kind" "BuilderInteractionKind" NOT NULL,
  "status" "BuilderInteractionStatus" NOT NULL DEFAULT 'PENDING',
  "dedupeKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "metadata" JSONB,
  "resolutionReason" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BuilderInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BuilderInteraction_dedupeKey_key" ON "BuilderInteraction"("dedupeKey");

-- CreateIndex
CREATE INDEX "BuilderInteraction_projectId_status_createdAt_idx" ON "BuilderInteraction"("projectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BuilderInteraction_conversationId_status_createdAt_idx" ON "BuilderInteraction"("conversationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BuilderInteraction_runId_status_createdAt_idx" ON "BuilderInteraction"("runId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "BuilderInteraction" ADD CONSTRAINT "BuilderInteraction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BuilderProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuilderInteraction" ADD CONSTRAINT "BuilderInteraction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuilderInteraction" ADD CONSTRAINT "BuilderInteraction_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BuilderRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
