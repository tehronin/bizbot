import { beforeEach, describe, expect, it, vi } from "vitest";

const files = vi.hoisted(() => new Map<string, string>());

const mocks = vi.hoisted(() => ({
  readBuilderFile: vi.fn((relativePath: string) => {
    const value = files.get(relativePath);
    if (value === undefined) {
      throw new Error(`missing file ${relativePath}`);
    }
    return value;
  }),
  writeBuilderFile: vi.fn((relativePath: string, content: string) => {
    files.set(relativePath, content);
    return { auditPath: `${relativePath}.audit` };
  }),
  listBuilderFiles: vi.fn(),
}));

vi.mock("@/lib/builder/workspace", () => ({
  readBuilderFile: mocks.readBuilderFile,
  writeBuilderFile: mocks.writeBuilderFile,
  listBuilderFiles: mocks.listBuilderFiles,
}));

import { loadBuilderProjectContext, selectRelevantInstructionFragments, syncBuilderProjectProjection } from "@/lib/builder/context";

describe("builder context", () => {
  beforeEach(() => {
    files.clear();
    vi.clearAllMocks();
    mocks.readBuilderFile.mockImplementation((relativePath: string) => {
      const value = files.get(relativePath);
      if (value === undefined) {
        throw new Error(`missing file ${relativePath}`);
      }
      return value;
    });
    mocks.writeBuilderFile.mockImplementation((relativePath: string, content: string) => {
      files.set(relativePath, content);
      return { auditPath: `${relativePath}.audit` };
    });
    mocks.listBuilderFiles.mockImplementation((relativePath: string) => {
      const entries: Record<string, Array<{ path: string; type: "file" | "directory" }>> = {
        "projects/demo": [
          { path: "projects/demo/package.json", type: "file" },
          { path: "projects/demo/src", type: "directory" },
          { path: "projects/demo/tests", type: "directory" },
          { path: "projects/demo/.builder", type: "directory" },
        ],
        "projects/demo/src": [
          { path: "projects/demo/src/app", type: "directory" },
          { path: "projects/demo/src/lib", type: "directory" },
        ],
        "projects/demo/src/app": [
          { path: "projects/demo/src/app/layout.tsx", type: "file" },
          { path: "projects/demo/src/app/page.tsx", type: "file" },
        ],
        "projects/demo/src/lib": [
          { path: "projects/demo/src/lib/env.ts", type: "file" },
        ],
        "projects/demo/tests": [
          { path: "projects/demo/tests/app.test.ts", type: "file" },
        ],
        "projects/demo/.builder": [
          { path: "projects/demo/.builder/state.json", type: "file" },
        ],
      };
      return entries[relativePath] ?? [];
    });
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
        dependencyContract: {
          version: 1,
          expectedHash: "dependency-hash-1",
          packageManager: "npm",
          decisionKeys: ["dependency_manager_npm", "ui_react"],
          updatedAt: "2025-01-01T00:00:00.000Z",
          snapshot: {
            packageManager: "npm",
            manifest: {
              name: "demo",
              version: "1.0.0",
              private: true,
              type: null,
            },
            scripts: [{ name: "build", command: "tsc -p tsconfig.json" }],
            packages: [{ name: "react", kind: "runtime", range: "^19.0.0", resolvedVersion: "19.0.0" }],
            lockfile: {
              path: "package-lock.json",
              present: true,
              lockfileVersion: 3,
              contentHash: "lock-hash-1",
            },
            classifications: {
              framework: [],
              ui: ["react"],
              database: [],
              mcp: [],
              queue: [],
              desktop: [],
              validation: [],
              graph: [],
              ai: [],
            },
          },
        },
        fileTopologyContract: {
          version: 1,
          expectedHash: "topology-hash-1",
          decisionKeys: ["file_topology_src_root", "file_topology_builder_projection_reserved"],
          updatedAt: "2025-01-01T00:00:00.000Z",
          snapshot: {
            root: ".",
            topLevel: ["package.json", "src", "tests"],
            anchors: {
              appRoot: "src/app",
              libRoot: "src/lib",
              componentsRoot: null,
              testsRoot: "tests",
              scriptsRoot: null,
              prismaRoot: null,
              tauriRoot: null,
              builderProjectionRoot: ".builder",
            },
            directories: ["src", "src/app", "src/lib", "tests"],
            importantFiles: ["package.json", "src/app/layout.tsx", "src/app/page.tsx"],
            classifications: {
              usesSrcRoot: true,
              usesNextAppRouter: true,
              usesTestsRoot: true,
              usesScriptsRoot: false,
              usesDesktopShell: false,
              rootMinimal: true,
            },
            rules: {
              preferSrcLib: true,
              preferSrcComponents: false,
              discourageTopLevelFeatureFolders: true,
              reserveBuilderProjectionPaths: true,
            },
          },
        },
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
    expect(mocks.writeBuilderFile).toHaveBeenCalledWith("projects/demo/.builder/dependency-contract.md", expect.stringContaining("dependency-hash-1"));
    expect(mocks.writeBuilderFile).toHaveBeenCalledWith("projects/demo/.builder/file-topology.md", expect.stringContaining("topology-hash-1"));
    expect(mocks.writeBuilderFile).toHaveBeenCalledWith("projects/demo/.builder/architecture.md", expect.stringContaining("planning_schema"));
    expect(mocks.writeBuilderFile).toHaveBeenCalledWith("projects/demo/.builder/architecture.md", expect.stringContaining("legacy_projection_path"));
    expect(mocks.writeBuilderFile).toHaveBeenCalledWith("projects/demo/.builder/state.json", expect.stringContaining("Ship the demo app."));
  });

  it("skips projection writes when artifacts and manifest are unchanged", () => {
    const args = {
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
        dependencyContract: null,
        fileTopologyContract: null,
        architectureNotes: [],
        architecture: { active: [], stale: [] },
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
        brief: null,
        milestones: [],
        currentMilestone: null,
        currentTaskSpec: null,
      },
    };

    syncBuilderProjectProjection(args);
    mocks.writeBuilderFile.mockClear();

    syncBuilderProjectProjection(args);

    expect(mocks.writeBuilderFile).toHaveBeenCalledTimes(1);
    expect(mocks.writeBuilderFile).toHaveBeenCalledWith(
      "projects/demo/.builder/cache/stats.json",
      expect.stringContaining('"filesSkipped": 11'),
    );
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