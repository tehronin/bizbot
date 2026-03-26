/**
 * social/twitter.ts — Twitter/X API v2 client.
 * Uses OAuth 2.0 with user context for posting; Bearer token for reading.
 * Official API only — no browser automation.
 */

import { TwitterApi, TweetV2PostTweetResult } from "twitter-api-v2";
import type {
  SocialClient,
  SocialPost,
  SocialReply,
  SocialMention,
  EngagementMetrics,
  PostInput,
} from "./types";
import { RateLimitError, sleep } from "./types";

function buildClient(): TwitterApi {
  return new TwitterApi({
    appKey: process.env.TWITTER_CLIENT_ID ?? "",
    appSecret: process.env.TWITTER_CLIENT_SECRET ?? "",
    accessToken: process.env.TWITTER_ACCESS_TOKEN ?? "",
    accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET ?? "",
  });
}

async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      const e = error as { code?: number; rateLimit?: { reset?: number } };
      if (e.code === 429 && attempt < maxRetries) {
        const resetMs = e.rateLimit?.reset
          ? (e.rateLimit.reset * 1000 - Date.now()) + 1000
          : 60_000;
        await sleep(resetMs);
        attempt++;
        continue;
      }
      if (e.code === 429) throw new RateLimitError();
      throw error;
    }
  }
}

export class TwitterClient implements SocialClient {
  platform = "twitter" as const;
  private client: TwitterApi;

  constructor() {
    this.client = buildClient();
  }

  isConnected(): boolean {
    return !!(
      process.env.TWITTER_ACCESS_TOKEN &&
      process.env.TWITTER_ACCESS_TOKEN_SECRET
    );
  }

  async post(input: PostInput): Promise<SocialPost> {
    const result: TweetV2PostTweetResult = await withRateLimitRetry(() =>
      this.client.v2.tweet({
        text: input.content,
        ...(input.replyToId
          ? { reply: { in_reply_to_tweet_id: input.replyToId } }
          : {}),
      }),
    );

    return {
      id: result.data.id,
      content: result.data.text,
      url: `https://x.com/i/web/status/${result.data.id}`,
      publishedAt: new Date(),
    };
  }

  async reply(replyToId: string, content: string): Promise<SocialReply> {
    const result = await withRateLimitRetry(() =>
      this.client.v2.reply(content, replyToId),
    );
    return {
      id: result.data.id,
      content: result.data.text,
      inReplyToId: replyToId,
      publishedAt: new Date(),
    };
  }

  async getMentions(limit = 20): Promise<SocialMention[]> {
    const me = await this.client.v2.me();
    const timeline = await this.client.v2.userMentionTimeline(me.data.id, {
      max_results: limit,
      "tweet.fields": ["created_at", "author_id", "text"],
      expansions: ["author_id"],
      "user.fields": ["name", "username"],
    });

    const users = new Map(
      (timeline.includes?.users ?? []).map((u) => [u.id, u]),
    );

    return (timeline.data?.data ?? []).map((tweet) => {
      const author = users.get(tweet.author_id ?? "");
      return {
        id: tweet.id,
        authorName: author?.name ?? "Unknown",
        authorHandle: author?.username ? `@${author.username}` : "unknown",
        content: tweet.text,
        createdAt: tweet.created_at ? new Date(tweet.created_at) : new Date(),
        url: `https://x.com/i/web/status/${tweet.id}`,
      };
    });
  }

  async getAnalytics(postId: string): Promise<EngagementMetrics> {
    const tweet = await this.client.v2.singleTweet(postId, {
      "tweet.fields": ["public_metrics"],
    });
    const m = tweet.data.public_metrics;
    return {
      likes: m?.like_count ?? 0,
      replies: m?.reply_count ?? 0,
      shares: m?.retweet_count ?? 0,
      impressions: m?.impression_count ?? 0,
    };
  }
}
