import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildBuilderPlanAdherence: vi.fn(),
  composeBuilderTaskPrompt: vi.fn(() => "task prompt"),
  buildBuilderStructuredReview: vi.fn(),
  validateBuilderContainerStage: vi.fn(),
  completeBuilderRun: vi.fn(),
  createBuilderRun: vi.fn(),
  createBuilderTask: vi.fn(),
  ensureBuilderRunMcpSnapshotPreflight: vi.fn(),
  ensureBuilderRunFileTopologySnapshotPreflight: vi.fn(),
  executeNativeBuilderTask: vi.fn(),
  findExecutionTaskForTaskSpec: vi.fn(),
  getLatestBuilderMcpSnapshotForRun: vi.fn(),
  getBuilderMcpSnapshotOverview: vi.fn(),
  getBuilderProject: vi.fn(),
  getBuilderPlanningSnapshot: vi.fn(),
  getBuilderTask: vi.fn(),
  getBuilderTaskSpec: vi.fn(),
  loadBuilderProjectContext: vi.fn(),
  recomputeBuilderPlanningProgress: vi.fn(),
  selectNextRunnableTaskSpec: vi.fn(),
  setBuilderTaskSpecStatus: vi.fn(),
  queueBuilderMcpSnapshotCleanup: vi.fn(),
  updateBuilderProject: vi.fn(),
  updateBuilderTask: vi.fn(),
  updateBuilderTaskExecutionState: vi.fn(),
  updateBuilderTaskStage: vi.fn(),
  updateBuilderRun: vi.fn(),
}));

vi.mock("@/lib/builder/context", () => ({
  loadBuilderProjectContext: mocks.loadBuilderProjectContext,
  selectRelevantInstructionFragments: vi.fn(() => []),
  syncBuilderProjectProjection: vi.fn(),
}));

vi.mock("@/lib/builder/native-agent", () => ({
  executeNativeBuilderTask: mocks.executeNativeBuilderTask,
}));

vi.mock("@/lib/builder/planning", () => ({
  findExecutionTaskForTaskSpec: mocks.findExecutionTaskForTaskSpec,
  generateBuilderProjectPlan: vi.fn(),
  getBuilderProjectBrief: vi.fn(),
  getBuilderPlanningSnapshot: mocks.getBuilderPlanningSnapshot,
  getBuilderTaskSpec: mocks.getBuilderTaskSpec,
  recomputeBuilderPlanningProgress: mocks.recomputeBuilderPlanningProgress,
  selectNextRunnableTaskSpec: mocks.selectNextRunnableTaskSpec,
  setBuilderTaskSpecStatus: mocks.setBuilderTaskSpecStatus,
  upsertBuilderProjectBrief: vi.fn(),
  defaultTaskSpecValidators: () => ["MANUAL_REVIEW"],
}));

vi.mock("@/lib/builder/projects", () => ({
  completeBuilderRun: mocks.completeBuilderRun,
  createBuilderRun: mocks.createBuilderRun,
  getBuilderProject: mocks.getBuilderProject,
  listBuilderRuns: vi.fn(),
  updateBuilderProject: mocks.updateBuilderProject,
  updateBuilderRun: mocks.updateBuilderRun,
}));

vi.mock("@/lib/builder/prompt", () => ({
  buildBuilderPlanAdherence: mocks.buildBuilderPlanAdherence,
  composeBuilderTaskPrompt: mocks.composeBuilderTaskPrompt,
  inferBuilderTaskExecutionMode: vi.fn(() => "implementation"),
}));

vi.mock("@/lib/builder/mcp-snapshots", () => ({
  ensureBuilderRunMcpSnapshotPreflight: mocks.ensureBuilderRunMcpSnapshotPreflight,
  getLatestBuilderMcpSnapshotForRun: mocks.getLatestBuilderMcpSnapshotForRun,
  getBuilderMcpSnapshotOverview: mocks.getBuilderMcpSnapshotOverview,
  queueBuilderMcpSnapshotCleanup: mocks.queueBuilderMcpSnapshotCleanup,
  selectRelevantBuilderMcpContext: vi.fn(() => ({
    currentHash: "hash-1",
    tools: [{ name: "builder_get_project", title: "Get Builder Project", description: "Read the current Builder project.", ownerId: "builder", ownerKind: "builtin-plugin", annotations: null, parameters: null }],
    prompts: [],
    resources: [],
    reasons: ["mode:analysis_only"],
  })),
}));

vi.mock("@/lib/builder/file-topology-snapshots", () => ({
  ensureBuilderRunFileTopologySnapshotPreflight: mocks.ensureBuilderRunFileTopologySnapshotPreflight,
  selectRelevantBuilderFileTopologyContext: vi.fn(() => ({
    currentHash: "topology-hash-1",
    roots: ["src", "tests", ".builder"],
    anchors: {
      appRoot: "src/app",
      libRoot: "src/lib",
      componentsRoot: null,
      testsRoot: "tests",
      scriptsRoot: null,
      prismaRoot: null,
      tauriRoot: null,
      builderProjectionRoot: ".builder",
    },
    placementGuidance: ["Route files belong under src/app."],
    reasons: ["mode:analysis_only"],
  })),
}));

vi.mock("@/lib/mcp/client", () => ({
  ensureMcpClientsInitialized: vi.fn(async () => undefined),
}));

vi.mock("@/lib/builder/review", () => ({
  buildBuilderStructuredReview: mocks.buildBuilderStructuredReview,
}));

vi.mock("@/lib/builder/container-stage", () => ({
  validateBuilderContainerStage: mocks.validateBuilderContainerStage,
}));

vi.mock("@/lib/builder/session", () => ({
  registerBuilderRunController: vi.fn(),
  unregisterBuilderRunController: vi.fn(),
}));

vi.mock("@/lib/builder/tasks", () => ({
  createBuilderTask: mocks.createBuilderTask,
  getBuilderTask: mocks.getBuilderTask,
  listBuilderTasks: vi.fn(() => []),
  reconcileBuilderRunWithTask: vi.fn((run) => run),
  resolveBuilderContinuationTask: vi.fn(),
  resumeBuilderTask: vi.fn(),
  updateBuilderTask: mocks.updateBuilderTask,
  updateBuilderTaskExecutionState: mocks.updateBuilderTaskExecutionState,
  updateBuilderTaskStage: mocks.updateBuilderTaskStage,
}));

vi.mock("@/lib/db", () => ({
  db: {
    builderRun: {
      findUniqueOrThrow: vi.fn(),
    },
  },
}));

import { orchestrateBuilderTask } from "@/lib/builder/orchestrator";

describe("builder orchestrator finalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const project = {
      id: "project-1",
      name: "Plugin Package Sweep",
      slug: "plugin-package-sweep",
      relativePath: "projects/plugin-package-sweep",
      template: "plugin-package",
      packageManager: "NPM",
      gitInitialized: false,
      lifecycle: "ACTIVE",
      lastRunStatus: "IDLE",
      context: { architecture: { active: [], stale: [] } },
      latestSessionSummary: null,
    };
    const originalTaskSpec = {
      id: "task-spec-original",
      milestoneId: "milestone-1",
      title: "Capture runtime and scope decisions",
      summary: "Confirm the runtime boundary and concrete utility export.",
      status: "ACTIVE",
      sortOrder: 1,
      completionCriteria: ["Identify the requested deliverables and runtime boundary."],
      validators: ["MANUAL_REVIEW"],
      architecturalDecisionKeys: [],
      dependencyIds: [],
    };
    const replacementTaskSpec = {
      ...originalTaskSpec,
      id: "task-spec-replacement",
    };
    const activePlanning = {
      lifecycle: "ACTIVE",
      brief: {
        id: "brief-1",
        projectId: "project-1",
        title: "Plugin package verifier sweep",
        summary: "Evolve the scaffold into a minimal utility plugin.",
        goals: [],
        constraints: [],
        deliverables: [],
        notes: null,
      },
      milestones: [{
        id: "milestone-1",
        title: "Confirm implementation contract",
        summary: "Translate the brief into concrete runtime requirements.",
        status: "ACTIVE",
        sortOrder: 1,
        taskSpecs: [originalTaskSpec],
      }],
      currentMilestone: {
        id: "milestone-1",
        title: "Confirm implementation contract",
        summary: "Translate the brief into concrete runtime requirements.",
        status: "ACTIVE",
        sortOrder: 1,
        taskSpecs: [originalTaskSpec],
      },
      currentTaskSpec: originalTaskSpec,
    };
    const replannedSnapshot = {
      ...activePlanning,
      milestones: [{
        id: "milestone-1",
        title: "Confirm implementation contract",
        summary: "Translate the brief into concrete runtime requirements.",
        status: "ACTIVE",
        sortOrder: 1,
        taskSpecs: [replacementTaskSpec],
      }],
      currentMilestone: {
        id: "milestone-1",
        title: "Confirm implementation contract",
        summary: "Translate the brief into concrete runtime requirements.",
        status: "ACTIVE",
        sortOrder: 1,
        taskSpecs: [replacementTaskSpec],
      },
      currentTaskSpec: replacementTaskSpec,
    };
    const completedPlanning = {
      ...replannedSnapshot,
      lifecycle: "ACTIVE",
      milestones: [{
        id: "milestone-1",
        title: "Confirm implementation contract",
        summary: "Translate the brief into concrete runtime requirements.",
        status: "COMPLETE",
        sortOrder: 1,
        taskSpecs: [{ ...replacementTaskSpec, status: "COMPLETE" }],
      }],
      currentMilestone: null,
      currentTaskSpec: null,
    };
    const task = {
      id: "task-1",
      projectId: "project-1",
      taskSpecId: "task-spec-original",
      title: originalTaskSpec.title,
      description: originalTaskSpec.summary,
      status: "RUNNING",
      stage: "IMPLEMENTING",
      acceptanceCriteria: originalTaskSpec.completionCriteria,
      summary: null,
      parentTaskId: null,
      metadata: null,
      createdAt: new Date("2026-04-04T00:00:00.000Z"),
      updatedAt: new Date("2026-04-04T00:00:00.000Z"),
    };
    const run = {
      id: "run-1",
      projectId: "project-1",
      taskId: "task-1",
      kind: "ORCHESTRATION",
      title: "Builder task: Capture runtime and scope decisions",
      command: "builder-orchestrator",
      args: null,
      status: "RUNNING",
      stdout: null,
      stderr: null,
      summary: null,
      metadata: null,
      startedAt: new Date("2026-04-04T00:00:00.000Z"),
      finishedAt: null,
      createdAt: new Date("2026-04-04T00:00:00.000Z"),
      updatedAt: new Date("2026-04-04T00:00:00.000Z"),
    };
    const review = {
      taskId: "task-1",
      projectId: "project-1",
      status: "SUCCEEDED",
      stage: "DONE",
      summary: "Captured runtime and scope decisions.",
      filesChanged: [],
      commandsExecuted: [],
      validation: {
        passed: true,
        skipped: true,
        summary: "Verification skipped because the task only requires manual_review.",
        scripts: [],
      },
      tests: { passed: null, exitCode: null, summary: null },
      lint: { passed: null, exitCode: null, summary: null },
      build: { passed: null, exitCode: null, summary: null },
      risks: [],
      nextSteps: ["Advance the next runnable task spec."],
      updatedAt: "2026-04-04T00:00:00.000Z",
    };

    mocks.getBuilderProject.mockResolvedValue(project);
    mocks.getBuilderPlanningSnapshot.mockResolvedValue(activePlanning);
    mocks.selectNextRunnableTaskSpec.mockResolvedValue(originalTaskSpec);
    mocks.findExecutionTaskForTaskSpec.mockResolvedValue(null);
    mocks.createBuilderTask.mockResolvedValue(task);
    mocks.getBuilderTask.mockResolvedValue(task);
    mocks.createBuilderRun.mockResolvedValue(run);
    mocks.updateBuilderTaskStage.mockResolvedValue(task);
    mocks.updateBuilderTaskExecutionState.mockResolvedValue(task);
    mocks.loadBuilderProjectContext.mockReturnValue({
      context: { architecture: { active: [], stale: [] } },
      projection: { stale: false, statePathExists: false },
    });
    mocks.ensureBuilderRunMcpSnapshotPreflight.mockResolvedValue({
      status: "captured",
      snapshot: { id: "snapshot-1", snapshotSequence: 1 },
      drift: { changed: false },
    });
    mocks.ensureBuilderRunFileTopologySnapshotPreflight.mockResolvedValue({
      status: "captured",
      snapshot: { expectedHash: "topology-hash-1" },
      drift: { changed: false },
    });
    mocks.getLatestBuilderMcpSnapshotForRun.mockResolvedValue({
      id: "snapshot-1",
      snapshotSequence: 1,
    });
    mocks.queueBuilderMcpSnapshotCleanup.mockResolvedValue(undefined);
    mocks.getBuilderMcpSnapshotOverview.mockResolvedValue({
      activeRunId: "run-1",
      currentSequence: 1,
      currentHash: "hash-1",
      state: "captured",
      history: [],
      drift: null,
    });
    mocks.buildBuilderPlanAdherence.mockReturnValue({
      allowsExecution: true,
      mode: "implementation",
      summary: "manual review",
      blockingIssues: [],
      requiredDecisionKeys: [],
      staleDecisionKeys: [],
      reconfirmedStaleKeys: [],
      directives: [],
    });
    mocks.executeNativeBuilderTask.mockResolvedValue({
      result: {
        ok: true,
        command: "builder-operator",
        args: [],
        cwd: "projects/plugin-package-sweep",
        exitCode: 0,
        signal: null,
        stdout: "captured decisions",
        stderr: "",
        timedOut: false,
      },
      loop: {
        finalVerdict: "complete",
        phase: "reviewing",
        verified: false,
        verificationSkipped: true,
        iterations: [],
        maxIterations: 3,
      },
    });
    mocks.validateBuilderContainerStage.mockResolvedValue({
      available: true,
      status: "passed",
      summary: "Container stage passed for app.",
      composeFile: "compose.yml",
      serviceId: "compose:compose.yml:app",
      serviceName: "app",
      workingDirectory: "/workspace",
      containerId: "container-1",
      startedService: true,
      stoppedService: true,
      fileChecks: [],
      scriptChecks: [],
      logsPreview: null,
      auditPaths: [],
    });
    mocks.buildBuilderStructuredReview.mockReturnValue(review);
    mocks.getBuilderTaskSpec.mockRejectedValueOnce(new Error("Builder task spec not found: task-spec-original"));
    mocks.recomputeBuilderPlanningProgress.mockResolvedValue(replannedSnapshot);
    mocks.updateBuilderTask.mockImplementation(async (_taskId: string, input: Record<string, unknown>) => ({
      ...task,
      ...input,
      updatedAt: new Date("2026-04-04T00:00:01.000Z"),
    }));
    mocks.setBuilderTaskSpecStatus
      .mockResolvedValueOnce(activePlanning)
      .mockResolvedValueOnce(completedPlanning);
    mocks.updateBuilderProject.mockImplementation(async (_projectId: string, input: Record<string, unknown>) => ({
      ...project,
      ...input,
      updatedAt: new Date("2026-04-04T00:00:02.000Z"),
    }));
    mocks.completeBuilderRun.mockImplementation(async (_runId: string, input: Record<string, unknown>) => ({
      ...run,
      ...input,
      finishedAt: new Date("2026-04-04T00:00:03.000Z"),
      updatedAt: new Date("2026-04-04T00:00:03.000Z"),
    }));
    mocks.updateBuilderRun.mockResolvedValue(run);
  });

  it("re-links finalization to the replacement task spec after in-task replanning", async () => {
    await orchestrateBuilderTask("project-1", {
      request: "Advance the next runnable Builder task for this plugin-package project.",
    });

    expect(mocks.ensureBuilderRunMcpSnapshotPreflight).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      runId: "run-1",
      taskId: "task-1",
      taskSpecId: "task-spec-original",
    }));
    expect(mocks.composeBuilderTaskPrompt).toHaveBeenCalledWith(expect.objectContaining({
      mcpContext: expect.objectContaining({ currentHash: "hash-1" }),
    }));
    expect(mocks.updateBuilderTask).toHaveBeenCalledWith("task-1", expect.objectContaining({
      status: "SUCCEEDED",
      taskSpecId: "task-spec-replacement",
    }));
    expect(mocks.setBuilderTaskSpecStatus).toHaveBeenLastCalledWith("project-1", "task-spec-replacement", "COMPLETE");
    expect(mocks.completeBuilderRun).toHaveBeenCalledWith("run-1", expect.objectContaining({
      metadata: expect.objectContaining({
        taskSpecId: "task-spec-replacement",
      }),
    }));
    expect(mocks.validateBuilderContainerStage).toHaveBeenCalledWith(expect.objectContaining({
      project: expect.objectContaining({ id: "project-1" }),
    }));
  });

  it("aborts before native execution when MCP contract drift is detected", async () => {
    mocks.ensureBuilderRunMcpSnapshotPreflight.mockRejectedValueOnce(new Error("Builder MCP contract drift detected for run run-1; operator approval is required before task execution can continue."));

    await expect(orchestrateBuilderTask("project-1", {
      request: "Advance the next runnable Builder task for this plugin-package project.",
    })).rejects.toThrow("operator approval is required before task execution can continue");

    expect(mocks.executeNativeBuilderTask).not.toHaveBeenCalled();
  });
});