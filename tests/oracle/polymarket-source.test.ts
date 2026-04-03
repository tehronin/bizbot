import { afterEach, describe, expect, it, vi } from "vitest";
import { parseOraclePredictionTarget } from "@/lib/oracle/intent";
import { normalizePolymarketMarket, searchPolymarketOracleSource } from "@/lib/oracle/polymarket-source";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("oracle polymarket source adapter", () => {
  it("normalizes a Polymarket market into the Oracle source contract", () => {
    const normalized = normalizePolymarketMarket({
      id: "market-1",
      question: "Will BTC hit 150k by Dec 31 2026?",
      active: true,
      closed: false,
      endDate: "2026-12-31",
      volume: 1200,
      liquidity: 800,
      outcomes: [
        { label: "Yes", price: 0.41 },
        { label: "No", price: 0.59 },
      ],
    });

    expect(normalized).toEqual(expect.objectContaining({
      source: "polymarket",
      sourceMarketId: "market-1",
      title: "Will BTC hit 150k by Dec 31 2026?",
      closeTime: "2026-12-31",
      outcomes: [
        { label: "Yes", probability: 0.41 },
        { label: "No", probability: 0.59 },
      ],
    }));
  });

  it("searches Polymarket through the Oracle source adapter contract", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ([
        {
          id: "market-1",
          question: "Will BTC hit 150k by Dec 31 2026?",
          active: true,
          closed: false,
          endDate: "2026-12-31",
          outcomes: ["Yes", "No"],
          outcomePrices: [0.41, 0.59],
        },
      ]),
    })));

    const target = parseOraclePredictionTarget("oracle predict btc over 150k this year", {
      referenceDate: new Date("2026-04-03T00:00:00.000Z"),
    });
    expect(target).toBeTruthy();

    const result = await searchPolymarketOracleSource(target!, {
      limit: 5,
      queryOverride: "btc 150k 2026",
    });

    expect(result).toEqual(expect.objectContaining({
      source: "polymarket",
      query: "btc 150k 2026",
      markets: [expect.objectContaining({
        source: "polymarket",
        sourceMarketId: "market-1",
        title: "Will BTC hit 150k by Dec 31 2026?",
      })],
    }));
  });
});