import { describe, expect, it, vi } from "vitest";
import type { BuilderDevLoopContext } from "@/lib/mcp/devloop-context";
import { buildDevLoopSamplingRequest, requestDevLoopSampling } from "@/lib/mcp/sampling";

function buildContext(): BuilderDevLoopContext {
  return {
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
  };
}

describe("MCP sampling bridge", () => {
  it("builds an analysis-only request without tools", () => {
    const request = buildDevLoopSamplingRequest(buildContext());

    expect(request.includeContext).toBe("none");
    expect(request.tools).toBeUndefined();
    expect(request.toolChoice).toBeUndefined();
    expect(request.temperature).toBe(0);
  });

  it("returns unavailable when the connected client does not advertise sampling", async () => {
    const createMessage = vi.fn();

    const result = await requestDevLoopSampling({
      transportKind: "stdio",
      createMessage,
      getClientCapabilities: () => ({}),
    }, buildContext());

    expect(result.diagnosisSource).toBe("deterministic_fallback");
    expect(result.status).toBe("warning");
    expect(result.summary).toContain("did not advertise sampling support");
    expect(result.likelyRootCause).toContain("snapshot baseline");
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("normalizes a structured JSON sampling response", async () => {
    const createMessage = vi.fn(async () => ({
      role: "assistant",
      content: {
        type: "text",
        text: JSON.stringify({
          summary: "The MCP snapshot drifted after a tool contract change.",
          status: "warning",
          tripletHealth: {
            overall: "drifted",
            mcpSnapshot: "drifted",
            dependencyContract: "aligned",
            fileTopologyContract: "pending",
          },
          latestFailure: "TypeScript compile error in route handler.",
          likelyRootCause: "The Builder contract changed without refreshing the MCP snapshot baseline.",
          suggestedFix: "Regenerate or reconcile the MCP snapshot baseline before re-running verification.",
          smallestNextFix: "Refresh the accepted MCP snapshot baseline.",
          recommendedNextProbe: "Inspect the active Builder MCP contract drift and current contract seed.",
          evidenceUsed: ["MCP snapshot drifted", "TypeScript compile error in route handler."],
          nextSteps: ["inspect the changed MCP contract", "refresh the snapshot baseline"],
          confidence: "high",
        }),
      },
      model: "gpt-5.4",
      stopReason: "endTurn",
    }));

    const result = await requestDevLoopSampling({
      transportKind: "stdio",
      createMessage,
      getClientCapabilities: () => ({ sampling: {} }),
    }, buildContext());

    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("warning");
    expect(result.diagnosisSource).toBe("sampled");
    expect(result.tripletHealth).toEqual({
      overall: "drifted",
      mcpSnapshot: "drifted",
      dependencyContract: "aligned",
      fileTopologyContract: "pending",
    });
    expect(result.likelyRootCause).toContain("snapshot baseline");
    expect(result.suggestedFix).toContain("snapshot baseline");
    expect(result.smallestNextFix).toContain("snapshot baseline");
    expect(result.recommendedNextProbe).toContain("contract drift");
    expect(result.evidenceUsed).toEqual(expect.arrayContaining(["MCP snapshot drifted"]));
    expect(result.confidence).toBe("high");
    expect(result.model).toBe("gpt-5.4");
  });

  it("falls back to a deterministic diagnosis when the sampling response is plain text", async () => {
    const result = await requestDevLoopSampling({
      transportKind: "stdio",
      createMessage: vi.fn(async () => ({
        role: "assistant",
        content: { type: "text", text: "The contract looks stale; inspect the active MCP drift first." },
        model: "gpt-5.4",
        stopReason: "endTurn",
      })),
      getClientCapabilities: () => ({ sampling: {} }),
    }, buildContext());

    expect(result.diagnosisSource).toBe("sampled");
    expect(result.summary).toContain("contract looks stale");
    expect(result.smallestNextFix).toContain("snapshot baseline");
    expect(result.recommendedNextProbe).toContain("MCP contract drift");
  });

  it("falls back to a deterministic diagnosis when the sampling response contains malformed JSON", async () => {
    const result = await requestDevLoopSampling({
      transportKind: "stdio",
      createMessage: vi.fn(async () => ({
        role: "assistant",
        content: { type: "text", text: "```json\n{\"summary\":\"bad\",\"status\":\"warning\"\n```" },
        model: "gpt-5.4",
        stopReason: "endTurn",
      })),
      getClientCapabilities: () => ({ sampling: {} }),
    }, buildContext());

    expect(result.diagnosisSource).toBe("sampled");
    expect(result.likelyRootCause).toContain("snapshot baseline");
    expect(result.evidenceUsed.length).toBeGreaterThan(0);
  });

  it("returns a deterministic local diagnosis when sampling is unavailable", async () => {
    const result = await requestDevLoopSampling({
      transportKind: "stdio",
      createMessage: vi.fn(),
      getClientCapabilities: () => ({}),
    }, buildContext());

    expect(result.diagnosisSource).toBe("deterministic_fallback");
    expect(result.status).toBe("warning");
    expect(result.likelyRootCause).toContain("snapshot baseline");
    expect(result.smallestNextFix).toContain("snapshot baseline");
    expect(result.recommendedNextProbe).toContain("MCP contract drift");
  });
});