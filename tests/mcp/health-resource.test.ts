import { describe, expect, it } from "vitest";
import { getBizBotResourceDefinition } from "@/lib/mcp/preview-catalog";

describe("MCP health resource", () => {
  it("exposes a one-shot MCP health snapshot", async () => {
    const resource = getBizBotResourceDefinition("bizbot://debug/mcp-health");

    expect(resource).toEqual(expect.objectContaining({
      uri: "bizbot://debug/mcp-health",
      ownerId: "developer",
      group: "debug",
      mimeType: "application/json",
    }));

    const sample = await resource!.read() as {
      generatedAt: string;
      status: string;
      summary: string;
      trace: { persistence: { path: string; version: number; limit: number } };
      sampling: { toolCount: number; toolNames: string[] };
      queues: { activeQueueNames: string[] };
    };

    expect(sample.generatedAt).toEqual(expect.any(String));
    expect(sample.status).toEqual(expect.any(String));
    expect(sample.summary).toEqual(expect.any(String));
    expect(sample.trace.persistence).toEqual(expect.objectContaining({
      path: expect.any(String),
      version: 1,
      limit: 250,
    }));
    expect(sample.trace.recentFailures.every((entry) => entry.failure === null || typeof entry.failure.kind === "string")).toBe(true);
    expect(sample.sampling.toolCount).toBeGreaterThan(0);
    expect(sample.sampling.toolNames).toContain("developer_list_agent_runs");
    expect(sample.queues.activeQueueNames).toEqual(expect.arrayContaining([
      expect.any(String),
    ]));
  });
});
