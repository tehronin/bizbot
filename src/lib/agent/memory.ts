/**
 * agent/memory.ts — Hybrid memory system combining pgvector + Memgraph.
 *
 * Short-term: current conversation context (loaded from DB per session)
 * Long-term: pgvector semantic search over Memory table
 * Knowledge: Memgraph graph traversal for entities/topics
 */

import { db } from "@/lib/db";
import { searchKnowledgeDocuments } from "@/lib/agent/knowledge";
import type { JsonObject } from "@/lib/agent/tools";
import { searchMemories, storeMemoryEmbedding } from "@/lib/embeddings/search";
import { searchGraph } from "@/lib/graph/queries";

interface MemoryFallbackRow {
  key: string;
  value: string;
  category: string;
}

interface RecentMessageRow {
  role: string;
  content: string;
}

export interface MemoryEntry {
  key: string;
  value: string;
  category: string;
  similarity?: number;
}

export interface MemoryInspectorEntry {
  id: string;
  key: string;
  value: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationInspectorEntry {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ConversationMessageInspectorEntry {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

const DEFAULT_USER_ID = "local-user";

/** Store a new memory entry with embedding. */
export async function remember(
  key: string,
  value: string,
  category = "general",
  userId = DEFAULT_USER_ID,
): Promise<void> {
  // Ensure user exists
  await db.user.upsert({
    where: { id: userId },
    create: { id: userId, name: "User" },
    update: {},
  });

  const memory = await db.memory.upsert({
    where: { id: `${userId}:${key}` },
    create: { id: `${userId}:${key}`, userId, key, value, category },
    update: { value, category },
  });

  // Embed in background (fire and forget for speed)
  storeMemoryEmbedding(memory.id, `${key}: ${value}`).catch(console.error);
}

/** Recall memories most semantically similar to the query. */
export async function recall(
  query: string,
  limit = 5,
  userId = DEFAULT_USER_ID,
): Promise<MemoryEntry[]> {
  try {
    const results = await searchMemories(userId, query, limit);
    return results.map((r) => ({
      key: r.key,
      value: r.value,
      category: r.category,
      similarity: r.similarity,
    }));
  } catch {
    // Fall back to simple text search if pgvector not ready
    const results = await db.memory.findMany({
      where: { userId, value: { contains: query.slice(0, 50) } },
      take: limit,
    });
    return results.map((memory: MemoryFallbackRow) => ({
      key: memory.key,
      value: memory.value,
      category: memory.category,
    }));
  }
}

export async function inspectMemories(options?: {
  query?: string;
  category?: string;
  limit?: number;
  userId?: string;
}): Promise<MemoryInspectorEntry[]> {
  const limit = Math.max(1, Math.min(Math.trunc(options?.limit ?? 20), 100));
  const userId = options?.userId ?? DEFAULT_USER_ID;

  const memories = await db.memory.findMany({
    where: {
      userId,
      ...(options?.category ? { category: options.category } : {}),
      ...(options?.query
        ? {
            OR: [
              { key: { contains: options.query, mode: "insensitive" } },
              { value: { contains: options.query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  return memories.map((memory) => ({
    id: memory.id,
    key: memory.key,
    value: memory.value,
    category: memory.category,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  }));
}

export async function listRecentConversations(options?: {
  limit?: number;
  userId?: string;
}): Promise<ConversationInspectorEntry[]> {
  const limit = Math.max(1, Math.min(Math.trunc(options?.limit ?? 20), 100));
  const userId = options?.userId ?? DEFAULT_USER_ID;

  const conversations = await db.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: {
      _count: {
        select: { messages: true },
      },
    },
  });

  return conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title ?? null,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    messageCount: conversation._count.messages,
  }));
}

export async function inspectConversationMessages(
  conversationId: string,
  limit = 50,
): Promise<ConversationMessageInspectorEntry[]> {
  const normalizedLimit = Math.max(1, Math.min(Math.trunc(limit), 200));
  const messages = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: normalizedLimit,
  });

  return messages.reverse().map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  }));
}

/** Build a context string for the LLM prompt from relevant memories + graph entities. */
export async function buildContext(
  userMessage: string,
  conversationId?: string,
  userId = DEFAULT_USER_ID,
): Promise<string> {
  const parts: string[] = [];

  // Recent conversation messages
  if (conversationId) {
    const recent = await db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    if (recent.length > 0) {
      parts.push(
        "Recent conversation:\n" +
          recent
            .reverse()
            .map((message: RecentMessageRow) => `${message.role}: ${message.content}`)
            .join("\n"),
      );
    }
  }

  // Semantic memory recall
  const memories = await recall(userMessage, 5, userId);
  if (memories.length > 0) {
    parts.push(
      "Relevant memories:\n" +
        memories.map((m) => `- [${m.category}] ${m.key}: ${m.value}`).join("\n"),
    );
  }

  // Knowledge graph context
  try {
    const graphResults = await searchGraph(userMessage, 5);
    if (graphResults.length > 0) {
      parts.push(
        "Knowledge graph:\n" +
          graphResults.map((g) => `- ${g.type}: ${g.name}`).join("\n"),
      );
    }
  } catch {
    // Memgraph may not be available
  }

  try {
    const knowledgeResults = await searchKnowledgeDocuments(userMessage, 3);
    if (knowledgeResults.length > 0) {
      parts.push(
        "Company docs:\n" + knowledgeResults.map((doc) => `- ${doc.path}: ${doc.snippet}`).join("\n"),
      );
    }
  } catch {
    // Local knowledge folder may not exist yet
  }

  return parts.join("\n\n");
}

/** Save a message to the conversation history. */
export async function saveMessage(
  conversationId: string,
  role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL",
  content: string,
  metadata?: JsonObject,
): Promise<void> {
  await db.message.create({
    data: { conversationId, role, content, metadata },
  });
}

export async function trimConversationMessages(
  conversationId: string,
  maxMessages: number,
): Promise<void> {
  if (maxMessages < 1) {
    return;
  }

  const overflow = await db.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: maxMessages,
    select: { id: true },
  });

  if (overflow.length === 0) {
    return;
  }

  await db.message.deleteMany({
    where: {
      id: {
        in: overflow.map((message) => message.id),
      },
    },
  });
}

export async function getOrCreateScopedConversation(
  scopeKey: string,
  userId = DEFAULT_USER_ID,
): Promise<string> {
  const title = `Scope:${scopeKey}`;

  await db.user.upsert({
    where: { id: userId },
    create: { id: userId, name: "User" },
    update: {},
  });

  const existing = await db.conversation.findFirst({
    where: { userId, title },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    return existing.id;
  }

  const conversation = await db.conversation.create({
    data: { userId, title },
  });
  return conversation.id;
}

/** Get or create a conversation for the local user. */
export async function getOrCreateConversation(
  conversationId?: string,
  userId = DEFAULT_USER_ID,
): Promise<string> {
  if (conversationId) {
    const existing = await db.conversation.findUnique({
      where: { id: conversationId },
    });
    if (existing) return existing.id;
  }

  await db.user.upsert({
    where: { id: userId },
    create: { id: userId, name: "User" },
    update: {},
  });

  const conversation = await db.conversation.create({
    data: { userId, title: `Chat ${new Date().toLocaleString()}` },
  });
  return conversation.id;
}
