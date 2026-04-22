// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChat, type UseChatResult } from "@/hooks/useChat";
import type { ChatConversationBootstrap } from "@/lib/chat/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
}));

let latestChat: UseChatResult | null = null;

function ensureLocalStorage(): Storage {
  const existing = window.localStorage as Storage | undefined;
  if (
    existing
    && typeof existing.getItem === "function"
    && typeof existing.setItem === "function"
    && typeof existing.removeItem === "function"
    && typeof existing.clear === "function"
  ) {
    return existing;
  }

  const store = new Map<string, string>();
  const storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key) ?? null : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  } satisfies Storage;

  Object.defineProperty(window, "localStorage", {
    value: storage,
    configurable: true,
  });

  return storage;
}

function createBootstrap(overrides: Partial<ChatConversationBootstrap> = {}): ChatConversationBootstrap {
  return {
    currentConversationId: null,
    currentConversation: null,
    activeSidecarPanel: null,
    activeSidecarStack: { panels: [], activePanelId: null },
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
    builderProjectConversations: [],
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
    ensureLocalStorage().clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    ensureLocalStorage().clear();
  });

  it("does not sync bootstrap execution defaults back to the conversation", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
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
              builderProjectId: null,
              builderProjectName: null,
              builderProjectRelativePath: null,
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
    const storage = ensureLocalStorage();
    storage.setItem("bizbot:chat-execution-mode", "agent");
    storage.setItem("bizbot:chat-execution-plugin", "builder");

    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
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

    expect(storage.getItem("bizbot:chat-execution-mode")).toBe("agent");
    expect(storage.getItem("bizbot:chat-execution-plugin")).toBe("builder");
  });

  it("offers a conversational resume prompt after a streamed run failure with a resumable run id", async () => {
    const encoder = new TextEncoder();
    let bootstrapCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/chat/conversations")) {
        bootstrapCount += 1;
        return {
          ok: true,
          json: async () => createBootstrap(bootstrapCount > 1 ? {
            currentConversationId: "conversation-1",
            currentConversation: {
              id: "conversation-1",
              title: "Resume test",
              label: "Resume test",
              preview: "No persisted recovery prompt yet",
              builderProjectId: null,
              builderProjectName: null,
              builderProjectRelativePath: null,
              createdAt: "2026-04-20T12:00:00.000Z",
              updatedAt: "2026-04-20T12:01:00.000Z",
              lastMessageAt: "2026-04-20T12:01:00.000Z",
              archivedAt: null,
              messageCount: 1,
              defaultMode: "ask",
              defaultPluginId: "just-chatting",
              messages: [],
            },
          } : {}),
        } as Response;
      }

      if (url === "/api/agent") {
        expect(init?.method).toBe("POST");
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("event: meta\ndata: {\"type\":\"meta\",\"conversationId\":\"conversation-1\",\"runId\":\"run-1\",\"profile\":\"general_operator\",\"profileLabel\":\"General Operator\",\"provider\":\"openai\",\"model\":\"gpt-4o\"}\n\n"));
            controller.enqueue(encoder.encode("event: error\ndata: {\"type\":\"error\",\"conversationId\":\"conversation-1\",\"runId\":\"run-1\",\"error\":\"tool timeout while reading MCP status\"}\n\n"));
            controller.close();
          },
        });

        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<UseChatHarness />);

    await waitFor(() => {
      expect(latestChat?.isBootstrapping).toBe(false);
    });

    await latestChat!.sendMessage("check the MCP status");

    await waitFor(() => {
      expect(latestChat?.pendingResumePrompt).toEqual(expect.objectContaining({
        runId: "run-1",
        summary: "tool timeout while reading MCP status",
        mode: "ask",
        pluginId: "just-chatting",
      }));
    });

  });
});