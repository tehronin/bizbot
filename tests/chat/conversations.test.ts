import { beforeEach, describe, expect, it, vi } from "vitest";

type TestConversation = {
  id: string;
  title: string | null;
  userId: string;
  defaultMode: "ASK" | "AGENT";
  defaultPluginId: string;
  archivedAt: Date | null;
  deletedAt: Date | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{
    id: string;
    role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
    content: string;
    metadata?: unknown;
    createdAt: Date;
  }>;
};

const store = vi.hoisted(() => ({
  conversations: [] as TestConversation[],
}));

function cloneConversation(conversation: TestConversation) {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({ ...message })),
    _count: { messages: conversation.messages.length },
  };
}

function matchStringFilter(value: string | null | undefined, expected: unknown) {
  if (!expected || typeof expected !== "object" || !("contains" in expected)) {
    return true;
  }

  const candidate = typeof value === "string" ? value : "";
  const search = String(expected.contains ?? "");
  return candidate.toLowerCase().includes(search.toLowerCase());
}

function matchConversation(conversation: TestConversation, where: Record<string, unknown>): boolean {
  const orConditions = Array.isArray(where.OR) ? where.OR : null;

  if (typeof where.id === "string" && conversation.id !== where.id) {
    return false;
  }

  if (typeof where.userId === "string" && conversation.userId !== where.userId) {
    return false;
  }

  if (where.deletedAt === null && conversation.deletedAt !== null) {
    return false;
  }

  if (where.archivedAt === null && conversation.archivedAt !== null) {
    return false;
  }

  if (typeof where.archivedAt === "object" && where.archivedAt !== null && "not" in where.archivedAt) {
    if (conversation.archivedAt === null) {
      return false;
    }
  }

  if (typeof where.updatedAt === "object" && where.updatedAt !== null) {
    const updatedAtFilter = where.updatedAt as { gte?: Date; lte?: Date };
    if (updatedAtFilter.gte && conversation.updatedAt < updatedAtFilter.gte) {
      return false;
    }
    if (updatedAtFilter.lte && conversation.updatedAt > updatedAtFilter.lte) {
      return false;
    }
  }

  if (!matchStringFilter(conversation.title, where.title)) {
    return false;
  }

  if (!matchStringFilter(null, where.promptSummary)) {
    return false;
  }

  if (typeof where.messages === "object" && where.messages !== null && "some" in where.messages) {
    const some = (where.messages as { some?: { content?: unknown } }).some;
    if (some?.content && !conversation.messages.some((message) => matchStringFilter(message.content, some.content))) {
      return false;
    }
  }

  if (orConditions && orConditions.length > 0) {
    return orConditions.some((entry) => matchConversation(conversation, entry as Record<string, unknown>));
  }

  return true;
}

function sortConversations(conversations: TestConversation[]) {
  return [...conversations].sort((left, right) => {
    const leftLastMessageAt = left.lastMessageAt?.getTime() ?? 0;
    const rightLastMessageAt = right.lastMessageAt?.getTime() ?? 0;
    if (leftLastMessageAt !== rightLastMessageAt) {
      return rightLastMessageAt - leftLastMessageAt;
    }

    const leftUpdatedAt = left.updatedAt.getTime();
    const rightUpdatedAt = right.updatedAt.getTime();
    if (leftUpdatedAt !== rightUpdatedAt) {
      return rightUpdatedAt - leftUpdatedAt;
    }

    return right.createdAt.getTime() - left.createdAt.getTime();
  });
}

const dbMocks = vi.hoisted(() => ({
  user: {
    upsert: vi.fn(async () => ({ id: "local-user" })),
  },
  setting: {
    findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
      if (where.key !== "usage_ledger_model_pricing") {
        return null;
      }

      return {
        value: JSON.stringify({
          "gemini-3-flash-preview": {
            promptUsdPerMillion: 0.45,
            completionUsdPerMillion: 2.75,
          },
        }),
      };
    }),
  },
  conversation: {
    count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return store.conversations.filter((conversation) => matchConversation(conversation, where)).length;
    }),
    findMany: vi.fn(async ({ where, take, skip = 0 }: { where: Record<string, unknown>; take?: number; skip?: number }) => {
      const rows = sortConversations(store.conversations.filter((conversation) => matchConversation(conversation, where)));
      const end = typeof take === "number" ? skip + take : undefined;
      return rows.slice(skip, end).map(cloneConversation);
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const match = sortConversations(store.conversations.filter((conversation) => matchConversation(conversation, where)))[0];
      return match ? cloneConversation(match) : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<TestConversation> }) => {
      const target = store.conversations.find((conversation) => conversation.id === where.id);
      if (!target) {
        throw new Error("Conversation not found.");
      }

      Object.assign(target, data, { updatedAt: new Date("2026-04-01T15:00:00.000Z") });
      return cloneConversation(target);
    }),
  },
}));

const runJournalMocks = vi.hoisted(() => ({
  getConversationUsageSummary: vi.fn((conversationId: string | null | undefined) => ({
    conversationId: conversationId ?? null,
    runId: conversationId ? `run-${conversationId}` : null,
    profile: conversationId ? "general_operator" : null,
    profileLabel: conversationId ? "General" : null,
    provider: conversationId ? "google" : null,
    model: conversationId ? "gemini-3-flash-preview" : null,
    startedAt: conversationId ? "2026-04-01T12:00:00.000Z" : null,
    requestCount: conversationId ? 2 : 0,
    promptTokens: conversationId ? 120 : 0,
    completionTokens: conversationId ? 45 : 0,
    totalTokens: conversationId ? 165 : 0,
    cachedPromptTokens: conversationId ? 5 : 0,
  })),
}));

vi.mock("@/lib/db", () => ({
  db: dbMocks,
}));

vi.mock("@/lib/agent/user-context", () => ({
  resolveAgentUserId: (userId?: string | null) => userId ?? "local-user",
}));

vi.mock("@/lib/agent/run-journal", () => ({
  getConversationUsageSummary: runJournalMocks.getConversationUsageSummary,
}));

vi.mock("@/lib/chat/execution", () => ({
  DEFAULT_CHAT_EXECUTION_MODE: "ask",
  DEFAULT_CHAT_EXECUTION_PLUGIN_ID: "just-chatting",
  buildChatExecutionCatalog: () => ({
    defaults: {
      mode: "ask",
      pluginId: "just-chatting",
    },
    plugins: [
      {
        id: "just-chatting",
        displayName: "Just Chatting",
        description: "Full-context chat and planning without tool execution.",
        accentColor: "#38bdf8",
        accentSurface: "rgba(56,189,248,0.12)",
        accentBorder: "rgba(56,189,248,0.36)",
        toollessInAsk: true,
        toollessInAgent: true,
      },
    ],
  }),
  resolveChatExecutionSelection: ({ mode, pluginId }: { mode?: "ask" | "agent"; pluginId?: string }) => ({
    mode: mode ?? "ask",
    pluginId: pluginId ?? "just-chatting",
  }),
}));

import {
  archiveConversation,
  deleteConversation,
  listArchivedConversations,
  resolveChatBootstrap,
  restoreConversation,
} from "@/lib/chat/conversations";

describe("chat conversations service", () => {
  beforeEach(() => {
    store.conversations = [
      {
        id: "active-newer",
        title: "Ops triage",
        userId: "local-user",
        defaultMode: "ASK",
        defaultPluginId: "just-chatting",
        archivedAt: null,
        deletedAt: null,
        lastMessageAt: new Date("2026-04-01T12:00:00.000Z"),
        createdAt: new Date("2026-04-01T11:00:00.000Z"),
        updatedAt: new Date("2026-04-01T12:00:00.000Z"),
        messages: [
          { id: "m-1", role: "USER", content: "Draft a rollout plan", createdAt: new Date("2026-04-01T11:30:00.000Z") },
          { id: "m-2", role: "ASSISTANT", content: "Here is the rollout plan.", createdAt: new Date("2026-04-01T12:00:00.000Z") },
        ],
      },
      {
        id: "active-older",
        title: "Support queue",
        userId: "local-user",
        defaultMode: "ASK",
        defaultPluginId: "just-chatting",
        archivedAt: null,
        deletedAt: null,
        lastMessageAt: new Date("2026-03-31T18:00:00.000Z"),
        createdAt: new Date("2026-03-31T17:00:00.000Z"),
        updatedAt: new Date("2026-03-31T18:00:00.000Z"),
        messages: [
          { id: "m-3", role: "USER", content: "Follow up with open inbox items", createdAt: new Date("2026-03-31T17:15:00.000Z") },
        ],
      },
      {
        id: "archived-conversation",
        title: null,
        userId: "local-user",
        defaultMode: "AGENT",
        defaultPluginId: "content",
        archivedAt: new Date("2026-03-30T13:00:00.000Z"),
        deletedAt: null,
        lastMessageAt: new Date("2026-03-30T12:00:00.000Z"),
        createdAt: new Date("2026-03-30T10:00:00.000Z"),
        updatedAt: new Date("2026-03-30T13:00:00.000Z"),
        messages: [
          {
            id: "m-4",
            role: "USER",
            content: "This archived conversation title is intentionally missing and the preview should be truncated because it is far longer than eighty characters for the test.",
            createdAt: new Date("2026-03-30T10:30:00.000Z"),
          },
        ],
      },
      {
        id: "deleted-conversation",
        title: "Deleted",
        userId: "local-user",
        defaultMode: "ASK",
        defaultPluginId: "just-chatting",
        archivedAt: new Date("2026-03-29T09:00:00.000Z"),
        deletedAt: new Date("2026-03-29T10:00:00.000Z"),
        lastMessageAt: new Date("2026-03-29T09:00:00.000Z"),
        createdAt: new Date("2026-03-29T08:00:00.000Z"),
        updatedAt: new Date("2026-03-29T10:00:00.000Z"),
        messages: [
          { id: "m-5", role: "USER", content: "This should stay hidden.", createdAt: new Date("2026-03-29T08:15:00.000Z") },
        ],
      },
    ];
    vi.clearAllMocks();
  });

  it("keeps the stored active conversation selected on bootstrap", async () => {
    const result = await resolveChatBootstrap({ selectedConversationId: "active-older" });

    expect(result.currentConversationId).toBe("active-older");
    expect(result.currentConversation?.id).toBe("active-older");
    expect(result.activeRun.conversationId).toBe("active-older");
    expect(result.activeRun.totalTokens).toBe(165);
    expect(result.modelPricing["gemini-3-flash-preview"]?.promptUsdPerMillion).toBe(0.45);
  });

  it("falls back to the most recent active conversation when there is no stored selection", async () => {
    const result = await resolveChatBootstrap();

    expect(result.currentConversationId).toBe("active-newer");
    expect(result.activeRun.conversationId).toBe("active-newer");
    expect(result.recentConversations.map((conversation) => conversation.id)).toEqual(["active-newer", "active-older"]);
    expect(result.recentPagination.totalItems).toBe(2);
  });

  it("falls back to the most recent active conversation when the stored selection is archived or deleted", async () => {
    const archivedFallback = await resolveChatBootstrap({ selectedConversationId: "archived-conversation" });
    const deletedFallback = await resolveChatBootstrap({ selectedConversationId: "deleted-conversation" });

    expect(archivedFallback.currentConversationId).toBe("active-newer");
    expect(deletedFallback.currentConversationId).toBe("active-newer");
  });

  it("excludes archived and deleted conversations from the active default candidate list", async () => {
    const result = await resolveChatBootstrap();

    expect(result.recentConversations.every((conversation) => conversation.archivedAt === null)).toBe(true);
    expect(result.archivedConversations.map((conversation) => conversation.id)).toEqual(["archived-conversation"]);
  });

  it("archives, restores, and soft deletes conversations", async () => {
    const archived = await archiveConversation("active-older");
    expect(archived.archivedAt).not.toBeNull();

    const restored = await restoreConversation("active-older");
    expect(restored.archivedAt).toBeNull();

    await deleteConversation("archived-conversation");
    const archivedConversations = await listArchivedConversations();
    expect(archivedConversations.map((conversation) => conversation.id)).not.toContain("archived-conversation");
  });

  it("can soft delete an active conversation directly", async () => {
    await deleteConversation("active-older");

    const result = await resolveChatBootstrap();
    expect(result.recentConversations.map((conversation) => conversation.id)).not.toContain("active-older");
  });

  it("filters and paginates history lists server-side", async () => {
    store.conversations.push(
      {
        id: "active-search-hit",
        title: "Campaign planner",
        userId: "local-user",
        defaultMode: "ASK",
        defaultPluginId: "just-chatting",
        archivedAt: null,
        deletedAt: null,
        lastMessageAt: new Date("2026-04-02T09:00:00.000Z"),
        createdAt: new Date("2026-04-02T08:00:00.000Z"),
        updatedAt: new Date("2026-04-02T09:00:00.000Z"),
        messages: [
          { id: "m-6", role: "USER", content: "Need campaign budget notes", createdAt: new Date("2026-04-02T08:15:00.000Z") },
        ],
      },
      {
        id: "archived-search-hit",
        title: "Archive review",
        userId: "local-user",
        defaultMode: "AGENT",
        defaultPluginId: "content",
        archivedAt: new Date("2026-04-02T10:00:00.000Z"),
        deletedAt: null,
        lastMessageAt: new Date("2026-04-02T09:30:00.000Z"),
        createdAt: new Date("2026-04-02T09:00:00.000Z"),
        updatedAt: new Date("2026-04-02T10:00:00.000Z"),
        messages: [
          { id: "m-7", role: "USER", content: "Archive the campaign notes", createdAt: new Date("2026-04-02T09:10:00.000Z") },
        ],
      },
    );

    const result = await resolveChatBootstrap({
      recentPage: 1,
      archivedPage: 1,
      pageSize: 1,
      historyFilters: {
        search: "campaign",
        from: "2026-04-02",
        to: "2026-04-02",
      },
    });

    expect(result.recentConversations.map((conversation) => conversation.id)).toEqual(["active-search-hit"]);
    expect(result.archivedConversations.map((conversation) => conversation.id)).toEqual(["archived-search-hit"]);
    expect(result.recentPagination.totalItems).toBe(1);
    expect(result.archivedPagination.totalItems).toBe(1);
    expect(result.historyFilters.search).toBe("campaign");
  });
});