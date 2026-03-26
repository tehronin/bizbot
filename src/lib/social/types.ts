/**
 * social/types.ts — Unified platform-agnostic social media interface.
 * Every platform adapter implements SocialClient.
 */

export type PlatformName = "twitter" | "facebook" | "instagram";

export interface SocialPost {
  id: string;
  content: string;
  mediaUrls?: string[];
  publishedAt?: Date;
  url?: string;
  metrics?: EngagementMetrics;
}

export interface SocialReply {
  id: string;
  content: string;
  inReplyToId: string;
  publishedAt?: Date;
}

export interface SocialMention {
  id: string;
  authorName: string;
  authorHandle: string;
  content: string;
  createdAt: Date;
  url: string;
}

export interface EngagementMetrics {
  likes: number;
  replies: number;
  shares: number;
  impressions: number;
  clicks?: number;
}

export interface PostInput {
  content: string;
  mediaUrls?: string[];
  replyToId?: string;
}

/** Common interface every platform adapter must implement. */
export interface SocialClient {
  platform: PlatformName;

  /** Publish a post. Returns the created post or throws on failure. */
  post(input: PostInput): Promise<SocialPost>;

  /** Reply to an existing post. */
  reply(replyToId: string, content: string): Promise<SocialReply>;

  /** Fetch recent mentions of the authenticated account. */
  getMentions(limit?: number): Promise<SocialMention[]>;

  /** Fetch engagement metrics for a published post. */
  getAnalytics(postId: string): Promise<EngagementMetrics>;

  /** Check if the client is authenticated and ready. */
  isConnected(): boolean;
}

/** Rate limit error for use in adapters. */
export class RateLimitError extends Error {
  retryAfterMs: number;
  constructor(retryAfterMs = 60_000) {
    super(`Rate limited. Retry after ${retryAfterMs}ms`);
    this.retryAfterMs = retryAfterMs;
  }
}

/** Sleep helper for backoff. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
