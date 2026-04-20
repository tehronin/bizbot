import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CreateMessageRequestSchema } from "@modelcontextprotocol/sdk/types.js";

vi.mock("@/lib/mcp/devloop-context", () => ({
  buildCurrentBuilderDevLoopContext: vi.fn(async () => ({
    generatedAt: "2026-04-10T12:00:00.000Z",
    project: {
      id: "project_123",
      name: "Builder Demo",
      slug: "builder-demo",
      relativePath: "projects/builder-demo",
      template: "next-prisma",
      packageManager: "NPM",
      lifecycle: "ACTIVE",
      updatedAt: "2026-04-10T12:00:00.000Z",
    },
    currentTask: {
      id: "task_123",
      title: "Repair builder loop",
      status: "RUNNING",
      stage: "VERIFY",
      updatedAt: "2026-04-10T12:00:00.000Z",
    },
    mcpSnapshot: { state: "drifted" },
    dependencyContract: { state: "aligned" },
    fileTopologyContract: { state: "pending_capture" },
    latestReview: {
      taskId: "task_123",
      status: "FAILED",
      stage: "VERIFY",
      summary: "Tests are still failing.",
      risks: ["verification gap"],
      nextSteps: ["inspect failing test"],
      updatedAt: "2026-04-10T12:00:00.000Z",
    },
    recentRuns: [
      {
        id: "run_123",
        title: "Loop attempt 1",
        kind: "PLAN_TASK",
        status: "FAILED",
        taskId: "task_123",
        startedAt: "2026-04-10T11:55:00.000Z",
        finishedAt: "2026-04-10T11:58:00.000Z",
        blockedReason: "TypeScript compile error in route handler.",
      },
    ],
    operatorTrust: {
      overallStatus: "warning",
      summary: "Runtime needs review.",
      runtime: {
        status: "warning",
        summary: "Recent run failed during verification.",
      },
    },
    configReadiness: {
      projectReady: true,
      executionReady: true,
      summary: "Ready",
    },
    currentBlockerOrLastErrorSignal: {
      activeRunBlockedReason: "TypeScript compile error in route handler.",
      latestReviewSummary: "Tests are still failing.",
      latestReviewRisks: ["verification gap"],
      latestFailedRun: {
        id: "run_123",
        title: "Loop attempt 1",
        status: "FAILED",
        blockedReason: "TypeScript compile error in route handler.",
        startedAt: "2026-04-10T11:55:00.000Z",
        finishedAt: "2026-04-10T11:58:00.000Z",
      },
      trustRuntimeSummary: {
        overallStatus: "warning",
        overallSummary: "Runtime needs review.",
        runtimeStatus: "warning",
        runtimeSummary: "Recent run failed during verification.",
      },
    },
    diagnosticSummary: {
      validation: {
        passed: false,
        skipped: false,
        summary: "Verification failed during test.",
        scripts: ["test"],
        buildSummary: null,
        testSummary: "test failed (1).",
        lintSummary: null,
      },
      contracts: {
        mcpSnapshotState: "drifted",
        dependencyContractState: "aligned",
        fileTopologyContractState: "pending_capture",
        summary: "MCP snapshot drifted; dependency contract aligned; file topology contract pending_capture.",
      },
      reviewFocus: {
        summary: "Tests are still failing.",
        risks: ["verification gap"],
        nextSteps: ["inspect failing test"],
      },
      trustFocus: {
        overallStatus: "warning",
        runtimeStatus: "warning",
        governanceStatus: "warning",
        summary: "Runtime needs review.",
      },
      probeTargets: ["Inspect the active Builder MCP contract drift and snapshot baseline."],
    },
  })),
}));

describe("stdio MCP sampling e2e", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("completes initialize, tool discovery, and a sampling-backed developer loop assist call", async () => {
    const [{ createBizBotMcpServer }, { getStdioMcpServerOptions }] = await Promise.all([
      import("@/lib/mcp/server"),
      import("@/lib/mcp/stdio"),
    ]);

    const samplingHandler = vi.fn(async () => ({
      role: "assistant" as const,
      content: {
        type: "text" as const,
        text: JSON.stringify({
          summary: "The MCP snapshot drifted after a contract change.",
          status: "warning",
          tripletHealth: {
            overall: "drifted",
            mcpSnapshot: "drifted",
            dependencyContract: "aligned",
            fileTopologyContract: "pending",
          },
          latestFailure: "TypeScript compile error in route handler.",
          likelyRootCause: "The Builder MCP snapshot baseline is stale.",
          suggestedFix: "Refresh the MCP snapshot baseline and re-run verification.",
          smallestNextFix: "Refresh the accepted MCP snapshot baseline.",
          recommendedNextProbe: "Inspect the active Builder MCP contract drift and current contract seed.",
          evidenceUsed: ["MCP snapshot drifted", "TypeScript compile error in route handler."],
          nextSteps: ["inspect the changed MCP contract", "refresh the snapshot baseline"],
          confidence: "high",
        }),
      },
      model: "gpt-5.4",
      stopReason: "endTurn" as const,
    }));

    const server = createBizBotMcpServer(getStdioMcpServerOptions());
    const client = new Client(
      { name: "vitest-sampling-client", version: "1.0.0" },
      { capabilities: { sampling: { tools: {} } } },
    );
    client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
      expect(request.params).toEqual(expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "developer_list_agent_runs" }),
        ]),
        toolChoice: { mode: "auto" },
        metadata: expect.objectContaining({ toolsAllowed: true }),
      }));
      expect(request.params.tools).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "developer_vscode_loop_assist" }),
        expect.objectContaining({ name: "developer_invoke_imported_mcp_tool" }),
      ]));
      return samplingHandler();
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const toolsResult = await client.listTools();
    expect(toolsResult.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "developer_vscode_loop_assist" }),
    ]));

    const callResult = await client.callTool({ name: "developer_vscode_loop_assist", arguments: {} });
    expect(samplingHandler).toHaveBeenCalledTimes(1);
    expect(callResult.structuredContent).toEqual(expect.objectContaining({
      sampling: expect.objectContaining({
        available: true,
        transportKind: "stdio",
        allowTools: true,
        clientSupportsSampling: true,
        clientSupportsSamplingTools: true,
      }),
      result: expect.objectContaining({
        diagnosisSource: "sampled",
        status: "warning",
        likelyRootCause: "The Builder MCP snapshot baseline is stale.",
        suggestedFix: "Refresh the MCP snapshot baseline and re-run verification.",
        smallestNextFix: "Refresh the accepted MCP snapshot baseline.",
        confidence: "high",
        model: "gpt-5.4",
      }),
    }));

    await Promise.all([client.close(), server.close()]);
  });
});