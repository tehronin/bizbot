// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChat, type UseChatResult } from "@/hooks/useChat";
import type { ChatConversationBootstrap } from "@/lib/chat/types";

let latestChat: UseChatResult | null = null;

function createBootstrap(overrides: Partial<ChatConversationBootstrap> = {}): ChatConversationBootstrap {
  return {
    currentConversationId: null,
    currentConversation: null,
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
        {
          id: "builder",
          displayName: "Builder",
          description: "External workspace scaffolding and build-lane operations.",
          accentColor: "#fb7185",
          accentSurface: "rgba(251,113,133,0.12)",
          accentBorder: "rgba(251,113,133,0.36)",
          toollessInAsk: true,
          toollessInAgent: false,
        },
      ],
    },
    builderProjects: [],
    builderStackPresets: [],
    builderTemplates: [],
    builderInbox: [],
    activeRun: {
      conversationId: null,
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
    },
    modelPricing: {},
    recentConversations: [],
    archivedConversations: [],
    recentPagination: {
      currentPage: 1,
      pageSize: 6,
      totalItems: 0,
      totalPages: 1,
    },
    archivedPagination: {
      currentPage: 1,
      pageSize: 6,
      totalItems: 0,
      totalPages: 1,
    },
    historyFilters: {
      search: "",
      from: null,
      to: null,
    },
    ...overrides,
  };
}

function UseChatHarness() {
  latestChat = useChat();
  return null;
}

describe("useChat execution preference behavior", () => {
  beforeEach(() => {
    latestChat = null;
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("does not sync bootstrap execution defaults back to the conversation", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/chat/conversations")) {
        return {
          ok: true,
          json: async () => createBootstrap({
            currentConversationId: "conversation-1",
            currentConversation: {
              id: "conversation-1",
              title: "Builder chat",
              label: "Builder chat",
              preview: "Builder is in Ask mode",
              createdAt: "2026-04-18T15:56:27.430Z",
              updatedAt: "2026-04-18T15:57:07.042Z",
              lastMessageAt: "2026-04-18T15:57:07.042Z",
              archivedAt: null,
              messageCount: 3,
              defaultMode: "ask",
              defaultPluginId: "builder",
              messages: [],
            },
            executionDefaults: {
              mode: "ask",
              pluginId: "builder",
            },
          }),
        } as Response;
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<UseChatHarness />);

    await waitFor(() => {
      expect(latestChat?.isBootstrapping).toBe(false);
      expect(latestChat?.conversationId).toBe("conversation-1");
      expect(latestChat?.executionMode).toBe("ask");
      expect(latestChat?.executionPluginId).toBe("builder");
    });

    expect(
      fetchMock.mock.calls.filter(([input, init]) => (
        String(input).includes("/api/chat/conversations/conversation-1/defaults")
          && init?.method === "POST"
      )),
    ).toHaveLength(0);
  });

  it("restores stored execution preference before persisting it", async () => {
    window.localStorage.setItem("bizbot:chat-execution-mode", "agent");
    window.localStorage.setItem("bizbot:chat-execution-plugin", "builder");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/chat/conversations")) {
        return {
          ok: true,
          json: async () => createBootstrap(),
        } as Response;
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<UseChatHarness />);

    await waitFor(() => {
      expect(latestChat?.isBootstrapping).toBe(false);
      expect(latestChat?.executionMode).toBe("agent");
      expect(latestChat?.executionPluginId).toBe("builder");
    });

    expect(window.localStorage.getItem("bizbot:chat-execution-mode")).toBe("agent");
    expect(window.localStorage.getItem("bizbot:chat-execution-plugin")).toBe("builder");
  });
});