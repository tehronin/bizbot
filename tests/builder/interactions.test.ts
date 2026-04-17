import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBuilderProjectOverview: vi.fn(),
  listBuilderProjects: vi.fn(),
  getBuilderProject: vi.fn(),
  getBuilderTask: vi.fn(),
  getOrCreateConversation: vi.fn(),
  saveMessage: vi.fn(),
  updateConversationExecutionDefaults: vi.fn(),
  launchBuilderTask: vi.fn(),
  recordBuilderProjectCommand: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/builder/orchestrator", () => ({
  getBuilderProjectOverview: mocks.getBuilderProjectOverview,
  launchBuilderTask: mocks.launchBuilderTask,
}));

vi.mock("@/lib/builder/projects", () => ({
  listBuilderProjects: mocks.listBuilderProjects,
  getBuilderProject: mocks.getBuilderProject,
}));

vi.mock("@/lib/builder/tasks", () => ({
  getBuilderTask: mocks.getBuilderTask,
}));

vi.mock("@/lib/agent/memory", () => ({
  getOrCreateConversation: mocks.getOrCreateConversation,
  saveMessage: mocks.saveMessage,
  updateConversationExecutionDefaults: mocks.updateConversationExecutionDefaults,
}));

vi.mock("@/lib/builder/commands", () => ({
  recordBuilderProjectCommand: mocks.recordBuilderProjectCommand,
}));

vi.mock("@/lib/db", () => ({
  db: {
    builderInteraction: {
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
      upsert: mocks.upsert,
    },
  },
}));

import { listPendingBuilderInteractionCards, syncBuilderProjectInteractions } from "@/lib/builder/interactions";

function createOverview(overrides: Record<string, unknown> = {}) {
  return {
    project: {
      id: "project-1",
      name: "Demo",
      relativePath: "projects/demo",
    },
    context: {
      architecture: {
        active: [],
        stale: [],
      },
    },
    currentTask: null,
    tasks: [],
    runs: [],
    mcpSnapshot: {
      state: "aligned",
      activeRunId: null,
      currentHash: "mcp-hash",
      planning: null,
    },
    dependencyContract: {
      state: "aligned",
      runId: null,
      currentHash: "dep-hash",
      planning: null,
    },
    fileTopologyContract: {
      state: "aligned",
      runId: null,
      currentHash: "topo-hash",
      planning: null,
    },
    ...overrides,
  } as never;
}

function createInteraction(args: {
  id: string;
  kind: "MCP_POLICY_RECONCILIATION" | "MCP_CONTRACT_DRIFT" | "DEPENDENCY_CONTRACT_DRIFT" | "FILE_TOPOLOGY_CONTRACT_DRIFT";
  dedupeKey: string;
  runId?: string | null;
  title: string;
  summary: string;
  metadata?: Record<string, unknown>;
  status?: "PENDING" | "APPROVED" | "REJECTED" | "RESOLVED";
}) {
  return {
    id: args.id,
    projectId: "project-1",
    conversationId: null,
    runId: args.runId ?? null,
    kind: args.kind,
    status: args.status ?? "PENDING",
    dedupeKey: args.dedupeKey,
    title: args.title,
    summary: args.summary,
    metadata: args.metadata ?? { state: "drifted", recommendations: [] },
    resolutionReason: null,
    resolvedAt: null,
    createdAt: new Date("2026-04-17T00:00:00.000Z"),
    updatedAt: new Date("2026-04-17T00:00:00.000Z"),
    project: {
      id: "project-1",
      name: "Demo",
      relativePath: "projects/demo",
    },
  };
}

describe("builder interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => createInteraction({
      id: "interaction-1",
      kind: create.kind as "MCP_POLICY_RECONCILIATION" | "MCP_CONTRACT_DRIFT" | "DEPENDENCY_CONTRACT_DRIFT" | "FILE_TOPOLOGY_CONTRACT_DRIFT",
      dedupeKey: String(create.dedupeKey),
      runId: (create.runId as string | null | undefined) ?? null,
      title: String(create.title),
      summary: String(create.summary),
      metadata: create.metadata as Record<string, unknown> | undefined,
    }));
  });

  it("does not create actionable cards for dependency or topology pending capture", async () => {
    mocks.getBuilderProjectOverview.mockResolvedValue(createOverview({
      dependencyContract: {
        state: "pending_capture",
        runId: "run-1",
        currentHash: "dep-hash",
        planning: {
          summary: "Dependency baseline missing.",
          recommendations: ["capture dependency baseline"],
        },
      },
      fileTopologyContract: {
        state: "pending_capture",
        runId: "run-1",
        currentHash: "topo-hash",
        planning: {
          summary: "Topology baseline missing.",
          recommendations: ["capture topology baseline"],
        },
      },
    }));

    const cards = await syncBuilderProjectInteractions("project-1");

    expect(cards).toEqual([]);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("reuses the same drift dedupe key when only the run id changes", async () => {
    mocks.getBuilderProjectOverview
      .mockResolvedValueOnce(createOverview({
        dependencyContract: {
          state: "drifted",
          runId: "run-1",
          currentHash: "dep-hash",
          planning: {
            summary: "Dependency drift detected.",
            recommendations: ["review package changes"],
          },
        },
      }))
      .mockResolvedValueOnce(createOverview({
        dependencyContract: {
          state: "drifted",
          runId: "run-2",
          currentHash: "dep-hash",
          planning: {
            summary: "Dependency drift detected.",
            recommendations: ["review package changes"],
          },
        },
      }));

    await syncBuilderProjectInteractions("project-1");
    await syncBuilderProjectInteractions("project-1");

    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.upsert.mock.calls[0][0].where.dedupeKey).toBe("project-1:dependency:drift:dep-hash");
    expect(mocks.upsert.mock.calls[1][0].where.dedupeKey).toBe("project-1:dependency:drift:dep-hash");
    expect(mocks.upsert.mock.calls[1][0].update.runId).toBe("run-2");
  });

  it("fetches each project overview once during inbox bootstrap", async () => {
    mocks.listBuilderProjects.mockResolvedValue([{
      id: "project-1",
      archivedAt: null,
    }]);
    mocks.getBuilderProjectOverview.mockResolvedValue(createOverview({
      currentTask: {
        id: "task-1",
        status: "RUNNING",
        title: "Implement interaction sync",
        summary: "Refactor sync flow.",
        description: "Refactor sync flow.",
        stage: "IMPLEMENTING",
        updatedAt: new Date("2026-04-17T12:00:00.000Z"),
      },
      runs: [{
        id: "run-1",
        kind: "ORCHESTRATION",
        taskId: "task-1",
        status: "RUNNING",
      }],
    }));
    mocks.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const cards = await listPendingBuilderInteractionCards();

    expect(mocks.getBuilderProjectOverview).toHaveBeenCalledTimes(1);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      kind: "task_execution",
      runId: "run-1",
      taskId: "task-1",
      title: "Implement interaction sync",
    });
  });

  it("adds task progress from existing task metadata", async () => {
    mocks.listBuilderProjects.mockResolvedValue([{
      id: "project-1",
      archivedAt: null,
    }]);
    mocks.getBuilderProjectOverview.mockResolvedValue(createOverview({
      currentTask: {
        id: "task-1",
        status: "RUNNING",
        title: "Repair builder loop",
        summary: "Repair the failing verification step.",
        description: "Repair the failing verification step.",
        stage: "TESTING",
        updatedAt: new Date("2026-04-17T12:00:00.000Z"),
        metadata: {
          currentIteration: 2,
          maxIterations: null,
          loopPhase: "verifying",
          latestLoopSummary: "Re-running tests after repair.",
        },
      },
      runs: [{
        id: "run-1",
        kind: "ORCHESTRATION",
        taskId: "task-1",
        status: "RUNNING",
      }],
    }));
    mocks.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const cards = await listPendingBuilderInteractionCards();

    expect(cards[0]?.progress).toEqual({
      currentIteration: 2,
      maxIterations: null,
      loopPhase: "verifying",
      latestLoopSummary: "Re-running tests after repair.",
    });
  });

  it("projects structured dependency drift details onto cards", async () => {
    mocks.getBuilderProjectOverview.mockResolvedValue(createOverview({
      dependencyContract: {
        state: "drifted",
        runId: "run-1",
        currentHash: "dep-hash",
        planning: {
          summary: "Dependency drift detected.",
          recommendations: ["review package changes"],
        },
        drift: {
          previousHash: "old-hash",
          currentHash: "dep-hash",
          changed: true,
          packageManagerChanged: false,
          lockfileChanged: true,
          packages: {
            added: ["zod"],
            removed: [],
            changed: ["next"],
            reclassified: [],
          },
          scripts: {
            added: ["verify"],
            removed: [],
            changed: [],
          },
        },
      },
    }));

    const cards = await syncBuilderProjectInteractions("project-1");

    expect(cards[0]?.details).toEqual({
      dependencyDrift: {
        packageManagerChanged: false,
        lockfileChanged: true,
        packages: [
          { label: "packages added", items: ["zod"] },
          { label: "packages changed", items: ["next"] },
        ],
        scripts: [
          { label: "scripts added", items: ["verify"] },
        ],
      },
    });
  });
});