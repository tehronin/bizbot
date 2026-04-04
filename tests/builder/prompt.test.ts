import { describe, expect, it } from "vitest";
import { composeBuilderPlannerPrompt, composeBuilderTaskPrompt } from "@/lib/builder/prompt";

describe("builder prompt synthesis", () => {
  it("builds a compact task prompt from project state and selected fragments", () => {
    const prompt = composeBuilderTaskPrompt({
      project: {
        name: "Demo",
        relativePath: "projects/demo",
        template: "next-app",
        packageManager: "PNPM",
      } as never,
      task: {
        title: "Add a health endpoint",
        acceptanceCriteria: ["Add the endpoint", "Run tests"],
        metadata: { planSteps: [{ id: "1", label: "Implement endpoint", status: "in_progress" }] },
      } as never,
      context: {
        objective: "Ship the demo app.",
        architectureNotes: [],
        codingConventions: ["Use App Router."],
        constraints: ["Stay inside the external workspace."],
        importantCommands: ["pnpm test"],
        currentPlan: [],
        latestSessionSummary: "Previous test failed.",
        knownFailures: ["pnpm test currently fails."],
        nextSteps: ["Fix the test."],
        instructionNotes: null,
        updatedAt: null,
      },
      lifecycle: "ACTIVE",
      brief: {
        id: "brief-1",
        projectId: "project-1",
        title: "Demo brief",
        summary: "Drive Builder through a staged project planner.",
        goals: [],
        constraints: [],
        deliverables: [],
        notes: null,
      } as never,
      currentMilestone: {
        id: "milestone-1",
        title: "Plan foundation",
        summary: "Persist the brief and milestones.",
        status: "ACTIVE",
        sortOrder: 1,
        taskSpecs: [],
      },
      currentTaskSpec: {
        id: "task-spec-1",
        milestoneId: "milestone-1",
        title: "Add planning tables",
        summary: "Extend the Builder schema.",
        status: "ACTIVE",
        sortOrder: 1,
        completionCriteria: ["Add the endpoint", "Run tests"],
        validators: ["TYPECHECK", "MANUAL_REVIEW"],
        architecturalDecisionKeys: ["planning_schema"],
        dependencyIds: [],
      },
      request: "Add a health endpoint and rerun the tests.",
      stage: "IMPLEMENTING",
      fragments: [{ source: "AGENTS.md", heading: "Mission", content: "Keep edits small and reviewable." }],
    });

    expect(prompt).toContain("Builder mission");
    expect(prompt).toContain("Project lifecycle: active.");
    expect(prompt).toContain("Current milestone: Plan foundation");
    expect(prompt).toContain("Validators: typecheck, manual_review.");
    expect(prompt).toContain("Add a health endpoint");
    expect(prompt).toContain("Keep edits small and reviewable.");
    expect(prompt).not.toContain("undefined");
  });

  it("builds a planner prompt with exact brief and architecture context blocks", () => {
    const prompt = composeBuilderPlannerPrompt({
      project: {
        id: "project-1",
        name: "Demo",
        relativePath: "projects/demo",
        template: "next-app",
        packageManager: "PNPM",
      } as never,
      brief: {
        id: "brief-1",
        projectId: "project-1",
        title: "Builder v3.1 second pass",
        summary: "Harden planning and ADR reconciliation without changing the execution loop.",
        goals: ["Keep the current route and plugin surfaces."],
        constraints: ["No new Prisma models."],
        deliverables: ["Planner hardening", "Living ADR reconciliation"],
        notes: "Non-goals: execution loop rewrites, new routes",
      } as never,
      context: {
        objective: "Harden Builder planning.",
        architectureNotes: [],
        architecture: {
          active: [{
            key: "planning_authority_split",
            canonicalKey: "builder:project-1:planning_authority_split",
            displayName: "planning_authority_split",
            description: "Database planning remains canonical.",
            confidence: 0.9,
            status: "active",
            source: "builder_adr",
            updatedAt: new Date("2026-04-04T00:00:00.000Z").toISOString(),
          }],
          stale: [{
            key: "legacy_projection_path",
            canonicalKey: "builder:project-1:legacy_projection_path",
            displayName: "legacy_projection_path",
            description: "Old projection path needs reconfirmation.",
            confidence: 0.8,
            status: "deprecated",
            source: "builder_adr",
            updatedAt: new Date("2026-04-04T00:00:00.000Z").toISOString(),
          }],
        },
        codingConventions: [],
        constraints: ["Preserve the execution loop."],
        importantCommands: [],
        currentPlan: [],
        latestSessionSummary: null,
        knownFailures: [],
        nextSteps: [],
        instructionNotes: "Keep the planner output structured.",
        updatedAt: null,
      },
      constraints: ["No new routes.", "No new models."],
      nonGoals: ["Execution loop rewrites", "New plugin entry points"],
      acceptanceCriteria: ["Planner validates stale ADR reconciliation", "Planner output stays dependency-safe"],
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

    expect(prompt).toContain("[Brief]");
    expect(prompt).toContain("[Constraints]");
    expect(prompt).toContain("[Non-Goals]");
    expect(prompt).toContain("[Acceptance Criteria]");
    expect(prompt).toContain("[Template Guidance]");
    expect(prompt).toContain("[Active Architecture]");
    expect(prompt).toContain("[Stale Architecture - Needs Reconfirmation]");
    expect(prompt).toContain("No new models.");
    expect(prompt).toContain("Execution loop rewrites");
    expect(prompt).toContain("Planner validates stale ADR reconciliation");
    expect(prompt).toContain("next-app");
  });
});