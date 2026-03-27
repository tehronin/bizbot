import { InboxChannelType, InboxStatus, PlatformType, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type InboxPlatformName = "twitter" | "facebook" | "instagram";

export interface UpsertInboxItemInput {
  platform: InboxPlatformName;
  channelType: "DIRECT_MESSAGE" | "SOCIAL_MENTION";
  externalId: string;
  threadId?: string;
  authorName?: string;
  authorHandle?: string;
  content: string;
  receivedAt?: Date;
  metadata?: Prisma.InputJsonValue;
}

export function parsePlatformType(platform: InboxPlatformName): PlatformType {
  switch (platform) {
    case "twitter":
      return PlatformType.TWITTER;
    case "facebook":
      return PlatformType.FACEBOOK;
    case "instagram":
      return PlatformType.INSTAGRAM;
  }
}

export async function upsertInboxItem(input: UpsertInboxItemInput) {
  const platformType = parsePlatformType(input.platform);
  const platform = await db.platform.upsert({
    where: { id: input.platform },
    update: { type: platformType, displayName: input.platform },
    create: {
      id: input.platform,
      type: platformType,
      displayName: input.platform,
      connected: false,
    },
  });

  return db.inboxMessage.upsert({
    where: {
      platformId_externalId: {
        platformId: platform.id,
        externalId: input.externalId,
      },
    },
    update: {
      channelType:
        input.channelType === "DIRECT_MESSAGE"
          ? InboxChannelType.DIRECT_MESSAGE
          : InboxChannelType.SOCIAL_MENTION,
      threadId: input.threadId ?? input.externalId,
      authorName: input.authorName ?? null,
      authorHandle: input.authorHandle ?? null,
      content: input.content,
      receivedAt: input.receivedAt ?? new Date(),
      metadata: input.metadata,
    },
    create: {
      platformId: platform.id,
      channelType:
        input.channelType === "DIRECT_MESSAGE"
          ? InboxChannelType.DIRECT_MESSAGE
          : InboxChannelType.SOCIAL_MENTION,
      externalId: input.externalId,
      threadId: input.threadId ?? input.externalId,
      authorName: input.authorName ?? null,
      authorHandle: input.authorHandle ?? null,
      content: input.content,
      receivedAt: input.receivedAt ?? new Date(),
      status: InboxStatus.OPEN,
      metadata: input.metadata,
    },
  });
}