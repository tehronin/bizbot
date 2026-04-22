import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/memory/service", () => ({
  getActiveMemoryFacts: vi.fn(),
  setMemoryFact: vi.fn(),
}));

vi.mock("@/lib/oracle/predictions", () => ({
  persistOraclePrediction: vi.fn(async ({ userId, conversationId, target, personality, evidenceMode, impliedProbability, calibratedProbability, confidence, sentiment, headline, summary, summaryPacket, sourceBlend, evidenceGaps, verdict, isWatched }) => ({
    id: "prediction-1",
    userId,
    conversationId: conversationId ?? null,
    rawPrompt: target.rawPrompt,
    normalizedPrompt: target.normalizedPrompt,
    canonicalQuestion: target.canonicalQuestion,
    asset: target.asset ?? null,
    personality,
    isWatched: isWatched ?? false,
    analysisCount: 1,
    lastEvidenceMode: evidenceMode,
    lastImpliedProbability: impliedProbability,
    lastCalibratedProbability: calibratedProbability,
    lastConfidence: confidence,
    lastSentiment: sentiment,
    lastHeadline: headline,
    lastSummary: summary,
    lastSummaryPacket: summaryPacket,
    lastSourceBlend: sourceBlend,
    lastEvidenceGaps: evidenceGaps,
    lastVerdict: verdict,
    lastAnalyzedAt: "2026-04-17T00:00:00.000Z",
    createdAt: "2026-04-17T00:00:00.000Z",
    updatedAt: "2026-04-17T00:00:00.000Z",
  })),
  listOraclePredictions: vi.fn(async () => []),
}));

vi.mock("@/lib/oracle/swarm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/oracle/swarm")>();
  const { resolveOraclePredictionEvidence } = await import("@/lib/oracle/evidence");
  return {
    ...actual,
    resolveOracleSwarmEvidence: vi.fn(async (target, options) => {
      const market = await resolveOraclePredictionEvidence(target, options);
      return {
        market,
        webResearch: [],
        trendSignals: [],
        evidenceGaps: [],
        swarmTrace: { planId: "test-plan", durationMs: 50, workerCount: 1, completedCount: 1, failedCount: 0 },
      };
    }),
  };
});

import { getActiveMemoryFacts, setMemoryFact } from "@/lib/agent/memory/service";
import { executeTool, getAllToolDefinitions } from "@/lib/agent/plugins";
import { resetKalshiServiceCache } from "@/lib/kalshi/service";
import { listOraclePredictions, persistOraclePrediction } from "@/lib/oracle/predictions";
import { routeSidecarInteraction } from "@/lib/sidecar/router";
import { resetActiveSidecarPanelsForTests, syncActiveSidecarPanel } from "@/lib/sidecar/state";
import type { SidecarPanel } from "@/lib/sidecar/types";

const mockedGetActiveMemoryFacts = vi.mocked(getActiveMemoryFacts);
const mockedSetMemoryFact = vi.mocked(setMemoryFact);
const mockedPersistOraclePrediction = vi.mocked(persistOraclePrediction);
const mockedListOraclePredictions = vi.mocked(listOraclePredictions);

describe("oracle plugin", () => {
  beforeEach(() => {
    process.env.BIZBOT_PLUGIN_ORACLE_ENABLED = "true";
    resetKalshiServiceCache();
    resetActiveSidecarPanelsForTests();
    mockedGetActiveMemoryFacts.mockReset();
    mockedSetMemoryFact.mockReset();
    mockedPersistOraclePrediction.mockClear();
    mockedListOraclePredictions.mockClear();
    mockedGetActiveMemoryFacts.mockResolvedValue([] as never);
    mockedSetMemoryFact.mockResolvedValue({ id: "fact-1", key: "oracle_bot_personality", value: "balanced" } as never);
  });

  it("is enabled by default and can be explicitly disabled", () => {
    delete process.env.BIZBOT_PLUGIN_ORACLE_ENABLED;
    const defaultTools = getAllToolDefinitions(undefined, { agentProfile: "mcp_operator" }).map((tool) => tool.name);
    expect(defaultTools).toContain("oracle_search_markets");
    expect(defaultTools).toContain("oracle_get_market_verdict");
    expect(defaultTools).toContain("oracle_analyze_prediction");
    expect(defaultTools).toContain("oracle_open_personality_selector");
    expect(defaultTools).toContain("oracle_watch_prediction");
    expect(defaultTools).toContain("oracle_list_predictions");

    process.env.BIZBOT_PLUGIN_ORACLE_ENABLED = "false";
    const disabledTools = getAllToolDefinitions(undefined, { agentProfile: "mcp_operator" }).map((tool) => tool.name);
    expect(disabledTools).not.toContain("oracle_search_markets");
    expect(disabledTools).not.toContain("oracle_get_market_verdict");
    expect(disabledTools).not.toContain("oracle_analyze_prediction");
    expect(disabledTools).not.toContain("oracle_open_personality_selector");
    expect(disabledTools).not.toContain("oracle_watch_prediction");
    expect(disabledTools).not.toContain("oracle_list_predictions");
  });

  it("builds an evidence-backed Oracle prediction analysis packet", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/series")) {
        return {
          ok: true,
          json: async () => ({ series: [] }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ([
          {
            id: "market-1",
            question: "Will Bitcoin hit 150k by Dec 31 2026?",
            active: true,
            closed: false,
            endDate: "2026-12-31",
            liquidity: 500000,
            outcomes: ["Yes", "No"],
            outcomePrices: [0.41, 0.59],
          },
        ]),
      } as Response;
    }));

    const result = await executeTool("oracle_analyze_prediction", {
      prompt: "oracle predict btc over 150k this year",
    }, {
      access: { agentProfile: "research_operator", userId: "user-1" },
    });

    expect(result).toEqual(expect.objectContaining({
      evidenceMode: "exact_market",
      impliedProbability: 0.41,
      predictionLogId: "prediction-1",
      watchEnabled: false,
      sourceBlend: expect.objectContaining({
        agreement: "single_source",
        spread: 0,
        sources: [expect.objectContaining({ source: "polymarket", probability: 0.41 })],
      }),
      summaryPacket: expect.stringContaining("Canonical target: Will BTC trade over 150k by"),
    }));
  });

  it("exposes structured source blend details when multiple sources contribute", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/series")) {
        return {
          ok: true,
          json: async () => ({
            series: [
              { ticker: "KXBTCD", title: "Bitcoin price Above/below", category: "Crypto", tags: ["BTC"] },
            ],
          }),
        } as Response;
      }

      if (url.includes("series_ticker=KXBTCD")) {
        return {
          ok: true,
          json: async () => ({
            markets: [
              {
                ticker: "KXBTC-26DEC31-T150000",
                title: "Bitcoin price by Dec 31, 2026?",
                subtitle: "$150,000 or above",
                yes_bid_dollars: "0.44",
                yes_ask_dollars: "0.48",
                liquidity_dollars: "220000.00",
                volume_fp: "700000.00",
                close_time: "2026-12-31T23:59:59Z",
                status: "active",
              },
            ],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ([
          {
            id: "market-1",
            question: "Will Bitcoin hit 150k by Dec 31 2026?",
            active: true,
            closed: false,
            endDate: "2026-12-31",
            liquidity: 500000,
            outcomes: ["Yes", "No"],
            outcomePrices: [0.41, 0.59],
          },
        ]),
      } as Response;
    }));

    const result = await executeTool("oracle_analyze_prediction", {
      prompt: "oracle predict btc over 150k this year",
    }, {
      access: { agentProfile: "research_operator", userId: "user-1" },
    });

    expect(result).toEqual(expect.objectContaining({
      sourceBlend: expect.objectContaining({
        agreement: "aligned",
        sources: [
          expect.objectContaining({ source: "polymarket", probability: 0.41 }),
          expect.objectContaining({ source: "kalshi", probability: 0.46 }),
        ],
      }),
    }));
  });

  it("retries once with a rephrased query when all source searches come back empty", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/series")) {
        return {
          ok: true,
          json: async () => ({ series: [] }),
        } as Response;
      }

      const parsedUrl = new URL(url);
      const query = parsedUrl.searchParams.get("search");
      if (query === "btc 150k 2026") {
        return {
          ok: true,
          json: async () => ([
            {
              id: "market-1",
              question: "Will Bitcoin hit 150k by Dec 31 2026?",
              active: true,
              closed: false,
              endDate: "2026-12-31",
              liquidity: 500000,
              outcomes: ["Yes", "No"],
              outcomePrices: [0.36, 0.64],
            },
          ]),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ([]),
      } as Response;
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await executeTool("oracle_analyze_prediction", {
      prompt: "oracle predict btc over 150k this year",
    }, {
      access: { agentProfile: "research_operator", userId: "user-1" },
    });

    expect(result).toEqual(expect.objectContaining({
      evidenceMode: "exact_market",
      impliedProbability: 0.36,
    }));
    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("search=btc+150k+2026"))).toBe(true);
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
        context: {
          contextId: "oracle.personality.preferences",
          readKeys: ["selectedPersonality"],
          writeKeys: ["selectedPersonality"],
          selectionKey: "selectedPersonality",
        },
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
      action: "open",
      panel: expect.objectContaining({
        panelId: expect.any(String),
        context: {
          contextId: "oracle.personality.preferences",
          readKeys: ["selectedPersonality"],
        },
        content: expect.objectContaining({
          type: "key_value",
          entries: expect.arrayContaining([
            expect.objectContaining({ label: "default personality", contextKey: "selectedPersonality" }),
          ]),
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
      markets: [expect.objectContaining({ sourceMarketId: "market-1", title: "Will BTC hit 150k?" })],
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
        context: {
          contextId: "oracle.market.selection",
          readKeys: [
            "selectedMarketId",
            "selectedMarketQuestion",
            "selectedMarketEndDate",
            "selectedMarketVolumeSummary",
            "selectedMarketOutcomeSummary",
            "selectedPersonalityLabel",
            "selectedVerdictHeadline",
            "selectedVerdictSummary",
            "selectedVerdictConfidence",
          ],
          writeKeys: [
            "selectedMarketId",
            "selectedMarketQuestion",
            "selectedMarketEndDate",
            "selectedMarketVolumeSummary",
            "selectedMarketOutcomeSummary",
            "selectedPersonalityLabel",
            "selectedVerdictHeadline",
            "selectedVerdictSummary",
            "selectedVerdictConfidence",
          ],
          selectionKey: "selectedMarketId",
        },
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
      expectedStackRevision: 1,
      contextPatch: {
        contextId: "oracle.market.selection",
        values: {
          selectedMarketId: "market-1",
        },
      },
      conversationId: "conversation-1",
      userId: "user-1",
    });

    expect(interactionResult).toEqual(expect.objectContaining({
      ok: true,
      action: "open",
      panel: expect.objectContaining({
        panelId: expect.any(String),
        context: {
          contextId: "oracle.market.selection",
          readKeys: [
            "selectedMarketId",
            "selectedMarketQuestion",
            "selectedMarketEndDate",
            "selectedMarketVolumeSummary",
            "selectedMarketOutcomeSummary",
            "selectedPersonalityLabel",
            "selectedVerdictHeadline",
            "selectedVerdictSummary",
            "selectedVerdictConfidence",
          ],
        },
        content: expect.objectContaining({
          type: "markdown",
          markdown: expect.stringContaining("{{selectedMarketQuestion}}"),
        }),
      }),
      context: expect.objectContaining({
        contextId: "oracle.market.selection",
        values: {
          selectedMarketId: "market-1",
          selectedMarketQuestion: "Will BTC hit 150k?",
          selectedMarketEndDate: "2026-12-31",
          selectedMarketVolumeSummary: "n/a",
          selectedMarketOutcomeSummary: expect.stringContaining("Yes:"),
          selectedPersonalityLabel: "Balanced",
          selectedVerdictHeadline: expect.any(String),
          selectedVerdictSummary: expect.any(String),
          selectedVerdictConfidence: expect.any(String),
        },
      }),
    }));
  });
});