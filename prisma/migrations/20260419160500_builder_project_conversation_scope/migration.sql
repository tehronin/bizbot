ALTER TABLE "Conversation"
ADD COLUMN "builderProjectId" TEXT;

ALTER TABLE "Conversation"
ADD CONSTRAINT "Conversation_builderProjectId_fkey"
FOREIGN KEY ("builderProjectId") REFERENCES "BuilderProject"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "Conversation_builderProjectId_archivedAt_deletedAt_lastMessageA_idx"
ON "Conversation"("builderProjectId", "archivedAt", "deletedAt", "lastMessageAt");