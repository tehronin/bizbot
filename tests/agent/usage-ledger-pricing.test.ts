import { describe, expect, it } from "vitest";
import {
  getDefaultUsageLedgerModelPricing,
  parseUsageLedgerModelPricingSetting,
  serializeUsageLedgerModelPricingSetting,
} from "@/lib/agent/usage-ledger-pricing";

describe("usage ledger model pricing", () => {
  it("returns model-specific defaults and provider fallbacks", () => {
    expect(getDefaultUsageLedgerModelPricing("gemini-3-flash-preview", "google")).toEqual({
      promptUsdPerMillion: 0.35,
      completionUsdPerMillion: 1.05,
    });
    expect(getDefaultUsageLedgerModelPricing("unknown-model", "ollama")).toEqual({
      promptUsdPerMillion: 0,
      completionUsdPerMillion: 0,
    });
  });

  it("parses and serializes saved pricing settings", () => {
    const serialized = serializeUsageLedgerModelPricingSetting({
      "gemini-3-flash-preview": { promptUsdPerMillion: 0.4, completionUsdPerMillion: 1.2 },
      "gpt-4o": { promptUsdPerMillion: 5, completionUsdPerMillion: 15 },
    });

    expect(parseUsageLedgerModelPricingSetting(serialized)).toEqual({
      "gemini-3-flash-preview": { promptUsdPerMillion: 0.4, completionUsdPerMillion: 1.2 },
      "gpt-4o": { promptUsdPerMillion: 5, completionUsdPerMillion: 15 },
    });
  });

  it("ignores malformed saved pricing data", () => {
    expect(parseUsageLedgerModelPricingSetting("not-json")).toEqual({});
    expect(parseUsageLedgerModelPricingSetting(JSON.stringify({ bad: { promptUsdPerMillion: "x" } }))).toEqual({
      bad: { promptUsdPerMillion: 0, completionUsdPerMillion: 0 },
    });
  });
});