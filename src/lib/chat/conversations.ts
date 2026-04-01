import { db } from "@/lib/db";
import { resolveAgentUserId } from "@/lib/agent/user-context";
import {
  buildConversationLabel,
  truncateChatPreview,
  type ChatConversationBootstrap,
  type ChatConversationDetail,
  type ChatConversationMessage,
  type ChatConversationSummary,
} from "@/lib/chat/types";

const RECENT_CONVERSATION_LIMIT = 12;
const ARCHIVED_CONVERSATION_LIMIT = 24;

type ConversationRow = Awaited<ReturnType<typeof fetchConversationRows>>[number];
type ConversationState = "active" | "archived" | "any";

function serializeMessage(row: { id: string; role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL"; content: string; createdAt: Date }): ChatConversationMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

function serializeSummary(row: ConversationRow): ChatConversationSummary {
  const messages = row.messages.map(serializeMessage);
  const firstUserMessage = messages.find((message) => message.role === "USER")?.content ?? null;
  const previewSource = messages.at(-1)?.content ?? null;

  return {
    id: row.id,
    title: row.title ?? null,
    label: buildConversationLabel({
      title: row.title,
      firstUserMessage,
    }),
    preview: previewSource ? truncateChatPreview(previewSource) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    messageCount: row._count.messages,
  };
}

function serializeDetail(row: ConversationRow): ChatConversationDetail {
  return {
    ...serializeSummary(row),
    messages: row.messages.map(serializeMessage),
  };
}

function conversationOrderBy() {
  return [{ lastMessageAt: "desc" as const }, { updatedAt: "desc" as const }, { createdAt: "desc" as const }];
}

function buildStateWhere(userId: string, state: ConversationState) {
  if (state === "active") {
    return { userId, archivedAt: null, deletedAt: null };
  }

  if (state === "archived") {
    return {
      userId,
      deletedAt: null,
      archivedAt: { not: null as never },
    };
  }

  return { userId, deletedAt: null };
}

async function ensureConversationUser(userId: string): Promise<void> {
  await db.user.upsert({
    where: { id: userId },
    create: { id: userId, name: "User" },
    update: {},
  });
}

async function fetchConversationRows(userId: string, state: ConversationState, limit: number) {
  return db.conversation.findMany({
    where: buildStateWhere(userId, state),
    orderBy: conversationOrderBy(),
    take: limit,
    include: {
      _count: {
        select: { messages: true },
      },
      messages: {
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function listActiveConversations(userIdInput?: string): Promise<ChatConversationSummary[]> {
  const userId = resolveAgentUserId(userIdInput);
  await ensureConversationUser(userId);

  const rows = await fetchConversationRows(userId, "active", RECENT_CONVERSATION_LIMIT);
  return rows.map(serializeSummary);
}

export async function listArchivedConversations(userIdInput?: string): Promise<ChatConversationSummary[]> {
  const userId = resolveAgentUserId(userIdInput);
  await ensureConversationUser(userId);

  const rows = await fetchConversationRows(userId, "archived", ARCHIVED_CONVERSATION_LIMIT);
  return rows.map(serializeSummary);
}

export async function getConversationDetail(
  conversationId: string,
  userIdInput?: string,
  state: ConversationState = "any",
): Promise<ChatConversationDetail | null> {
  const userId = resolveAgentUserId(userIdInput);
  await ensureConversationUser(userId);

  const row = await db.conversation.findFirst({
    where: {
      id: conversationId,
      ...buildStateWhere(userId, state),
    },
    include: {
      _count: {
        select: { messages: true },
      },
      messages: {
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  return row ? serializeDetail(row) : null;
}

export async function resolveChatBootstrap(options?: {
  userId?: string;
  selectedConversationId?: string | null;
}): Promise<ChatConversationBootstrap> {
  const userId = resolveAgentUserId(options?.userId);
  await ensureConversationUser(userId);

  const [recentConversations, archivedConversations, preferredConversation] = await Promise.all([
    listActiveConversations(userId),
    listArchivedConversations(userId),
    options?.selectedConversationId
      ? getConversationDetail(options.selectedConversationId, userId, "active")
      : Promise.resolve(null),
  ]);

  const currentConversationId = preferredConversation?.id ?? recentConversations[0]?.id ?? null;
  const currentConversation = preferredConversation
    ?? (currentConversationId ? await getConversationDetail(currentConversationId, userId, "active") : null);

  const normalizedRecentConversations = preferredConversation
    ? [preferredConversation, ...recentConversations.filter((conversation) => conversation.id !== preferredConversation.id)]
        .slice(0, RECENT_CONVERSATION_LIMIT)
    : recentConversations;

  return {
    currentConversationId,
    currentConversation,
    recentConversations: normalizedRecentConversations,
    archivedConversations,
  };
}

async function requireConversation(
  conversationId: string,
  userId: string,
  state: ConversationState,
): Promise<void> {
  const conversation = await db.conversation.findFirst({
    where: {
      id: conversationId,
      ...buildStateWhere(userId, state),
    },
    select: { id: true },
  });

  if (!conversation) {
    throw new Error("Conversation not found.");
  }
}

export async function archiveConversation(conversationId: string, userIdInput?: string): Promise<ChatConversationDetail> {
  const userId = resolveAgentUserId(userIdInput);
  await ensureConversationUser(userId);
  await requireConversation(conversationId, userId, "active");

  await db.conversation.update({
    where: { id: conversationId },
    data: { archivedAt: new Date() },
  });

  const conversation = await getConversationDetail(conversationId, userId, "archived");
  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  return conversation;
}

export async function restoreConversation(conversationId: string, userIdInput?: string): Promise<ChatConversationDetail> {
  const userId = resolveAgentUserId(userIdInput);
  await ensureConversationUser(userId);
  await requireConversation(conversationId, userId, "archived");

  await db.conversation.update({
    where: { id: conversationId },
    data: { archivedAt: null },
  });

  const conversation = await getConversationDetail(conversationId, userId, "active");
  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  return conversation;
}

export async function deleteArchivedConversation(conversationId: string, userIdInput?: string): Promise<void> {
  const userId = resolveAgentUserId(userIdInput);
  await ensureConversationUser(userId);
  await requireConversation(conversationId, userId, "archived");

  await db.conversation.update({
    where: { id: conversationId },
    data: { deletedAt: new Date() },
  });
}