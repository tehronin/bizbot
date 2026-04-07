-- CreateTable
CREATE TABLE "public"."mcp_snapshots" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "taskId" TEXT,
    "taskSpecId" TEXT,
    "snapshotSequence" INTEGER NOT NULL,
    "versionHash" TEXT NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "mappingsJson" JSONB,
    "metadata" JSONB,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_snapshots_pkey" PRIMARY KEY ("id")
);

-- Reserved for future v4.2 raw SQL enrichment only.
-- ALTER TABLE "public"."mcp_snapshots" ADD COLUMN "snapshotEmbedding" vector(1536);

-- CreateIndex
CREATE UNIQUE INDEX "mcp_snapshots_runId_snapshotSequence_key" ON "public"."mcp_snapshots"("runId", "snapshotSequence");

-- CreateIndex
CREATE INDEX "mcp_snapshots_projectId_appliedAt_idx" ON "public"."mcp_snapshots"("projectId", "appliedAt");

-- CreateIndex
CREATE INDEX "mcp_snapshots_runId_appliedAt_idx" ON "public"."mcp_snapshots"("runId", "appliedAt");

-- CreateIndex
CREATE INDEX "mcp_snapshots_runId_versionHash_idx" ON "public"."mcp_snapshots"("runId", "versionHash");

-- CreateIndex
CREATE INDEX "mcp_snapshots_taskId_appliedAt_idx" ON "public"."mcp_snapshots"("taskId", "appliedAt");

-- CreateIndex
CREATE INDEX "mcp_snapshots_taskSpecId_appliedAt_idx" ON "public"."mcp_snapshots"("taskSpecId", "appliedAt");

-- AddForeignKey
ALTER TABLE "public"."mcp_snapshots" ADD CONSTRAINT "mcp_snapshots_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."BuilderProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."mcp_snapshots" ADD CONSTRAINT "mcp_snapshots_runId_fkey" FOREIGN KEY ("runId") REFERENCES "public"."BuilderRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."mcp_snapshots" ADD CONSTRAINT "mcp_snapshots_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."BuilderTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."mcp_snapshots" ADD CONSTRAINT "mcp_snapshots_taskSpecId_fkey" FOREIGN KEY ("taskSpecId") REFERENCES "public"."BuilderTaskSpec"("id") ON DELETE SET NULL ON UPDATE CASCADE;