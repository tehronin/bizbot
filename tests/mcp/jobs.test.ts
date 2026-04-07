import { beforeEach, describe, expect, it, vi } from "vitest";

const queueAddMock = vi.fn();
const queueConstructorMock = vi.fn();

vi.mock("bullmq", () => ({
  Queue: class MockQueue {
    add = queueAddMock;

    constructor(...args: unknown[]) {
      queueConstructorMock(...args);
    }
  },
}));

vi.mock("@/lib/queue/redis", () => ({
  getBullMqConnection: vi.fn(() => ({ host: "127.0.0.1", port: 6379 })),
}));

describe("mcp jobs", () => {
  beforeEach(() => {
    queueAddMock.mockReset();
    queueConstructorMock.mockClear();
    vi.resetModules();
    delete (globalThis as typeof globalThis & { bizbotMcpQueues?: unknown }).bizbotMcpQueues;

    queueAddMock.mockImplementation(async (_name, _data, options) => ({
      id: options?.jobId,
      name: _name,
      data: _data,
    }));
  });

  it("uses BullMQ-safe deterministic job ids for embedding jobs", async () => {
    const { enqueueMcpEmbeddingJob } = await import("@/lib/mcp/jobs");

    const job = await enqueueMcpEmbeddingJob({
      projectId: "project-123",
      snapshotSequence: 7,
      snapshotId: "snapshot-123",
      reason: "build_complete",
      requestedAt: "2026-04-07T16:56:56.000Z",
      embeddingFormatVersion: "v1",
    });

    expect(queueAddMock).toHaveBeenCalledWith(
      "generate-snapshot-embedding",
      expect.objectContaining({ projectId: "project-123", snapshotSequence: 7 }),
      expect.objectContaining({ jobId: "mcp-embed__project-123__7__v1" }),
    );
    expect(job.id).toBe("mcp-embed__project-123__7__v1");
    expect(job.id).not.toContain(":");
  });

  it("uses BullMQ-safe deterministic job ids for ontology jobs", async () => {
    const { enqueueMcpOntologyJob } = await import("@/lib/mcp/jobs");

    const job = await enqueueMcpOntologyJob({
      projectId: "project-123",
      snapshotSequence: 8,
      snapshotId: "snapshot-123",
      reason: "embedding_complete",
      requestedAt: "2026-04-07T16:56:56.000Z",
    });

    expect(queueAddMock).toHaveBeenCalledWith(
      "maintain-snapshot-ontology",
      expect.objectContaining({ projectId: "project-123", snapshotSequence: 8 }),
      expect.objectContaining({ jobId: "mcp-ontology__project-123__8" }),
    );
    expect(job.id).toBe("mcp-ontology__project-123__8");
    expect(job.id).not.toContain(":");
  });

  it("uses BullMQ-safe deterministic job ids for cleanup jobs", async () => {
    const { enqueueMcpCleanupJob } = await import("@/lib/mcp/jobs");

    const job = await enqueueMcpCleanupJob({
      projectId: "project-123",
      reason: "manual",
      requestedAt: "2026-04-07T16:56:56.000Z",
    });

    expect(queueAddMock).toHaveBeenCalledWith(
      "cleanup-snapshot-artifacts",
      expect.objectContaining({ projectId: "project-123", reason: "manual" }),
      expect.objectContaining({ jobId: "mcp-cleanup__project-123__project" }),
    );
    expect(job.id).toBe("mcp-cleanup__project-123__project");
    expect(job.id).not.toContain(":");
  });
});