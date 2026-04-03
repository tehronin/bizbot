-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."PlatformType" AS ENUM ('TWITTER', 'FACEBOOK', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "public"."LeadStage" AS ENUM ('NONE', 'LEAD', 'QUALIFIED', 'CONTACTED', 'CONVERTED', 'LOST');

-- CreateEnum
CREATE TYPE "public"."PostStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'AUTO_APPROVED');

-- CreateEnum
CREATE TYPE "public"."MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');

-- CreateEnum
CREATE TYPE "public"."PolicyType" AS ENUM ('GUARDRAIL', 'BRAND_VOICE', 'BROWSER_ALLOWLIST', 'SCHEDULE', 'AUTO_APPROVE');

-- CreateEnum
CREATE TYPE "public"."InboxChannelType" AS ENUM ('SOCIAL_MENTION', 'DIRECT_MESSAGE');

-- CreateEnum
CREATE TYPE "public"."InboxStatus" AS ENUM ('OPEN', 'PROCESSING', 'DRAFTED', 'REPLIED', 'DISMISSED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."BrowserActionType" AS ENUM ('NAVIGATE', 'SCREENSHOT', 'EXTRACT', 'FILL_FORM', 'CLICK', 'DOWNLOAD');

-- CreateEnum
CREATE TYPE "public"."BrowserActionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."GoogleBusinessPostStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."BuilderPackageManager" AS ENUM ('NPM', 'PNPM');

-- CreateEnum
CREATE TYPE "public"."BuilderRunStatus" AS ENUM ('IDLE', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."BuilderRunKind" AS ENUM ('BOOTSTRAP', 'COMMAND', 'INSTALL', 'GIT_INIT', 'SCRIPT', 'GENERATOR', 'AGENTIC', 'ORCHESTRATION');

-- CreateEnum
CREATE TYPE "public"."BuilderTaskStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."BuilderTaskStage" AS ENUM ('PLANNING', 'IMPLEMENTING', 'TESTING', 'REVIEW', 'DOCUMENTING', 'DONE');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'User',
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Platform" (
    "id" TEXT NOT NULL,
    "type" "public"."PlatformType" NOT NULL,
    "displayName" TEXT NOT NULL,
    "username" TEXT,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "useBrowserMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Platform_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Post" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mediaUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "platformId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "status" "public"."PostStatus" NOT NULL DEFAULT 'DRAFT',
    "externalId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PostApproval" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "status" "public"."ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "autoApproveRule" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Conversation" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "userId" TEXT NOT NULL,
    "promptSummary" TEXT,
    "promptSummaryUpdatedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "public"."MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Memory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserMemoryFact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMemoryFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OntologyEntity" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "scope" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "attributes" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OntologyEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OntologyRelation" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "scope" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subjectEntityId" TEXT NOT NULL,
    "objectEntityId" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OntologyRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OntologyAlias" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OntologyAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OntologyEvidence" (
    "id" TEXT NOT NULL,
    "entityId" TEXT,
    "relationId" TEXT,
    "sourceKind" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "approvalMarker" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OntologyEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Policy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."PolicyType" NOT NULL,
    "description" TEXT,
    "rules" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ScheduleRule" (
    "id" TEXT NOT NULL,
    "platformType" "public"."PlatformType" NOT NULL,
    "maxPerDay" INTEGER NOT NULL DEFAULT 5,
    "timeWindows" JSONB NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Setting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InboxMessage" (
    "id" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "channelType" "public"."InboxChannelType" NOT NULL,
    "status" "public"."InboxStatus" NOT NULL DEFAULT 'OPEN',
    "leadStage" "public"."LeadStage" NOT NULL DEFAULT 'NONE',
    "leadScore" INTEGER NOT NULL DEFAULT 0,
    "leadSummary" TEXT,
    "externalId" TEXT NOT NULL,
    "threadId" TEXT,
    "authorName" TEXT,
    "authorHandle" TEXT,
    "content" TEXT NOT NULL,
    "replyContent" TEXT,
    "replyPostId" TEXT,
    "metadata" JSONB,
    "cannedResponseTreeId" TEXT,
    "cannedResponseNodeKey" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BrowserSession" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "cookies" JSONB NOT NULL,
    "storage" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrowserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BrowserAction" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "actionType" "public"."BrowserActionType" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "public"."BrowserActionStatus" NOT NULL DEFAULT 'PENDING',
    "screenshotPath" TEXT,
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "BrowserAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CompetitorWatch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "platformHint" "public"."PlatformType",
    "extractSelector" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "checkEveryMinutes" INTEGER NOT NULL DEFAULT 60,
    "lastCheckedAt" TIMESTAMP(3),
    "lastChangedAt" TIMESTAMP(3),
    "lastHash" TEXT,
    "lastSummary" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitorWatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CompetitorSnapshot" (
    "id" TEXT NOT NULL,
    "watchId" TEXT NOT NULL,
    "changeDetected" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "links" JSONB,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CannedResponseTree" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "platformHint" "public"."PlatformType",
    "channelType" "public"."InboxChannelType",
    "rootNodeKey" TEXT NOT NULL,
    "nodes" JSONB NOT NULL,
    "matchRules" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CannedResponseTree_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GoogleBusinessLocation" (
    "id" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "locationName" TEXT NOT NULL,
    "infoLocationName" TEXT,
    "title" TEXT NOT NULL,
    "storeCode" TEXT,
    "websiteUrl" TEXT,
    "regularHours" JSONB,
    "metadata" JSONB,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleBusinessLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GoogleBusinessReview" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "resourceName" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "reviewerName" TEXT,
    "reviewerPhotoUrl" TEXT,
    "starRating" INTEGER NOT NULL,
    "comment" TEXT,
    "reviewReply" TEXT,
    "reviewReplyUpdatedAt" TIMESTAMP(3),
    "createTime" TIMESTAMP(3) NOT NULL,
    "updateTime" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "needsResponse" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GoogleBusinessReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GoogleBusinessPost" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "resourceName" TEXT,
    "summary" TEXT NOT NULL,
    "topicType" TEXT NOT NULL DEFAULT 'STANDARD',
    "actionType" TEXT,
    "callToActionUrl" TEXT,
    "searchUrl" TEXT,
    "eventData" JSONB,
    "offerData" JSONB,
    "status" "public"."GoogleBusinessPostStatus" NOT NULL DEFAULT 'DRAFT',
    "error" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleBusinessPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BuilderProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "packageManager" "public"."BuilderPackageManager" NOT NULL DEFAULT 'NPM',
    "gitInitialized" BOOLEAN NOT NULL DEFAULT false,
    "lastRunStatus" "public"."BuilderRunStatus" NOT NULL DEFAULT 'IDLE',
    "context" JSONB,
    "latestSessionSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuilderProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BuilderTemplatePreset" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultPackageManager" "public"."BuilderPackageManager" NOT NULL DEFAULT 'NPM',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuilderTemplatePreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BuilderRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "kind" "public"."BuilderRunKind" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "public"."BuilderRunStatus" NOT NULL DEFAULT 'RUNNING',
    "command" TEXT,
    "args" JSONB,
    "stdout" TEXT,
    "stderr" TEXT,
    "summary" TEXT,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "BuilderRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BuilderTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "public"."BuilderTaskStatus" NOT NULL DEFAULT 'PENDING',
    "stage" "public"."BuilderTaskStage" NOT NULL DEFAULT 'PLANNING',
    "acceptanceCriteria" JSONB,
    "summary" TEXT,
    "parentTaskId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuilderTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BuilderCliProfile" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "supportsNonInteractive" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuilderCliProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PostApproval_postId_key" ON "public"."PostApproval"("postId");

-- CreateIndex
CREATE INDEX "Conversation_userId_archivedAt_deletedAt_lastMessageAt_idx" ON "public"."Conversation"("userId", "archivedAt", "deletedAt", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Memory_userId_category_idx" ON "public"."Memory"("userId", "category");

-- CreateIndex
CREATE INDEX "UserMemoryFact_userId_category_idx" ON "public"."UserMemoryFact"("userId", "category");

-- CreateIndex
CREATE INDEX "UserMemoryFact_userId_key_idx" ON "public"."UserMemoryFact"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "UserMemoryFact_userId_key_key" ON "public"."UserMemoryFact"("userId", "key");

-- CreateIndex
CREATE INDEX "OntologyEntity_userId_scope_type_canonicalKey_idx" ON "public"."OntologyEntity"("userId", "scope", "type", "canonicalKey");

-- CreateIndex
CREATE INDEX "OntologyEntity_scope_type_canonicalKey_idx" ON "public"."OntologyEntity"("scope", "type", "canonicalKey");

-- CreateIndex
CREATE INDEX "OntologyEntity_status_scope_idx" ON "public"."OntologyEntity"("status", "scope");

-- CreateIndex
CREATE INDEX "OntologyRelation_userId_scope_type_idx" ON "public"."OntologyRelation"("userId", "scope", "type");

-- CreateIndex
CREATE INDEX "OntologyRelation_subjectEntityId_type_idx" ON "public"."OntologyRelation"("subjectEntityId", "type");

-- CreateIndex
CREATE INDEX "OntologyRelation_objectEntityId_type_idx" ON "public"."OntologyRelation"("objectEntityId", "type");

-- CreateIndex
CREATE INDEX "OntologyRelation_isActive_scope_idx" ON "public"."OntologyRelation"("isActive", "scope");

-- CreateIndex
CREATE INDEX "OntologyAlias_scope_normalizedValue_idx" ON "public"."OntologyAlias"("scope", "normalizedValue");

-- CreateIndex
CREATE INDEX "OntologyAlias_entityId_kind_idx" ON "public"."OntologyAlias"("entityId", "kind");

-- CreateIndex
CREATE INDEX "OntologyEvidence_entityId_idx" ON "public"."OntologyEvidence"("entityId");

-- CreateIndex
CREATE INDEX "OntologyEvidence_relationId_idx" ON "public"."OntologyEvidence"("relationId");

-- CreateIndex
CREATE INDEX "OntologyEvidence_sourceKind_sourceRef_idx" ON "public"."OntologyEvidence"("sourceKind", "sourceRef");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_key_key" ON "public"."Setting"("key");

-- CreateIndex
CREATE INDEX "InboxMessage_status_channelType_receivedAt_idx" ON "public"."InboxMessage"("status", "channelType", "receivedAt");

-- CreateIndex
CREATE INDEX "InboxMessage_leadStage_receivedAt_idx" ON "public"."InboxMessage"("leadStage", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InboxMessage_platformId_externalId_key" ON "public"."InboxMessage"("platformId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "BrowserSession_domain_key" ON "public"."BrowserSession"("domain");

-- CreateIndex
CREATE INDEX "CompetitorWatch_active_lastCheckedAt_idx" ON "public"."CompetitorWatch"("active", "lastCheckedAt");

-- CreateIndex
CREATE INDEX "CompetitorSnapshot_watchId_createdAt_idx" ON "public"."CompetitorSnapshot"("watchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorSnapshot_watchId_contentHash_key" ON "public"."CompetitorSnapshot"("watchId", "contentHash");

-- CreateIndex
CREATE INDEX "CannedResponseTree_active_platformHint_channelType_idx" ON "public"."CannedResponseTree"("active", "platformHint", "channelType");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleBusinessLocation_locationName_key" ON "public"."GoogleBusinessLocation"("locationName");

-- CreateIndex
CREATE INDEX "GoogleBusinessReview_locationId_updateTime_idx" ON "public"."GoogleBusinessReview"("locationId", "updateTime");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleBusinessReview_locationId_reviewId_key" ON "public"."GoogleBusinessReview"("locationId", "reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleBusinessPost_resourceName_key" ON "public"."GoogleBusinessPost"("resourceName");

-- CreateIndex
CREATE INDEX "GoogleBusinessPost_locationId_status_createdAt_idx" ON "public"."GoogleBusinessPost"("locationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BuilderProject_slug_key" ON "public"."BuilderProject"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "BuilderProject_relativePath_key" ON "public"."BuilderProject"("relativePath");

-- CreateIndex
CREATE INDEX "BuilderProject_template_createdAt_idx" ON "public"."BuilderProject"("template", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BuilderTemplatePreset_key_key" ON "public"."BuilderTemplatePreset"("key");

-- CreateIndex
CREATE INDEX "BuilderRun_projectId_startedAt_idx" ON "public"."BuilderRun"("projectId", "startedAt");

-- CreateIndex
CREATE INDEX "BuilderRun_taskId_startedAt_idx" ON "public"."BuilderRun"("taskId", "startedAt");

-- CreateIndex
CREATE INDEX "BuilderRun_status_startedAt_idx" ON "public"."BuilderRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "BuilderTask_projectId_status_updatedAt_idx" ON "public"."BuilderTask"("projectId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "BuilderTask_projectId_stage_updatedAt_idx" ON "public"."BuilderTask"("projectId", "stage", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BuilderCliProfile_key_key" ON "public"."BuilderCliProfile"("key");

-- AddForeignKey
ALTER TABLE "public"."Post" ADD CONSTRAINT "Post_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "public"."Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PostApproval" ADD CONSTRAINT "PostApproval_postId_fkey" FOREIGN KEY ("postId") REFERENCES "public"."Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Memory" ADD CONSTRAINT "Memory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserMemoryFact" ADD CONSTRAINT "UserMemoryFact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OntologyEntity" ADD CONSTRAINT "OntologyEntity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OntologyRelation" ADD CONSTRAINT "OntologyRelation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OntologyRelation" ADD CONSTRAINT "OntologyRelation_subjectEntityId_fkey" FOREIGN KEY ("subjectEntityId") REFERENCES "public"."OntologyEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OntologyRelation" ADD CONSTRAINT "OntologyRelation_objectEntityId_fkey" FOREIGN KEY ("objectEntityId") REFERENCES "public"."OntologyEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OntologyAlias" ADD CONSTRAINT "OntologyAlias_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "public"."OntologyEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OntologyEvidence" ADD CONSTRAINT "OntologyEvidence_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "public"."OntologyEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OntologyEvidence" ADD CONSTRAINT "OntologyEvidence_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "public"."OntologyRelation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AnalyticsSnapshot" ADD CONSTRAINT "AnalyticsSnapshot_postId_fkey" FOREIGN KEY ("postId") REFERENCES "public"."Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AnalyticsSnapshot" ADD CONSTRAINT "AnalyticsSnapshot_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "public"."Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InboxMessage" ADD CONSTRAINT "InboxMessage_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "public"."Platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InboxMessage" ADD CONSTRAINT "InboxMessage_cannedResponseTreeId_fkey" FOREIGN KEY ("cannedResponseTreeId") REFERENCES "public"."CannedResponseTree"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CompetitorSnapshot" ADD CONSTRAINT "CompetitorSnapshot_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "public"."CompetitorWatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GoogleBusinessReview" ADD CONSTRAINT "GoogleBusinessReview_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."GoogleBusinessLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GoogleBusinessPost" ADD CONSTRAINT "GoogleBusinessPost_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."GoogleBusinessLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BuilderRun" ADD CONSTRAINT "BuilderRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."BuilderProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BuilderRun" ADD CONSTRAINT "BuilderRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."BuilderTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BuilderTask" ADD CONSTRAINT "BuilderTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."BuilderProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BuilderTask" ADD CONSTRAINT "BuilderTask_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "public"."BuilderTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;