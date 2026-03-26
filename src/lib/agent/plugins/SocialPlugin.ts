/**
 * SocialPlugin — post, reply, get mentions, get analytics across platforms.
 */

import { TwitterClient } from "@/lib/social/twitter";
import { FacebookClient, InstagramClient } from "@/lib/social/meta";
import type { EngagementMetrics, SocialClient, SocialMention, SocialPost, SocialReply } from "@/lib/social/types";
import type { ToolDefinition } from "@/lib/agent/tools";

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

interface SocialMentionsArgs {
  platform: PlatformName;
  limit?: number;
}

interface SocialAnalyticsArgs {
  platform: PlatformName;
  postId: string;
}

function getClient(platform: PlatformName): SocialClient {
  switch (platform) {
    case "twitter":
      return new TwitterClient();
    case "facebook":
      return new FacebookClient();
    case "instagram":
      return new InstagramClient();
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

export const socialPlugin = {
  tools: [
    {
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
        const client = getClient(platform);
        return client.post({ content, mediaUrls });
      },
    } satisfies ToolDefinition<SocialPostArgs, SocialPost>,
    {
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
        const client = getClient(platform);
        return client.reply(postId, content);
      },
    } satisfies ToolDefinition<SocialReplyArgs, SocialReply>,
    {
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
    } satisfies ToolDefinition<SocialMentionsArgs, SocialMention[]>,
    {
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
    } satisfies ToolDefinition<SocialAnalyticsArgs, EngagementMetrics>,
  ],
};
