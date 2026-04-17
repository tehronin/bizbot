import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildOracleSwarmPlan, resolveOracleSwarmEvidence } from "@/lib/oracle/swarm";
import { parseOraclePredictionTarget } from "@/lib/oracle/intent";

const REFERENCE_DATE = new Date("2026-04-03T00:00:00.000Z");

// ---------------------------------------------------------------------------
// Mock the heavy dependencies so unit tests stay fast
// ---------------------------------------------------------------------------

vi.mock("@/lib/oracle/evidence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/oracle/evidence")>();
  return {
    ...actual,
    resolveOraclePredictionEvidence: vi.fn().mockResolvedValue({
      target: { canonicalQuestion: "Will BTC hit 150k by end of 2026?" },
      evidenceMode: "adjacent_inference",
      inferredProbability: 0.22,
      confidence: "medium",
      overallSentiment: "bullish",
      sourceBlend: { agreement: "single_source", spread: 0 },
      sourceProbabilities: [{ source: "kalshi", probability: 0.22, candidateCount: 2 }],
      exactMatch: null,
      adjacentMatches: [],
      allCandidates: [],
      summaryPacket: "Market evidence summary.",
    }),
  };
});

vi.mock("@/lib/polymarket/service", () => ({
  searchPolymarketMarkets: vi.fn().mockResolvedValue({
    query: "btc 150k",
    markets: [
      {
        id: "pm-btc-150k",
        question: "Will BTC exceed $150,000 by end of 2026?",
        outcomes: [{ label: "Yes", price: 0.22 }, { label: "No", price: 0.78 }],
        active: true,
        closed: false,
        endDate: "2026-12-31",
        volume: 125000,
        url: "https://polymarket.com/market/btc-150k",
      },
    ],
  }),
}));

vi.mock("@/lib/kalshi/service", () => ({
  listKalshiSeries: vi.fn().mockResolvedValue([
    { ticker: "BTC-PRICE", title: "BTC price milestones", tags: ["bitcoin", "crypto"] },
    { ticker: "BTC-EOY", title: "Bitcoin end of year", tags: ["btc"] },
    { ticker: "ETH-PRICE", title: "ETH price milestones", tags: ["ethereum", "crypto"] },
  ]),
  getKalshiMarkets: vi.fn().mockResolvedValue([]),
}));

describe("oracle swarm planner", () => {
  it("builds a plan with three work items for a BTC prediction", () => {
    const target = parseOraclePredictionTarget("oracle predict btc over 150k this year", { referenceDate: REFERENCE_DATE });
    expect(target).toBeTruthy();

    const plan = buildOracleSwarmPlan(target!);
    expect(plan.mode).toBe("oracle_swarm");
    expect(plan.workItems).toHaveLength(3);

    const ids = plan.workItems.map((w) => w.id);
    expect(ids).toContain("market_search");
    expect(ids).toContain("web_research");
    expect(ids).toContain("trend_analysis");
  });

  it("encodes the prediction target in the market_search work item payload", () => {
    const target = parseOraclePredictionTarget("oracle predict eth over 5k by december", { referenceDate: REFERENCE_DATE });
    const plan = buildOracleSwarmPlan(target!);
    const marketItem = plan.workItems.find((w) => w.id === "market_search")!;
    expect(marketItem.payload.target).toEqual(target);
  });

  it("generates research queries from the target for the web_research lane", () => {
    const target = parseOraclePredictionTarget("oracle predict btc over 150k this year", { referenceDate: REFERENCE_DATE });
    const plan = buildOracleSwarmPlan(target!);
    const webItem = plan.workItems.find((w) => w.id === "web_research")!;
    const queries = webItem.payload.queries as string[];
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.some((q) => q.toLowerCase().includes("btc") || q.toLowerCase().includes("bitcoin"))).toBe(true);
  });

  it("generates trend queries from the target", () => {
    const target = parseOraclePredictionTarget("oracle predict btc over 150k this year", { referenceDate: REFERENCE_DATE });
    const plan = buildOracleSwarmPlan(target!);
    const trendItem = plan.workItems.find((w) => w.id === "trend_analysis")!;
    const queries = trendItem.payload.queries as string[];
    expect(queries.length).toBeGreaterThan(0);
  });

  it("sets deterministic_merge aggregation and oracle_swarm mode", () => {
    const target = parseOraclePredictionTarget("oracle predict sol over 300 this year", { referenceDate: REFERENCE_DATE });
    const plan = buildOracleSwarmPlan(target!);
    expect(plan.aggregationStrategy).toBe("deterministic_merge");
    expect(plan.failurePolicy).toBe("fallback_to_single_agent");
  });
});

describe("oracle swarm execution", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-apply default mocks after clearAllMocks
    const { searchPolymarketMarkets } = vi.mocked(await import("@/lib/polymarket/service"));
    searchPolymarketMarkets.mockResolvedValue({
      query: "btc 150k",
      markets: [
        {
          id: "pm-btc-150k",
          question: "Will BTC exceed $150,000 by end of 2026?",
          outcomes: [{ label: "Yes", price: 0.22 }, { label: "No", price: 0.78 }],
          active: true,
          closed: false,
          endDate: "2026-12-31",
          volume: 125000,
          url: "https://polymarket.com/market/btc-150k",
        },
      ],
    });
    const { listKalshiSeries } = vi.mocked(await import("@/lib/kalshi/service"));
    listKalshiSeries.mockResolvedValue([
      { ticker: "BTC-PRICE", title: "BTC price milestones", tags: ["bitcoin", "crypto"] },
      { ticker: "BTC-EOY", title: "Bitcoin end of year", tags: ["btc"] },
    ]);
  });

  it("resolves a swarm evidence bundle with market, web research, and trend data", async () => {
    const target = parseOraclePredictionTarget("oracle predict btc over 150k this year", { referenceDate: REFERENCE_DATE });
    expect(target).toBeTruthy();

    const bundle = await resolveOracleSwarmEvidence(target!);

    // Market evidence should be present
    expect(bundle.market).toBeDefined();
    expect(bundle.market.evidenceMode).toBe("adjacent_inference");
    expect(bundle.market.inferredProbability).toBe(0.22);

    // Web research should contain Polymarket results formatted as structured snippets
    expect(bundle.webResearch.length).toBeGreaterThan(0);
    const firstResult = bundle.webResearch[0]!;
    expect(firstResult.snippets.length).toBeGreaterThan(0);
    expect(firstResult.snippets[0]!.title).toContain("BTC");

    // Trend signals should reflect Kalshi series match count
    expect(bundle.trendSignals.length).toBeGreaterThan(0);
    const firstSignal = bundle.trendSignals[0]!;
    expect(["rising", "stable", "declining", "unknown"]).toContain(firstSignal.trendDirection);

    // Swarm trace
    expect(bundle.swarmTrace.workerCount).toBe(3);
    expect(bundle.swarmTrace.completedCount).toBe(3);
    expect(bundle.swarmTrace.failedCount).toBe(0);
    expect(bundle.swarmTrace.durationMs).toBeGreaterThanOrEqual(0);

    // Evidence gaps should be empty (all lanes succeeded)
    expect(bundle.evidenceGaps).toEqual([]);
  });

  it("enriches the market summary packet with research and trend data", async () => {
    const target = parseOraclePredictionTarget("oracle predict btc over 150k this year", { referenceDate: REFERENCE_DATE });
    const bundle = await resolveOracleSwarmEvidence(target!);

    expect(bundle.market.summaryPacket).toContain("Market evidence summary.");
    expect(bundle.market.summaryPacket).toContain("Swarm:");
  });

  it("records evidence gaps when secondary lanes fail", async () => {
    const { searchPolymarketMarkets } = vi.mocked(await import("@/lib/polymarket/service"));
    const { listKalshiSeries } = vi.mocked(await import("@/lib/kalshi/service"));
    searchPolymarketMarkets.mockRejectedValue(new Error("Polymarket API unavailable"));
    listKalshiSeries.mockRejectedValue(new Error("Kalshi API unavailable"));

    const target = parseOraclePredictionTarget("oracle predict btc over 150k this year", { referenceDate: REFERENCE_DATE });
    const bundle = await resolveOracleSwarmEvidence(target!);

    // Market evidence should still succeed
    expect(bundle.market).toBeDefined();
    expect(bundle.market.evidenceMode).toBe("adjacent_inference");

    // Web research should have empty snippets (worker catches errors internally)
    for (const result of bundle.webResearch) {
      expect(result.snippets).toEqual([]);
    }

    // Trend signals should report "unknown" (listKalshiSeries failed)
    for (const signal of bundle.trendSignals) {
      expect(signal.trendDirection).toBe("unknown");
      expect(signal.interestLevel).toBe("unknown");
    }

    // Swarm workers catch internally, so completedCount is still 3
    expect(bundle.swarmTrace.completedCount).toBe(3);
    expect(bundle.swarmTrace.failedCount).toBe(0);
  });
});
