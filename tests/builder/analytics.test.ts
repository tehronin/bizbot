import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    builderRun: {
      findMany: mocks.findMany,
    },
  },
}));

import { getBuilderStats, summarizeBuilderProjectMetrics } from "@/lib/builder/analytics";

describe("builder analytics", () => {
  it("computes retry and verification rates from run metadata", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "run-1",
        taskId: "task-1",
        status: "SUCCEEDED",
        metadata: {
          loop: {
            iterations: [{ iteration: 1 }, { iteration: 2 }],
            verified: true,
            verificationSkipped: false,
          },
          review: {
            validation: {
              passed: true,
              skipped: false,
            },
          },
        },
      },
      {
        id: "run-2",
        taskId: "task-2",
        status: "FAILED",
        metadata: {
          loop: {
            iterations: [{ iteration: 1 }],
            verified: false,
            verificationSkipped: false,
          },
          review: {
            validation: {
              passed: false,
              skipped: false,
            },
          },
        },
      },
      {
        id: "run-3",
        taskId: "task-1",
        status: "SUCCEEDED",
        metadata: {
          loop: {
            iterations: [{ iteration: 1 }],
            verified: false,
            verificationSkipped: true,
          },
          review: {
            validation: {
              passed: true,
              skipped: true,
            },
          },
        },
      },
    ]);

    const stats = await getBuilderStats("project-1");

    expect(stats.totalRuns).toBe(3);
    expect(stats.totalTasksRun).toBe(2);
    expect(stats.successRate).toBe(0.67);
    expect(stats.verificationPassRate).toBe(0.5);
    expect(stats.retryRate).toBe(0.33);
    expect(stats.avgIterationsPerRun).toBe(1.33);
    expect(stats.avgIterationsPerTask).toBe(2);
  });

  it("summarizes project-level efficiency, promotion, and architecture health", () => {
    const metrics = summarizeBuilderProjectMetrics({
      runs: [
        {
          taskId: "task-1",
          status: "SUCCEEDED",
          metadata: {
            loop: {
              iterations: [{ iteration: 1 }, { iteration: 2 }],
              verified: true,
              verificationSkipped: false,
            },
            review: {
              validation: {
                passed: true,
                skipped: false,
              },
            },
          },
        },
      ] as never,
      tasks: [
        { metadata: { retryCount: 1, currentIteration: 2 } },
        { metadata: { retryCount: 0, currentIteration: 1 } },
      ] as never,
      planning: {
        lifecycle: "ACTIVE",
        brief: null,
        milestones: [
          {
            id: "milestone-1",
            title: "Plan",
            summary: "summary",
            status: "COMPLETE",
            sortOrder: 1,
            taskSpecs: [
              {
                id: "task-spec-1",
                milestoneId: "milestone-1",
                title: "Task 1",
                summary: "summary",
                status: "COMPLETE",
                sortOrder: 1,
                completionCriteria: [],
                validators: [],
                architecturalDecisionKeys: ["planning_schema"],
                dependencyIds: [],
              },
            ],
          },
          {
            id: "milestone-2",
            title: "Implement",
            summary: "summary",
            status: "ACTIVE",
            sortOrder: 2,
            taskSpecs: [
              {
                id: "task-spec-2",
                milestoneId: "milestone-2",
                title: "Task 2",
                summary: "summary",
                status: "BLOCKED",
                sortOrder: 1,
                completionCriteria: [],
                validators: [],
                architecturalDecisionKeys: ["runtime_boundary"],
                dependencyIds: [],
              },
            ],
          },
        ],
        currentMilestone: null,
        currentTaskSpec: {
          id: "task-spec-2",
          milestoneId: "milestone-2",
          title: "Task 2",
          summary: "summary",
          status: "BLOCKED",
          sortOrder: 1,
          completionCriteria: [],
          validators: [],
          architecturalDecisionKeys: ["runtime_boundary"],
          dependencyIds: [],
        },
      },
      context: {
        objective: null,
        architectureNotes: [],
        architecture: {
          active: [{ key: "planning_schema" }],
          stale: [{ key: "legacy_projection_path" }],
        },
        codingConventions: [],
        constraints: [],
        importantCommands: [],
        currentPlan: [],
        latestSessionSummary: null,
        knownFailures: [],
        nextSteps: [],
        instructionNotes: null,
        updatedAt: null,
      } as never,
      latestReview: {
        taskId: "task-2",
        projectId: "project-1",
        status: "FAILED",
        stage: "TESTING",
        summary: "summary",
        filesChanged: [],
        commandsExecuted: [],
        validation: { passed: false, skipped: false, summary: "failed", scripts: ["build"] },
        tests: { passed: null, exitCode: null, summary: null },
        lint: { passed: null, exitCode: null, summary: null },
        build: { passed: false, exitCode: 1, summary: "failed" },
        risks: [],
        nextSteps: [],
        architecture: {
          activeKeys: ["planning_schema"],
          staleKeys: ["legacy_projection_path"],
          reconfirmedStaleKeys: [],
          addressedStaleKeys: ["legacy_projection_path"],
          missingStaleKeys: [],
          unreferencedActiveKeys: [],
          conflictingDecisionKeys: [],
          newDecisionKeys: ["runtime_boundary"],
          retiredDecisionKeys: ["legacy_projection_path"],
        },
        updatedAt: "2026-04-04T00:00:00.000Z",
      },
    });

    expect(metrics.efficiency.tasksInRetry).toBe(1);
    expect(metrics.promotion.completedMilestones).toBe(1);
    expect(metrics.promotion.blockedTaskSpecs).toBe(1);
    expect(metrics.architecture.activeDecisionCount).toBe(1);
    expect(metrics.architecture.staleDecisionCount).toBe(1);
    expect(metrics.architecture.latestRetiredDecisionCount).toBe(1);
  });
});
