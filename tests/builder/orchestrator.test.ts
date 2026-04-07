import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBuilderProject: vi.fn(),
  getBuilderProjectBrief: vi.fn(),
  getBuilderPlanningSnapshot: vi.fn(),
  upsertBuilderProjectBrief: vi.fn(),
  recomputeBuilderPlanningProgress: vi.fn(),
  generateBuilderProjectPlan: vi.fn(),
  listBuilderTasks: vi.fn(),
  listBuilderRuns: vi.fn(),
  getBuilderMcpSnapshotOverview: vi.fn(),
  updateBuilderProject: vi.fn(),
  readBuilderFile: vi.fn(),
  writeBuilderFile: vi.fn(),
}));

vi.mock("@/lib/builder/mcp-snapshots", () => ({
  ensureBuilderRunMcpSnapshotPreflight: vi.fn(),
  getBuilderMcpSnapshotOverview: mocks.getBuilderMcpSnapshotOverview,
  selectRelevantBuilderMcpContext: vi.fn(() => ({ currentHash: "hash-1", tools: [], prompts: [], resources: [], reasons: ["mode:analysis_only"] })),
}));

vi.mock("@/lib/mcp/client", () => ({
  ensureMcpClientsInitialized: vi.fn(async () => undefined),
}));

vi.mock("@/lib/builder/projects", () => ({
  getBuilderProject: mocks.getBuilderProject,
  updateBuilderProject: mocks.updateBuilderProject,
  listBuilderRuns: mocks.listBuilderRuns,
}));

vi.mock("@/lib/builder/planning", () => ({
  getBuilderProjectBrief: mocks.getBuilderProjectBrief,
  getBuilderPlanningSnapshot: mocks.getBuilderPlanningSnapshot,
  upsertBuilderProjectBrief: mocks.upsertBuilderProjectBrief,
  recomputeBuilderPlanningProgress: mocks.recomputeBuilderPlanningProgress,
  generateBuilderProjectPlan: mocks.generateBuilderProjectPlan,
  findExecutionTaskForTaskSpec: vi.fn(),
  getBuilderTaskSpec: vi.fn(),
  selectNextRunnableTaskSpec: vi.fn(),
  setBuilderTaskSpecStatus: vi.fn(),
  defaultTaskSpecValidators: () => ["MANUAL_REVIEW"],
}));

vi.mock("@/lib/builder/tasks", () => ({
  listBuilderTasks: mocks.listBuilderTasks,
}));

vi.mock("@/lib/builder/context", () => ({
  loadBuilderProjectContext: (project: { context?: unknown }) => ({ context: project.context ?? { architecture: { active: [], stale: [] } }, projection: { stale: false, statePathExists: false } }),
  selectRelevantInstructionFragments: vi.fn(() => []),
  syncBuilderProjectProjection: vi.fn(),
}));

vi.mock("@/lib/builder/native-agent", () => ({
  executeNativeBuilderTask: vi.fn(),
}));

vi.mock("@/lib/builder/prompt", () => ({
  composeBuilderTaskPrompt: vi.fn(() => "task prompt"),
}));

vi.mock("@/lib/builder/review", () => ({
  buildBuilderStructuredReview: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {},
}));

import { planBuilderProject } from "@/lib/builder/orchestrator";

describe("builder orchestrator planning", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getBuilderProject.mockResolvedValue({
      id: "project-1",
      name: "Demo",
      slug: "demo",
      relativePath: "projects/demo",
      template: "node-cli",
      packageManager: "NPM",
      lifecycle: "DRAFT",
      lastRunStatus: "IDLE",
      context: {},
    });
    mocks.getBuilderProjectBrief.mockResolvedValue(null);
    mocks.upsertBuilderProjectBrief.mockResolvedValue({
      id: "brief-1",
      projectId: "project-1",
      title: "Builder v3.1",
      summary: "Harden planner and ADR reconciliation.",
      goals: [],
      constraints: [],
      deliverables: [],
      notes: null,
    });
    mocks.getBuilderPlanningSnapshot.mockResolvedValue({
      lifecycle: "DRAFT",
      brief: null,
      milestones: [],
      currentMilestone: null,
      currentTaskSpec: null,
    });
    mocks.generateBuilderProjectPlan.mockResolvedValue({
      planning: {
        lifecycle: "PLANNED",
        brief: {
          id: "brief-1",
          projectId: "project-1",
          title: "Builder v3.1",
          summary: "Harden planner and ADR reconciliation.",
          goals: [],
          constraints: [],
          deliverables: [],
          notes: null,
        },
        milestones: [],
        currentMilestone: null,
        currentTaskSpec: null,
      },
      architecture: {
        active: [{
          key: "planning_schema",
          canonicalKey: "builder:project-1:planning_schema",
          displayName: "planning_schema",
          description: "Planning state remains database-backed.",
          confidence: 0.9,
          status: "active",
          source: "builder_adr",
          updatedAt: "2026-04-04T00:00:00.000Z",
        }],
        stale: [],
      },
      critique: {
        valid: true,
        issues: [],
        normalizedMilestones: [],
        reconciliation: {
          activeKeys: ["planning_schema"],
          staleKeys: [],
          addressedStaleKeys: [],
          missingStaleKeys: [],
          newDecisionKeys: ["planning_schema"],
          retiredDecisionKeys: [],
        },
      },
    });
    mocks.updateBuilderProject.mockImplementation(async (_projectId: string, input: Record<string, unknown>) => ({
      id: "project-1",
      name: "Demo",
      slug: "demo",
      relativePath: "projects/demo",
      template: "node-cli",
      packageManager: "NPM",
      lifecycle: input.lifecycle ?? "PLANNED",
      lastRunStatus: "IDLE",
      context: input.context ?? {},
      latestSessionSummary: input.latestSessionSummary ?? null,
    }));
    mocks.listBuilderTasks.mockResolvedValue([]);
    mocks.listBuilderRuns.mockResolvedValue([]);
    mocks.getBuilderMcpSnapshotOverview.mockResolvedValue({
      activeRunId: null,
      currentSequence: null,
      currentHash: null,
      state: "pending_capture",
      history: [],
      drift: null,
    });
    mocks.recomputeBuilderPlanningProgress.mockResolvedValue({
      lifecycle: "PLANNED",
      brief: {
        id: "brief-1",
        projectId: "project-1",
        title: "Builder v3.1",
        summary: "Harden planner and ADR reconciliation.",
        goals: [],
        constraints: [],
        deliverables: [],
        notes: null,
      },
      milestones: [],
      currentMilestone: null,
      currentTaskSpec: null,
    });
  });

  it("keeps planBuilderProject as the single planning entrypoint and delegates to the hardened planner service", async () => {
    await planBuilderProject("project-1", {
      title: "Builder v3.1",
      summary: "Harden planner and ADR reconciliation.",
      regenerate: true,
    });

    expect(mocks.generateBuilderProjectPlan).toHaveBeenCalledWith(expect.objectContaining({
      project: expect.objectContaining({ id: "project-1" }),
      brief: expect.objectContaining({ title: "Builder v3.1" }),
    }));
    expect(mocks.updateBuilderProject).toHaveBeenCalledWith("project-1", expect.objectContaining({
      context: expect.objectContaining({
        architecture: expect.objectContaining({
          active: expect.arrayContaining([expect.objectContaining({ key: "planning_schema" })]),
        }),
      }),
    }));
  });
});