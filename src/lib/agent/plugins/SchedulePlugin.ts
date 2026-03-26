/** SchedulePlugin — Create, list, and cancel scheduled posts. */

import { db } from "@/lib/db";
import type { ToolDefinition } from "@/lib/agent/tools";

interface SchedulePostArgs {
  platformId: string;
  content: string;
  scheduledAt: string;
  mediaUrls?: string[];
}

type ScheduleListArgs = Record<string, never>;

interface ScheduleCancelArgs {
  postId: string;
}

export const schedulePlugin = {
  tools: [
    {
      name: "schedule_post",
      description: "Schedule a post for future publishing.",
      parameters: {
        type: "object",
        properties: {
          platformId: { type: "string" },
          content: { type: "string" },
          scheduledAt: { type: "string", description: "ISO 8601 datetime string" },
          mediaUrls: { type: "array", items: { type: "string" } },
        },
        required: ["platformId", "content", "scheduledAt"],
      },
      execute: async ({ platformId, content, scheduledAt, mediaUrls }: SchedulePostArgs) => {
        const post = await db.post.create({
          data: {
            content,
            platformId,
            authorId: "local-user",
            status: "SCHEDULED",
            scheduledAt: new Date(scheduledAt),
            mediaUrls: mediaUrls ?? [],
          },
        });
        return {
          scheduled: true,
          postId: post.id,
          scheduledAt: post.scheduledAt?.toISOString() ?? scheduledAt,
        };
      },
    } satisfies ToolDefinition<SchedulePostArgs, { scheduled: boolean; postId: string; scheduledAt: string }>,
    {
      name: "schedule_list",
      description: "List all scheduled posts.",
      parameters: { type: "object", properties: {} },
      execute: async (_args: ScheduleListArgs) => {
        const posts = await db.post.findMany({
          where: { status: "SCHEDULED" },
          include: { platform: true },
          orderBy: { scheduledAt: "asc" },
        });
        return {
          scheduledPosts: posts.map((post: { id: string; content: string; platformId: string; scheduledAt: Date | null; status: string }) => ({
            id: post.id,
            content: post.content,
            platformId: post.platformId,
            scheduledAt: post.scheduledAt?.toISOString() ?? null,
            status: post.status,
          })),
        };
      },
    } satisfies ToolDefinition<ScheduleListArgs, { scheduledPosts: Array<{ id: string; content: string; platformId: string; scheduledAt: string | null; status: string }> }>,
    {
      name: "schedule_cancel",
      description: "Cancel a scheduled post.",
      parameters: {
        type: "object",
        properties: { postId: { type: "string" } },
        required: ["postId"],
      },
      execute: async ({ postId }: ScheduleCancelArgs) => {
        await db.post.update({
          where: { id: postId },
          data: { status: "DRAFT" },
        });
        return { cancelled: true, postId };
      },
    } satisfies ToolDefinition<ScheduleCancelArgs, { cancelled: boolean; postId: string }>,
  ],
};
