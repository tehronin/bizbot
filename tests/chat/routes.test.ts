import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const conversationMocks = vi.hoisted(() => ({
  resolveChatBootstrap: vi.fn(),
  getConversationDetail: vi.fn(),
  archiveConversation: vi.fn(),
  restoreConversation: vi.fn(),
  deleteConversation: vi.fn(),
}));

vi.mock("@/lib/chat/conversations", () => ({
  resolveChatBootstrap: conversationMocks.resolveChatBootstrap,
  getConversationDetail: conversationMocks.getConversationDetail,
  archiveConversation: conversationMocks.archiveConversation,
  restoreConversation: conversationMocks.restoreConversation,
  deleteConversation: conversationMocks.deleteConversation,
}));

import { GET as getConversations } from "@/app/api/chat/conversations/route";
import { DELETE as deleteConversation, GET as getConversation } from "@/app/api/chat/conversations/[id]/route";
import { POST as archiveConversation } from "@/app/api/chat/conversations/[id]/archive/route";
import { POST as restoreConversation } from "@/app/api/chat/conversations/[id]/restore/route";

describe("chat conversation routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the chat bootstrap payload", async () => {
    conversationMocks.resolveChatBootstrap.mockResolvedValue({
      currentConversationId: "active-1",
      currentConversation: null,
      chatVerbosity: "concise",
      executionDefaults: {
        mode: "ask",
        pluginId: "just-chatting",
      },
      executionCatalog: {
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
      },
      activeRun: {
        conversationId: "active-1",
        runId: "run-active-1",
        profile: "general_operator",
        profileLabel: "General",
        provider: "google",
        model: "gemini-3-flash-preview",
        startedAt: "2026-04-01T12:00:00.000Z",
        requestCount: 2,
        promptTokens: 120,
        completionTokens: 45,
        totalTokens: 165,
        cachedPromptTokens: 5,
      },
      builderProjects: [
        {
          id: "project-1",
          name: "Alpha",
          relativePath: "workspace/alpha",
        },
      ],
      builderProjectConversations: [],
      builderStackPresets: [],
      builderTemplates: [],
      builderInbox: [],
      modelPricing: {
        "gemini-3-flash-preview": {
          promptUsdPerMillion: 0.45,
          completionUsdPerMillion: 2.75,
        },
      },
      recentConversations: [],
      archivedConversations: [],
      recentPagination: { currentPage: 1, pageSize: 6, totalItems: 0, totalPages: 1 },
      archivedPagination: { currentPage: 1, pageSize: 6, totalItems: 0, totalPages: 1 },
      historyFilters: { search: "", from: null, to: null },
    });

    const response = await getConversations(new NextRequest("http://localhost/api/chat/conversations?selectedId=active-1&selectedBuilderProjectId=project-1&recentPage=2&archivedPage=3&historyPageSize=8&historySearch=ops&historyFrom=2026-04-01&historyTo=2026-04-02"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(conversationMocks.resolveChatBootstrap).toHaveBeenCalledWith({
      userId: undefined,
      selectedConversationId: "active-1",
      selectedBuilderProjectId: "project-1",
      recentPage: 2,
      archivedPage: 3,
      pageSize: 8,
      historyFilters: {
        search: "ops",
        from: "2026-04-01",
        to: "2026-04-02",
      },
    });
    expect(payload.currentConversationId).toBe("active-1");
    expect(payload.activeRun.totalTokens).toBe(165);
    expect(payload.modelPricing["gemini-3-flash-preview"].completionUsdPerMillion).toBe(2.75);
  });

  it("returns a conversation detail payload", async () => {
    conversationMocks.getConversationDetail.mockResolvedValue({ id: "archived-1" });

    const response = await getConversation(new NextRequest("http://localhost/api/chat/conversations/archived-1"), {
      params: Promise.resolve({ id: "archived-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.conversation.id).toBe("archived-1");
  });

  it("archives, restores, and deletes through dedicated lifecycle routes", async () => {
    conversationMocks.archiveConversation.mockResolvedValue({ id: "archived-1" });
    conversationMocks.restoreConversation.mockResolvedValue({ id: "active-1" });
    conversationMocks.deleteConversation.mockResolvedValue(undefined);

    const archiveResponse = await archiveConversation(new NextRequest("http://localhost/api/chat/conversations/active-1/archive", { method: "POST" }), {
      params: Promise.resolve({ id: "active-1" }),
    });
    const restoreResponse = await restoreConversation(new NextRequest("http://localhost/api/chat/conversations/archived-1/restore", { method: "POST" }), {
      params: Promise.resolve({ id: "archived-1" }),
    });
    const deleteResponse = await deleteConversation(new NextRequest("http://localhost/api/chat/conversations/archived-1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "archived-1" }),
    });

    expect(archiveResponse.status).toBe(200);
    expect(restoreResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(conversationMocks.archiveConversation).toHaveBeenCalledWith("active-1", undefined);
    expect(conversationMocks.restoreConversation).toHaveBeenCalledWith("archived-1", undefined);
    expect(conversationMocks.deleteConversation).toHaveBeenCalledWith("archived-1", undefined);
  });
});