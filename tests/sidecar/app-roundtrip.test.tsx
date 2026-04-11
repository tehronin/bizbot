// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SidecarHost from "@/components/layout/SidecarHost";
import { useChat } from "@/hooks/useChat";
import { BIZBOT_SIDECAR_EVENT } from "@/lib/sidecar/types";
import type { ChatConversationBootstrap } from "@/lib/chat/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function createBootstrap(): ChatConversationBootstrap {
  return {
    currentConversationId: "conversation-1",
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
          id: "oracle",
          displayName: "Oracle",
          description: "Market-focused prediction and evidence gathering.",
          accentColor: "#facc15",
          accentSurface: "rgba(250,204,21,0.14)",
          accentBorder: "rgba(250,204,21,0.36)",
          toollessInAsk: true,
          toollessInAgent: false,
        },
      ],
    },
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
  };
}

function ChatSidecarHarness() {
  useChat();
  return <SidecarHost />;
}

describe("sidecar app roundtrip", () => {
  beforeEach(() => {
    const bootstrap = createBootstrap();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/chat/conversations")) {
        return {
          ok: true,
          json: async () => bootstrap,
        } as Response;
      }

      if (url.includes("/api/sidecar/interactions")) {
        const payload = JSON.parse(String(init?.body ?? "{}")) as {
          panelId: string;
          actionId: string;
          selectedItemIds: string[];
          conversationId: string;
        };

        return {
          ok: true,
          json: async () => ({
            ok: true,
            action: "update",
            panel: {
              panelId: payload.panelId,
              title: "Oracle personality",
              content: {
                type: "markdown",
                markdown: `## Saved ${payload.selectedItemIds[0]} for ${payload.conversationId}`,
              },
            },
          }),
        } as Response;
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
  });

  it("round-trips a Sidecar selection click through useChat and re-renders the returned panel", async () => {
    render(<ChatSidecarHarness />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });

    window.dispatchEvent(new CustomEvent(BIZBOT_SIDECAR_EVENT, {
      detail: {
        action: "open",
        conversationId: "conversation-1",
        panel: {
          panelId: "oracle-panel",
          title: "Oracle personality",
          content: {
            type: "selection",
            title: "Choose Oracle personality",
            selectionMode: "single",
            items: [
              { id: "balanced", title: "Balanced" },
              { id: "bullish", title: "Bullish" },
            ],
            actions: [
              { id: "oracle_personality_toggle", label: "Choose", kind: "toggle" },
              { id: "oracle_personality_apply", label: "Save personality", kind: "apply" },
            ],
            interaction: { routeKey: "oracle.personality.select" },
          },
        },
      },
    }));

    await waitFor(() => {
      expect(screen.getByText("Choose Oracle personality")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Bullish").closest("button") as HTMLButtonElement);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/sidecar/interactions", expect.objectContaining({
        method: "POST",
      }));
      expect(screen.getByText("Saved bullish for conversation-1")).toBeTruthy();
    });
  });
});