import { describe, expect, it } from "vitest";
import { composeBuilderOperatorTrustState } from "@/lib/builder/operator-trust";

describe("builder operator trust", () => {
  it("marks trust as blocked when config or runtime are blocked and surfaces approval queue context", () => {
    const trust = composeBuilderOperatorTrustState({
      review: {
        taskId: "task-1",
        projectId: "project-1",
        status: "FAILED",
        stage: "TESTING",
        summary: "Tests failed after implementation.",
        filesChanged: ["src/index.ts"],
        commandsExecuted: ["npm test"],
        validation: { passed: false, skipped: false, summary: "Tests failed.", scripts: ["test"] },
        tests: { passed: false, exitCode: 1, summary: "test failed." },
        lint: { passed: null, exitCode: null, summary: null },
        build: { passed: null, exitCode: null, summary: null },
        config: undefined,
        risks: ["Tests are still failing."],
        nextSteps: ["Fix the failing test."],
        architecture: undefined,
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      configReadiness: {
        schemaPath: ".env.example",
        schemaAvailable: true,
        projectReady: false,
        executionReady: true,
        totalRequiredKeys: 1,
        missingProjectKeys: ["DATABASE_URL"],
        missingExecutionKeys: [],
        malformedEntries: [],
        keys: [],
        summary: "Execution can rely on host env, but project-local env files are missing: DATABASE_URL.",
      },
      reconciliation: {
        thresholds: { staleRunningMs: 1, noProgressMs: 1, identicalFailureThreshold: 2 },
        alerts: [{ code: "stale_running_state", runId: "run-1", taskId: "task-1", severity: "danger", summary: "Run is stale.", autoFixable: false, triggeredAt: "2025-01-01T00:00:00.000Z" }],
        corrections: [],
        activeAlertCount: 1,
        reconciledRunCount: 0,
        unresolvedAlertCount: 1,
      },
      mcpSnapshot: {
        activeRunId: "run-1",
        currentSnapshotId: "snapshot-1",
        currentSequence: 1,
        currentHash: "hash-1",
        state: "drifted",
        history: [],
        drift: {
          previousHash: "hash-0",
          currentHash: "hash-1",
          changed: true,
          tools: { added: [], removed: [], changed: [] },
          prompts: { added: [], removed: [], changed: [] },
          resources: { added: [], removed: [], changed: [] },
          profileChanged: false,
          contractChanged: true,
          impact: {
            classification: "non_breaking",
            requiresVersionBump: false,
            reasons: ["Tool set changed."],
            changedSurfaces: ["tools"],
            reviewFiles: ["docs/sidecar.md"],
          },
        },
        semantic: { queueState: "idle", mappingCount: 0, uniqueToolCount: 0, validatorCount: 0, activeAdrDecisionKeys: [], ontologyHints: [], embeddingFormatVersion: null, embeddedAt: null, ontologySyncVersion: null, ontologySyncedAt: null, cleanupProcessedAt: null },
        semanticMatches: [],
        planning: null,
      },
      approvals: [{ id: "approval-1", postId: "post-1", status: "PENDING", approvalStatus: "PENDING", postStatus: "PENDING_APPROVAL", platform: "Twitter", excerpt: "Queued post excerpt", notes: "Review before publishing", createdAt: "2025-01-01T00:00:00.000Z" }],
    });

    expect(trust.overallStatus).toBe("blocked");
    expect(trust.runtime.status).toBe("blocked");
    expect(trust.config.status).toBe("warning");
    expect(trust.approvals.pendingCount).toBe(1);
    expect(trust.summary).toContain("runtime blocked");
  });
});