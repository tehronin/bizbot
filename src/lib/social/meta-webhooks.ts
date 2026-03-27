import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { processInboxNow } from "@/lib/agent/heartbeat";
import { upsertInboxItem, type InboxPlatformName } from "@/lib/social/inbox";

interface MetaMessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
  };
  postback?: {
    title?: string;
    payload?: string;
  };
}

interface MetaChangeEvent {
  field?: string;
  value?: {
    message?: {
      mid?: string;
      text?: string;
    };
    text?: string;
    item?: string;
    from?: {
      id?: string;
      username?: string;
      name?: string;
    };
    sender?: {
      id?: string;
      username?: string;
      name?: string;
    };
    comment_id?: string;
    media_id?: string;
  };
}

interface MetaEntry {
  id?: string;
  messaging?: MetaMessagingEvent[];
  changes?: MetaChangeEvent[];
}

interface MetaWebhookBody {
  object?: string;
  entry?: MetaEntry[];
}

interface ParsedMetaWebhookEvent {
  platform: InboxPlatformName;
  channelType: "DIRECT_MESSAGE" | "SOCIAL_MENTION";
  externalId: string;
  threadId?: string;
  authorName?: string;
  authorHandle?: string;
  content: string;
  receivedAt: Date;
  metadata?: Prisma.InputJsonValue;
}

function inferPlatform(body: MetaWebhookBody): InboxPlatformName {
  return body.object === "instagram" ? "instagram" : "facebook";
}

function buildStableExternalId(...parts: Array<string | number | undefined>): string {
  const payload = parts
    .filter((value): value is string | number => value !== undefined && value !== "")
    .join("|");

  return createHash("sha256").update(payload).digest("hex");
}

export function parseMetaWebhookEvents(body: MetaWebhookBody): ParsedMetaWebhookEvent[] {
  const platform = inferPlatform(body);
  const events: ParsedMetaWebhookEvent[] = [];

  for (const entry of body.entry ?? []) {
    for (const messaging of entry.messaging ?? []) {
      const text = messaging.message?.text ?? messaging.postback?.title ?? messaging.postback?.payload;
      if (!text || messaging.message?.is_echo) {
        continue;
      }

      const senderId = messaging.sender?.id ?? "unknown-sender";
      const externalId =
        messaging.message?.mid
        ?? buildStableExternalId(
          entry.id ?? platform,
          senderId,
          messaging.recipient?.id,
          messaging.timestamp,
          text,
        );

      events.push({
        platform,
        channelType: "DIRECT_MESSAGE",
        externalId,
        threadId: senderId,
        authorName: senderId,
        authorHandle: senderId,
        content: text,
        receivedAt: messaging.timestamp ? new Date(messaging.timestamp) : new Date(),
        metadata: {
          recipientId: messaging.recipient?.id ?? entry.id ?? null,
          senderId,
        },
      });
    }

    for (const change of entry.changes ?? []) {
      const text = change.value?.message?.text ?? change.value?.text ?? change.value?.item;
      if (!text) {
        continue;
      }

      const sender = change.value?.from ?? change.value?.sender;
      const channelType = /mention|comment/i.test(change.field ?? "")
        ? "SOCIAL_MENTION"
        : "DIRECT_MESSAGE";
      const externalId =
        change.value?.message?.mid
        ?? change.value?.comment_id
        ?? change.value?.media_id
        ?? buildStableExternalId(
          entry.id ?? platform,
          change.field,
          sender?.id,
          text,
        );

      events.push({
        platform,
        channelType,
        externalId,
        threadId: sender?.id ?? entry.id,
        authorName: sender?.name ?? sender?.username ?? sender?.id,
        authorHandle: sender?.username ?? sender?.id,
        content: text,
        receivedAt: new Date(),
        metadata: {
          field: change.field ?? null,
          entryId: entry.id ?? null,
        },
      });
    }
  }

  return events;
}

export async function ingestMetaWebhook(body: MetaWebhookBody) {
  const events = parseMetaWebhookEvents(body);
  const items = await Promise.all(events.map((event) => upsertInboxItem(event)));
  const shouldProcessImmediately = process.env.BIZBOT_PROCESS_WEBHOOK_INBOX_IMMEDIATELY === "true";

  const processed = items.length > 0 && shouldProcessImmediately
    ? await processInboxNow()
    : { replied: 0, drafted: 0, failed: 0 };

  return {
    received: events.length,
    processed,
  };
}