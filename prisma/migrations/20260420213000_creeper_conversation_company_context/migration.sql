ALTER TABLE "Conversation"
ADD COLUMN "companyProfileId" TEXT;

CREATE INDEX "Conversation_companyProfileId_archivedAt_deletedAt_lastMessageAt_idx"
ON "Conversation"("companyProfileId", "archivedAt", "deletedAt", "lastMessageAt");

ALTER TABLE "Conversation"
ADD CONSTRAINT "Conversation_companyProfileId_fkey"
FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id")
ON DELETE SET NULL ON UPDATE CASCADE;