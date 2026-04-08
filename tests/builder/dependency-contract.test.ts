import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readBuilderFile: vi.fn(),
  updateBuilderProject: vi.fn(),
  promoteBuilderArchitecturalDecisionsToOntology: vi.fn(),
}));

vi.mock("@/lib/builder/workspace", () => ({
  readBuilderFile: mocks.readBuilderFile,
}));

vi.mock("@/lib/builder/projects", () => ({
  updateBuilderProject: mocks.updateBuilderProject,
}));

vi.mock("@/lib/ontology/promotion", () => ({
  promoteBuilderArchitecturalDecisionsToOntology: mocks.promoteBuilderArchitecturalDecisionsToOntology,
}));

import {
  BuilderDependencyContractDriftError,
  buildCurrentBuilderDependencyContractSnapshot,
  ensureBuilderRunDependencyContractPreflight,
  getBuilderDependencyPlanningContext,
  resolveBuilderProjectDependencyContractDrift,
} from "@/lib/builder/dependency-contract";

describe("builder dependency contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateBuilderProject.mockResolvedValue({});
    mocks.promoteBuilderArchitecturalDecisionsToOntology.mockResolvedValue({});
  });

  it("builds a deterministic dependency snapshot and planning context from package files", () => {
    mocks.readBuilderFile.mockImplementation((relativePath: string) => {
      if (relativePath === "projects/demo/package.json") {
        return JSON.stringify({
          name: "demo",
          private: true,
          scripts: {
            build: "next build",
            test: "vitest run",
          },
          dependencies: {
            next: "16.2.1",
            react: "19.1.0",
            "@prisma/client": "6.16.2",
          },
          devDependencies: {
            prisma: "6.16.2",
          },
        });
      }
      if (relativePath === "projects/demo/package-lock.json") {
        return JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": { version: "1.0.0" },
            "node_modules/next": { version: "16.2.1" },
            "node_modules/react": { version: "19.1.0" },
            "node_modules/@prisma/client": { version: "6.16.2" },
            "node_modules/prisma": { version: "6.16.2" },
          },
        });
      }
      throw new Error(`missing: ${relativePath}`);
    });

    const snapshot = buildCurrentBuilderDependencyContractSnapshot({
      projectRelativePath: "projects/demo",
      packageManager: "NPM",
    });
    const planningContext = getBuilderDependencyPlanningContext({
      projectRelativePath: "projects/demo",
      packageManager: "NPM",
      context: {
        dependencyContract: {
          version: 1,
          expectedHash: "baseline-hash",
          packageManager: "npm",
          decisionKeys: ["dependency_manager_npm", "framework_next", "orm_prisma"],
          updatedAt: "2026-04-08T00:00:00.000Z",
          snapshot: {
            packageManager: "npm",
            manifest: {
              name: "demo",
              version: null,
              private: true,
              type: null,
            },
            scripts: [{ name: "build", command: "next build" }],
            packages: [{ name: "next", kind: "runtime", range: "15.0.0", resolvedVersion: "15.0.0" }],
            lockfile: {
              path: "package-lock.json",
              present: true,
              lockfileVersion: 3,
              contentHash: "old-lock-hash",
            },
            classifications: {
              framework: ["next"],
              ui: [],
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
      },
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.packages.map((entry) => entry.name)).toEqual(["@prisma/client", "next", "prisma", "react"]);
    expect(snapshot?.lockfile.present).toBe(true);
    expect(planningContext?.driftDetected).toBe(true);
    expect(planningContext?.relatedArchitectureDecisionKeys).toEqual(expect.arrayContaining(["dependency_manager_npm", "framework_next", "orm_prisma", "ui_react"]));
    expect(planningContext?.highlightedPackages).toEqual(expect.arrayContaining(["next", "react", "@prisma/client"]));
  });

  it("blocks execution when the live dependency contract drifts from the accepted baseline", async () => {
    mocks.readBuilderFile.mockImplementation((relativePath: string) => {
      if (relativePath === "projects/demo/package.json") {
        return JSON.stringify({
          name: "demo",
          private: true,
          scripts: {
            build: "next build",
          },
          dependencies: {
            next: "16.2.1",
            react: "19.1.0",
            zod: "3.25.0",
          },
        });
      }
      if (relativePath === "projects/demo/package-lock.json") {
        return JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "node_modules/next": { version: "16.2.1" },
            "node_modules/react": { version: "19.1.0" },
            "node_modules/zod": { version: "3.25.0" },
          },
        });
      }
      throw new Error(`missing: ${relativePath}`);
    });

    await expect(ensureBuilderRunDependencyContractPreflight({
      project: {
        id: "project-1",
        relativePath: "projects/demo",
        packageManager: "NPM",
        context: {
          dependencyContract: {
            version: 1,
            expectedHash: "accepted-hash",
            packageManager: "npm",
            decisionKeys: ["dependency_manager_npm", "framework_next", "ui_react"],
            updatedAt: "2026-04-08T00:00:00.000Z",
            snapshot: {
              packageManager: "npm",
              manifest: {
                name: "demo",
                version: null,
                private: true,
                type: null,
              },
              scripts: [{ name: "build", command: "next build" }],
              packages: [
                { name: "next", kind: "runtime", range: "16.2.1", resolvedVersion: "16.2.1" },
                { name: "react", kind: "runtime", range: "19.1.0", resolvedVersion: "19.1.0" },
              ],
              lockfile: {
                path: "package-lock.json",
                present: true,
                lockfileVersion: 3,
                contentHash: "old-lock-hash",
              },
              classifications: {
                framework: ["next"],
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
        },
      } as never,
      runId: "run-1",
    })).rejects.toBeInstanceOf(BuilderDependencyContractDriftError);
  });

  it("approves dependency contract drift through the explicit resolution path", async () => {
    mocks.readBuilderFile.mockImplementation((relativePath: string) => {
      if (relativePath === "projects/demo/package.json") {
        return JSON.stringify({
          name: "demo",
          private: true,
          scripts: {
            build: "next build",
            test: "vitest run",
          },
          dependencies: {
            next: "16.2.1",
            react: "19.1.0",
            zod: "3.25.0",
          },
        });
      }
      if (relativePath === "projects/demo/package-lock.json") {
        return JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "node_modules/next": { version: "16.2.1" },
            "node_modules/react": { version: "19.1.0" },
            "node_modules/zod": { version: "3.25.0" },
          },
        });
      }
      throw new Error(`missing: ${relativePath}`);
    });

    const resolution = await resolveBuilderProjectDependencyContractDrift({
      project: {
        id: "project-1",
        relativePath: "projects/demo",
        packageManager: "NPM",
        context: {
          dependencyContract: {
            version: 1,
            expectedHash: "accepted-hash",
            packageManager: "npm",
            decisionKeys: ["dependency_manager_npm", "framework_next", "ui_react"],
            updatedAt: "2026-04-08T00:00:00.000Z",
            snapshot: {
              packageManager: "npm",
              manifest: {
                name: "demo",
                version: null,
                private: true,
                type: null,
              },
              scripts: [{ name: "build", command: "next build" }],
              packages: [
                { name: "next", kind: "runtime", range: "16.2.1", resolvedVersion: "16.2.1" },
                { name: "react", kind: "runtime", range: "19.1.0", resolvedVersion: "19.1.0" },
              ],
              lockfile: {
                path: "package-lock.json",
                present: true,
                lockfileVersion: 3,
                contentHash: "old-lock-hash",
              },
              classifications: {
                framework: ["next"],
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
        },
      } as never,
      runId: "run-1",
      decision: "approve",
      reason: "Accept the new zod dependency.",
    });

    expect(resolution.status).toBe("approved");
    expect(resolution.baseline?.decisionKeys).toEqual(expect.arrayContaining(["dependency_manager_npm", "framework_next", "ui_react", "validation_zod"]));
    expect(mocks.promoteBuilderArchitecturalDecisionsToOntology).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      decisionKeys: expect.arrayContaining(["validation_zod"]),
    }));
    expect(mocks.updateBuilderProject).toHaveBeenCalled();
  });
});
