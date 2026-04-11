-- CreateEnum
CREATE TYPE "public"."ChatExecutionMode" AS ENUM ('ASK', 'AGENT');

-- AlterTable
ALTER TABLE "public"."Conversation"
ADD COLUMN "defaultMode" "public"."ChatExecutionMode" NOT NULL DEFAULT 'ASK',
ADD COLUMN "defaultPluginId" TEXT NOT NULL DEFAULT 'just-chatting';