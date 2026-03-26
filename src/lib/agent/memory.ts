/**
 * agent/memory.ts — Hybrid memory system combining pgvector + Memgraph.
 *
 * Short-term: current conversation context (loaded from DB per session)
 * Long-term: pgvector semantic search over Memory table
 * Knowledge: Memgraph graph traversal for entities/topics
 */

import { db } from "@/lib/db";
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
