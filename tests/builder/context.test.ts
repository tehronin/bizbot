import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readBuilderFile: vi.fn(),
  writeBuilderFile: vi.fn(),
}));

vi.mock("@/lib/builder/workspace", () => ({
  readBuilderFile: mocks.readBuilderFile,
  writeBuilderFile: mocks.writeBuilderFile,
}));

import { loadBuilderProjectContext, selectRelevantInstructionFragments, syncBuilderProjectProjection } from "@/lib/builder/context";

describe("builder context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers database context when the .builder state projection is stale", () => {
    mocks.readBuilderFile.mockImplementation((filePath: string) => {
      if (filePath.endsWith(".builder/state.json")) {
        return JSON.stringify({ objective: "stale objective" });
      }
      throw new Error("missing");
    });

    const result = loadBuilderProjectContext({
      id: "project-1",
      name: "Demo",
      slug: "demo",
      relativePath: "projects/demo",
      template: "node-cli",
      packageManager: "NPM",
      gitInitialized: false,
      lifecycle: "DRAFT",
      lastRunStatus: "IDLE",
      context: { objective: "database objective", constraints: ["stay bounded"] },
    } as never);

    expect(result.context.objective).toBe("database objective");
    expect(result.projection.stale).toBe(true);
  });

  it("syncs the canonical projection files from the database state", () => {
    syncBuilderProjectProjection({
      project: {
        id: "project-1",
        name: "Demo",
        slug: "demo",
        relativePath: "projects/demo",
        template: "node-cli",
        packageManager: "NPM",
        lifecycle: "PLANNED",
      } as never,
      context: {
        objective: "Ship the demo app.",
        plannedStack: null,
        architectureNotes: ["Keep reports in .builder/reports."],
        architecture: {
          active: [{
            key: "planning_schema",
            canonicalKey: "builder:project-1:planning_schema",
            displayName: "planning_schema",
            description: "The project plan remains DB authoritative.",
            confidence: 0.9,
            status: "active",
            source: "builder_adr",
            updatedAt: "2025-01-01T00:00:00.000Z",
          }],
          stale: [{
            key: "legacy_projection_path",
            canonicalKey: "builder:project-1:legacy_projection_path",
            displayName: "legacy_projection_path",
            description: "Old projection path needs reconfirmation.",
            confidence: 0.8,
            status: "deprecated",
            source: "builder_adr",
            updatedAt: "2025-01-01T00:00:00.000Z",
          }],
        },
        codingConventions: ["Use strict TypeScript."],
        constraints: ["Stay inside the external workspace."],
        importantCommands: ["npm run build"],
        currentPlan: [{ id: "1", label: "Implement changes", status: "in_progress" }],
        latestSessionSummary: "Implemented the first pass.",
        knownFailures: [],
        nextSteps: ["Run tests."],
        instructionNotes: "Avoid large prompt dumps.",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      planning: {
        lifecycle: "PLANNED",
        brief: {
          id: "brief-1",
          projectId: "project-1",
          title: "Ship the demo app",
          summary: "Build the staged Builder planning flow.",
          goals: ["Keep state canonical in the database."],
          constraints: ["Stay inside the external workspace."],
          deliverables: ["Planner", "Scheduler"],
          notes: "Derived from product brief.",
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
          updatedAt: new Date("2025-01-01T00:00:00.000Z"),
        },
        milestones: [{
          id: "milestone-1",
          title: "Plan foundation",
          summary: "Persist the brief and milestone state.",
          status: "ACTIVE",
          sortOrder: 1,
          taskSpecs: [{
            id: "task-spec-1",
            milestoneId: "milestone-1",
            title: "Add planning tables",
            summary: "Extend the schema.",
            status: "ACTIVE",
            sortOrder: 1,
            completionCriteria: ["Schema compiles."],
            validators: ["TYPECHECK"],
            architecturalDecisionKeys: ["planning_schema"],
            dependencyIds: [],
          }],
        }],
        currentMilestone: null,
        currentTaskSpec: null,
      },
    });

    expect(mocks.writeBuilderFile).toHaveBeenCalledWith("projects/demo/AGENTS.md", expect.stringContaining("Ship the demo app."));
    expect(mocks.writeBuilderFile).toHaveBeenCalledWith("projects/demo/.builder/project-brief.md", expect.stringContaining("Build the staged Builder planning flow."));
    expect(mocks.writeBuilderFile).toHaveBeenCalledWith("projects/demo/.builder/milestones.md", expect.stringContaining("Plan foundation"));
    expect(mocks.writeBuilderFile).toHaveBeenCalledWith("projects/demo/.builder/task-board.md", expect.stringContaining("Add planning tables"));
    expect(mocks.writeBuilderFile).toHaveBeenCalledWith("projects/demo/.builder/project-context.md", expect.stringContaining("Use strict TypeScript."));
    expect(mocks.writeBuilderFile).toHaveBeenCalledWith("projects/demo/.builder/architecture.md", expect.stringContaining("planning_schema"));
    expect(mocks.writeBuilderFile).toHaveBeenCalledWith("projects/demo/.builder/architecture.md", expect.stringContaining("legacy_projection_path"));
    expect(mocks.writeBuilderFile).toHaveBeenCalledWith("projects/demo/.builder/state.json", expect.stringContaining("Ship the demo app."));
  });

  it("selects compact relevant instruction fragments instead of the full file set", () => {
    mocks.readBuilderFile.mockImplementation((filePath: string) => {
      if (filePath.endsWith("AGENTS.md")) {
        return "# Builder Project Instructions\n\n## Mission\nBuild a dashboard.\n\n## Constraints\nNever touch the BizBot repo.";
      }
      if (filePath.endsWith("project-context.md")) {
        return "# Project Context\n\n## Commands\nUse npm run build.\n\n## Notes\nPrefer App Router components.";
      }
      if (filePath.endsWith("project-brief.md")) {
        return "# Project Brief\n\n## Summary\nBuild a dashboard with staged planning.";
      }
      throw new Error("missing");
    });

    const fragments = selectRelevantInstructionFragments({ relativePath: "projects/demo" } as never, "build the dashboard with app router");

    expect(fragments.length).toBeGreaterThan(0);
    expect(fragments.every((fragment) => fragment.content.length <= 601)).toBe(true);
  });
});