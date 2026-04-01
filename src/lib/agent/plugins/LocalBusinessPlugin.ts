/** LocalBusinessPlugin — Google Business Profile operations for reviews, posts, and hours. */

import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";
import { getLocalBusinessPluginDeps } from "@/lib/agent/plugins/local-business-runtime";

type LocalBusinessStatusArgs = Record<string, never>;

interface LocalBusinessDashboardArgs {
  syncRemote?: boolean;
}

interface LocalBusinessListReviewsArgs {
  needsResponse?: boolean;
  limit?: number;
}

interface LocalBusinessReplyReviewArgs {
  reviewId: string;
  comment: string;
}

interface LocalBusinessCreatePostArgs {
  summary: string;
  topicType?: string;
  actionType?: string;
  callToActionUrl?: string;
}

interface LocalBusinessHoursArgs {
  periods: Array<{
    openDay: string;
    openTime: string;
    closeDay: string;
    closeTime: string;
  }>;
}

export const localBusinessPlugin = {
  tools: [
    registerTool(defineTool({
      name: "local_business_get_status",
      description: "Inspect Google Business Profile readiness and the latest local dashboard snapshot.",
      parameters: { type: "object", properties: {} },
      execute: async () => ({
        configured: await getLocalBusinessPluginDeps().isConfigured(),
        dashboard: await getLocalBusinessPluginDeps().getDashboard(false),
      }),
    } satisfies ToolDefinition<LocalBusinessStatusArgs, { configured: boolean; dashboard: Awaited<ReturnType<ReturnType<typeof getLocalBusinessPluginDeps>["getDashboard"]>> }>)),
    registerTool(defineTool({
      name: "local_business_get_dashboard",
      description: "Get the Google Business dashboard, optionally syncing reviews and posts from Google first.",
      parameters: {
        type: "object",
        properties: {
          syncRemote: { type: "boolean", default: false },
        },
      },
      execute: async ({ syncRemote }: LocalBusinessDashboardArgs) => ({
        dashboard: await getLocalBusinessPluginDeps().getDashboard(syncRemote ?? false),
      }),
    } satisfies ToolDefinition<LocalBusinessDashboardArgs, { dashboard: Awaited<ReturnType<ReturnType<typeof getLocalBusinessPluginDeps>["getDashboard"]>> }>)),
    registerTool(defineTool({
      name: "local_business_sync_reviews",
      description: "Sync Google Business reviews into the local dashboard store.",
      parameters: { type: "object", properties: {} },
      execute: async () => ({
        reviews: await getLocalBusinessPluginDeps().syncReviews(),
      }),
    } satisfies ToolDefinition<LocalBusinessStatusArgs, { reviews: Awaited<ReturnType<ReturnType<typeof getLocalBusinessPluginDeps>["syncReviews"]>> }>)),
    registerTool(defineTool({
      name: "local_business_sync_posts",
      description: "Sync Google Business posts into the local dashboard store.",
      parameters: { type: "object", properties: {} },
      execute: async () => ({
        posts: await getLocalBusinessPluginDeps().syncPosts(),
      }),
    } satisfies ToolDefinition<LocalBusinessStatusArgs, { posts: Awaited<ReturnType<ReturnType<typeof getLocalBusinessPluginDeps>["syncPosts"]>> }>)),
    registerTool(defineTool({
      name: "local_business_list_reviews",
      description: "List recent locally cached Google Business reviews, optionally only those still needing a response.",
      parameters: {
        type: "object",
        properties: {
          needsResponse: { type: "boolean" },
          limit: { type: "number", default: 25 },
        },
      },
      execute: async ({ needsResponse, limit }: LocalBusinessListReviewsArgs) => ({
        reviews: await getLocalBusinessPluginDeps().listReviews({
          where: needsResponse === undefined ? {} : { needsResponse },
          orderBy: { updateTime: "desc" },
          take: Math.min(Math.max(limit ?? 25, 1), 100),
        }),
      }),
    } satisfies ToolDefinition<LocalBusinessListReviewsArgs, { reviews: Awaited<ReturnType<ReturnType<typeof getLocalBusinessPluginDeps>["listReviews"]>> }>)),
    registerTool(defineTool({
      name: "local_business_reply_review",
      description: "Reply to a Google Business review by local review id.",
      parameters: {
        type: "object",
        properties: {
          reviewId: { type: "string" },
          comment: { type: "string" },
        },
        required: ["reviewId", "comment"],
      },
      execute: async ({ reviewId, comment }: LocalBusinessReplyReviewArgs) => ({
        review: await getLocalBusinessPluginDeps().replyReview(reviewId, comment),
      }),
    } satisfies ToolDefinition<LocalBusinessReplyReviewArgs, { review: Awaited<ReturnType<ReturnType<typeof getLocalBusinessPluginDeps>["replyReview"]>> }>)),
    registerTool(defineTool({
      name: "local_business_create_post",
      description: "Create a new Google Business local post.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          topicType: { type: "string" },
          actionType: { type: "string" },
          callToActionUrl: { type: "string" },
        },
        required: ["summary"],
      },
      execute: async ({ summary, topicType, actionType, callToActionUrl }: LocalBusinessCreatePostArgs) => ({
        post: await getLocalBusinessPluginDeps().createPost({
          summary,
          topicType,
          actionType,
          callToActionUrl,
        }),
      }),
    } satisfies ToolDefinition<LocalBusinessCreatePostArgs, { post: Awaited<ReturnType<ReturnType<typeof getLocalBusinessPluginDeps>["createPost"]>> }>)),
    registerTool(defineTool({
      name: "local_business_update_hours",
      description: "Update Google Business regular hours using open and close periods.",
      parameters: {
        type: "object",
        properties: {
          periods: {
            type: "array",
            items: {
              type: "object",
              properties: {
                openDay: { type: "string" },
                openTime: { type: "string" },
                closeDay: { type: "string" },
                closeTime: { type: "string" },
              },
              required: ["openDay", "openTime", "closeDay", "closeTime"],
            },
          },
        },
        required: ["periods"],
      },
      execute: async ({ periods }: LocalBusinessHoursArgs) => ({
        location: await getLocalBusinessPluginDeps().updateHours({ periods }),
      }),
    } satisfies ToolDefinition<LocalBusinessHoursArgs, { location: Awaited<ReturnType<ReturnType<typeof getLocalBusinessPluginDeps>["updateHours"]>> }>)),
  ],
};