import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBuilderProject: vi.fn(),
  getBuilderRun: vi.fn(),
  getBuilderTask: vi.fn(),
}));

vi.mock("@/lib/builder/projects", async () => {
  const actual = await vi.importActual<object>("@/lib/builder/projects");
  return {
    ...actual,
    getBuilderProject: mocks.getBuilderProject,
    getBuilderRun: mocks.getBuilderRun,
  };
});

vi.mock("@/lib/builder/tasks", async () => {
  const actual = await vi.importActual<object>("@/lib/builder/tasks");
  return {
    ...actual,
    getBuilderTask: mocks.getBuilderTask,
  };
});

import {
  startBuilderManagedProcess,
  waitForBuilderManagedProcess,
} from "@/lib/builder/process-registry";

function createTempBuilderWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-builder-processes-"));
}

afterEach(() => {
  delete process.env.BIZBOT_BUILDER_WORKSPACE_PATH;
  delete process.env.BIZBOT_BUILDER_ALLOWED_COMMANDS;
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("builder process registry", () => {
  it("rejects task scopes that do not belong to the requested project", async () => {
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_ALLOWED_COMMANDS = "node";
    mocks.getBuilderTask.mockResolvedValue({ id: "task-1", projectId: "project-2" });

    await expect(startBuilderManagedProcess({
      command: "node",
      args: ["-e", "process.exit(0)"],
      projectId: "project-1",
      taskId: "task-1",
    })).rejects.toThrow("Builder managed process task task-1 does not belong to project project-1.");
  });

  it("normalizes project scope from task and run ownership before process launch", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    process.env.BIZBOT_BUILDER_ALLOWED_COMMANDS = "node";
    mocks.getBuilderTask.mockResolvedValue({ id: "task-1", projectId: "project-1" });
    mocks.getBuilderRun.mockResolvedValue({ id: "run-1", projectId: "project-1", taskId: "task-1" });
    mocks.getBuilderProject.mockResolvedValue({ id: "project-1" });

    const started = await startBuilderManagedProcess({
      command: "node",
      args: ["-e", "console.log('builder-process-ok')"],
      taskId: "task-1",
      runId: "run-1",
      timeoutSeconds: 30,
    });
    const finished = await waitForBuilderManagedProcess({
      processId: started.process.processId,
      timeoutSeconds: 5,
    });

    expect(started.process.projectId).toBe("project-1");
    expect(started.process.taskId).toBe("task-1");
    expect(started.process.runId).toBe("run-1");
    expect(fs.existsSync(path.join(workspaceRoot, started.process.metadataPath))).toBe(true);
    expect(finished.completed).toBe(true);
    expect(["exited", "failed"]).toContain(finished.process.status);
  });
});