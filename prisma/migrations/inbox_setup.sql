DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InboxChannelType') THEN
    CREATE TYPE "InboxChannelType" AS ENUM ('SOCIAL_MENTION', 'DIRECT_MESSAGE');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InboxStatus') THEN
    CREATE TYPE "InboxStatus" AS ENUM ('OPEN', 'PROCESSING', 'DRAFTED', 'REPLIED', 'DISMISSED', 'FAILED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "InboxMessage" (
  "id" TEXT PRIMARY KEY,
  "platformId" TEXT NOT NULL,
  "channelType" "InboxChannelType" NOT NULL,
  "status" "InboxStatus" NOT NULL DEFAULT 'OPEN',
  "externalId" TEXT NOT NULL,
  "threadId" TEXT,
  "authorName" TEXT,
  "authorHandle" TEXT,
  "content" TEXT NOT NULL,
  "replyContent" TEXT,
  "replyPostId" TEXT,
  "metadata" JSONB,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboxMessage_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "InboxMessage_platformId_externalId_key"
  ON "InboxMessage" ("platformId", "externalId");

CREATE INDEX IF NOT EXISTS "InboxMessage_status_channelType_receivedAt_idx"
  ON "InboxMessage" ("status", "channelType", "receivedAt");