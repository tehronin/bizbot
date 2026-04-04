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

  it("builds generic implementation milestones for a plain Express REST API brief", () => {
    const milestones = buildPlanFromBrief({
      id: "brief-2",
      projectId: "project-2",
      title: "Express Items API",
      summary: "Build a Node.js REST API with Express. Three endpoints — GET /health, GET /items, POST /items. In-memory storage. No database. Returns JSON.",
      goals: ["Add validation.", "Add tests."],
      constraints: ["No database."],
      deliverables: ["Working JSON API with health and items endpoints."],
      notes: null,
      createdAt: new Date("2026-04-04T00:00:00.000Z"),
      updatedAt: new Date("2026-04-04T00:00:00.000Z"),
    });

    expect(milestones.map((milestone) => milestone.title)).toEqual([
      "Confirm API contract",
      "Scaffold the service runtime",
      "Implement endpoint behavior",
      "Verify and review the deliverable",
    ]);
    expect(milestones.flatMap((milestone) => milestone.tasks.map((task) => task.title))).toEqual(expect.arrayContaining([
      "Capture runtime and endpoint decisions",
      "Set up the Express server shell",
      "Implement health and items endpoints",
      "Add request validation and JSON error handling",
      "Add endpoint tests and verification scripts",
    ]));
    expect(milestones.flatMap((milestone) => milestone.tasks.flatMap((task) => task.architecturalDecisionKeys))).toEqual(expect.arrayContaining([
      "tech_stack_runtime",
      "tech_stack_framework",
      "persistence_in_memory",
      "database_strategy_none",
      "response_format_json",
    ]));
    expect(milestones.flatMap((milestone) => milestone.tasks.flatMap((task) => task.architecturalDecisionKeys))).not.toEqual(expect.arrayContaining([
      "planning_authority_split",
      "builder_plan_projection",
    ]));
  });

  it("keeps generic DB-backed briefs generic even when notes mention Builder regression context", () => {
    const milestones = buildPlanFromBrief({
      id: "brief-3",
      projectId: "project-3",
      title: "Express Prisma SQLite API",
      summary: "Build a Node.js REST API with Express, Prisma, and SQLite. Endpoints: GET /health, GET /items, POST /items. Persist items in SQLite through Prisma. Return JSON.",
      goals: ["Add endpoint tests."],
      constraints: ["Use local SQLite only."],
      deliverables: ["Working Express API with Prisma persistence."],
      notes: "This is the next Builder regression after the in-memory Express API success.",
      createdAt: new Date("2026-04-04T00:00:00.000Z"),
      updatedAt: new Date("2026-04-04T00:00:00.000Z"),
    });

    expect(milestones.map((milestone) => milestone.title)).toEqual([
      "Confirm API contract",
      "Scaffold the service runtime",
      "Implement endpoint behavior",
      "Verify and review the deliverable",
    ]);
    expect(milestones.flatMap((milestone) => milestone.tasks.flatMap((task) => task.architecturalDecisionKeys))).toEqual(expect.arrayContaining([
      "tech_stack_runtime",
      "tech_stack_framework",
      "database_strategy_sqlite",
      "persistence_relational",
      "service_surface_rest_api",
    ]));
    expect(milestones.flatMap((milestone) => milestone.tasks.flatMap((task) => task.architecturalDecisionKeys))).not.toEqual(expect.arrayContaining([
      "planning_authority_split",
      "planning_schema",
    ]));
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

  it("tracks stale-key reconfirmation and warns when active architecture is left implicit", () => {
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
          dependencyKeys: [],
          architecturalDecisionKeys: ["legacy_projection_path"],
          architecturalStaleKeys: [],
        }],
      }],
      activeArchitecture: [{
        key: "planning_authority_split",
        canonicalKey: "builder:project-1:planning_authority_split",
        displayName: "planning_authority_split",
        description: "Database planning remains canonical.",
        confidence: 0.9,
        status: "active",
        source: "builder_adr",
        updatedAt: new Date("2026-04-04T00:00:00.000Z").toISOString(),
      }],
      staleArchitecture: [{
        key: "legacy_projection_path",
        canonicalKey: "builder:project-1:legacy_projection_path",
        displayName: "legacy_projection_path",
        description: "Old projection path needs reconfirmation.",
        confidence: 0.8,
        status: "deprecated",
        source: "builder_adr",
        updatedAt: new Date("2026-04-04T00:00:00.000Z").toISOString(),
      }],
    });

    expect(critique.reconciliation.reconfirmedStaleKeys).toEqual(["legacy_projection_path"]);
    expect(critique.reconciliation.unreferencedActiveKeys).toEqual(["planning_authority_split"]);
    expect(critique.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "active_architecture_not_reconciled", severity: "warning" }),
    ]));
  });

  it("rejects planner output that marks the same architecture key as both new and stale", () => {
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
          dependencyKeys: [],
          architecturalDecisionKeys: ["legacy_projection_path"],
          architecturalStaleKeys: ["legacy_projection_path"],
        }],
      }],
      staleArchitecture: [{
        key: "legacy_projection_path",
        canonicalKey: "builder:project-1:legacy_projection_path",
        displayName: "legacy_projection_path",
        description: "Old projection path needs reconfirmation.",
        confidence: 0.8,
        status: "deprecated",
        source: "builder_adr",
        updatedAt: new Date("2026-04-04T00:00:00.000Z").toISOString(),
      }],
    });

    expect(critique.valid).toBe(false);
    expect(critique.reconciliation.conflictingDecisionKeys).toEqual(["legacy_projection_path"]);
    expect(critique.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "conflicting_architecture_reconciliation", severity: "error" }),
    ]));
  });
});