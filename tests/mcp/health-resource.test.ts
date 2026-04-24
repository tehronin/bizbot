import { describe, expect, it } from "vitest";
import { getBizBotResourceDefinition } from "@/lib/mcp/preview-catalog";

function resetBullMqState() {
  const globals = globalThis as typeof globalThis & {
    bizbotBullMqConnection?: { disconnect: () => void };
    bizbotMcpQueues?: object;
    bizbotAgentHeartbeatQueue?: object;
  };

  globals.bizbotBullMqConnection?.disconnect();
  delete globals.bizbotBullMqConnection;
  delete globals.bizbotMcpQueues;
  delete globals.bizbotAgentHeartbeatQueue;
}

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
      localStdio: { sessionsStarted: number; toolCallCount: number; available: boolean };
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
    expect(sample.localStdio).toEqual(expect.objectContaining({
      available: expect.any(Boolean),
      sessionsStarted: expect.any(Number),
      toolCallCount: expect.any(Number),
    }));
    expect(sample.sampling.toolCount).toBeGreaterThan(0);
    expect(sample.sampling.toolNames).toContain("developer_list_agent_runs");
    expect(sample.queues.activeQueueNames).toEqual(expect.arrayContaining([
      expect.any(String),
    ]));
  });

  it("degrades cleanly when Redis is unavailable", async () => {
    const originalRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = "redis://127.0.0.1:6390";
    resetBullMqState();

    try {
      const resource = getBizBotResourceDefinition("bizbot://debug/mcp-health");
      const sample = await resource!.read() as {
        status: string;
        queues: { pendingJobs: number; failedJobs: number; activeQueueNames: string[] };
        trace: { persistence: { version: number } };
      };

      expect(sample.status).toEqual(expect.any(String));
      expect(sample.queues.pendingJobs).toBe(0);
      expect(sample.queues.failedJobs).toBe(0);
      expect(sample.queues.activeQueueNames).toEqual(expect.arrayContaining([
        expect.any(String),
      ]));
      expect(sample.trace.persistence.version).toBe(1);
    } finally {
      if (originalRedisUrl === undefined) {
        delete process.env.REDIS_URL;
      } else {
        process.env.REDIS_URL = originalRedisUrl;
      }
      resetBullMqState();
    }
  });
});
