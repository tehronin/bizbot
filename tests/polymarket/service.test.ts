import { afterEach, describe, expect, it, vi } from "vitest";
import { getPolymarketMarket, searchPolymarketMarkets } from "@/lib/polymarket/service";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("polymarket service", () => {
  it("normalizes market search responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ([
        {
          id: "market-1",
          question: "Will ETH be above $5k by year end?",
          active: true,
          closed: false,
          endDate: "2026-12-31",
          volume: "12345",
          liquidity: 6789,
          outcomes: ["Yes", "No"],
          outcomePrices: [0.62, "0.38"],
        },
      ]),
    })));

    const result = await searchPolymarketMarkets("eth", 5);

    expect(result).toEqual({
      query: "eth",
      markets: [
        {
          id: "market-1",
          question: "Will ETH be above $5k by year end?",
          active: true,
          closed: false,
          endDate: "2026-12-31",
          volume: 12345,
          liquidity: 6789,
          outcomes: [
            { label: "Yes", price: 0.62 },
            { label: "No", price: 0.38 },
          ],
        },
      ],
    });
  });

  it("normalizes single market lookups", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        conditionId: "market-2",
        title: "Will BizBot ship Oracle this quarter?",
        active: true,
        isClosed: false,
        prices: ["0.55", "0.45"],
        outcomeNames: ["Yes", "No"],
      }),
    })));

    const market = await getPolymarketMarket("market-2");

    expect(market).toEqual({
      id: "market-2",
      question: "Will BizBot ship Oracle this quarter?",
      active: true,
      closed: false,
      outcomes: [
        { label: "Yes", price: 0.55 },
        { label: "No", price: 0.45 },
      ],
    });
  });

  it("fails on non-array search payloads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [] }),
    })));

    await expect(searchPolymarketMarkets("eth")).rejects.toThrow("Polymarket search payload must be an array.");
  });
});