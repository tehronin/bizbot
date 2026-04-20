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

interface RecentMessageRow {
  role: string;
  content: string;
  createdAt: Date;
}

interface ConversationSummaryRow {
  promptSummary: string | null;
  promptSummaryUpdatedAt: Date | null;
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

export interface RetrievalDecision {
  included: boolean;
  reason: string;
  resultCount: number;
  chars: number;
}

export interface BuildContextResult {
  text: string;
  blocks: {
    conversationSummary: string;
    recentConversation: string;
    semanticRecall: string;
    graph: string;
    knowledgeDocs: string;
  };
  retrieval: {
    conversationSummary: RetrievalDecision;
    recentConversation: RetrievalDecision;
    semanticRecall: RetrievalDecision;
    graph: RetrievalDecision;
    knowledgeDocs: RetrievalDecision;
  };
}

interface ContextLimits {
  recentRawMessageWindow: number;
  summaryMaxChars: number;
  summaryLineMaxChars: number;
  summaryMessageLimit: number;
  recentConversationTake: number;
  semanticRecallLimit: number;
  graphLimit: number;
  knowledgeDocsLimit: number;
}

const DEFAULT_USER_ID = "local-user";
const RECENT_CONVERSATION_MAX_AGE_MS = 30 * 60 * 1000;
const STANDARD_CONTEXT_LIMITS: ContextLimits = {
  recentRawMessageWindow: 6,
  summaryMaxChars: 1_200,
  summaryLineMaxChars: 180,
  summaryMessageLimit: 80,
  recentConversationTake: 10,
  semanticRecallLimit: 5,
  graphLimit: 5,
  knowledgeDocsLimit: 3,
};

const EXTENDED_GOOGLE_CONTEXT_LIMITS: ContextLimits = {
  recentRawMessageWindow: 12,
  summaryMaxChars: 6_000,
  summaryLineMaxChars: 320,
  summaryMessageLimit: 160,
  recentConversationTake: 20,
  semanticRecallLimit: 8,
  graphLimit: 8,
  knowledgeDocsLimit: 6,
};

function getContextLimits(extendedContext = false): ContextLimits {
  return extendedContext ? EXTENDED_GOOGLE_CONTEXT_LIMITS : STANDARD_CONTEXT_LIMITS;
}

function buildSkippedDecision(reason: string): RetrievalDecision {
  return {
    included: false,
    reason,
    resultCount: 0,
    chars: 0,
  };
}

function buildIncludedDecision(reason: string, resultCount: number, chars: number): RetrievalDecision {
  return {
    included: true,
    reason,
    resultCount,
    chars,
  };
}

function isShortFollowUp(message: string): boolean {
  return message.trim().split(/\s+/).filter(Boolean).length <= 18;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars - 3)}...`;
}

function shouldUseConversationHistory(userMessage: string): { include: boolean; reason: string } {
  const normalized = userMessage.trim().toLowerCase();
  if (!normalized) {
    return { include: false, reason: "message is empty" };
  }

  if (/\b(new topic|separate question|unrelated|ignore previous|start over|different subject)\b/.test(normalized)) {
    return { include: false, reason: "message explicitly starts a new topic" };
  }

  const continuityPattern = /\b(that|it|this|those|them|continue|again|previous|earlier|same|above|follow up|follow-up|retry|fix that|what about|also|instead)\b/;
  if (continuityPattern.test(normalized) || isShortFollowUp(normalized) || normalized.endsWith("?")) {
    return { include: true, reason: "message looks like a continuation of the current thread" };
  }

  return { include: false, reason: "message does not appear to continue the current thread" };
}

function shouldIncludeRecentConversation(userMessage: string, recentMessages: RecentMessageRow[]): { include: boolean; reason: string } {
  if (recentMessages.length === 0) {
    return { include: false, reason: "no conversation history available" };
  }

  const historyIntent = shouldUseConversationHistory(userMessage);
  if (!historyIntent.include) {
    return historyIntent;
  }

  const latestMessageAgeMs = Date.now() - recentMessages[0].createdAt.getTime();
  if (latestMessageAgeMs <= RECENT_CONVERSATION_MAX_AGE_MS) {
    return { include: true, reason: "conversation is recent and the message looks continuous" };
  }

  return { include: false, reason: "conversation history exists, but the most recent raw turns are stale" };
}

function buildSummaryLine(message: RecentMessageRow, limits: ContextLimits): string {
  const roleLabel = message.role === "USER" ? "User" : message.role === "ASSISTANT" ? "Assistant" : message.role;
  const compact = message.content.replace(/\s+/g, " ").trim();
  return `- ${roleLabel}: ${truncate(compact, limits.summaryLineMaxChars)}`;
}

function buildConversationSummaryText(messages: RecentMessageRow[], limits: ContextLimits): string {
  const meaningfulMessages = messages.filter((message) => message.role === "USER" || message.role === "ASSISTANT");
  if (meaningfulMessages.length <= limits.recentRawMessageWindow) {
    return "";
  }

  const summarySource = meaningfulMessages.slice(0, -limits.recentRawMessageWindow);
  if (summarySource.length === 0) {
    return "";
  }

  const lines: string[] = ["Earlier conversation summary:"];
  for (const message of summarySource) {
    const nextLine = buildSummaryLine(message, limits);
    const nextText = [...lines, nextLine].join("\n");
    if (nextText.length > limits.summaryMaxChars) {
      lines.push(`- ${summarySource.length - (lines.length - 1)} earlier turns omitted for brevity.`);
      break;
    }
    lines.push(nextLine);
  }

  return lines.join("\n");
}

async function refreshConversationPromptSummary(conversationId: string): Promise<void> {
  const limits = getContextLimits(false);
  const messages = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: limits.summaryMessageLimit,
    select: {
      role: true,
      content: true,
      createdAt: true,
    },
  });

  const promptSummary = buildConversationSummaryText(messages, limits);
  await db.conversation.update({
    where: { id: conversationId },
    data: {
      promptSummary: promptSummary || null,
      promptSummaryUpdatedAt: promptSummary ? new Date() : null,
    },
  });
}

async function buildConversationSummaryBlock(
  userMessage: string,
  conversationId: string | undefined,
  limits: ContextLimits,
  extendedContext = false,
): Promise<{ text: string; decision: RetrievalDecision }> {
  if (!conversationId) {
    return { text: "", decision: buildSkippedDecision("no conversation id supplied") };
  }

  const historyIntent = shouldUseConversationHistory(userMessage);
  if (!historyIntent.include) {
    return { text: "", decision: buildSkippedDecision(historyIntent.reason) };
  }

  if (extendedContext) {
    const messages = await db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: limits.summaryMessageLimit,
      select: {
        role: true,
        content: true,
        createdAt: true,
      },
    });

    const extendedSummary = buildConversationSummaryText(messages, limits);
    if (extendedSummary) {
      return {
        text: extendedSummary,
        decision: buildIncludedDecision(`${historyIntent.reason}; rebuilt extended Gemini summary`, 1, extendedSummary.length),
      };
    }
  }

  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    select: {
      promptSummary: true,
      promptSummaryUpdatedAt: true,
    },
  }) as ConversationSummaryRow | null;

  const promptSummary = conversation?.promptSummary?.trim() ?? "";
  if (!promptSummary) {
    return { text: "", decision: buildSkippedDecision("no rolling conversation summary is available yet") };
  }

  return {
    text: promptSummary,
    decision: buildIncludedDecision(historyIntent.reason, 1, promptSummary.length),
  };
}

function shouldRecallSemanticMemory(userMessage: string): { include: boolean; reason: string } {
  const normalized = userMessage.toLowerCase();
  const pattern = /\b(remember|preference|prefer|my name|about me|i like|i dislike|always|never|workflow|routine|style|voice|tone|persona|schedule|timezone|history|what did i say|what do i usually)\b/;
  return pattern.test(normalized)
    ? { include: true, reason: "message asks about user identity, preference, or workflow context" }
    : { include: false, reason: "message does not target long-term user memory" };
}

function shouldSearchGraph(userMessage: string): { include: boolean; reason: string } {
  const normalized = userMessage.toLowerCase();
  const pattern = /\b(who is|what is|relationship|related to|connected to|between|owner|owns|entity|entities|graph|ontology|person|company|topic|lead|account)\b/;
  return pattern.test(normalized)
    ? { include: true, reason: "message appears to ask about entities or relationships" }
    : { include: false, reason: "message does not appear to require graph traversal" };
}

function shouldSearchKnowledgeDocs(userMessage: string): { include: boolean; reason: string } {
  const normalized = userMessage.toLowerCase();
  const pattern = /\b(how to|how do i|where is|which file|command|config|configure|setup|install|run|build|deploy|policy|doc|docs|readme|endpoint|api|operational|troubleshoot|error|fix|workspace)\b/;
  return pattern.test(normalized)
    ? { include: true, reason: "message appears to ask for factual or operational guidance" }
    : { include: false, reason: "message does not appear to need knowledge-document retrieval" };
}

async function buildRecentConversationBlock(
  conversationId: string | undefined,
  limits: ContextLimits,
): Promise<{ text: string; messages: RecentMessageRow[]; decision: RetrievalDecision }> {
  if (!conversationId) {
    return { text: "", messages: [], decision: buildSkippedDecision("no conversation id supplied") };
  }

  const recentMessages = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: limits.recentConversationTake,
    select: {
      role: true,
      content: true,
      createdAt: true,
    },
  });

  return {
    text: recentMessages
      .reverse()
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n"),
    messages: recentMessages,
    decision: buildIncludedDecision("recent conversation queried for gating", recentMessages.length, 0),
  };
}

async function buildSemanticRecallBlock(userMessage: string, userId: string, limits: ContextLimits): Promise<{ text: string; decision: RetrievalDecision }> {
  const gate = shouldRecallSemanticMemory(userMessage);
  if (!gate.include) {
    return { text: "", decision: buildSkippedDecision(gate.reason) };
  }

  const memories = await recall(userMessage, limits.semanticRecallLimit, userId);
  if (memories.length === 0) {
    return { text: "", decision: buildSkippedDecision("semantic recall returned no relevant memories") };
  }

  const text = memories.map((m) => `- [${m.category}] ${m.key}: ${m.value}`).join("\n");
  return {
    text,
    decision: buildIncludedDecision(gate.reason, memories.length, text.length),
  };
}

async function buildGraphBlock(userMessage: string, limits: ContextLimits): Promise<{ text: string; decision: RetrievalDecision }> {
  const gate = shouldSearchGraph(userMessage);
  if (!gate.include) {
    return { text: "", decision: buildSkippedDecision(gate.reason) };
  }

  try {
    const graphResults = await searchGraph(userMessage, limits.graphLimit);
    if (graphResults.length === 0) {
      return { text: "", decision: buildSkippedDecision("graph search returned no matches") };
    }

    const text = graphResults.map((g) => `- ${g.type}: ${g.name}`).join("\n");
    return {
      text,
      decision: buildIncludedDecision(gate.reason, graphResults.length, text.length),
    };
  } catch {
    return { text: "", decision: buildSkippedDecision("graph search unavailable") };
  }
}

async function buildKnowledgeDocsBlock(userMessage: string, limits: ContextLimits): Promise<{ text: string; decision: RetrievalDecision }> {
  const gate = shouldSearchKnowledgeDocs(userMessage);
  if (!gate.include) {
    return { text: "", decision: buildSkippedDecision(gate.reason) };
  }

  try {
    const knowledgeResults = await searchKnowledgeDocuments(userMessage, limits.knowledgeDocsLimit);
    if (knowledgeResults.length === 0) {
      return { text: "", decision: buildSkippedDecision("knowledge search returned no matches") };
    }

    const text = knowledgeResults.map((doc) => `- ${doc.path}: ${doc.snippet}`).join("\n");
    return {
      text,
      decision: buildIncludedDecision(gate.reason, knowledgeResults.length, text.length),
    };
  } catch {
    return { text: "", decision: buildSkippedDecision("knowledge search unavailable") };
  }
}

export async function buildContextForPrompt(
  userMessage: string,
  conversationId?: string,
  userId = DEFAULT_USER_ID,
  options?: { extendedContext?: boolean },
): Promise<BuildContextResult> {
  const limits = getContextLimits(options?.extendedContext ?? false);
  const recentConversationBase = await buildRecentConversationBlock(conversationId, limits);
  const conversationSummaryPromise = buildConversationSummaryBlock(userMessage, conversationId, limits, options?.extendedContext ?? false);
  const recentConversationGate = shouldIncludeRecentConversation(userMessage, recentConversationBase.messages);

  const semanticRecallPromise = buildSemanticRecallBlock(userMessage, userId, limits);
  const graphPromise = buildGraphBlock(userMessage, limits);
  const knowledgeDocsPromise = buildKnowledgeDocsBlock(userMessage, limits);
  const [conversationSummary, semanticRecall, graph, knowledgeDocs] = await Promise.all([
    conversationSummaryPromise,
    semanticRecallPromise,
    graphPromise,
    knowledgeDocsPromise,
  ]);

  const recentConversationText = recentConversationGate.include && recentConversationBase.text
    ? recentConversationBase.text
    : "";
  const recentConversationDecision = recentConversationGate.include && recentConversationBase.text
    ? buildIncludedDecision(recentConversationGate.reason, recentConversationBase.text.split("\n").length, recentConversationBase.text.length)
    : buildSkippedDecision(recentConversationGate.reason);

  const parts: string[] = [];
  if (conversationSummary.text) {
    parts.push(conversationSummary.text);
  }
  if (recentConversationText) {
    parts.push(`Recent conversation:\n${recentConversationText}`);
  }
  if (semanticRecall.text) {
    parts.push(`Relevant memories:\n${semanticRecall.text}`);
  }
  if (graph.text) {
    parts.push(`Knowledge graph:\n${graph.text}`);
  }
  if (knowledgeDocs.text) {
    parts.push(`Company docs:\n${knowledgeDocs.text}`);
  }

  return {
    text: parts.join("\n\n"),
    blocks: {
      conversationSummary: conversationSummary.text,
      recentConversation: recentConversationText,
      semanticRecall: semanticRecall.text,
      graph: graph.text,
      knowledgeDocs: knowledgeDocs.text,
    },
    retrieval: {
      conversationSummary: conversationSummary.decision,
      recentConversation: recentConversationDecision,
      semanticRecall: semanticRecall.decision,
      graph: graph.decision,
      knowledgeDocs: knowledgeDocs.decision,
    },
  };
}

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
    return results.map((memory) => ({
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
    where: { userId, deletedAt: null },
    orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
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
  const result = await buildContextForPrompt(userMessage, conversationId, userId);
  return result.text;
}

/** Save a message to the conversation history. */
export async function saveMessage(
  conversationId: string,
  role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL",
  content: string,
  metadata?: JsonObject,
): Promise<void> {
  const timestamp = new Date();

  await db.$transaction([
    db.message.create({
      data: { conversationId, role, content, metadata },
    }),
    db.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: timestamp },
    }),
  ]);

  void refreshConversationPromptSummary(conversationId).catch((error) => {
    console.warn("[agent memory] failed to refresh conversation summary:", error);
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
    where: { userId, title, archivedAt: null, deletedAt: null },
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
  options?: { builderProjectId?: string | null },
): Promise<string> {
  if (conversationId) {
    const existing = await db.conversation.findFirst({
      where: { id: conversationId, userId, archivedAt: null, deletedAt: null },
      select: { id: true, builderProjectId: true },
    });
    if (existing) {
      if (!options?.builderProjectId || existing.builderProjectId === options.builderProjectId) {
        return existing.id;
      }
    }
  }

  await db.user.upsert({
    where: { id: userId },
    create: { id: userId, name: "User" },
    update: {},
  });

  const conversation = await db.conversation.create({
    data: {
      userId,
      title: `Chat ${new Date().toLocaleString()}`,
      ...(options?.builderProjectId ? { builderProjectId: options.builderProjectId } : {}),
    },
  });
  return conversation.id;
}

export async function updateConversationExecutionDefaults(
  conversationId: string,
  defaults: { mode: "ask" | "agent"; pluginId: string },
): Promise<void> {
  await db.conversation.update({
    where: { id: conversationId },
    data: {
      defaultMode: defaults.mode === "agent" ? "AGENT" : "ASK",
      defaultPluginId: defaults.pluginId,
    },
  });
}
