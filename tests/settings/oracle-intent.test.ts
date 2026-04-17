import { describe, expect, it } from "vitest";
import {
  getOraclePredictionIntent,
  isMeaningfulOraclePredictionTarget,
  parseOraclePredictionTarget,
} from "@/lib/oracle/intent";

const REFERENCE_DATE = new Date("2026-04-03T00:00:00.000Z");

describe("oracle prediction intent", () => {
  it("matches when oracle and predict appear in the same prompt", () => {
    const result = getOraclePredictionIntent("Oracle predict BTC to 150k", { referenceDate: REFERENCE_DATE });
    expect(result.matched).toBe(true);
    expect(result.query).toBe("BTC to 150k");
    expect(result.target).toEqual(expect.objectContaining({
      asset: "BTC",
      thresholdValue: 150000,
      thresholdUnit: "usd",
      canonicalQuestion: "Will BTC trade over 150k?",
    }));
  });

  it("strips wrapper phrases and obvious filler words from Oracle prompts", () => {
    const result = getOraclePredictionIntent("Oracle, can you predict btc 150k this year for me?", { referenceDate: REFERENCE_DATE });
    expect(result.matched).toBe(true);
    expect(result.query).toBe("btc 150k");
    expect(result.target).toEqual(expect.objectContaining({
      asset: "BTC",
      thresholdValue: 150000,
      timeframeText: "this year",
      timeframeEnd: "2026-12-31",
      canonicalQuestion: "Will BTC trade over 150k by 2026-12-31?",
    }));
  });

  it("keeps meaningful market qualifiers while removing prompt filler", () => {
    const result = getOraclePredictionIntent("Please oracle prediction on sol above 300 by december", { referenceDate: REFERENCE_DATE });
    expect(result.matched).toBe(true);
    expect(result.query).toBe("sol above 300 by december");
    expect(result.target).toEqual(expect.objectContaining({
      asset: "SOL",
      direction: "over",
      thresholdValue: 300,
      timeframeEnd: "2026-12-31",
    }));
  });

  it("parses ETH downside targets into a canonical prediction target", () => {
    const result = getOraclePredictionIntent("oracle predict eth under 2k by june", { referenceDate: REFERENCE_DATE });
    expect(result.target).toEqual(expect.objectContaining({
      asset: "ETH",
      direction: "under",
      thresholdValue: 2000,
      timeframeEnd: "2026-06-30",
      canonicalQuestion: "Will ETH trade under 2k by 2026-06-30?",
    }));
    expect(result.target?.searchQueries).toEqual(expect.arrayContaining([
      "eth 2k 2026",
      "eth under 2k",
    ]));
  });

  it("parses macro prompts without misreading the year as a price target", () => {
    const result = getOraclePredictionIntent("oracle predict whether the fed cuts rates by september 2026", { referenceDate: REFERENCE_DATE });
    expect(result.matched).toBe(true);
    expect(result.target).toEqual(expect.objectContaining({
      asset: "FED",
      timeframeEnd: "2026-09-30",
      canonicalQuestion: "whether fed cuts rates by september 2026",
    }));
    expect(result.target?.thresholdValue).toBeUndefined();
  });

  it("parses election prompts as open-ended Oracle targets", () => {
    const target = parseOraclePredictionTarget("oracle predict who wins the election in 2028", { referenceDate: REFERENCE_DATE });
    expect(target).toEqual(expect.objectContaining({
      asset: "US_ELECTION",
      canonicalQuestion: "who wins election in 2028",
    }));
    expect(target?.thresholdValue).toBeUndefined();
    expect(target?.searchQueries).toEqual(expect.arrayContaining(["who wins election in 2028", "election"]));
  });

  it("treats open-ended market questions as meaningful even without a numeric threshold", () => {
    const target = parseOraclePredictionTarget("oracle predict if gold breaks out this year", { referenceDate: REFERENCE_DATE });
    expect(target).toEqual(expect.objectContaining({
      asset: "GOLD",
      canonicalQuestion: "if gold breaks out",
    }));
    expect(isMeaningfulOraclePredictionTarget(target)).toBe(true);
  });

  it("does not match when the oracle keyword is missing", () => {
    expect(getOraclePredictionIntent("Predict BTC to 150k")).toEqual({
      matched: false,
      query: "",
    });
  });

  it("treats topical explicit-plugin follow-ups as meaningful Oracle targets", () => {
    const target = parseOraclePredictionTarget("what about etherium ?", { referenceDate: REFERENCE_DATE });
    expect(isMeaningfulOraclePredictionTarget(target)).toBe(true);
  });

  it("rejects conversational follow-ups as explicit Oracle targets", () => {
    const target = parseOraclePredictionTarget("are you sure?", { referenceDate: REFERENCE_DATE });
    expect(target).toEqual(expect.objectContaining({ normalizedPrompt: "are sure" }));
    expect(isMeaningfulOraclePredictionTarget(target)).toBe(false);
  });
});
