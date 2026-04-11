import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBuilderProject: vi.fn(),
  getBuilderProjectRecord: vi.fn(),
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
  validateBuilderProjectEnv: vi.fn(),
  buildBuilderOperatorTrustState: vi.fn(),
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
  getBuilderProjectRecord: mocks.getBuilderProjectRecord,
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

vi.mock("@/lib/builder/environment", () => ({
  validateBuilderProjectEnv: mocks.validateBuilderProjectEnv,
}));

vi.mock("@/lib/builder/operator-trust", () => ({
  buildBuilderOperatorTrustState: mocks.buildBuilderOperatorTrustState,
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
    mocks.getBuilderProjectRecord.mockResolvedValue({
      id: "project-1",
      name: "Demo",
      slug: "demo",
      relativePath: "projects/demo",
      template: "node-cli",
      packageManager: "NPM",
      gitInitialized: false,
      lifecycle: "PLANNED",
      lastRunStatus: "IDLE",
      workspaceState: "present",
      latestSessionSummary: null,
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
    mocks.validateBuilderProjectEnv.mockReturnValue({
      schemaPath: ".env.example",
      schemaAvailable: true,
      projectReady: true,
      executionReady: true,
      totalRequiredKeys: 2,
      missingProjectKeys: [],
      missingExecutionKeys: [],
      malformedEntries: [],
      keys: [],
      summary: "Config ready with 2 required env keys.",
    });
    mocks.buildBuilderOperatorTrustState.mockResolvedValue({
      generatedAt: "2025-01-01T00:00:00.000Z",
      overallStatus: "trusted",
      summary: "Operator trust is trusted across config, runtime, review, and approval surfaces.",
      review: { status: "trusted", summary: "complete", reviewStatus: "SUCCEEDED", validationPassed: true, riskCount: 0, updatedAt: "2025-01-01T00:00:00.000Z" },
      config: { status: "trusted", summary: "Config ready", schemaAvailable: true, projectReady: true, executionReady: true, missingProjectKeys: [], missingExecutionKeys: [] },
      runtime: { status: "trusted", summary: "Runtime artifacts are aligned.", activeAlertCount: 0, unresolvedAlertCount: 0, autoFixCount: 0, mcpState: "captured", driftDetected: false },
      approvals: { status: "trusted", summary: "No pending human approvals are waiting in the queue.", pendingCount: 0, pendingApprovals: [] },
      governance: { status: "warning", summary: "Approval gates exist.", approvalRequiredCapabilities: ["governance_contracts"] },
      prioritizedBlockers: [],
      trend: {
        direction: "improving",
        basis: "Compared the last 2 finished Builder runs against the previous 2.",
        summary: "Trust is improving: recent run and review results are stronger than the prior window, and retained audit history is clean.",
        warningAuditEvents: 0,
        criticalAuditEvents: 0,
        blockerCount: 0,
        recentWindow: { runCount: 2, successRate: 1, verificationPassRate: 1, averageRiskCount: 0, reviewWarningCount: 0, blockedRunCount: 0 },
        previousWindow: { runCount: 2, successRate: 0.5, verificationPassRate: 0.5, averageRiskCount: 1, reviewWarningCount: 1, blockedRunCount: 1 },
      },
      artifactPaths: { markdown: ".builder/reports/operator-trust.md", json: ".builder/reports/operator-trust.json", latestReview: ".builder/reports/latest-review.md", processArtifacts: ".builder/processes" },
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
    expect(mocks.validateBuilderProjectEnv).toHaveBeenCalledWith("projects/demo");
    expect(mocks.buildBuilderOperatorTrustState).toHaveBeenCalled();
  });
});