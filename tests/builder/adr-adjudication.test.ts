import { describe, expect, it } from "vitest";
import {
  adjudicateBuilderExecutionAdr,
  adjudicateBuilderPlanningAdr,
  buildExecutionAdrFocus,
  buildPlanningAdrFocus,
} from "@/lib/builder/adr-adjudication";

describe("builder ADR adjudication", () => {
  it("blocks planning only for stale ADR that are relevant to the current work", () => {
    const focus = buildPlanningAdrFocus({
      brief: {
        title: "Projection sync cleanup",
        summary: "Refine Builder projection sync and staged task board behavior.",
        goals: [],
        constraints: [],
        deliverables: [],
        notes: null,
      },
      staleArchitecture: [
        {
          key: "legacy_projection_path",
          canonicalKey: "builder:project-1:legacy_projection_path",
          displayName: "legacy_projection_path",
          description: "Old projection layout for Builder state files.",
          confidence: 0.8,
          status: "deprecated",
          source: "builder_adr",
          updatedAt: "2026-04-04T00:00:00.000Z",
        },
        {
          key: "orm_prisma",
          canonicalKey: "builder:project-1:orm_prisma",
          displayName: "orm_prisma",
          description: "Prisma remains the ORM boundary.",
          confidence: 0.8,
          status: "deprecated",
          source: "builder_adr",
          updatedAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });

    const adjudication = adjudicateBuilderPlanningAdr({
      focus,
      critique: {
        valid: true,
        issues: [],
        normalizedMilestones: [],
        reconciliation: {
          activeKeys: [],
          staleKeys: ["legacy_projection_path", "orm_prisma"],
          reconfirmedStaleKeys: [],
          addressedStaleKeys: [],
          missingStaleKeys: ["legacy_projection_path", "orm_prisma"],
          unreferencedActiveKeys: [],
          conflictingDecisionKeys: [],
          newDecisionKeys: [],
          retiredDecisionKeys: [],
        },
      },
    });

    expect(focus.staleRelevantKeys).toEqual(["legacy_projection_path"]);
    expect(adjudication.overallVerdict).toBe("block");
    expect(adjudication.summary).toContain("legacy_projection_path");
    expect(adjudication.summary).not.toContain("orm_prisma");
  });

  it("escalates protected-boundary planning changes", () => {
    const focus = buildPlanningAdrFocus({
      brief: {
        title: "Dependency contract overhaul",
        summary: "Revise package manager policy and dependency baseline handling.",
        goals: [],
        constraints: [],
        deliverables: [],
        notes: null,
      },
      staleArchitecture: [{
        key: "package_manager_policy",
        canonicalKey: "builder:project-1:package_manager_policy",
        displayName: "package_manager_policy",
        description: "NPM remains the package manager baseline.",
        confidence: 0.9,
        status: "deprecated",
        source: "builder_adr",
        updatedAt: "2026-04-04T00:00:00.000Z",
      }],
    });

    const adjudication = adjudicateBuilderPlanningAdr({
      focus,
      critique: {
        valid: true,
        issues: [],
        normalizedMilestones: [],
        reconciliation: {
          activeKeys: [],
          staleKeys: ["package_manager_policy"],
          reconfirmedStaleKeys: [],
          addressedStaleKeys: ["package_manager_policy"],
          missingStaleKeys: [],
          unreferencedActiveKeys: [],
          conflictingDecisionKeys: [],
          newDecisionKeys: [],
          retiredDecisionKeys: ["package_manager_policy"],
        },
      },
    });

    expect(adjudication.overallVerdict).toBe("escalate");
    expect(adjudication.escalationReason).toContain("package_manager_policy");
  });

  it("does not escalate initial protected-boundary ADR introductions during planning", () => {
    const focus = buildPlanningAdrFocus({
      brief: {
        title: "Builder smoke planning",
        summary: "Create a minimal Builder plan and stage the first canonical task.",
        goals: [],
        constraints: [],
        deliverables: [],
        notes: null,
      },
      staleArchitecture: [],
    });

    const adjudication = adjudicateBuilderPlanningAdr({
      focus,
      critique: {
        valid: true,
        issues: [],
        normalizedMilestones: [],
        reconciliation: {
          activeKeys: [],
          staleKeys: [],
          reconfirmedStaleKeys: [],
          addressedStaleKeys: [],
          missingStaleKeys: [],
          unreferencedActiveKeys: [],
          conflictingDecisionKeys: [],
          newDecisionKeys: ["planning_schema", "builder_plan_projection"],
          retiredDecisionKeys: [],
        },
      },
    });

    expect(adjudication.overallVerdict).toBe("proceed_with_update");
    expect(adjudication.escalationReason).toBeNull();
    expect(adjudication.updateDecisionKeys).toEqual(expect.arrayContaining(["planning_schema", "builder_plan_projection"]));
  });

  it("updates execution ADR memory only for relevant architecture keys", () => {
    const focus = buildExecutionAdrFocus({
      request: "Tighten Builder projection sync and task board rendering.",
      taskSpec: {
        id: "task-spec-1",
        milestoneId: "milestone-1",
        title: "Sync projection files",
        summary: "Keep Builder projection files aligned with DB-backed state.",
        status: "ACTIVE",
        sortOrder: 1,
        completionCriteria: ["Sync the projection files"],
        validators: ["MANUAL_REVIEW"],
        architecturalDecisionKeys: ["planning_schema"],
        dependencyIds: [],
      },
      adherence: {
        allowsExecution: true,
        mode: "implementation",
        summary: "aligned",
        blockingIssues: [],
        requiredDecisionKeys: ["planning_schema"],
        staleDecisionKeys: ["planning_schema", "orm_prisma"],
        reconfirmedStaleKeys: ["planning_schema"],
        directives: [],
      },
      staleArchitecture: [
        {
          key: "planning_schema",
          canonicalKey: "builder:project-1:planning_schema",
          displayName: "planning_schema",
          description: "Builder planning state remains canonical in the database.",
          confidence: 0.9,
          status: "deprecated",
          source: "builder_adr",
          updatedAt: "2026-04-04T00:00:00.000Z",
        },
        {
          key: "orm_prisma",
          canonicalKey: "builder:project-1:orm_prisma",
          displayName: "orm_prisma",
          description: "Prisma remains the ORM boundary.",
          confidence: 0.9,
          status: "deprecated",
          source: "builder_adr",
          updatedAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });

    const adjudication = adjudicateBuilderExecutionAdr({
      focus,
      taskSpec: {
        id: "task-spec-1",
        milestoneId: "milestone-1",
        title: "Sync projection files",
        summary: "Keep Builder projection files aligned with DB-backed state.",
        status: "ACTIVE",
        sortOrder: 1,
        completionCriteria: ["Sync the projection files"],
        validators: ["MANUAL_REVIEW"],
        architecturalDecisionKeys: ["planning_schema"],
        dependencyIds: [],
      },
      adherence: {
        allowsExecution: true,
        mode: "implementation",
        summary: "aligned",
        blockingIssues: [],
        requiredDecisionKeys: ["planning_schema"],
        staleDecisionKeys: ["planning_schema", "orm_prisma"],
        reconfirmedStaleKeys: ["planning_schema"],
        directives: [],
      },
    });

    expect(focus.staleRelevantKeys).toEqual(["planning_schema"]);
    expect(adjudication.overallVerdict).toBe("proceed_with_update");
    expect(adjudication.updateDecisionKeys).toEqual(["planning_schema"]);
    expect(adjudication.updateDecisionKeys).not.toContain("orm_prisma");
  });
});
