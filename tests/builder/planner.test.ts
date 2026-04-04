import { describe, expect, it } from "vitest";
import { buildPlanFromBrief, critiqueBuilderPlanCandidate, normalizeArchitecturalDecisionKeys, normalizePlannerOutput } from "@/lib/builder/planner";

describe("builder planner", () => {
  it("builds a normalized 3-7 milestone plan from a persisted brief", () => {
    const milestones = buildPlanFromBrief({
      id: "brief-1",
      projectId: "project-1",
      title: "Builder v3.1",
      summary: "Add schema, scheduler, routes, dashboard, tests, and docs for project-first planning.",
      goals: ["Keep planning relational."],
      constraints: ["Preserve execution history."],
      deliverables: ["Planner", "Scheduler", "Dashboard"],
      notes: "Focus on canonical DB state.",
      createdAt: new Date("2026-04-04T00:00:00.000Z"),
      updatedAt: new Date("2026-04-04T00:00:00.000Z"),
    });

    expect(milestones.length).toBeGreaterThanOrEqual(3);
    expect(milestones.length).toBeLessThanOrEqual(7);
    expect(milestones[0]?.sortOrder).toBe(1);
    expect(milestones.every((milestone) => milestone.tasks.length > 0)).toBe(true);
  });

  it("drops invalid architectural decision keys with the explicit snake_case regex", () => {
    expect(normalizeArchitecturalDecisionKeys([
      "valid_key",
      "StillInvalid",
      "also-invalid",
      "another_valid_2",
      "2bad",
    ])).toEqual(["valid_key", "another_valid_2"]);
  });

  it("normalizes planner output and removes invalid validator and dependency data", () => {
    const normalized = normalizePlannerOutput([{
      key: "milestone_a",
      title: "Milestone A",
      summary: "Summary",
      tasks: [{
        key: "task_a",
        title: "Task A",
        summary: "Do the thing.",
        completionCriteria: ["Ship it"],
        validators: ["build", "bogus", "manual review"],
        dependencyKeys: ["missing_key"],
        architectural_new_decisions: ["valid_key", "NotValid"],
        architectural_stale_keys: ["legacy_key", "StillInvalid"],
      }],
    }]);

    expect(normalized[0]?.tasks[0]?.validators).toEqual(["BUILD", "MANUAL_REVIEW"]);
    expect(normalized[0]?.tasks[0]?.dependencyKeys).toEqual([]);
    expect(normalized[0]?.tasks[0]?.architecturalDecisionKeys).toEqual(["valid_key"]);
    expect(normalized[0]?.tasks[0]?.architecturalStaleKeys).toEqual(["legacy_key"]);
  });

  it("rejects malformed dependency graphs during critique", () => {
    const critique = critiqueBuilderPlanCandidate({
      milestones: [{
        key: "milestone_a",
        title: "Milestone A",
        summary: "Summary",
        status: "PENDING",
        sortOrder: 1,
        tasks: [{
          key: "task_a",
          title: "Task A",
          summary: "Do A.",
          status: "PENDING",
          sortOrder: 1,
          completionCriteria: ["Done A"],
          validators: ["MANUAL_REVIEW"],
          dependencyKeys: ["task_b"],
          architecturalDecisionKeys: ["valid_key"],
          architecturalStaleKeys: ["legacy_key"],
        }, {
          key: "task_b",
          title: "Task B",
          summary: "Do B.",
          status: "PENDING",
          sortOrder: 2,
          completionCriteria: ["Done B"],
          validators: ["MANUAL_REVIEW"],
          dependencyKeys: ["task_a"],
          architecturalDecisionKeys: [],
          architecturalStaleKeys: [],
        }],
      }],
      staleArchitecture: [{
        key: "legacy_key",
        canonicalKey: "builder:project-1:legacy_key",
        displayName: "legacy_key",
        description: "Legacy architecture note",
        confidence: 0.9,
        status: "deprecated",
        source: "builder_adr",
        updatedAt: new Date("2026-04-04T00:00:00.000Z").toISOString(),
      }],
    });

    expect(critique.valid).toBe(false);
    expect(critique.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "dependency_cycle" }),
    ]));
  });
});