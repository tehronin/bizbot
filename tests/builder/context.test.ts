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
      } as never,
      context: {
        objective: "Ship the demo app.",
        architectureNotes: ["Keep reports in .builder/reports."],
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
    });

    expect(mocks.writeBuilderFile).toHaveBeenCalledWith("projects/demo/AGENTS.md", expect.stringContaining("Ship the demo app."));
    expect(mocks.writeBuilderFile).toHaveBeenCalledWith("projects/demo/.builder/project-context.md", expect.stringContaining("Use strict TypeScript."));
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
      throw new Error("missing");
    });

    const fragments = selectRelevantInstructionFragments({ relativePath: "projects/demo" } as never, "build the dashboard with app router");

    expect(fragments.length).toBeGreaterThan(0);
    expect(fragments.every((fragment) => fragment.content.length <= 601)).toBe(true);
  });
});