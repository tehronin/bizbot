/**
 * SocialPlugin — post, reply, get mentions, get analytics across platforms.
 */

import { PlatformType, PostStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getAgentRuntimeConfig } from "@/lib/agent/runtime";
import type { EngagementMetrics, SocialClient, SocialMention, SocialPost, SocialReply } from "@/lib/social/types";
import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";
import { getSocialPluginDeps } from "@/lib/agent/plugins/social-runtime";

type PlatformName = "twitter" | "facebook" | "instagram";

interface SocialPostArgs {
  platform: PlatformName;
  content: string;
  mediaUrls?: string[];
}

interface SocialReplyArgs {
  platform: PlatformName;
  postId: string;
  content: string;
}

interface QueuedApprovalResult {
  queued: boolean;
  approvalRequired: boolean;
  postId: string;
  approvalId: string;
  status: PostStatus;
}

interface SocialMentionsArgs {
  platform: PlatformName;
  limit?: number;
}

interface SocialAnalyticsArgs {
  platform: PlatformName;
  postId: string;
}

function getClient(platform: PlatformName): SocialClient {
  return getSocialPluginDeps().getClient(platform);
}

function getPlatformType(platform: PlatformName): PlatformType {
  switch (platform) {
    case "twitter":
      return PlatformType.TWITTER;
    case "facebook":
      return PlatformType.FACEBOOK;
    case "instagram":
      return PlatformType.INSTAGRAM;
  }
}

async function getOrCreatePlatform(platform: PlatformName) {
  const type = getPlatformType(platform);
  return db.platform.upsert({
    where: { id: platform },
    update: { type, displayName: platform },
    create: { id: platform, type, displayName: platform, connected: false },
  });
}

async function queuePostForApproval(platform: PlatformName, content: string, mediaUrls?: string[]): Promise<QueuedApprovalResult> {
  const platformRecord = await getOrCreatePlatform(platform);
  const post = await db.post.create({
    data: {
      platformId: platformRecord.id,
      authorId: "local-user",
      content,
      mediaUrls: mediaUrls ?? [],
      status: PostStatus.PENDING_APPROVAL,
    },
  });
  const approval = await db.postApproval.create({
    data: {
      postId: post.id,
      notes: "Queued by autonomy policy before publishing.",
    },
  });

  return {
    queued: true,
    approvalRequired: true,
    postId: post.id,
    approvalId: approval.id,
    status: PostStatus.PENDING_APPROVAL,
  };
}

export const socialPlugin = {
  tools: [
    registerTool(defineTool({
      name: "social_post",
      description: "Post content to a social media platform (twitter, facebook, instagram). Content will be queued for approval first.",
      parameters: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["twitter", "facebook", "instagram"] },
          content: { type: "string", description: "Text content of the post" },
          mediaUrls: { type: "array", items: { type: "string" }, description: "Optional image/video URLs" },
        },
        required: ["platform", "content"],
      },
      execute: async ({ platform, content, mediaUrls }: SocialPostArgs) => {
        const runtime = getAgentRuntimeConfig();
        if (runtime.autonomyPreset === "manual_only" || runtime.autonomyPreset === "reply_only") {
          throw new Error("Current autonomy preset does not allow the agent to originate new posts.");
        }
        if (runtime.autonomyPreset === "approval_all_posts") {
          return queuePostForApproval(platform, content, mediaUrls);
        }

        const client = getClient(platform);
        return client.post({ content, mediaUrls });
      },
    } satisfies ToolDefinition<SocialPostArgs, SocialPost | QueuedApprovalResult>)),
    registerTool(defineTool({
      name: "social_reply",
      description: "Reply to an existing post on a social platform.",
      parameters: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["twitter", "facebook", "instagram"] },
          postId: { type: "string" },
          content: { type: "string" },
        },
        required: ["platform", "postId", "content"],
      },
      execute: async ({ platform, postId, content }: SocialReplyArgs) => {
        const runtime = getAgentRuntimeConfig();
        if (runtime.autonomyPreset === "manual_only") {
          throw new Error("Current autonomy preset does not allow the agent to send replies.");
        }

        const client = getClient(platform);
        return client.reply(postId, content);
      },
    } satisfies ToolDefinition<SocialReplyArgs, SocialReply>)),
    registerTool(defineTool({
      name: "social_get_mentions",
      description: "Get recent mentions of the account on a platform.",
      parameters: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["twitter", "facebook", "instagram"] },
          limit: { type: "number", default: 20 },
        },
        required: ["platform"],
      },
      execute: async ({ platform, limit }: SocialMentionsArgs) => {
        const client = getClient(platform);
        return client.getMentions(limit ?? 20);
      },
    } satisfies ToolDefinition<SocialMentionsArgs, SocialMention[]>)),
    registerTool(defineTool({
      name: "social_get_analytics",
      description: "Get engagement analytics for a published post.",
      parameters: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["twitter", "facebook", "instagram"] },
          postId: { type: "string" },
        },
        required: ["platform", "postId"],
      },
      execute: async ({ platform, postId }: SocialAnalyticsArgs) => {
        const client = getClient(platform);
        return client.getAnalytics(postId);
      },
    } satisfies ToolDefinition<SocialAnalyticsArgs, EngagementMetrics>)),
  ],
};
