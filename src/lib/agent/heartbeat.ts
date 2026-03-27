import {
  InboxChannelType,
  InboxStatus,
  type InboxMessage,
  PostStatus,
  PlatformType,
  type Platform,
  type Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";
import { buildContext, getOrCreateConversation, saveMessage } from "@/lib/agent/memory";
import { chatComplete } from "@/lib/agent/kernel";
import { ensureKnowledgeEmbeddingsIndexed } from "@/lib/agent/knowledge";
import { getAgentCapabilities, getAgentRuntimeConfig } from "@/lib/agent/runtime";
import { runDueCompetitorChecks } from "@/lib/competitors/monitor";
import { getPlatformNameForType, getSocialClientForPlatformType } from "@/lib/social/clients";

interface HeartbeatRunSummary {
  indexedKnowledge: boolean;
  knowledgeChunks: number;
  importedInboxItems: number;
  publishedPosts: number;
  repliedItems: number;
  draftedDirectMessages: number;
  failedActions: number;
  competitorChecks: number;
  competitorChanges: number;
}

type InboxItemWithPlatform = InboxMessage & {
  platform: Platform;
};

type InboxMetadata = {
  participantId?: string;
  threadUrl?: string;
  messageUrl?: string;
  error?: string;
};

interface ProcessInboxSummary {
  replied: number;
  drafted: number;
  failed: number;
}

const MANAGED_PLATFORMS: Array<{ id: string; type: PlatformType }> = [
  { id: "twitter", type: PlatformType.TWITTER },
  { id: "facebook", type: PlatformType.FACEBOOK },
  { id: "instagram", type: PlatformType.INSTAGRAM },
];

const globalForHeartbeat = globalThis as typeof globalThis & {
  bizbotHeartbeatActive?: boolean;
};

function parseInboxMetadata(value: Prisma.JsonValue | null): InboxMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const candidate = value as Record<string, Prisma.JsonValue>;
  return {
    participantId: typeof candidate.participantId === "string" ? candidate.participantId : undefined,
    threadUrl: typeof candidate.threadUrl === "string" ? candidate.threadUrl : undefined,
    messageUrl: typeof candidate.messageUrl === "string" ? candidate.messageUrl : undefined,
    error: typeof candidate.error === "string" ? candidate.error : undefined,
  };
}

function mergeInboxMetadata(
  currentValue: Prisma.JsonValue | null,
  patch: Partial<InboxMetadata>,
): Prisma.InputJsonValue {
  return {
    ...parseInboxMetadata(currentValue),
    ...patch,
  };
}

function formatErrorMessage(error: Error | string | null | undefined): string {
  if (!error) {
    return "Unknown error";
  }

  return error instanceof Error ? error.message : String(error);
}

async function claimInboxMessage(id: string, statuses: InboxStatus[]): Promise<boolean> {
  const result = await db.inboxMessage.updateMany({
    where: {
      id,
      status: { in: statuses },
    },
    data: {
      status: InboxStatus.PROCESSING,
      processedAt: new Date(),
    },
  });

  return result.count === 1;
}

async function claimPostForPublishing(id: string, now: Date): Promise<boolean> {
  const result = await db.post.updateMany({
    where: {
      id,
      OR: [
        {
          status: PostStatus.SCHEDULED,
          scheduledAt: { lte: now },
        },
        {
          status: PostStatus.APPROVED,
          OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
        },
      ],
    },
    data: { status: PostStatus.PUBLISHING },
  });

  return result.count === 1;
}

async function setHeartbeatSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

async function upsertPlatform(platformId: string, platformType: PlatformType, connected: boolean): Promise<Platform> {
  return db.platform.upsert({
    where: { id: platformId },
    update: {
      type: platformType,
      displayName: platformId,
      connected,
    },
    create: {
      id: platformId,
      type: platformType,
      displayName: platformId,
      connected,
    },
  });
}

async function syncInboxFromMentions(): Promise<number> {
  let imported = 0;

  for (const managedPlatform of MANAGED_PLATFORMS) {
    const client = getSocialClientForPlatformType(managedPlatform.type);
    const platform = await upsertPlatform(managedPlatform.id, managedPlatform.type, client.isConnected());
    if (!client.isConnected()) {
      continue;
    }

    const mentions = await client.getMentions(20);
    for (const mention of mentions) {
      const existing = await db.inboxMessage.findUnique({
        where: {
          platformId_externalId: {
            platformId: platform.id,
            externalId: mention.id,
          },
        },
        select: { id: true },
      });

      await db.inboxMessage.upsert({
        where: {
          platformId_externalId: {
            platformId: platform.id,
            externalId: mention.id,
          },
        },
        update: {
          authorName: mention.authorName,
          authorHandle: mention.authorHandle,
          content: mention.content,
          receivedAt: mention.createdAt,
          metadata: mergeInboxMetadata(null, { messageUrl: mention.url }),
        },
        create: {
          platformId: platform.id,
          channelType: InboxChannelType.SOCIAL_MENTION,
          externalId: mention.id,
          threadId: mention.id,
          authorName: mention.authorName,
          authorHandle: mention.authorHandle,
          content: mention.content,
          receivedAt: mention.createdAt,
          metadata: mergeInboxMetadata(null, { messageUrl: mention.url }),
        },
      });

      if (!existing) {
        imported += 1;
      }
    }
  }

  return imported;
}

async function syncInboxFromDirectMessages(): Promise<number> {
  let imported = 0;

  for (const managedPlatform of MANAGED_PLATFORMS) {
    const client = getSocialClientForPlatformType(managedPlatform.type);
    const platform = await upsertPlatform(managedPlatform.id, managedPlatform.type, client.isConnected());
    if (!client.isConnected() || !client.supportsDirectMessages?.() || !client.listDirectMessages) {
      continue;
    }

    const directMessages = await client.listDirectMessages(20);
    for (const message of directMessages) {
      const existing = await db.inboxMessage.findUnique({
        where: {
          platformId_externalId: {
            platformId: platform.id,
            externalId: message.id,
          },
        },
        select: { id: true },
      });

      await db.inboxMessage.upsert({
        where: {
          platformId_externalId: {
            platformId: platform.id,
            externalId: message.id,
          },
        },
        update: {
          authorName: message.authorName,
          authorHandle: message.authorHandle,
          content: message.content,
          threadId: message.threadId,
          receivedAt: message.createdAt,
          metadata: mergeInboxMetadata(null, {
            participantId: message.participantId,
          }),
        },
        create: {
          platformId: platform.id,
          channelType: InboxChannelType.DIRECT_MESSAGE,
          externalId: message.id,
          threadId: message.threadId,
          authorName: message.authorName,
          authorHandle: message.authorHandle,
          content: message.content,
          receivedAt: message.createdAt,
          metadata: mergeInboxMetadata(null, {
            participantId: message.participantId,
          }),
        },
      });

      if (!existing) {
        imported += 1;
      }
    }
  }

  return imported;
}

async function publishReadyPosts(): Promise<number> {
  const now = new Date();
  const readyPosts = await db.post.findMany({
    where: {
      OR: [
        {
          status: PostStatus.SCHEDULED,
          scheduledAt: { lte: now },
        },
        {
          status: PostStatus.APPROVED,
          OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
        },
      ],
    },
    include: { platform: true },
    orderBy: { scheduledAt: "asc" },
    take: 20,
  });

  let published = 0;

  for (const post of readyPosts) {
    try {
      const client = getSocialClientForPlatformType(post.platform.type);
      if (!client.isConnected()) {
        continue;
      }

      const claimed = await claimPostForPublishing(post.id, now);
      if (!claimed) {
        continue;
      }

      const result = await client.post({ content: post.content, mediaUrls: post.mediaUrls });
      await db.post.updateMany({
        where: { id: post.id, status: PostStatus.PUBLISHING },
        data: {
          status: PostStatus.PUBLISHED,
          externalId: result.id,
          publishedAt: result.publishedAt ?? new Date(),
        },
      });
      published += 1;
    } catch (error) {
      await db.post.updateMany({
        where: { id: post.id, status: PostStatus.PUBLISHING },
        data: { status: PostStatus.FAILED },
      });
      console.error("[heartbeat publish]", error);
    }
  }

  return published;
}

async function generateReplyDraft(item: InboxItemWithPlatform): Promise<string> {
  if (item.replyContent) {
    return item.replyContent;
  }

  const platformName = getPlatformNameForType(item.platform.type);
  const context = await buildContext(item.content, undefined, "local-user");
  const conversationId = await getOrCreateConversation(undefined, "local-user");
  const response = await chatComplete([
    {
      role: "system",
      content:
        `You are BizBot preparing an automated ${item.channelType === InboxChannelType.DIRECT_MESSAGE ? "direct-message" : "social"} reply for ${platformName}. `
        + "Keep it concise, on-brand, and safe. Return only the reply body with no preamble."
        + (context ? `\n\nContext:\n${context}` : ""),
    },
    {
      role: "user",
      content: `Incoming message from ${item.authorHandle ?? item.authorName ?? "unknown sender"}:\n${item.content}`,
    },
  ]);

  await saveMessage(conversationId, "USER", item.content, {
    source: "inbox",
    inboxMessageId: item.id,
  });
  await saveMessage(conversationId, "ASSISTANT", response.content, {
    source: "inbox-reply-draft",
    inboxMessageId: item.id,
  });

  await db.inboxMessage.update({
    where: { id: item.id },
    data: {
      replyContent: response.content,
      processedAt: new Date(),
    },
  });

  return response.content;
}

async function sendInboxReply(item: InboxItemWithPlatform, replyContent: string): Promise<void> {
  const client = getSocialClientForPlatformType(item.platform.type);

  if (item.channelType === InboxChannelType.DIRECT_MESSAGE) {
    if (!client.supportsDirectMessages?.() || !client.sendDirectMessage) {
      await db.inboxMessage.update({
        where: { id: item.id },
        data: {
          status: InboxStatus.DRAFTED,
          replyContent,
          processedAt: new Date(),
        },
      });
      return;
    }

    const metadata = parseInboxMetadata(item.metadata);
    const recipientId = metadata.participantId ?? item.threadId;
    if (!recipientId) {
      throw new Error(`Missing DM recipient for inbox item ${item.id}`);
    }

    const reply = await client.sendDirectMessage(recipientId, replyContent, item.externalId);
    await db.inboxMessage.update({
      where: { id: item.id },
      data: {
        status: InboxStatus.REPLIED,
        replyContent,
        replyPostId: reply.id,
        processedAt: new Date(),
      },
    });
    return;
  }

  const reply = await client.reply(item.threadId ?? item.externalId, replyContent);
  await db.inboxMessage.update({
    where: { id: item.id },
    data: {
      status: InboxStatus.REPLIED,
      replyContent,
      replyPostId: reply.id,
      processedAt: new Date(),
    },
  });
}

async function setInboxFailure(item: InboxItemWithPlatform, error: Error | string): Promise<void> {
  await db.inboxMessage.update({
    where: { id: item.id },
    data: {
      status: InboxStatus.FAILED,
      processedAt: new Date(),
      metadata: mergeInboxMetadata(item.metadata, { error: formatErrorMessage(error) }),
    },
  });
}

async function getInboxItemOrThrow(id: string): Promise<InboxItemWithPlatform> {
  const item = await db.inboxMessage.findUnique({
    where: { id },
    include: { platform: true },
  });

  if (!item) {
    throw new Error(`Inbox item not found: ${id}`);
  }

  return item;
}

export async function draftInboxReply(id: string): Promise<InboxItemWithPlatform> {
  const item = await getInboxItemOrThrow(id);
  const claimed = await claimInboxMessage(id, [InboxStatus.OPEN, InboxStatus.FAILED]);
  if (!claimed) {
    return getInboxItemOrThrow(id);
  }

  try {
    const replyContent = await generateReplyDraft(item);
    await db.inboxMessage.update({
      where: { id },
      data: {
        status: InboxStatus.DRAFTED,
        replyContent,
        processedAt: new Date(),
      },
    });
  } catch (error) {
    await setInboxFailure(item, formatErrorMessage(error instanceof Error ? error : String(error)));
    throw error;
  }

  return getInboxItemOrThrow(id);
}

export async function approveInboxReply(id: string): Promise<InboxItemWithPlatform> {
  let item = await getInboxItemOrThrow(id);
  const claimed = await claimInboxMessage(id, [InboxStatus.OPEN, InboxStatus.DRAFTED, InboxStatus.FAILED]);
  if (!claimed) {
    return getInboxItemOrThrow(id);
  }

  try {
    const replyContent = await generateReplyDraft(item);
    item = await getInboxItemOrThrow(id);
    await sendInboxReply(item, replyContent);
  } catch (error) {
    await setInboxFailure(item, formatErrorMessage(error instanceof Error ? error : String(error)));
    throw error;
  }

  return getInboxItemOrThrow(id);
}

export async function resendDraftedInboxReply(id: string): Promise<InboxItemWithPlatform> {
  return approveInboxReply(id);
}

export async function dismissInboxMessage(id: string): Promise<InboxItemWithPlatform> {
  await db.inboxMessage.update({
    where: { id },
    data: {
      status: InboxStatus.DISMISSED,
      processedAt: new Date(),
    },
  });

  return getInboxItemOrThrow(id);
}

async function processInbox(): Promise<ProcessInboxSummary> {
  const runtime = getAgentRuntimeConfig();
  const capabilities = getAgentCapabilities(runtime);
  if (!capabilities.canReplyDirectly || capabilities.replyScope === "none") {
    return { replied: 0, drafted: 0, failed: 0 };
  }

  const eligibleChannelTypes = capabilities.replyScope === "direct_messages_only"
    ? [InboxChannelType.DIRECT_MESSAGE]
    : [InboxChannelType.DIRECT_MESSAGE, InboxChannelType.SOCIAL_MENTION];

  const openItems = await db.inboxMessage.findMany({
    where: {
      status: InboxStatus.OPEN,
      channelType: { in: eligibleChannelTypes },
    },
    include: { platform: true },
    orderBy: { receivedAt: "asc" },
    take: 10,
  });

  let replied = 0;
  let drafted = 0;
  let failed = 0;

  for (const item of openItems) {
    const claimed = await claimInboxMessage(item.id, [InboxStatus.OPEN]);
    if (!claimed) {
      continue;
    }

    try {
      const replyContent = await generateReplyDraft(item);
      const refreshed = await getInboxItemOrThrow(item.id);
      await sendInboxReply(refreshed, replyContent);

      const finalItem = await getInboxItemOrThrow(item.id);
      if (finalItem.status === InboxStatus.DRAFTED) {
        drafted += 1;
      } else {
        replied += 1;
      }
    } catch (error) {
      failed += 1;
      await setInboxFailure(item, formatErrorMessage(error instanceof Error ? error : String(error)));
      console.error("[heartbeat inbox]", error);
    }
  }

  return { replied, drafted, failed };
}

export async function processInboxNow(): Promise<ProcessInboxSummary> {
  return processInbox();
}

export async function runAgentHeartbeat(): Promise<HeartbeatRunSummary> {
  if (globalForHeartbeat.bizbotHeartbeatActive) {
    return {
      indexedKnowledge: false,
      knowledgeChunks: 0,
      importedInboxItems: 0,
      publishedPosts: 0,
      repliedItems: 0,
      draftedDirectMessages: 0,
      failedActions: 0,
      competitorChecks: 0,
      competitorChanges: 0,
    };
  }

  globalForHeartbeat.bizbotHeartbeatActive = true;
  await setHeartbeatSetting("agent_last_heartbeat_started_at", new Date().toISOString());

  try {
    const knowledge = await ensureKnowledgeEmbeddingsIndexed();
    const importedMentions = await syncInboxFromMentions();
    const importedDirectMessages = await syncInboxFromDirectMessages();
    const publishedPosts = await publishReadyPosts();
    const inbox = await processInbox();
    const competitor = await runDueCompetitorChecks();

    const summary: HeartbeatRunSummary = {
      indexedKnowledge: knowledge.indexed,
      knowledgeChunks: knowledge.chunkCount,
      importedInboxItems: importedMentions + importedDirectMessages,
      publishedPosts,
      repliedItems: inbox.replied,
      draftedDirectMessages: inbox.drafted,
      failedActions: inbox.failed + competitor.failed,
      competitorChecks: competitor.checked,
      competitorChanges: competitor.changed,
    };

    await setHeartbeatSetting("agent_last_heartbeat_finished_at", new Date().toISOString());
    await setHeartbeatSetting("agent_last_heartbeat_summary", JSON.stringify(summary));
    return summary;
  } finally {
    globalForHeartbeat.bizbotHeartbeatActive = false;
  }
}
