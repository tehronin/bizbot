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
}));

vi.mock("@/lib/builder/workspace", () => ({
  readBuilderFile: mocks.readBuilderFile,
  writeBuilderFile: mocks.writeBuilderFile,
}));

import {
  buildBuilderPlanningCacheKey,
  hashBuilderProjectionArtifactContent,
  persistBuilderContextPacketCache,
  readBuilderCacheStats,
  readBuilderContextPacketManifest,
  readBuilderPlanningCache,
  recordBuilderPlanningCacheLookup,
  recordBuilderProjectionCacheSync,
  writeBuilderPlanningCache,
} from "@/lib/builder/cache";

describe("builder cache", () => {
  beforeEach(() => {
    files.clear();
    vi.clearAllMocks();
  });

  it("persists context packet manifests and reuses unchanged fingerprints", () => {
    const first = persistBuilderContextPacketCache({
      projectRelativePath: "projects/demo",
      artifacts: [{
        packetId: "project_context",
        relativePath: "projects/demo/.builder/project-context.md",
        content: "# Project Context\n",
      }],
    });

    expect(first.reused).toBe(false);
    expect(mocks.writeBuilderFile).toHaveBeenCalledWith(
      "projects/demo/.builder/cache/context-packets.json",
      expect.stringContaining('"packetId": "project_context"'),
    );
    expect(readBuilderContextPacketManifest("projects/demo")?.packets).toEqual([
      expect.objectContaining({
        packetId: "project_context",
        relativePath: "projects/demo/.builder/project-context.md",
        contentHash: hashBuilderProjectionArtifactContent("# Project Context\n"),
      }),
    ]);

    mocks.writeBuilderFile.mockClear();
    const second = persistBuilderContextPacketCache({
      projectRelativePath: "projects/demo",
      artifacts: [{
        packetId: "project_context",
        relativePath: "projects/demo/.builder/project-context.md",
        content: "# Project Context\n",
      }],
    });

    expect(second.reused).toBe(true);
    expect(mocks.writeBuilderFile).not.toHaveBeenCalled();
  });

  it("writes and reads planning cache artifacts by hash key", () => {
    const key = buildBuilderPlanningCacheKey({
      project: { id: "project-1", template: "node-cli" },
      brief: { title: "Ship it" },
      architecture: { active: [], stale: [] },
      mcpPlanningContext: { currentHash: "mcp-1" },
      dependencyPlanningContext: { currentHash: "dep-1" },
      dependencyContext: { reasons: ["mode:analysis_only"] },
      fileTopologyPlanningContext: { currentHash: "top-1" },
      fileTopologyContext: { reasons: ["template:node-cli"] },
    });

    writeBuilderPlanningCache({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      key,
      prompt: "planner prompt",
      critique: {
        valid: true,
        issues: [],
        normalizedMilestones: [],
        reconciliation: {
          activeKeys: [],
          staleKeys: [],
          addressedStaleKeys: [],
          missingStaleKeys: [],
          reconfirmedStaleKeys: [],
          unreferencedActiveKeys: [],
          conflictingDecisionKeys: [],
          newDecisionKeys: [],
          retiredDecisionKeys: [],
        },
      },
    });

    expect(readBuilderPlanningCache({ projectRelativePath: "projects/demo", key })?.prompt).toBe("planner prompt");
    expect(readBuilderPlanningCache({ projectRelativePath: "projects/demo", key: "other" })).toBeNull();
    expect(readBuilderCacheStats("projects/demo").planning.writes).toBe(1);
  });

  it("tracks planning lookup outcomes and projection sync counters", () => {
    recordBuilderPlanningCacheLookup({
      projectRelativePath: "projects/demo",
      key: "key-1",
      outcome: "miss",
    });
    recordBuilderPlanningCacheLookup({
      projectRelativePath: "projects/demo",
      key: "key-1",
      outcome: "hit",
    });
    recordBuilderPlanningCacheLookup({
      projectRelativePath: "projects/demo",
      key: "key-2",
      outcome: "bypass",
    });
    recordBuilderProjectionCacheSync({
      projectRelativePath: "projects/demo",
      filesWritten: 3,
      filesSkipped: 9,
      manifestReused: true,
    });

    expect(readBuilderCacheStats("projects/demo")).toEqual(expect.objectContaining({
      planning: expect.objectContaining({
        lookups: 3,
        hits: 1,
        misses: 1,
        bypasses: 1,
      }),
      projection: expect.objectContaining({
        syncs: 1,
        filesWritten: 3,
        filesSkipped: 9,
        manifestReused: 1,
        manifestWrites: 0,
      }),
    }));
  });
});