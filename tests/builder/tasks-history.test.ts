import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  task: null as Record<string, unknown> | null,
  runs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/db", () => ({
  db: {
    builderTask: {
      findUnique: async ({ where }: { where: { id: string } }) => state.task?.id === where.id ? state.task : null,
    },
    builderRun: {
      findMany: async () => [...state.runs],
    },
  },
}));

import { getBuilderTaskHistory } from "@/lib/builder/tasks";

describe("builder task history", () => {
  it("reconciles a stale running builderRun when the paired task already finished", async () => {
    const updatedAt = new Date("2026-04-04T17:05:00.000Z");
    state.task = {
      id: "task-1",
      projectId: "project-1",
      taskSpecId: "task-spec-1",
      title: "Capture runtime and endpoint decisions",
      description: "Capture the API contract.",
      status: "SUCCEEDED",
      stage: "DONE",
      summary: "Captured the runtime and endpoint decisions.",
      metadata: {
        lastRunId: "run-1",
      },
      updatedAt,
    };
    state.runs = [{
      id: "run-1",
      taskId: "task-1",
      projectId: "project-1",
      status: "RUNNING",
      summary: "Native builder attempt 1 is running.",
      stdout: null,
      stderr: null,
      startedAt: new Date("2026-04-04T17:00:00.000Z"),
      finishedAt: null,
      metadata: null,
    }];

    const history = await getBuilderTaskHistory("task-1");

    expect(history).toHaveLength(1);
    expect(history[0]?.status).toBe("SUCCEEDED");
    expect(history[0]?.summary).toBe("Captured the runtime and endpoint decisions.");
    expect(history[0]?.finishedAt).toEqual(updatedAt);
  });
});