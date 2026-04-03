import { describe, expect, it } from "vitest";
import { buildOracleEvidenceBundle } from "@/lib/oracle/evidence";
import { parseOraclePredictionTarget } from "@/lib/oracle/intent";
import { normalizeKalshiMarket } from "@/lib/oracle/kalshi-source";
import { normalizePolymarketMarket } from "@/lib/oracle/polymarket-source";
import type { PolymarketMarket } from "@/lib/polymarket/types";

const REFERENCE_DATE = new Date("2026-04-03T00:00:00.000Z");

function createMarket(overrides: Partial<PolymarketMarket>): PolymarketMarket {
  return {
    id: "market-1",
    question: "Will Bitcoin hit 150k by Dec 31 2026?",
    active: true,
    closed: false,
    endDate: "2026-12-31",
    liquidity: 500_000,
    volume: 1_200_000,
    outcomes: [
      { label: "Yes", price: 0.34 },
      { label: "No", price: 0.66 },
    ],
    ...overrides,
  };
}

describe("oracle evidence bundle", () => {
  it("classifies an exact BTC market and carries through its implied odds", () => {
    const target = parseOraclePredictionTarget("oracle predict btc over 150k this year", { referenceDate: REFERENCE_DATE });
    expect(target).toBeTruthy();

    const bundle = buildOracleEvidenceBundle(target!, [
      normalizePolymarketMarket(createMarket({})),
      normalizePolymarketMarket(createMarket({ id: "market-2", question: "Will Bitcoin hit 200k by Dec 31 2026?", outcomes: [{ label: "Yes", price: 0.12 }, { label: "No", price: 0.88 }] })),
    ]);

    expect(bundle.evidenceMode).toBe("exact_market");
    expect(bundle.exactMatch?.market.sourceMarketId).toBe("market-1");
    expect(bundle.inferredProbability).toBe(0.34);
    expect(bundle.sourceProbabilities).toEqual([
      expect.objectContaining({ source: "polymarket", probability: 0.34, candidateCount: 1 }),
    ]);
    expect(bundle.sourceBlend).toEqual({ agreement: "single_source", spread: 0 });
    expect(bundle.confidence).toBe("high");
  });

  it("falls back to adjacent inference when no exact BTC market exists", () => {
    const target = parseOraclePredictionTarget("oracle predict btc over 150k this year", { referenceDate: REFERENCE_DATE });
    expect(target).toBeTruthy();

    const bundle = buildOracleEvidenceBundle(target!, [
      normalizePolymarketMarket(createMarket({ id: "market-2", question: "Will Bitcoin hit 140k by Dec 31 2026?", outcomes: [{ label: "Yes", price: 0.48 }, { label: "No", price: 0.52 }] })),
      normalizePolymarketMarket(createMarket({ id: "market-3", question: "Will Bitcoin hit 200k by Dec 31 2026?", outcomes: [{ label: "Yes", price: 0.16 }, { label: "No", price: 0.84 }] })),
    ]);

    expect(bundle.evidenceMode).toBe("adjacent_inference");
    expect(bundle.exactMatch).toBeNull();
    expect(bundle.adjacentMatches.length).toBeGreaterThan(0);
    expect(bundle.inferredProbability).not.toBeNull();
    expect(bundle.summaryPacket).toContain("Evidence mode: adjacent_inference");
  });

  it("parses ETH downside targets and aligns them against under markets", () => {
    const target = parseOraclePredictionTarget("oracle predict eth under 2k by june", { referenceDate: REFERENCE_DATE });
    expect(target).toBeTruthy();

    const bundle = buildOracleEvidenceBundle(target!, [
      normalizePolymarketMarket(createMarket({
        id: "eth-1",
        question: "Will ETH be below 2000 by June 30 2026?",
        endDate: "2026-06-30",
        outcomes: [{ label: "Yes", price: 0.62 }, { label: "No", price: 0.38 }],
      })),
    ]);

    expect(bundle.exactMatch?.targetAlignedProbability).toBe(0.62);
    expect(bundle.exactMatch?.sentimentLabel).toBe("bullish");
  });

  it("stays source-agnostic when the evidence comes from a Kalshi-normalized market", () => {
    const target = parseOraclePredictionTarget("oracle predict btc over 150k this year", { referenceDate: REFERENCE_DATE });
    expect(target).toBeTruthy();

    const bundle = buildOracleEvidenceBundle(target!, [
      normalizeKalshiMarket({
        ticker: "KXBTC-26DEC31-T150000",
        title: "Bitcoin price by Dec 31, 2026?",
        subtitle: "$150,000 or above",
        yesBid: 0.34,
        yesAsk: 0.38,
        liquidity: 200_000,
        volume: 750_000,
        closeTime: "2026-12-31T23:59:59Z",
        status: "active",
      }),
    ]);

    expect(bundle.evidenceMode).toBe("exact_market");
    expect(bundle.exactMatch?.market.source).toBe("kalshi");
    expect(bundle.exactMatch?.targetAlignedProbability).toBe(0.36);
  });

  it("blends exact-market probabilities across Polymarket and Kalshi instead of taking a single source", () => {
    const target = parseOraclePredictionTarget("oracle predict btc over 150k this year", { referenceDate: REFERENCE_DATE });
    expect(target).toBeTruthy();

    const bundle = buildOracleEvidenceBundle(target!, [
      normalizePolymarketMarket(createMarket({
        id: "poly-exact",
        question: "Will Bitcoin hit 150k by Dec 31 2026?",
        liquidity: 500_000,
        volume: 1_200_000,
        outcomes: [{ label: "Yes", price: 0.34 }, { label: "No", price: 0.66 }],
      })),
      normalizeKalshiMarket({
        ticker: "KXBTC-26DEC31-T150000",
        title: "Bitcoin price by Dec 31, 2026?",
        subtitle: "$150,000 or above",
        yesBid: 0.44,
        yesAsk: 0.48,
        liquidity: 220_000,
        volume: 700_000,
        closeTime: "2026-12-31T23:59:59Z",
        status: "active",
      }),
    ]);

    expect(bundle.evidenceMode).toBe("exact_market");
    expect(bundle.sourceProbabilities).toHaveLength(2);
    expect(bundle.inferredProbability).not.toBe(0.34);
    expect(bundle.inferredProbability).not.toBe(0.46);
    expect(bundle.sourceBlend).toEqual(expect.objectContaining({ agreement: "mixed" }));
    expect(bundle.summaryPacket).toContain("Source blend: polymarket 34.0% | kalshi 46.0%");
  });

  it("downgrades confidence when Polymarket and Kalshi materially diverge", () => {
    const target = parseOraclePredictionTarget("oracle predict btc over 150k this year", { referenceDate: REFERENCE_DATE });
    expect(target).toBeTruthy();

    const bundle = buildOracleEvidenceBundle(target!, [
      normalizePolymarketMarket(createMarket({
        id: "poly-divergent",
        question: "Will Bitcoin hit 150k by Dec 31 2026?",
        liquidity: 600_000,
        volume: 1_300_000,
        outcomes: [{ label: "Yes", price: 0.28 }, { label: "No", price: 0.72 }],
      })),
      normalizeKalshiMarket({
        ticker: "KXBTC-26DEC31-T150000",
        title: "Bitcoin price by Dec 31, 2026?",
        subtitle: "$150,000 or above",
        yesBid: 0.72,
        yesAsk: 0.76,
        liquidity: 260_000,
        volume: 850_000,
        closeTime: "2026-12-31T23:59:59Z",
        status: "active",
      }),
    ]);

    expect(bundle.sourceBlend).toEqual(expect.objectContaining({ agreement: "divergent" }));
    expect(bundle.confidence).toBe("low");
    expect(bundle.summaryPacket).toContain("Source agreement: divergent");
  });

  it("drops tangential weak markets from the surfaced evidence packet", () => {
    const target = parseOraclePredictionTarget("oracle predict btc over 150k this year", { referenceDate: REFERENCE_DATE });
    expect(target).toBeTruthy();

    const bundle = buildOracleEvidenceBundle(target!, [
      normalizePolymarketMarket(createMarket({ id: "adjacent-good", question: "Will Bitcoin hit 140k by Dec 31 2026?", outcomes: [{ label: "Yes", price: 0.48 }, { label: "No", price: 0.52 }] })),
      normalizeKalshiMarket({
        ticker: "KXTANGENTIAL",
        title: "Bitcoin price by Dec 31, 2026?",
        subtitle: "$20,000 or above",
        yesBid: 0.99,
        yesAsk: 1,
        liquidity: 100,
        volume: 500,
        closeTime: "2026-12-31T23:59:59Z",
        status: "active",
      }),
    ]);

    expect(bundle.allCandidates).toHaveLength(1);
    expect(bundle.allCandidates[0]?.market.sourceMarketId).toBe("adjacent-good");
    expect(bundle.summaryPacket).not.toContain("KXTANGENTIAL");
  });

  it("treats no active matching markets as weak negative evidence against the target", () => {
    const target = parseOraclePredictionTarget("oracle predict btc over 150k this year", { referenceDate: REFERENCE_DATE });
    expect(target).toBeTruthy();

    const bundle = buildOracleEvidenceBundle(target!, []);

    expect(bundle.evidenceMode).toBe("no_useful_match");
    expect(bundle.inferredProbability).toBe(0.18);
    expect(bundle.overallSentiment).toBe("bearish");
    expect(bundle.confidence).toBe("low");
    expect(bundle.summaryPacket).toContain("absence of active market support as a weak negative signal");
  });
});