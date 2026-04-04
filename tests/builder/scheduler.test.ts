import { describe, expect, it } from "vitest";
import { deriveBuilderProjectLifecycle, pickNextRunnableTaskSpecFromSnapshot } from "@/lib/builder/planning";
import type { BuilderPlanningSnapshot, BuilderTaskSpecState } from "@/lib/builder/types";

function taskSpec(overrides: Partial<BuilderTaskSpecState>): BuilderTaskSpecState {
  return {
    id: "task-spec-1",
    milestoneId: "milestone-1",
    title: "Task",
    summary: "Summary",
    status: "PENDING",
    sortOrder: 1,
    completionCriteria: ["Done"],
    validators: ["MANUAL_REVIEW"],
    architecturalDecisionKeys: [],
    dependencyIds: [],
    ...overrides,
  };
}

function snapshot(overrides?: Partial<BuilderPlanningSnapshot>): BuilderPlanningSnapshot {
  return {
    lifecycle: "PLANNED",
    brief: {
      id: "brief-1",
      projectId: "project-1",
      title: "Brief",
      summary: "Summary",
      goals: [],
      constraints: [],
      deliverables: [],
      notes: null,
      createdAt: new Date("2026-04-04T00:00:00.000Z"),
      updatedAt: new Date("2026-04-04T00:00:00.000Z"),
    },
    milestones: [{
      id: "milestone-1",
      title: "Milestone 1",
      summary: "Summary",
      status: "PENDING",
      sortOrder: 1,
      taskSpecs: [taskSpec({ id: "task-spec-1" })],
    }],
    currentMilestone: null,
    currentTaskSpec: null,
    ...overrides,
  };
}

describe("builder scheduler", () => {
  it("gates on incomplete dependencies", () => {
    const result = pickNextRunnableTaskSpecFromSnapshot(snapshot({
      milestones: [{
        id: "milestone-1",
        title: "Milestone 1",
        summary: "Summary",
        status: "PENDING",
        sortOrder: 1,
        taskSpecs: [
          taskSpec({ id: "task-spec-1", status: "COMPLETE" }),
          taskSpec({ id: "task-spec-2", sortOrder: 2, dependencyIds: ["task-spec-missing"] }),
        ],
      }],
    }));

    expect(result).toBeNull();
  });

  it("gates later milestones until the earlier milestone is complete", () => {
    const result = pickNextRunnableTaskSpecFromSnapshot(snapshot({
      milestones: [
        {
          id: "milestone-1",
          title: "Milestone 1",
          summary: "Summary",
          status: "PENDING",
          sortOrder: 1,
          taskSpecs: [taskSpec({ id: "task-spec-1", status: "PENDING" })],
        },
        {
          id: "milestone-2",
          title: "Milestone 2",
          summary: "Summary",
          status: "PENDING",
          sortOrder: 2,
          taskSpecs: [taskSpec({ id: "task-spec-2", milestoneId: "milestone-2" })],
        },
      ],
    }));

    expect(result?.id).toBe("task-spec-1");
  });

  it("excludes task specs with active execution", () => {
    const result = pickNextRunnableTaskSpecFromSnapshot(snapshot(), new Set(["task-spec-1"]));
    expect(result).toBeNull();
  });

  it("returns no runnable task when the next milestone or task is blocked", () => {
    const result = pickNextRunnableTaskSpecFromSnapshot(snapshot({
      milestones: [{
        id: "milestone-1",
        title: "Milestone 1",
        summary: "Summary",
        status: "BLOCKED",
        sortOrder: 1,
        taskSpecs: [taskSpec({ id: "task-spec-1", status: "BLOCKED" })],
      }],
    }));

    expect(result).toBeNull();
  });

  it("transitions the project to complete when every milestone is complete", () => {
    const lifecycle = deriveBuilderProjectLifecycle({
      brief: snapshot().brief,
      milestones: [{
        id: "milestone-1",
        title: "Milestone 1",
        summary: "Summary",
        status: "COMPLETE",
        sortOrder: 1,
        taskSpecs: [taskSpec({ id: "task-spec-1", status: "COMPLETE" })],
      }],
    });

    expect(lifecycle).toBe("COMPLETE");
  });
});