import type { Prisma } from "@prisma/client";
import type { LLMProvider } from "@/lib/agent/kernel";
import { db } from "@/lib/db";
import { getConversationUsageSummary } from "@/lib/agent/run-journal";
import { parseUsageLedgerModelPricingSetting, USAGE_LEDGER_MODEL_PRICING_SETTING_KEY } from "@/lib/agent/usage-ledger-pricing";
import { resolveAgentUserId } from "@/lib/agent/user-context";
import { extractBuilderRunTelemetry } from "@/lib/builder/telemetry";
import { listPendingBuilderInteractionCards } from "@/lib/builder/interactions";
import { listBuilderProjects } from "@/lib/builder/projects";
import { listBuilderStackPresets } from "@/lib/builder/stacks";
import { DEFAULT_BUILDER_TEMPLATE_PRESETS } from "@/lib/builder/template-presets";
import {
  buildChatExecutionCatalog,
  DEFAULT_CHAT_EXECUTION_MODE,
  DEFAULT_CHAT_EXECUTION_PLUGIN_ID,
  resolveChatExecutionSelection,
} from "@/lib/chat/execution";
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
  type BuilderChatCard,
  type BuilderChatCardAction,
  type ChatBuilderProjectSummary,
  type ChatBuilderStackPresetSummary,
  type ChatBuilderTemplateSummary,
} from "@/lib/chat/types";

type ConversationRow = Prisma.ConversationGetPayload<{
  include: {
    _count: {
      select: { messages: true };
    };
    messages: {
      select: {
        id: true;
        role: true;
        content: true;
        metadata: true;
        createdAt: true;
      };
    };
  };
}>;
type ConversationState = "active" | "archived" | "any";
type ConversationPageQuery = {
  page?: number;
  pageSize?: number;
  filters?: Partial<ChatConversationHistoryFilters>;
};

function normalizeMessageMetadata(value: unknown): ChatConversationMessage["metadata"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const attachments = Array.isArray(candidate.attachments)
    ? candidate.attachments.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return [];
        }

        const attachment = entry as Record<string, unknown>;
        if (attachment.type !== "knowledge-doc") {
          return [];
        }

        const path = typeof attachment.path === "string" ? attachment.path : "";
        const label = typeof attachment.label === "string" ? attachment.label : "";
        return path && label ? [{ type: "knowledge-doc" as const, path, label }] : [];
      })
    : undefined;

  const builderCards = Array.isArray(candidate.builderCards)
    ? candidate.builderCards.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return [];
        }

        const card = entry as Record<string, unknown>;
        const kind = card.kind;
        const status = card.status;
        if (
          (kind !== "mcp_policy_reconciliation"
            && kind !== "mcp_contract_drift"
            && kind !== "dependency_contract_drift"
            && kind !== "file_topology_contract_drift"
            && kind !== "task_execution")
          || (status !== "pending"
            && status !== "approved"
            && status !== "rejected"
            && status !== "resolved"
            && status !== "planned"
            && status !== "running"
            && status !== "succeeded"
            && status !== "failed"
            && status !== "cancelled")
        ) {
          return [];
        }

        const actions = Array.isArray(card.actions)
          ? card.actions.flatMap((actionEntry) => {
              if (!actionEntry || typeof actionEntry !== "object" || Array.isArray(actionEntry)) {
                return [];
              }

              const action = actionEntry as Record<string, unknown>;
              return (
                (action.id === "approve" || action.id === "reject" || action.id === "reconcile")
                && typeof action.label === "string"
                && (action.variant === "primary" || action.variant === "danger" || action.variant === "neutral")
              )
                ? [{ id: action.id as BuilderChatCardAction["id"], label: action.label, variant: action.variant as BuilderChatCardAction["variant"] }]
                : [];
            })
          : [];

        if (
          typeof card.id !== "string"
          || typeof card.interactionId !== "string"
          || typeof card.projectId !== "string"
          || typeof card.projectName !== "string"
          || typeof card.projectRelativePath !== "string"
          || typeof card.title !== "string"
          || typeof card.summary !== "string"
          || typeof card.state !== "string"
          || typeof card.updatedAt !== "string"
        ) {
          return [];
        }

        return [{
          id: card.id,
          interactionId: card.interactionId,
          kind,
          status,
          projectId: card.projectId,
          projectName: card.projectName,
          projectRelativePath: card.projectRelativePath,
          runId: typeof card.runId === "string" ? card.runId : null,
          taskId: typeof card.taskId === "string" ? card.taskId : null,
          title: card.title,
          summary: card.summary,
          state: card.state,
          recommendations: Array.isArray(card.recommendations)
            ? card.recommendations.filter((recommendation): recommendation is string => typeof recommendation === "string")
            : [],
          actions,
          updatedAt: card.updatedAt,
          resolvedAt: typeof card.resolvedAt === "string" ? card.resolvedAt : null,
          resolutionReason: typeof card.resolutionReason === "string" ? card.resolutionReason : null,
        } satisfies BuilderChatCard];
      })
    : undefined;

  return {
    chatMode: candidate.chatMode === "ask" || candidate.chatMode === "agent" ? candidate.chatMode : undefined,
    chatPluginId: typeof candidate.chatPluginId === "string" ? candidate.chatPluginId : undefined,
    attachments,
    builderCards,
  };
}

function serializeMessage(row: { id: string; role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL"; content: string; metadata?: unknown; createdAt: Date }): ChatConversationMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    metadata: normalizeMessageMetadata(row.metadata),
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
    defaultMode: row.defaultMode === "AGENT" ? "agent" : "ask",
    defaultPluginId: row.defaultPluginId,
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
          metadata: true,
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

function normalizeUsageProvider(provider: string | null): LLMProvider | null {
  switch (provider) {
    case "openai":
    case "anthropic":
    case "ollama":
    case "google":
    case "minimax":
      return provider;
    default:
      return null;
  }
}

async function buildConversationUsageSummary(currentConversation: ChatConversationDetail | null): Promise<ChatConversationUsageSummary> {
  const conversationId = currentConversation?.id ?? null;
  const baseSummary = conversationId
    ? getConversationUsageSummary(conversationId)
    : emptyConversationUsageSummary(null);

  if (!currentConversation) {
    return baseSummary;
  }

  const runIds = new Set<string>();
  const taskIds = new Set<string>();

  for (const message of currentConversation.messages) {
    for (const card of message.metadata?.builderCards ?? []) {
      if (card.runId) {
        runIds.add(card.runId);
      }
      if (card.taskId) {
        taskIds.add(card.taskId);
      }
    }
  }

  if (runIds.size === 0 && taskIds.size === 0) {
    return baseSummary;
  }

  const builderRuns = await db.builderRun.findMany({
    where: {
      OR: [
        ...(runIds.size > 0 ? [{ id: { in: [...runIds] } }] : []),
        ...(taskIds.size > 0 ? [{ taskId: { in: [...taskIds] } }] : []),
      ],
    },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      status: true,
      metadata: true,
      startedAt: true,
      finishedAt: true,
    },
  });

  if (builderRuns.length === 0) {
    return baseSummary;
  }

  const uniqueRuns = [...new Map(builderRuns.map((run) => [run.id, run])).values()];
  const builderTelemetry = uniqueRuns.map((run) => ({
    run,
    telemetry: extractBuilderRunTelemetry(run),
  }));

  const builderTotals = builderTelemetry.reduce((accumulator, entry) => ({
    requestCount: accumulator.requestCount + entry.telemetry.requestCount,
    promptTokens: accumulator.promptTokens + entry.telemetry.promptTokens,
    completionTokens: accumulator.completionTokens + entry.telemetry.completionTokens,
    totalTokens: accumulator.totalTokens + entry.telemetry.totalTokens,
    cachedPromptTokens: accumulator.cachedPromptTokens + entry.telemetry.cachedPromptTokens,
  }), {
    requestCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedPromptTokens: 0,
  });

  const latestBuilderRun = builderTelemetry[0];
  const shouldPreferBuilderIdentity = baseSummary.totalTokens === 0 && latestBuilderRun;
  const latestBuilderProvider = latestBuilderRun
    ? normalizeUsageProvider(latestBuilderRun.telemetry.provider)
    : null;

  return {
    conversationId,
    runId: shouldPreferBuilderIdentity ? latestBuilderRun.run.id : baseSummary.runId,
    profile: baseSummary.profile,
    profileLabel: shouldPreferBuilderIdentity ? "Builder" : baseSummary.profileLabel,
    provider: shouldPreferBuilderIdentity ? latestBuilderProvider : baseSummary.provider,
    model: shouldPreferBuilderIdentity ? latestBuilderRun.telemetry.model : baseSummary.model,
    startedAt: shouldPreferBuilderIdentity ? latestBuilderRun.run.startedAt.toISOString() : baseSummary.startedAt,
    requestCount: baseSummary.requestCount + builderTotals.requestCount,
    promptTokens: baseSummary.promptTokens + builderTotals.promptTokens,
    completionTokens: baseSummary.completionTokens + builderTotals.completionTokens,
    totalTokens: baseSummary.totalTokens + builderTotals.totalTokens,
    cachedPromptTokens: baseSummary.cachedPromptTokens + builderTotals.cachedPromptTokens,
  };
}

function buildExecutionDefaults(mode: unknown, pluginId: unknown) {
  const normalizedMode = typeof mode === "string" ? mode.toLowerCase() : null;

  return resolveChatExecutionSelection({
    mode: normalizedMode === "agent" ? "agent" : normalizedMode === "ask" ? "ask" : DEFAULT_CHAT_EXECUTION_MODE,
    pluginId: typeof pluginId === "string" ? pluginId : DEFAULT_CHAT_EXECUTION_PLUGIN_ID,
  });
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
          metadata: true,
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

  const [recentPage, archivedPage, preferredConversation, fallbackConversation, pricingSetting, builderProjects, builderInbox] = await Promise.all([
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
    listBuilderProjects(),
    listPendingBuilderInteractionCards({ conversationId: options?.selectedConversationId ?? null }),
  ]);

  const builderProjectOptions: ChatBuilderProjectSummary[] = builderProjects
    .filter((project) => !project.archivedAt)
    .map((project) => ({
      id: project.id,
      name: project.name,
      relativePath: project.relativePath,
    }));

  const builderStackPresets: ChatBuilderStackPresetSummary[] = listBuilderStackPresets().map((preset) => ({
    key: preset.key,
    displayName: preset.displayName,
    description: preset.description,
    template: preset.template,
    packageManager: preset.packageManager,
    tags: preset.tags,
  }));

  const builderTemplates: ChatBuilderTemplateSummary[] = DEFAULT_BUILDER_TEMPLATE_PRESETS.map((template) => ({
    key: template.key,
    displayName: template.displayName,
    description: template.description,
    defaultPackageManager: template.defaultPackageManager,
  }));

  const currentConversation = preferredConversation ?? fallbackConversation;
  const currentConversationId = currentConversation?.id ?? null;
  const executionCatalog = buildChatExecutionCatalog();
  const executionDefaults = currentConversation
    ? buildExecutionDefaults(currentConversation.defaultMode, currentConversation.defaultPluginId)
    : executionCatalog.defaults;
  const activeRun = await buildConversationUsageSummary(currentConversation);

  return {
    currentConversationId,
    currentConversation,
    executionDefaults,
    executionCatalog,
    builderProjects: builderProjectOptions,
    builderStackPresets,
    builderTemplates,
    activeRun,
    builderInbox,
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