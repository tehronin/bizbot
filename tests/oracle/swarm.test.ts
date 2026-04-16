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
      summaryPacket: "Market evidence summary.",
    }),
  };
});

vi.mock("@/lib/browser/engine", () => ({
  navigatePage: vi.fn().mockResolvedValue({
    result: {
      url: "https://www.google.com/search?q=btc+150k",
      title: "btc 150k - Google Search",
      text: "Bitcoin Price Prediction\nExperts suggest BTC could reach 150k by late 2026 based on current market trends and institutional adoption.\nAnother Result\nSome analysts remain cautious about the 150k target citing regulatory headwinds.",
    },
    cookies: [],
  }),
  extractText: vi.fn().mockResolvedValue({ text: "sample text", cookies: [] }),
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

  it("generates web search queries from the target", () => {
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves a swarm evidence bundle with market, web research, and trend data", async () => {
    const target = parseOraclePredictionTarget("oracle predict btc over 150k this year", { referenceDate: REFERENCE_DATE });
    expect(target).toBeTruthy();

    const bundle = await resolveOracleSwarmEvidence(target!);

    // Market evidence should be present
    expect(bundle.market).toBeDefined();
    expect(bundle.market.evidenceMode).toBe("adjacent_inference");
    expect(bundle.market.inferredProbability).toBe(0.22);

    // Web research should contain results from the mocked navigatePage
    expect(bundle.webResearch.length).toBeGreaterThan(0);

    // Trend signals should be present (may be "unknown" since we're mocking)
    expect(bundle.trendSignals.length).toBeGreaterThan(0);

    // Swarm trace
    expect(bundle.swarmTrace.workerCount).toBe(3);
    expect(bundle.swarmTrace.completedCount).toBe(3);
    expect(bundle.swarmTrace.failedCount).toBe(0);
    expect(bundle.swarmTrace.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("enriches the market summary packet with web research and trend data", async () => {
    const target = parseOraclePredictionTarget("oracle predict btc over 150k this year", { referenceDate: REFERENCE_DATE });
    const bundle = await resolveOracleSwarmEvidence(target!);

    // The summary packet should include the original market evidence plus swarm additions
    expect(bundle.market.summaryPacket).toContain("Market evidence summary.");
    expect(bundle.market.summaryPacket).toContain("Swarm:");
  });

  it("handles browser failures gracefully with empty snippets and unknown signals", async () => {
    // Make browser engine fail for this test
    const { navigatePage } = await import("@/lib/browser/engine");
    vi.mocked(navigatePage).mockRejectedValue(new Error("Browser unavailable"));

    const target = parseOraclePredictionTarget("oracle predict btc over 150k this year", { referenceDate: REFERENCE_DATE });
    const bundle = await resolveOracleSwarmEvidence(target!);

    // Market evidence should still succeed
    expect(bundle.market).toBeDefined();
    expect(bundle.market.evidenceMode).toBe("adjacent_inference");

    // Web research workers catch errors internally — results have empty snippets
    for (const result of bundle.webResearch) {
      expect(result.snippets).toEqual([]);
    }

    // Trend signals should report "unknown" direction/interest
    for (const signal of bundle.trendSignals) {
      expect(signal.trendDirection).toBe("unknown");
      expect(signal.interestLevel).toBe("unknown");
    }

    // All three swarm workers still complete (they catch internally)
    expect(bundle.swarmTrace.completedCount).toBe(3);
    expect(bundle.swarmTrace.failedCount).toBe(0);
  });
});
