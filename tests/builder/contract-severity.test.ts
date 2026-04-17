import { describe, expect, it } from "vitest";
import { resolveBuilderDependencyContractDrift } from "@/lib/builder/dependency-contract";
import { resolveBuilderFileTopologyContractDrift } from "@/lib/builder/file-topology-diff";
import { compareBuilderMcpContractSnapshots } from "@/lib/builder/mcp-snapshots";
import type {
  BuilderDependencyContractSnapshotState,
  BuilderFileTopologyContractSnapshotState,
  BuilderMcpContractSnapshotState,
} from "@/lib/builder/types";

describe("builder contract severity", () => {
  it("classifies lockfile-only dependency drift as benign", () => {
    const previousSnapshot: BuilderDependencyContractSnapshotState = {
      packageManager: "npm",
      manifest: { name: "demo", version: "1.0.0", private: true, type: "module" },
      scripts: [{ name: "build", command: "next build" }],
      packages: [{ name: "next", kind: "runtime", range: "16.0.0", resolvedVersion: "16.0.0" }],
      lockfile: { path: "package-lock.json", present: true, lockfileVersion: 3, contentHash: "old" },
      classifications: { framework: ["next"], ui: [], database: [], mcp: [], queue: [], desktop: [], validation: [], graph: [], ai: [] },
    };
    const currentSnapshot: BuilderDependencyContractSnapshotState = {
      ...previousSnapshot,
      lockfile: { ...previousSnapshot.lockfile, contentHash: "new" },
    };

    const drift = resolveBuilderDependencyContractDrift({ previousSnapshot, currentSnapshot });

    expect(drift.severity).toBe("benign");
    expect(drift.reasons).toContain("Only the lockfile changed relative to the accepted dependency baseline.");
  });

  it("classifies anchor-changing topology drift as breaking", () => {
    const previousSnapshot: BuilderFileTopologyContractSnapshotState = {
      root: ".",
      topLevel: ["src", "tests"],
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
      directories: ["src/app", "src/lib", "src/components", "tests"],
      importantFiles: ["package.json", "src/app/layout.tsx"],
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
    };
    const currentSnapshot: BuilderFileTopologyContractSnapshotState = {
      ...previousSnapshot,
      anchors: {
        ...previousSnapshot.anchors,
        appRoot: "app",
      },
    };

    const drift = resolveBuilderFileTopologyContractDrift({
      previousHash: "old",
      currentHash: "new",
      previousSnapshot,
      currentSnapshot,
    });

    expect(drift.severity).toBe("breaking");
    expect(drift.reasons).toContain("Project anchor paths changed.");
  });

  it("classifies additive MCP drift as notable", () => {
    const previousSnapshot: BuilderMcpContractSnapshotState = {
      contract: {
        version: "v1",
        compatibilityPolicyVersion: "v1",
        mcpLane: "mcp_operator",
        blockedTools: [],
        promptsAreServerOwned: true,
        resourcesAreServerOwned: true,
        importedCatalogs: { prompts: true, resources: true },
        toolOwnershipRequired: true,
        laneBoundedExposure: true,
      },
      profile: {
        agentProfile: "mcp_operator",
        autonomyPreset: "approval_all_posts",
        capabilities: {},
      },
      tools: [{ name: "builder_read_file", title: "Read", description: "Read", ownerId: "builtin", ownerKind: "builtin", annotations: {}, parameters: {} }],
      prompts: [],
      resources: [],
    };
    const currentSnapshot: BuilderMcpContractSnapshotState = {
      ...previousSnapshot,
      tools: [
        ...previousSnapshot.tools,
        { name: "builder_write_file", title: "Write", description: "Write", ownerId: "builtin", ownerKind: "builtin", annotations: {}, parameters: {} },
      ],
    };

    const drift = compareBuilderMcpContractSnapshots(previousSnapshot, currentSnapshot);

    expect(drift.changed).toBe(true);
    expect(drift.severity).toBe("notable");
    expect(drift.impact.classification).toBe("non_breaking");
  });
});