import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/memory/service", () => ({
  getActiveMemoryFacts: vi.fn(),
  setMemoryFact: vi.fn(),
}));

import { getActiveMemoryFacts, setMemoryFact } from "@/lib/agent/memory/service";
import { executeTool, getAllToolDefinitions } from "@/lib/agent/plugins";
import { routeSidecarInteraction } from "@/lib/sidecar/router";
import { resetActiveSidecarPanelsForTests, syncActiveSidecarPanel } from "@/lib/sidecar/state";
import type { SidecarPanel } from "@/lib/sidecar/types";

const mockedGetActiveMemoryFacts = vi.mocked(getActiveMemoryFacts);
const mockedSetMemoryFact = vi.mocked(setMemoryFact);

describe("oracle plugin", () => {
  beforeEach(() => {
    process.env.BIZBOT_PLUGIN_ORACLE_ENABLED = "true";
    resetActiveSidecarPanelsForTests();
    mockedGetActiveMemoryFacts.mockReset();
    mockedSetMemoryFact.mockReset();
    mockedGetActiveMemoryFacts.mockResolvedValue([] as never);
    mockedSetMemoryFact.mockResolvedValue({ id: "fact-1", key: "oracle_bot_personality", value: "balanced" } as never);
  });

  it("is disabled by default and exposed when enabled", () => {
    delete process.env.BIZBOT_PLUGIN_ORACLE_ENABLED;
    const disabledTools = getAllToolDefinitions(undefined, { agentProfile: "mcp_operator" }).map((tool) => tool.name);
    expect(disabledTools).not.toContain("oracle_search_markets");

    process.env.BIZBOT_PLUGIN_ORACLE_ENABLED = "true";
    const enabledTools = getAllToolDefinitions(undefined, { agentProfile: "mcp_operator" }).map((tool) => tool.name);
    expect(enabledTools).toContain("oracle_search_markets");
    expect(enabledTools).toContain("oracle_get_market_verdict");
    expect(enabledTools).toContain("oracle_open_personality_selector");
  });

  it("opens a generic Sidecar personality selector and persists a chosen personality", async () => {
    const result = await executeTool("oracle_open_personality_selector", {}, {
      access: { agentProfile: "general_operator", userId: "user-1" },
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      action: "open",
      panel: expect.objectContaining({
        title: "Oracle personality",
        content: expect.objectContaining({
          type: "selection",
          interaction: { routeKey: "oracle.personality.select" },
        }),
      }),
    }));

    const sidecarResult = result as { panel: SidecarPanel } & typeof result;
    syncActiveSidecarPanel({
      action: "open",
      panel: sidecarResult.panel,
      conversationId: "conversation-1",
      userId: "user-1",
    });

    const interactionResult = await routeSidecarInteraction({
      panelId: sidecarResult.panel.panelId,
      actionId: "oracle_personality_apply",
      selectedItemIds: ["bullish"],
      conversationId: "conversation-1",
      userId: "user-1",
    });

    expect(mockedSetMemoryFact).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      key: "oracle_bot_personality",
      value: "bullish",
    }));
    expect(interactionResult).toEqual(expect.objectContaining({
      ok: true,
      action: "update",
      panel: expect.objectContaining({
        panelId: sidecarResult.panel.panelId,
        content: expect.objectContaining({
          type: "markdown",
        }),
      }),
    }));
  });

  it("returns useful plain search results without Sidecar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ([
        {
          id: "market-1",
          question: "Will BTC hit 150k?",
          active: true,
          closed: false,
          outcomes: ["Yes", "No"],
          outcomePrices: [0.41, 0.59],
        },
      ]),
    })));

    const result = await executeTool("oracle_search_markets", {
      query: "btc",
      interactive: false,
    }, {
      access: { agentProfile: "research_operator", userId: "user-1" },
    });

    expect(result).toEqual(expect.objectContaining({
      query: "btc",
      markets: [expect.objectContaining({ id: "market-1" })],
      summary: expect.stringContaining("Will BTC hit 150k?"),
    }));
  });

  it("drives an interactive market selection flow through Sidecar and returns a verdict panel", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/markets?")) {
        return {
          ok: true,
          json: async () => ([
            {
              id: "market-1",
              question: "Will BTC hit 150k?",
              active: true,
              closed: false,
              outcomes: ["Yes", "No"],
              outcomePrices: [0.41, 0.59],
            },
          ]),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          id: "market-1",
          question: "Will BTC hit 150k?",
          active: true,
          closed: false,
          endDate: "2026-12-31",
          outcomes: ["Yes", "No"],
          outcomePrices: [0.41, 0.59],
        }),
      } as Response;
    }));

    mockedGetActiveMemoryFacts.mockResolvedValue([{ value: "balanced" }] as never);

    const result = await executeTool("oracle_search_markets", {
      query: "btc",
      interactive: true,
    }, {
      access: { agentProfile: "research_operator", userId: "user-1" },
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      action: "open",
      panel: expect.objectContaining({
        content: expect.objectContaining({
          type: "selection",
          interaction: { routeKey: "oracle.market.select" },
        }),
      }),
    }));

    const sidecarResult = result as { panel: SidecarPanel } & typeof result;
    syncActiveSidecarPanel({
      action: "open",
      panel: sidecarResult.panel,
      conversationId: "conversation-1",
      userId: "user-1",
    });

    const interactionResult = await routeSidecarInteraction({
      panelId: sidecarResult.panel.panelId,
      actionId: "oracle_market_apply",
      selectedItemIds: ["market-1"],
      conversationId: "conversation-1",
      userId: "user-1",
    });

    expect(interactionResult).toEqual(expect.objectContaining({
      ok: true,
      action: "update",
      panel: expect.objectContaining({
        panelId: sidecarResult.panel.panelId,
        content: expect.objectContaining({
          type: "markdown",
          markdown: expect.stringContaining("Will BTC hit 150k?"),
        }),
      }),
    }));
  });
});