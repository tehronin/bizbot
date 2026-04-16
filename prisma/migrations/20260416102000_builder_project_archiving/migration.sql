ALTER TABLE "BuilderProject"
ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "BuilderProject_archivedAt_updatedAt_idx"
ON "BuilderProject"("archivedAt", "updatedAt");
