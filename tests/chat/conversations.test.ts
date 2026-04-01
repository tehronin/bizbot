import { beforeEach, describe, expect, it, vi } from "vitest";

type TestConversation = {
  id: string;
  title: string | null;
  userId: string;
  archivedAt: Date | null;
  deletedAt: Date | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{
    id: string;
    role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
    content: string;
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

function matchConversation(conversation: TestConversation, where: Record<string, unknown>) {
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
    return conversation.archivedAt !== null;
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
  conversation: {
    findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take: number }) => {
      const rows = sortConversations(store.conversations.filter((conversation) => matchConversation(conversation, where)));
      return rows.slice(0, take).map(cloneConversation);
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

vi.mock("@/lib/db", () => ({
  db: dbMocks,
}));

vi.mock("@/lib/agent/user-context", () => ({
  resolveAgentUserId: (userId?: string | null) => userId ?? "local-user",
}));

import {
  archiveConversation,
  deleteArchivedConversation,
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
  });

  it("falls back to the most recent active conversation when there is no stored selection", async () => {
    const result = await resolveChatBootstrap();

    expect(result.currentConversationId).toBe("active-newer");
    expect(result.recentConversations.map((conversation) => conversation.id)).toEqual(["active-newer", "active-older"]);
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

    await deleteArchivedConversation("archived-conversation");
    const archivedConversations = await listArchivedConversations();
    expect(archivedConversations.map((conversation) => conversation.id)).not.toContain("archived-conversation");
  });
});