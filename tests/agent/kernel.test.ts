import { describe, expect, it } from "vitest";
import { getProviderCapabilityFlags } from "@/lib/agent/kernel";

describe("provider capability flags", () => {
  it("marks Google usage telemetry as verified", () => {
    expect(getProviderCapabilityFlags("google")).toEqual(expect.objectContaining({
      usageReliability: expect.objectContaining({
        supported: true,
        reliability: "verified",
      }),
      supportsToolCalling: true,
      nativeExtras: ["search-grounding", "code-execution"],
    }));
  });

  it("marks MiniMax usage telemetry as unverified until validated", () => {
    expect(getProviderCapabilityFlags("minimax")).toEqual(expect.objectContaining({
      usageReliability: expect.objectContaining({
        supported: true,
        reliability: "unverified",
      }),
    }));
  });
});