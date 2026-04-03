import { afterEach, describe, expect, it, vi } from "vitest";
import { resetKalshiServiceCache } from "@/lib/kalshi/service";
import { parseOraclePredictionTarget } from "@/lib/oracle/intent";
import { normalizeKalshiMarket, searchKalshiOracleSource } from "@/lib/oracle/kalshi-source";

afterEach(() => {
  resetKalshiServiceCache();
  vi.unstubAllGlobals();
});

describe("oracle kalshi source adapter", () => {
  it("normalizes a Kalshi market into the Oracle source contract", () => {
    const normalized = normalizeKalshiMarket({
      ticker: "KXBTC-26DEC31-T150000",
      title: "Bitcoin price by Dec 31, 2026?",
      subtitle: "$150,000 or above",
      yesBid: 0.39,
      yesAsk: 0.43,
      noBid: 0.57,
      noAsk: 0.61,
      lastPrice: 0.41,
      liquidity: 250_000,
      volume: 910_000,
      closeTime: "2026-12-31T23:59:59Z",
      status: "active",
    });

    expect(normalized).toEqual(expect.objectContaining({
      source: "kalshi",
      sourceMarketId: "KXBTC-26DEC31-T150000",
      title: "Bitcoin price by Dec 31, 2026?",
      subtitle: "$150,000 or above",
      closeTime: "2026-12-31T23:59:59Z",
      outcomes: [
        { label: "Above", probability: 0.41 },
        { label: "Below", probability: 0.59 },
      ],
    }));
  });

  it("discovers series then returns ranked Kalshi markets through the Oracle source contract", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/series")) {
        return {
          ok: true,
          json: async () => ({
            series: [
              { ticker: "KXETHMAXY", title: "How high will Ethereum get this year?", category: "Crypto", tags: ["ETH"] },
              { ticker: "KXETHD", title: "Ethereum price Above/below", category: "Crypto", tags: ["ETH"] },
              { ticker: "KXNBA", title: "NBA", category: "Sports", tags: ["Basketball"] },
            ],
          }),
        };
      }

      if (url.includes("/markets?") && url.includes("series_ticker=KXETHD")) {
        expect(url).toContain("status=open");
        expect(url).toContain("mve_filter=exclude");
        return {
          ok: true,
          json: async () => ({
            markets: [
              {
                ticker: "KXETHD-26JUN30-B2000",
                title: "Ethereum price by Jun 30, 2026?",
                subtitle: "$2,000 or below",
                yes_bid_dollars: "0.58",
                yes_ask_dollars: "0.62",
                volume_fp: "150000.00",
                liquidity_dollars: "80000.00",
                close_time: "2026-06-30T23:59:59Z",
                status: "active",
              },
            ],
          }),
        };
      }

      if (url.includes("/markets?") && url.includes("series_ticker=KXETHMAXY")) {
        return {
          ok: true,
          json: async () => ({ markets: [] }),
        };
      }

      return {
        ok: true,
        json: async () => ({ markets: [] }),
      };
    });

    vi.stubGlobal("fetch", fetchMock);

    const target = parseOraclePredictionTarget("oracle predict eth under 2k by june", {
      referenceDate: new Date("2026-04-03T00:00:00.000Z"),
    });
    expect(target).toBeTruthy();

    const result = await searchKalshiOracleSource(target!, {
      limit: 5,
      queryOverride: "eth under 2k june 2026",
    });

    expect(result).toEqual(expect.objectContaining({
      source: "kalshi",
      query: "eth under 2k june 2026",
      markets: [expect.objectContaining({
        source: "kalshi",
        sourceMarketId: "KXETHD-26JUN30-B2000",
        subtitle: "$2,000 or below",
      })],
    }));
    expect(fetchMock).toHaveBeenCalled();
  });
});