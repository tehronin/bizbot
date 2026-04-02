import { db } from "@/lib/db";
import { getConversationUsageSummary } from "@/lib/agent/run-journal";
import { parseUsageLedgerModelPricingSetting, USAGE_LEDGER_MODEL_PRICING_SETTING_KEY } from "@/lib/agent/usage-ledger-pricing";
import { resolveAgentUserId } from "@/lib/agent/user-context";
import {
  buildConversationLabel,
  truncateChatPreview,
  DEFAULT_CHAT_HISTORY_PAGE_SIZE,
  MAX_CHAT_HISTORY_PAGE_SIZE,
  type ChatConversationBootstrap,
  type ChatConversationDetail,
  type ChatConversationHistoryFilters,
  type ChatConversationPagination,
  type ChatConversationMessage,
  type ChatConversationSummary,
  type ChatConversationUsageSummary,
} from "@/lib/chat/types";

type ConversationRow = Awaited<ReturnType<typeof fetchConversationRows>>[number];
type ConversationState = "active" | "archived" | "any";
type ConversationPageQuery = {
  page?: number;
  pageSize?: number;
  filters?: Partial<ChatConversationHistoryFilters>;
};

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

function clampPageSize(pageSize?: number): number {
  const candidate = Number.isFinite(pageSize) ? Math.trunc(pageSize as number) : DEFAULT_CHAT_HISTORY_PAGE_SIZE;
  return Math.max(1, Math.min(candidate, MAX_CHAT_HISTORY_PAGE_SIZE));
}

function clampPage(page?: number): number {
  const candidate = Number.isFinite(page) ? Math.trunc(page as number) : 1;
  return Math.max(1, candidate);
}

function normalizeHistoryDate(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

export function normalizeHistoryFilters(input?: Partial<ChatConversationHistoryFilters>): ChatConversationHistoryFilters {
  const search = input?.search?.trim() ?? "";
  const from = normalizeHistoryDate(input?.from);
  const to = normalizeHistoryDate(input?.to);

  return {
    search,
    from,
    to,
  };
}

function startOfDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function endOfDay(value: string): Date {
  return new Date(`${value}T23:59:59.999Z`);
}

function buildHistoryFilterWhere(filters: ChatConversationHistoryFilters) {
  const where: Record<string, unknown> = {};

  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search, mode: "insensitive" as const } },
      { promptSummary: { contains: filters.search, mode: "insensitive" as const } },
      { messages: { some: { content: { contains: filters.search, mode: "insensitive" as const } } } },
    ];
  }

  if (filters.from || filters.to) {
    where.updatedAt = {
      ...(filters.from ? { gte: startOfDay(filters.from) } : {}),
      ...(filters.to ? { lte: endOfDay(filters.to) } : {}),
    };
  }

  return where;
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

function buildConversationWhere(userId: string, state: ConversationState, filters?: ChatConversationHistoryFilters) {
  return {
    ...buildStateWhere(userId, state),
    ...(filters ? buildHistoryFilterWhere(filters) : {}),
  };
}

async function ensureConversationUser(userId: string): Promise<void> {
  await db.user.upsert({
    where: { id: userId },
    create: { id: userId, name: "User" },
    update: {},
  });
}

async function fetchConversationRows(
  userId: string,
  state: ConversationState,
  options?: {
    take?: number;
    skip?: number;
    filters?: ChatConversationHistoryFilters;
  },
) {
  return db.conversation.findMany({
    where: buildConversationWhere(userId, state, options?.filters),
    orderBy: conversationOrderBy(),
    take: options?.take,
    skip: options?.skip,
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

async function countConversationRows(userId: string, state: ConversationState, filters?: ChatConversationHistoryFilters): Promise<number> {
  return db.conversation.count({
    where: buildConversationWhere(userId, state, filters),
  });
}

async function fetchConversationPage(
  userId: string,
  state: ConversationState,
  query?: ConversationPageQuery,
): Promise<{
  conversations: ChatConversationSummary[];
  pagination: ChatConversationPagination;
  filters: ChatConversationHistoryFilters;
}> {
  const pageSize = clampPageSize(query?.pageSize);
  const requestedPage = clampPage(query?.page);
  const filters = normalizeHistoryFilters(query?.filters);
  const totalItems = await countConversationRows(userId, state, filters);
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(requestedPage, totalPages);
  const skip = (currentPage - 1) * pageSize;

  const rows = totalItems === 0
    ? []
    : await fetchConversationRows(userId, state, {
        take: pageSize,
        skip,
        filters,
      });

  return {
    conversations: rows.map(serializeSummary),
    pagination: {
      currentPage,
      pageSize,
      totalItems,
      totalPages,
    },
    filters,
  };
}

async function fetchFirstActiveConversation(userId: string): Promise<ChatConversationDetail | null> {
  const rows = await fetchConversationRows(userId, "active", { take: 1 });
  const row = rows[0];
  return row ? serializeDetail(row) : null;
}

function emptyConversationUsageSummary(conversationId: string | null): ChatConversationUsageSummary {
  return {
    conversationId,
    runId: null,
    profile: null,
    profileLabel: null,
    provider: null,
    model: null,
    startedAt: null,
    requestCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedPromptTokens: 0,
  };
}

export async function listActiveConversations(userIdInput?: string): Promise<ChatConversationSummary[]> {
  const userId = resolveAgentUserId(userIdInput);
  await ensureConversationUser(userId);

  const page = await fetchConversationPage(userId, "active");
  return page.conversations;
}

export async function listArchivedConversations(userIdInput?: string): Promise<ChatConversationSummary[]> {
  const userId = resolveAgentUserId(userIdInput);
  await ensureConversationUser(userId);

  const page = await fetchConversationPage(userId, "archived", {
    pageSize: DEFAULT_CHAT_HISTORY_PAGE_SIZE,
  });
  return page.conversations;
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
  recentPage?: number;
  archivedPage?: number;
  pageSize?: number;
  historyFilters?: Partial<ChatConversationHistoryFilters>;
}): Promise<ChatConversationBootstrap> {
  const userId = resolveAgentUserId(options?.userId);
  await ensureConversationUser(userId);

  const [recentPage, archivedPage, preferredConversation, fallbackConversation, pricingSetting] = await Promise.all([
    fetchConversationPage(userId, "active", {
      page: options?.recentPage,
      pageSize: options?.pageSize,
      filters: options?.historyFilters,
    }),
    fetchConversationPage(userId, "archived", {
      page: options?.archivedPage,
      pageSize: options?.pageSize,
      filters: options?.historyFilters,
    }),
    options?.selectedConversationId
      ? getConversationDetail(options.selectedConversationId, userId, "active")
      : Promise.resolve(null),
    fetchFirstActiveConversation(userId),
    db.setting.findUnique({
      where: { key: USAGE_LEDGER_MODEL_PRICING_SETTING_KEY },
      select: { value: true },
    }),
  ]);

  const currentConversation = preferredConversation ?? fallbackConversation;
  const currentConversationId = currentConversation?.id ?? null;
  const activeRun = currentConversationId
    ? getConversationUsageSummary(currentConversationId)
    : emptyConversationUsageSummary(null);

  return {
    currentConversationId,
    currentConversation,
    activeRun,
    modelPricing: parseUsageLedgerModelPricingSetting(pricingSetting?.value),
    recentConversations: recentPage.conversations,
    archivedConversations: archivedPage.conversations,
    recentPagination: recentPage.pagination,
    archivedPagination: archivedPage.pagination,
    historyFilters: recentPage.filters,
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

export async function deleteConversation(conversationId: string, userIdInput?: string): Promise<void> {
  const userId = resolveAgentUserId(userIdInput);
  await ensureConversationUser(userId);
  await requireConversation(conversationId, userId, "any");

  await db.conversation.update({
    where: { id: conversationId },
    data: { deletedAt: new Date() },
  });
}

export async function deleteArchivedConversation(conversationId: string, userIdInput?: string): Promise<void> {
  await deleteConversation(conversationId, userIdInput);
}