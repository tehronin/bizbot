import { beforeEach, describe, expect, it } from "vitest";
import { getBizBotResourceDefinition } from "@/lib/mcp/preview-catalog";
import { resetDevLoopSamplingTelemetry } from "@/lib/mcp/sampling";

describe("MCP sampling policy resource", () => {
  beforeEach(() => {
    resetDevLoopSamplingTelemetry();
  });

  it("exposes the stdio-only sampling policy and runtime guardrails", async () => {
    const resource = getBizBotResourceDefinition("bizbot://debug/mcp-sampling-policy");

    expect(resource).toEqual(expect.objectContaining({
      uri: "bizbot://debug/mcp-sampling-policy",
      ownerId: "developer",
      group: "debug",
      mimeType: "application/json",
    }));

    const sample = await resource!.read() as {
      generatedAt: string;
      intentCatalog: string[];
      samplingEnabledTransports: string[];
      policies: {
        http: { advertiseSampling: boolean; allowTools: boolean };
        stdio: { advertiseSampling: boolean; allowTools: boolean; blockNestedSampling: boolean };
      };
      telemetry: {
        totalAttempts: number;
        deterministicFallbacks: number;
      };
    };

    expect(sample.generatedAt).toEqual(expect.any(String));
    expect(sample.intentCatalog).toContain("developer_devloop_status");
    expect(sample.samplingEnabledTransports).toEqual(["stdio"]);
    expect(sample.policies.http.advertiseSampling).toBe(false);
    expect(sample.policies.stdio.advertiseSampling).toBe(true);
    expect(sample.policies.stdio.allowTools).toBe(false);
    expect(sample.policies.stdio.blockNestedSampling).toBe(true);
    expect(sample.telemetry.totalAttempts).toBe(0);
    expect(sample.telemetry.deterministicFallbacks).toBe(0);
  });
});