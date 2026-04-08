import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  autonomyPreset: "approval_all_posts",
  tools: [
    {
      name: "builder_get_project",
      title: "Get Builder Project",
      description: "Read the current Builder project.",
      ownerId: "builder",
      ownerKind: "builtin-plugin",
      annotations: { readOnlyHint: true },
      parameters: { type: "object", properties: { projectId: { type: "string" } } },
    },
  ] as Array<Record<string, unknown>>,
  prompts: [
    {
      name: "debug-runtime",
      title: "Debug Runtime",
      description: "Investigate runtime issues.",
      ownerId: "developer",
      group: "developer",
      arguments: [{ name: "symptom", required: false, description: "Symptom summary." }],
    },
  ] as Array<Record<string, unknown>>,
  resources: [
    {
      name: "builder-current-project",
      uri: "bizbot://builder/current-project",
      title: "Current Builder Project",
      description: "Current Builder project state.",
      ownerId: "builder",
      group: "builder",
      mimeType: "application/json",
    },
  ] as Array<Record<string, unknown>>,
  importedPrompts: [] as Array<Record<string, unknown>>,
  importedResources: [] as Array<Record<string, unknown>>,
  snapshots: [] as Array<Record<string, unknown>>,
  nextId: 1,
}));

vi.mock("@/lib/agent/runtime", () => ({
  getAgentRuntimeConfig: () => ({ autonomyPreset: state.autonomyPreset }),
  getAgentCapabilities: () => ({ promptAssembly: true, toolExecution: true }),
}));

vi.mock("@/lib/mcp/tool-presentation", () => ({
  MCP_AGENT_PROFILE: "builder_operator",
  MCP_BLOCKED_TOOLS: new Set<string>(),
}));

vi.mock("@/lib/mcp/client", () => ({
  getMcpClientPrompts: () => state.importedPrompts,
  getMcpClientResources: () => state.importedResources,
}));

vi.mock("@/lib/mcp/preview-catalog", () => ({
  listCurrentMcpToolDescriptors: () => state.tools,
  listBizBotPromptDefinitions: () => state.prompts,
  listBizBotResourceDefinitions: () => state.resources,
}));

vi.mock("@/lib/db", () => ({
  db: {
    builderMcpSnapshot: {
      findMany: async ({ where }: { where: { runId?: string } }) =>
        state.snapshots
          .filter((snapshot) => !where.runId || snapshot.runId === where.runId)
          .sort((left, right) => Number(right.snapshotSequence) - Number(left.snapshotSequence)),
      findFirst: async ({ where }: { where: { runId?: string; projectId?: string } }) => {
        const filtered = state.snapshots
          .filter((snapshot) => (!where.runId || snapshot.runId === where.runId) && (!where.projectId || snapshot.projectId === where.projectId))
          .sort((left, right) => {
            const appliedDiff = new Date(String(right.appliedAt)).getTime() - new Date(String(left.appliedAt)).getTime();
            if (appliedDiff !== 0) {
              return appliedDiff;
            }
            return Number(right.snapshotSequence) - Number(left.snapshotSequence);
          });
        return filtered[0] ?? null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const record = {
          id: `snapshot-${state.nextId++}`,
          appliedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        state.snapshots.push(record);
        return record;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const index = state.snapshots.findIndex((snapshot) => snapshot.id === where.id);
        if (index === -1) {
          throw new Error(`missing snapshot ${where.id}`);
        }
        state.snapshots[index] = {
          ...state.snapshots[index],
          ...data,
          updatedAt: new Date(),
        };
        return state.snapshots[index];
      },
    },
  },
}));

import {
  appendBuilderMcpSnapshotMapping,
  canonicalizeBuilderMcpContractSnapshot,
  ensureBuilderRunMcpSnapshotPreflight,
  getBuilderMcpSnapshotOverview,
  hashBuilderMcpContractSnapshot,
  listBuilderMcpSnapshotsForRun,
  resolveBuilderRunMcpContractDrift,
} from "@/lib/builder/mcp-snapshots";

beforeEach(() => {
  state.autonomyPreset = "approval_all_posts";
  state.tools = [
    {
      name: "builder_get_project",
      title: "Get Builder Project",
      description: "Read the current Builder project.",
      ownerId: "builder",
      ownerKind: "builtin-plugin",
      annotations: { readOnlyHint: true },
      parameters: { type: "object", properties: { projectId: { type: "string" } } },
    },
  ];
  state.prompts = [
    {
      name: "debug-runtime",
      title: "Debug Runtime",
      description: "Investigate runtime issues.",
      ownerId: "developer",
      group: "developer",
      arguments: [{ name: "symptom", required: false, description: "Symptom summary." }],
    },
  ];
  state.resources = [
    {
      name: "builder-current-project",
      uri: "bizbot://builder/current-project",
      title: "Current Builder Project",
      description: "Current Builder project state.",
      ownerId: "builder",
      group: "builder",
      mimeType: "application/json",
    },
  ];
  state.importedPrompts = [];
  state.importedResources = [];
  state.snapshots = [];
  state.nextId = 1;
});

describe("builder mcp snapshots", () => {
  it("keeps canonical hashing invariant to object key order but changes on semantic drift", () => {
    const left = {
      contract: {
        version: "v1",
        compatibilityPolicyVersion: "v1",
        mcpLane: "builder_operator",
        blockedTools: [],
        promptsAreServerOwned: true,
        resourcesAreServerOwned: true,
        importedCatalogs: { prompts: true, resources: true },
        toolOwnershipRequired: true,
        laneBoundedExposure: true,
      },
      profile: {
        agentProfile: "builder_operator",
        autonomyPreset: "approval_all_posts",
        capabilities: { toolExecution: true, promptAssembly: true },
      },
      tools: [{
        name: "builder_get_project",
        title: "Get Builder Project",
        description: "Read the current Builder project.",
        ownerId: "builder",
        ownerKind: "builtin-plugin",
        annotations: { b: 2, a: 1 },
        parameters: { properties: { b: { type: "string" }, a: { type: "string" } }, type: "object" },
      }],
      prompts: [],
      resources: [],
    };
    const right = {
      contract: {
        compatibilityPolicyVersion: "v1",
        blockedTools: [],
        importedCatalogs: { resources: true, prompts: true },
        laneBoundedExposure: true,
        mcpLane: "builder_operator",
        promptsAreServerOwned: true,
        resourcesAreServerOwned: true,
        toolOwnershipRequired: true,
        version: "v1",
      },
      prompts: [],
      resources: [],
      tools: [{
        ownerKind: "builtin-plugin",
        ownerId: "builder",
        description: "Read the current Builder project.",
        title: "Get Builder Project",
        name: "builder_get_project",
        parameters: { type: "object", properties: { a: { type: "string" }, b: { type: "string" } } },
        annotations: { a: 1, b: 2 },
      }],
      profile: {
        capabilities: { promptAssembly: true, toolExecution: true },
        autonomyPreset: "approval_all_posts",
        agentProfile: "builder_operator",
      },
    };

    expect(canonicalizeBuilderMcpContractSnapshot(left as never)).toBe(canonicalizeBuilderMcpContractSnapshot(right as never));
    expect(hashBuilderMcpContractSnapshot(left as never)).toBe(hashBuilderMcpContractSnapshot(right as never));
    expect(hashBuilderMcpContractSnapshot({ ...right, tools: [{ ...(right.tools[0] as Record<string, unknown>), description: "Different contract" }] } as never))
      .not.toBe(hashBuilderMcpContractSnapshot(right as never));
  });

  it("detects project-level drift for a new run and supports approved rollover sequencing", async () => {
    const initial = await ensureBuilderRunMcpSnapshotPreflight({
      projectId: "project-1",
      runId: "run-1",
      taskId: "task-1",
      taskSpecId: "task-spec-1",
    });

    expect(initial.status).toBe("captured");
    expect(initial.snapshot.snapshotSequence).toBe(1);

    state.tools = [
      ...state.tools,
      {
        name: "builder_run_script",
        title: "Run Builder Script",
        description: "Run a package script in the Builder workspace.",
        ownerId: "builder",
        ownerKind: "builtin-plugin",
        annotations: { mutating: true },
        parameters: { type: "object", properties: { script: { type: "string" } } },
      },
    ];

    await expect(ensureBuilderRunMcpSnapshotPreflight({
      projectId: "project-1",
      runId: "run-2",
      taskId: "task-2",
      taskSpecId: "task-spec-2",
    })).rejects.toThrow("operator approval is required");

    const approved = await resolveBuilderRunMcpContractDrift({
      projectId: "project-1",
      runId: "run-2",
      taskId: "task-2",
      taskSpecId: "task-spec-2",
      decision: "approve",
      reason: "New script runner was intentionally added.",
    });

    expect(approved.status).toBe("approved");
    expect(approved.snapshot?.snapshotSequence).toBe(1);

    state.tools = state.tools.map((tool) => tool.name === "builder_run_script"
      ? { ...tool, description: "Run or verify a package script in the Builder workspace." }
      : tool);

    const secondApproval = await resolveBuilderRunMcpContractDrift({
      projectId: "project-1",
      runId: "run-2",
      taskId: "task-2",
      taskSpecId: "task-spec-2",
      decision: "approve",
      reason: "Schema changed again.",
    });

    expect(secondApproval.status).toBe("approved");
    expect(secondApproval.snapshot?.snapshotSequence).toBe(2);
  });

  it("appends runtime mappings without duplicating the same tool provenance record", async () => {
    await ensureBuilderRunMcpSnapshotPreflight({
      projectId: "project-1",
      runId: "run-3",
      taskId: "task-3",
      taskSpecId: "task-spec-3",
    });

    await appendBuilderMcpSnapshotMapping({
      runId: "run-3",
      toolName: "builder_get_project",
      agentRunId: "agent-run-1",
      taskId: "task-3",
      taskSpecId: "task-spec-3",
      validatorContext: ["MANUAL_REVIEW"],
      activeAdrDecisionKeys: ["mcp_contract_layer"],
      ontologyHints: ["mcp_contract_layer"],
    });
    await appendBuilderMcpSnapshotMapping({
      runId: "run-3",
      toolName: "builder_get_project",
      agentRunId: "agent-run-1",
      taskId: "task-3",
      taskSpecId: "task-spec-3",
      validatorContext: ["MANUAL_REVIEW"],
      activeAdrDecisionKeys: ["mcp_contract_layer"],
      ontologyHints: ["mcp_contract_layer"],
    });
    await appendBuilderMcpSnapshotMapping({
      runId: "run-3",
      toolName: "builder_get_project",
      agentRunId: "agent-run-2",
      taskId: "task-4",
      taskSpecId: "task-spec-4",
      validatorContext: ["TEST"],
      activeAdrDecisionKeys: ["mcp_contract_layer"],
      ontologyHints: ["ontology_runtime"],
    });

    const snapshots = await listBuilderMcpSnapshotsForRun("run-3");
    expect(snapshots[0]?.mappings).toHaveLength(2);
    expect(snapshots[0]?.mappings[0]?.toolName).toBe("builder_get_project");
  });

  it("surfaces drift in the overview even before a new run records its first local snapshot", async () => {
    await ensureBuilderRunMcpSnapshotPreflight({
      projectId: "project-1",
      runId: "run-1",
      taskId: "task-1",
      taskSpecId: "task-spec-1",
    });

    state.tools = [
      ...state.tools,
      {
        name: "developer_preview_mcp_exposure",
        title: "Preview MCP Exposure",
        description: "Inspect MCP exposure state.",
        ownerId: "developer",
        ownerKind: "builtin-plugin",
        annotations: { readOnlyHint: true },
        parameters: { type: "object", properties: {} },
      },
    ];

    const overview = await getBuilderMcpSnapshotOverview({
      projectId: "project-1",
      runId: "run-2",
    });

    expect(overview.state).toBe("drifted");
    expect(overview.currentSequence).toBe(1);
    expect(overview.drift?.tools.added).toContain("developer_preview_mcp_exposure");
  });
});