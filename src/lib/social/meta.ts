/**
 * social/meta.ts — Meta Graph API client for Facebook Pages + Instagram Business.
 *
 * Uses Development Mode (no app review needed for pages/accounts you own/admin).
 * Requires a long-lived User Access Token with appropriate page permissions.
 */

import axios, { AxiosInstance } from "axios";
import type {
  SocialClient,
  SocialPost,
  SocialReply,
  SocialMention,
  EngagementMetrics,
  PostInput,
} from "./types";
import { RateLimitError, sleep } from "./types";

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

function buildAxios(): AxiosInstance {
  return axios.create({
    baseURL: GRAPH_BASE,
    params: { access_token: process.env.META_ACCESS_TOKEN },
    timeout: 30_000,
  });
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      const e = error as {
        response?: { data?: { error?: { code?: number; message?: string } } };
      };
      const code = e.response?.data?.error?.code;
      if (code === 17 && attempt < maxRetries) {
        // (#17) User request limit reached
        await sleep(60_000);
        attempt++;
        continue;
      }
      if (code === 17) throw new RateLimitError(60_000);
      throw error;
    }
  }
}

// ─── Facebook Page Client ───────────────────────────────────────────────────

export class FacebookClient implements SocialClient {
  platform = "facebook" as const;
  private http: AxiosInstance;

  constructor() {
    this.http = buildAxios();
  }

  isConnected(): boolean {
    return !!(process.env.META_ACCESS_TOKEN && process.env.META_PAGE_ID);
  }

  async post(input: PostInput): Promise<SocialPost> {
    const pageId = process.env.META_PAGE_ID!;
    const response = await withRetry(() =>
      this.http.post(`/${pageId}/feed`, {
        message: input.content,
        ...(input.mediaUrls?.length ? { link: input.mediaUrls[0] } : {}),
      }),
    );
    return {
      id: response.data.id,
      content: input.content,
      publishedAt: new Date(),
    };
  }

  async reply(replyToId: string, content: string): Promise<SocialReply> {
    const response = await withRetry(() =>
      this.http.post(`/${replyToId}/comments`, { message: content }),
    );
    return {
      id: response.data.id,
      content,
      inReplyToId: replyToId,
      publishedAt: new Date(),
    };
  }

  async getMentions(limit = 20): Promise<SocialMention[]> {
    const pageId = process.env.META_PAGE_ID!;
    const response = await withRetry(() =>
      this.http.get(`/${pageId}/tagged`, {
        params: { fields: "id,from,message,created_time,permalink_url", limit },
      }),
    );
    return (response.data.data ?? []).map(
      (item: {
        id: string;
        from?: { name?: string; id?: string };
        message?: string;
        created_time?: string;
        permalink_url?: string;
      }) => ({
        id: item.id,
        authorName: item.from?.name ?? "Unknown",
        authorHandle: item.from?.id ?? "",
        content: item.message ?? "",
        createdAt: item.created_time ? new Date(item.created_time) : new Date(),
        url: item.permalink_url ?? "",
      }),
    );
  }

  async getAnalytics(postId: string): Promise<EngagementMetrics> {
    const response = await withRetry(() =>
      this.http.get(`/${postId}/insights`, {
        params: {
          metric: "post_impressions,post_reactions_by_type_total",
          period: "lifetime",
        },
      }),
    );
    const data = response.data.data ?? [];
    const impressions =
      data.find((d: { name: string }) => d.name === "post_impressions")?.values?.[0]?.value ?? 0;
    const reactionsData =
      data.find((d: { name: string }) => d.name === "post_reactions_by_type_total")?.values?.[0]
        ?.value ?? {};
    const likes =
      (reactionsData.like ?? 0) +
      (reactionsData.love ?? 0) +
      (reactionsData.wow ?? 0) +
      (reactionsData.haha ?? 0);

    return { likes, replies: 0, shares: 0, impressions };
  }
}

// ─── Instagram Business Client ───────────────────────────────────────────────

export class InstagramClient implements SocialClient {
  platform = "instagram" as const;
  private http: AxiosInstance;

  constructor() {
    this.http = buildAxios();
  }

  isConnected(): boolean {
    return !!(
      process.env.META_ACCESS_TOKEN &&
      process.env.META_INSTAGRAM_ACCOUNT_ID
    );
  }

  async post(input: PostInput): Promise<SocialPost> {
    const igId = process.env.META_INSTAGRAM_ACCOUNT_ID!;

    // Step 1: Create media container
    const mediaResponse = await withRetry(() =>
      this.http.post(`/${igId}/media`, {
        caption: input.content,
        ...(input.mediaUrls?.length
          ? { image_url: input.mediaUrls[0] }
          : { media_type: "REELS" }),
      }),
    );

    // Step 2: Publish the container
    const publishResponse = await withRetry(() =>
      this.http.post(`/${igId}/media_publish`, {
        creation_id: mediaResponse.data.id,
      }),
    );

    return {
      id: publishResponse.data.id,
      content: input.content,
      publishedAt: new Date(),
    };
  }

  async reply(replyToId: string, content: string): Promise<SocialReply> {
    const response = await withRetry(() =>
      this.http.post(`/${replyToId}/replies`, { message: content }),
    );
    return {
      id: response.data.id,
      content,
      inReplyToId: replyToId,
      publishedAt: new Date(),
    };
  }

  async getMentions(limit = 20): Promise<SocialMention[]> {
    const igId = process.env.META_INSTAGRAM_ACCOUNT_ID!;
    const response = await withRetry(() =>
      this.http.get(`/${igId}/tags`, {
        params: { fields: "id,from,text,timestamp", limit },
      }),
    );
    return (response.data.data ?? []).map(
      (item: {
        id: string;
        from?: { username?: string };
        text?: string;
        timestamp?: string;
      }) => ({
        id: item.id,
        authorName: item.from?.username ?? "Unknown",
        authorHandle: `@${item.from?.username ?? ""}`,
        content: item.text ?? "",
        createdAt: item.timestamp ? new Date(item.timestamp) : new Date(),
        url: `https://www.instagram.com/p/${item.id}/`,
      }),
    );
  }

  async getAnalytics(postId: string): Promise<EngagementMetrics> {
    const response = await withRetry(() =>
      this.http.get(`/${postId}/insights`, {
        params: {
          metric: "impressions,reach,likes_count,comments_count,saved",
        },
      }),
    );
    const data: Record<string, { values?: [{ value: number }] }> = {};
    for (const item of response.data.data ?? []) {
      data[item.name] = item;
    }
    return {
      impressions: data.impressions?.values?.[0]?.value ?? 0,
      likes: data.likes_count?.values?.[0]?.value ?? 0,
      replies: data.comments_count?.values?.[0]?.value ?? 0,
      shares: data.saved?.values?.[0]?.value ?? 0,
    };
  }
}
