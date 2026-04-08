import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBuilderRun: vi.fn(),
  updateBuilderRun: vi.fn(),
  completeBuilderRun: vi.fn(),
  cancelBuilderRunController: vi.fn(),
  updateBuilderTask: vi.fn(),
}));

vi.mock("@/lib/builder/session", () => ({
  cancelBuilderRunController: mocks.cancelBuilderRunController,
  registerBuilderRunController: vi.fn(),
  unregisterBuilderRunController: vi.fn(),
}));

vi.mock("@/lib/builder/projects", async () => {
  const actual = await vi.importActual<object>("@/lib/builder/projects");
  return {
    ...actual,
    getBuilderRun: mocks.getBuilderRun,
    updateBuilderRun: mocks.updateBuilderRun,
    completeBuilderRun: mocks.completeBuilderRun,
    createBuilderRun: vi.fn(),
    updateBuilderProject: vi.fn(),
  };
});

vi.mock("@/lib/builder/tasks", async () => {
  const actual = await vi.importActual<object>("@/lib/builder/tasks");
  return {
    ...actual,
    updateBuilderTask: mocks.updateBuilderTask,
  };
});

vi.mock("@/lib/builder/adapters/git", () => ({ gitInitRepository: vi.fn() }));
vi.mock("@/lib/builder/agentic", () => ({ buildBuilderAgenticExecution: vi.fn(), executeBuilderAgenticTask: vi.fn() }));
vi.mock("@/lib/builder/adapters/npm", () => ({ npmInstall: vi.fn(), npmRunScript: vi.fn() }));
vi.mock("@/lib/builder/adapters/pnpm", () => ({ pnpmInstall: vi.fn(), pnpmRunScript: vi.fn() }));
vi.mock("@/lib/builder/adapters/npx", () => ({ runNpxPackage: vi.fn() }));

import { cancelBuilderProjectRun } from "@/lib/builder/command-cancel";

describe("builder command cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reconciles a running run to CANCELLED when the live controller is missing", async () => {
    mocks.cancelBuilderRunController.mockReturnValue(false);
    mocks.getBuilderRun.mockResolvedValue({
      id: "run-1",
      status: "RUNNING",
      taskId: "task-1",
      metadata: { loop: { phase: "acting" } },
    });
    mocks.completeBuilderRun.mockResolvedValue({ id: "run-1", status: "CANCELLED" });
    mocks.updateBuilderTask.mockResolvedValue({ id: "task-1", status: "CANCELLED" });

    const result = await cancelBuilderProjectRun("run-1");

    expect(result).toEqual({ runId: "run-1", status: "CANCELLED" });
    expect(mocks.completeBuilderRun).toHaveBeenCalledWith("run-1", expect.objectContaining({
      status: "CANCELLED",
      summary: expect.stringContaining("no longer attached"),
    }));
    expect(mocks.updateBuilderTask).toHaveBeenCalledWith("task-1", expect.objectContaining({ status: "CANCELLED" }));
  });

  it("returns NOT_RUNNING when the run is already terminal", async () => {
    mocks.cancelBuilderRunController.mockReturnValue(false);
    mocks.getBuilderRun.mockResolvedValue({
      id: "run-1",
      status: "FAILED",
      taskId: "task-1",
      metadata: null,
    });

    const result = await cancelBuilderProjectRun("run-1");

    expect(result).toEqual({ runId: "run-1", status: "NOT_RUNNING" });
    expect(mocks.completeBuilderRun).not.toHaveBeenCalled();
  });
});