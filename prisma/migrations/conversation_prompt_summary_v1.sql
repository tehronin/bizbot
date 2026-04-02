ALTER TABLE "Conversation"
ADD COLUMN IF NOT EXISTS "promptSummary" TEXT,
ADD COLUMN IF NOT EXISTS "promptSummaryUpdatedAt" TIMESTAMP(3);

UPDATE "Conversation"
SET "promptSummary" = NULL
WHERE "promptSummary" = '';