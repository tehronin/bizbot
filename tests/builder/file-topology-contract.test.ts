import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listBuilderFiles: vi.fn(),
  updateBuilderProject: vi.fn(),
  promoteBuilderArchitecturalDecisionsToOntology: vi.fn(),
}));

vi.mock("@/lib/builder/workspace", () => ({
  listBuilderFiles: mocks.listBuilderFiles,
}));

vi.mock("@/lib/builder/projects", () => ({
  updateBuilderProject: mocks.updateBuilderProject,
}));

vi.mock("@/lib/ontology/promotion", () => ({
  promoteBuilderArchitecturalDecisionsToOntology: mocks.promoteBuilderArchitecturalDecisionsToOntology,
}));

import {
  BuilderFileTopologyContractDriftError,
  buildCurrentBuilderFileTopologyContractSnapshot,
  ensureBuilderRunFileTopologySnapshotPreflight,
  getBuilderFileTopologyPlanningContext,
  resolveBuilderRunFileTopologyContractDrift,
} from "@/lib/builder/file-topology-snapshots";

function seedTopologyWorkspace(includeDocs = false) {
  mocks.listBuilderFiles.mockImplementation((relativePath: string) => {
    const entries: Record<string, Array<{ path: string; type: "file" | "directory" }>> = {
      "projects/demo": [
        { path: "projects/demo/package.json", type: "file" },
        { path: "projects/demo/README.md", type: "file" },
        { path: "projects/demo/src", type: "directory" },
        { path: "projects/demo/tests", type: "directory" },
        { path: "projects/demo/scripts", type: "directory" },
        { path: "projects/demo/prisma", type: "directory" },
        { path: "projects/demo/.builder", type: "directory" },
        ...(includeDocs ? [{ path: "projects/demo/docs", type: "directory" as const }] : []),
      ],
      "projects/demo/src": [
        { path: "projects/demo/src/app", type: "directory" },
        { path: "projects/demo/src/lib", type: "directory" },
        { path: "projects/demo/src/components", type: "directory" },
      ],
      "projects/demo/src/app": [
        { path: "projects/demo/src/app/layout.tsx", type: "file" },
        { path: "projects/demo/src/app/page.tsx", type: "file" },
      ],
      "projects/demo/src/lib": [
        { path: "projects/demo/src/lib/env.ts", type: "file" },
      ],
      "projects/demo/src/components": [
        { path: "projects/demo/src/components/header.tsx", type: "file" },
      ],
      "projects/demo/tests": [
        { path: "projects/demo/tests/app.test.ts", type: "file" },
      ],
      "projects/demo/scripts": [
        { path: "projects/demo/scripts/setup.ts", type: "file" },
      ],
      "projects/demo/prisma": [
        { path: "projects/demo/prisma/schema.prisma", type: "file" },
      ],
      "projects/demo/.builder": [
        { path: "projects/demo/.builder/state.json", type: "file" },
      ],
      "projects/demo/docs": [
        { path: "projects/demo/docs/notes.md", type: "file" },
      ],
    };

    return entries[relativePath] ?? [];
  });
}

describe("builder file topology contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateBuilderProject.mockResolvedValue({});
    mocks.promoteBuilderArchitecturalDecisionsToOntology.mockResolvedValue({});
    seedTopologyWorkspace();
  });

  it("builds a deterministic topology snapshot and planning context", () => {
    const snapshot = buildCurrentBuilderFileTopologyContractSnapshot({
      projectRelativePath: "projects/demo",
    });
    const planningContext = getBuilderFileTopologyPlanningContext({
      projectRelativePath: "projects/demo",
      context: {
        fileTopologyContract: {
          version: 1,
          expectedHash: "baseline-hash",
          decisionKeys: ["file_topology_src_root", "file_topology_src_lib_preferred"],
          updatedAt: "2026-04-08T00:00:00.000Z",
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
      },
    });

    expect(snapshot.topLevel).toEqual(expect.arrayContaining(["README.md", "package.json", "prisma", "scripts", "src", "tests"]));
    expect(snapshot.anchors.appRoot).toBe("src/app");
    expect(snapshot.anchors.libRoot).toBe("src/lib");
    expect(snapshot.rules.reserveBuilderProjectionPaths).toBe(true);
    expect(planningContext.driftDetected).toBe(true);
    expect(planningContext.relatedArchitectureDecisionKeys).toEqual(expect.arrayContaining([
      "project_shape_next_app_router",
      "file_topology_src_root",
      "file_topology_src_lib_preferred",
      "file_topology_tests_root_namespace",
    ]));
    expect(planningContext.placementGuidance).toEqual(expect.arrayContaining([
      "Route files belong under src/app.",
      "Shared runtime helpers belong under src/lib.",
    ]));
  });

  it("blocks execution when live topology drifts from the accepted baseline", async () => {
    seedTopologyWorkspace(true);

    await expect(ensureBuilderRunFileTopologySnapshotPreflight({
      project: {
        id: "project-1",
        relativePath: "projects/demo",
        context: {
          fileTopologyContract: {
            version: 1,
            expectedHash: "accepted-hash",
            decisionKeys: ["file_topology_src_root"],
            updatedAt: "2026-04-08T00:00:00.000Z",
            snapshot: {
              root: ".",
              topLevel: ["package.json", "src", "tests"],
              anchors: {
                appRoot: "src/app",
                libRoot: "src/lib",
                componentsRoot: "src/components",
                testsRoot: "tests",
                scriptsRoot: "scripts",
                prismaRoot: "prisma",
                tauriRoot: null,
                builderProjectionRoot: ".builder",
              },
              directories: ["prisma", "scripts", "src", "src/app", "src/components", "src/lib", "tests"],
              importantFiles: ["package.json", "src/app/layout.tsx", "src/app/page.tsx", "prisma/schema.prisma"],
              classifications: {
                usesSrcRoot: true,
                usesNextAppRouter: true,
                usesTestsRoot: true,
                usesScriptsRoot: true,
                usesDesktopShell: false,
                rootMinimal: true,
              },
              rules: {
                preferSrcLib: true,
                preferSrcComponents: true,
                discourageTopLevelFeatureFolders: true,
                reserveBuilderProjectionPaths: true,
              },
            },
          },
        },
      } as never,
      runId: "run-1",
    })).rejects.toBeInstanceOf(BuilderFileTopologyContractDriftError);
  });

  it("approves topology drift through the explicit resolution path", async () => {
    seedTopologyWorkspace(true);

    const resolution = await resolveBuilderRunFileTopologyContractDrift({
      project: {
        id: "project-1",
        relativePath: "projects/demo",
        context: {
          fileTopologyContract: {
            version: 1,
            expectedHash: "accepted-hash",
            decisionKeys: ["file_topology_src_root"],
            updatedAt: "2026-04-08T00:00:00.000Z",
            snapshot: {
              root: ".",
              topLevel: ["package.json", "src", "tests"],
              anchors: {
                appRoot: "src/app",
                libRoot: "src/lib",
                componentsRoot: "src/components",
                testsRoot: "tests",
                scriptsRoot: "scripts",
                prismaRoot: "prisma",
                tauriRoot: null,
                builderProjectionRoot: ".builder",
              },
              directories: ["prisma", "scripts", "src", "src/app", "src/components", "src/lib", "tests"],
              importantFiles: ["package.json", "src/app/layout.tsx", "src/app/page.tsx", "prisma/schema.prisma"],
              classifications: {
                usesSrcRoot: true,
                usesNextAppRouter: true,
                usesTestsRoot: true,
                usesScriptsRoot: true,
                usesDesktopShell: false,
                rootMinimal: true,
              },
              rules: {
                preferSrcLib: true,
                preferSrcComponents: true,
                discourageTopLevelFeatureFolders: true,
                reserveBuilderProjectionPaths: true,
              },
            },
          },
        },
      } as never,
      runId: "run-1",
      decision: "approve",
      reason: "Accept the structural rollover.",
    });

    expect(resolution.status).toBe("approved");
    expect(resolution.baseline?.decisionKeys).toEqual(expect.arrayContaining([
      "file_topology_builder_projection_reserved",
      "file_topology_root_minimal",
    ]));
    expect(mocks.promoteBuilderArchitecturalDecisionsToOntology).toHaveBeenCalled();
    expect(mocks.updateBuilderProject).toHaveBeenCalled();
  });
});