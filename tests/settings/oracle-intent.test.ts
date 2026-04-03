import { describe, expect, it } from "vitest";
import { getOraclePredictionIntent } from "@/lib/oracle/intent";

describe("oracle prediction intent", () => {
  it("matches when oracle and predict appear in the same prompt", () => {
    expect(getOraclePredictionIntent("Oracle predict BTC to 150k")).toEqual({
      matched: true,
      query: "BTC to 150k",
    });
  });

  it("does not match when the oracle keyword is missing", () => {
    expect(getOraclePredictionIntent("Predict BTC to 150k")).toEqual({
      matched: false,
      query: "",
    });
  });
});
