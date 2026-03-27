/**
 * social/twitter.ts — Twitter/X API v2 client.
 * Uses OAuth 2.0 with user context for posting; Bearer token for reading.
 * Official API only — no browser automation.
 */

import { TwitterApi, TweetV2PostTweetResult } from "twitter-api-v2";
import type { DirectMessageCreateV1 } from "twitter-api-v2/dist/esm/types/v1/dm.v1.types";
import type {
  SocialClient,
  SocialDirectMessage,
  SocialPost,
  SocialReply,
  SocialMention,
  EngagementMetrics,
  PostInput,
} from "./types";
import { RateLimitError, sleep } from "./types";

function getTwitterAppKey(): string {
  return process.env.TWITTER_APP_KEY ?? process.env.TWITTER_CLIENT_ID ?? "";
}

function getTwitterAppSecret(): string {
  return process.env.TWITTER_APP_SECRET ?? process.env.TWITTER_CLIENT_SECRET ?? "";
}

function buildClient(): TwitterApi {
  return new TwitterApi({
    appKey: getTwitterAppKey(),
    appSecret: getTwitterAppSecret(),
    accessToken: process.env.TWITTER_ACCESS_TOKEN ?? "",
    accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET ?? "",
  });
}

function getTwitterUserId(): string {
  return process.env.TWITTER_USER_ID ?? "";
}

function mapDmEvent(event: DirectMessageCreateV1): SocialDirectMessage | null {
  const message = event.message_create;
  if (!message) {
    return null;
  }

  const localUserId = getTwitterUserId();
  if (message.sender_id === localUserId) {
    return null;
  }

  return {
    id: event.id,
    threadId: message.sender_id,
    participantId: message.sender_id,
    authorName: message.sender_id,
    authorHandle: message.sender_id,
    content: message.message_data.text,
    createdAt: new Date(Number(event.created_timestamp)),
  };
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
  private client: TwitterApi | null = null;

  private getClient(): TwitterApi {
    if (!this.isConnected()) {
      throw new Error("Twitter client is not configured.");
    }

    if (!this.client) {
      this.client = buildClient();
    }

    return this.client;
  }

  supportsDirectMessages(): boolean {
    return this.isConnected() && getTwitterUserId().length > 0;
  }

  isConnected(): boolean {
    return !!(
      getTwitterAppKey() &&
      getTwitterAppSecret() &&
      process.env.TWITTER_ACCESS_TOKEN &&
      process.env.TWITTER_ACCESS_TOKEN_SECRET
    );
  }

  async post(input: PostInput): Promise<SocialPost> {
    const client = this.getClient();
    const result: TweetV2PostTweetResult = await withRateLimitRetry(() =>
      client.v2.tweet({
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
    const client = this.getClient();
    const result = await withRateLimitRetry(() =>
      client.v2.reply(content, replyToId),
    );
    return {
      id: result.data.id,
      content: result.data.text,
      inReplyToId: replyToId,
      publishedAt: new Date(),
    };
  }

  async getMentions(limit = 20): Promise<SocialMention[]> {
    const client = this.getClient();
    const me = await client.v2.me();
    const timeline = await client.v2.userMentionTimeline(me.data.id, {
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

  async listDirectMessages(limit = 20): Promise<SocialDirectMessage[]> {
    const client = this.getClient();
    const paginator = await client.v1.listDmEvents({ count: Math.min(50, limit) });
    const events = paginator.events ?? [];
    return events
      .map((event) => mapDmEvent(event as DirectMessageCreateV1))
      .filter((event): event is SocialDirectMessage => event !== null)
      .slice(0, limit);
  }

  async sendDirectMessage(recipientId: string, content: string, _replyToId?: string): Promise<SocialReply> {
    const client = this.getClient();
    const result = await client.v1.sendDm({
      recipient_id: recipientId,
      text: content,
    });

    const event = result.event;
    return {
      id: event.id,
      content,
      inReplyToId: recipientId,
      publishedAt: new Date(Number(event.created_timestamp)),
    };
  }

  async getAnalytics(postId: string): Promise<EngagementMetrics> {
    const client = this.getClient();
    const tweet = await client.v2.singleTweet(postId, {
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
