import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  runs: [] as Array<Record<string, unknown>>,
  tasks: [] as Array<Record<string, unknown>>,
}));

const mocks = vi.hoisted(() => ({
  completeBuilderRun: vi.fn(),
  updateBuilderRun: vi.fn(),
  updateBuilderTask: vi.fn(),
  hasBuilderRunController: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    builderRun: {
      findMany: vi.fn(async () => state.runs),
    },
    builderTask: {
      findMany: vi.fn(async () => state.tasks),
    },
  },
}));

vi.mock("@/lib/builder/projects", () => ({
  completeBuilderRun: mocks.completeBuilderRun,
  updateBuilderRun: mocks.updateBuilderRun,
}));

vi.mock("@/lib/builder/tasks", async () => {
  const actual = await vi.importActual<object>("@/lib/builder/tasks");
  return {
    ...actual,
    updateBuilderTask: mocks.updateBuilderTask,
  };
});

vi.mock("@/lib/builder/session", () => ({
  hasBuilderRunController: mocks.hasBuilderRunController,
}));

import { inspectBuilderOperationalState, reconcileBuilderOperationalState } from "@/lib/builder/reconciliation";

describe("builder reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.runs = [];
    state.tasks = [];
    mocks.hasBuilderRunController.mockReturnValue(false);
    mocks.completeBuilderRun.mockResolvedValue(undefined);
    mocks.updateBuilderRun.mockResolvedValue(undefined);
    mocks.updateBuilderTask.mockResolvedValue(undefined);
  });

  it("flags stale running runs and repeated identical failures", () => {
    const now = new Date("2026-04-07T01:00:00.000Z");
    const task = {
      id: "task-1",
      status: "FAILED",
      metadata: { lastRunId: "run-1" },
    };

    const summary = inspectBuilderOperationalState({
      now,
      tasks: [task] as never,
      runs: [
        {
          id: "run-1",
          taskId: "task-1",
          status: "RUNNING",
          startedAt: new Date("2026-04-07T00:00:00.000Z"),
          stdout: "",
          stderr: "",
          metadata: null,
        },
        {
          id: "run-2",
          taskId: "task-1",
          status: "FAILED",
          startedAt: new Date("2026-04-07T00:10:00.000Z"),
          stdout: "",
          stderr: "",
          summary: "build failed",
          metadata: { review: { validation: { summary: "build failed" } } },
        },
        {
          id: "run-3",
          taskId: "task-1",
          status: "FAILED",
          startedAt: new Date("2026-04-07T00:20:00.000Z"),
          stdout: "",
          stderr: "",
          summary: "build failed",
          metadata: { review: { validation: { summary: "build failed" } } },
        },
      ] as never,
    });

    expect(summary.alerts.some((alert) => alert.code === "stale_running_state")).toBe(true);
    expect(summary.alerts.some((alert) => alert.code === "repeated_identical_verification_failure")).toBe(true);
    expect(summary.alerts.find((alert) => alert.code === "repeated_identical_verification_failure")?.failure).toEqual(expect.objectContaining({
      kind: "repeated_failure",
      suggestedNextAction: "inspect_stuck_loop",
    }));
  });

  it("auto-reconciles a stale RUNNING run when the paired task is already terminal", async () => {
    state.tasks = [{
      id: "task-1",
      status: "SUCCEEDED",
      stage: "DONE",
      summary: "Task completed.",
      metadata: { lastRunId: "run-1" },
    }];
    state.runs = [{
      id: "run-1",
      projectId: "project-1",
      taskId: "task-1",
      status: "RUNNING",
      startedAt: new Date("2026-04-07T00:00:00.000Z"),
      stdout: null,
      stderr: null,
      summary: "Still running",
      metadata: null,
    }];

    await reconcileBuilderOperationalState({ projectId: "project-1", now: new Date("2026-04-07T01:00:00.000Z") });

    expect(mocks.completeBuilderRun).toHaveBeenCalledWith("run-1", expect.objectContaining({
      status: "SUCCEEDED",
      summary: "Task completed.",
    }));
  });
});