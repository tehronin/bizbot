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
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
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
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
      update: mocks.update,
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
      severity: "benign",
      activeRunId: null,
      currentHash: "mcp-hash",
      planning: null,
    },
    dependencyContract: {
      state: "aligned",
      severity: "benign",
      runId: null,
      currentHash: "dep-hash",
      planning: null,
    },
    fileTopologyContract: {
      state: "aligned",
      severity: "benign",
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
    mocks.findUnique.mockResolvedValue(null);
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.update.mockResolvedValue(null);
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

  it("does not create actionable cards for first-run pending capture states", async () => {
    mocks.getBuilderProjectOverview.mockResolvedValue(createOverview({
      mcpSnapshot: {
        state: "pending_capture",
        severity: "baseline",
        activeRunId: null,
        currentHash: "mcp-hash",
        planning: {
          summary: "MCP baseline will be captured automatically.",
          recommendations: ["automatic baseline capture"],
        },
      },
      dependencyContract: {
        state: "pending_capture",
        severity: "baseline",
        runId: "run-1",
        currentHash: "dep-hash",
        planning: {
          summary: "Dependency baseline missing.",
          recommendations: ["capture dependency baseline"],
        },
      },
      fileTopologyContract: {
        state: "pending_capture",
        severity: "baseline",
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
      title: "Builder is making changes",
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

  it("projects task execution details from the latest run metadata", async () => {
    mocks.listBuilderProjects.mockResolvedValue([{
      id: "project-1",
      archivedAt: null,
    }]);
    mocks.getBuilderProjectOverview.mockResolvedValue(createOverview({
      currentTask: {
        id: "task-1",
        status: "RUNNING",
        title: "Repair failing verification",
        summary: "Investigate the failed build step.",
        description: "Investigate the failed build step.",
        stage: "TESTING",
        updatedAt: new Date("2026-04-17T12:00:00.000Z"),
        metadata: {
          currentIteration: 2,
          loopPhase: "verifying",
          latestLoopSummary: "Re-running build after edits.",
        },
      },
      runs: [{
        id: "run-1",
        kind: "ORCHESTRATION",
        taskId: "task-1",
        status: "RUNNING",
        stdout: "[status] running\n",
        stderr: "Build failed: cannot resolve module\n at src/app/page.tsx:10\n",
        metadata: {
          loop: {
            iterations: [{
              changedFiles: ["src/app/page.tsx", "src/lib/builder/interactions.ts"],
              verification: {
                passed: false,
                skipped: false,
                summary: "build failed during verification.",
                scripts: ["build", "test"],
                steps: [{
                  script: "build",
                  ok: false,
                  stderr: "Build failed: cannot resolve module",
                  stdout: "",
                }],
              },
            }],
          },
        },
      }],
    }));
    mocks.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const cards = await listPendingBuilderInteractionCards();

    expect(cards[0]).toMatchObject({
      kind: "task_execution",
      badges: ["verification: failed", "2 files changed"],
      details: {
        taskExecution: {
          changedFiles: ["src/app/page.tsx", "src/lib/builder/interactions.ts"],
          verificationStatus: "failed",
          verificationSummary: "build failed during verification.",
          verificationScripts: ["build", "test"],
          failingScript: "build",
          excerptLabel: "stderr excerpt",
        },
      },
    });
    expect(cards[0]?.details?.taskExecution?.latestExcerpt).toContain("cannot resolve module");
  });

  it("projects structured dependency drift details onto cards", async () => {
    mocks.getBuilderProjectOverview.mockResolvedValue(createOverview({
      dependencyContract: {
        state: "drifted",
        severity: "notable",
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
          severity: "notable",
          reasons: ["Direct dependency additions may change the project runtime or toolchain surface."],
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

    expect(cards[0]).toMatchObject({
      kind: "preflight_review",
      severity: "notable",
      badges: ["severity: notable", "1 preflight surface"],
      details: {
        preflightReview: {
          surfaces: [{
            id: "dependency",
            label: "Packages and scripts",
            severity: "notable",
          }],
        },
        dependencyDrift: {
          severity: "notable",
          reasons: ["Direct dependency additions may change the project runtime or toolchain surface."],
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
      },
    });
  });

  it("collapses multiple drift interactions into a single combined preflight review card", async () => {
    mocks.getBuilderProjectOverview.mockResolvedValue(createOverview({
      mcpSnapshot: {
        state: "drifted",
        severity: "notable",
        activeRunId: "run-1",
        currentHash: "mcp-hash",
        planning: {
          summary: "MCP contract drift exists between accepted snapshot sequence 4 and the live contract.",
          recommendations: ["review MCP additions"],
        },
        drift: {
          previousHash: "old-mcp",
          currentHash: "mcp-hash",
          changed: true,
          severity: "notable",
          tools: { added: ["builder_write_file"], removed: [], changed: [] },
          prompts: { added: [], removed: [], changed: [] },
          resources: { added: [], removed: [], changed: [] },
          profileChanged: false,
          contractChanged: false,
          impact: {
            classification: "non_breaking",
            requiresVersionBump: false,
            reasons: ["Only additive MCP surface growth was detected."],
            changedSurfaces: ["tools"],
            reviewFiles: [],
          },
        },
      },
      dependencyContract: {
        state: "drifted",
        severity: "breaking",
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
          severity: "breaking",
          reasons: ["Direct dependencies were removed from the accepted baseline."],
          packageManagerChanged: false,
          lockfileChanged: false,
          packages: { added: [], removed: ["zod"], changed: [], reclassified: [] },
          scripts: { added: [], removed: [], changed: [] },
        },
      },
      fileTopologyContract: {
        state: "drifted",
        severity: "notable",
        runId: "run-1",
        currentHash: "topo-hash",
        planning: {
          summary: "File topology drift detected.",
          recommendations: ["review topology changes"],
        },
        drift: {
          previousHash: "old-topo",
          currentHash: "topo-hash",
          changed: true,
          severity: "notable",
          reasons: ["Additional directories were introduced."],
          directories: { added: ["src/features"], removed: [] },
          importantFiles: { added: [], removed: [] },
          anchorsChanged: [],
          classificationsChanged: [],
          rulesChanged: [],
        },
      },
    }));

    const cards = await syncBuilderProjectInteractions("project-1");

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      kind: "preflight_review",
      severity: "breaking",
      badges: ["severity: breaking", "3 preflight surfaces"],
      actions: [
        { id: "approve", label: "continue with these changes" },
        { id: "reject", label: "stop and review first" },
      ],
      details: {
        preflightReview: {
          surfaces: [
            { id: "mcp", severity: "notable" },
            { id: "dependency", severity: "breaking" },
            { id: "file_topology", severity: "notable" },
          ],
        },
      },
    });
    expect(mocks.upsert).toHaveBeenCalledTimes(3);
  });
});