import { describe, expect, it } from "vitest";
import { composeBuilderOperatorTrustState } from "@/lib/builder/operator-trust";

describe("builder operator trust", () => {
  it("marks trust as blocked when config or runtime are blocked and surfaces approval queue context", () => {
    delete process.env.BIZBOT_BUILDER_ALLOWED_REMOTES;
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
        vcs: {
          available: true,
          repoRoot: "projects/demo",
          currentBranch: "main",
          headCommitSha: "0123456789abcdef0123456789abcdef01234567",
          ahead: 2,
          behind: 0,
          dirty: true,
          stagedCount: 1,
          unstagedCount: 1,
          untrackedCount: 1,
          conflictedCount: 0,
          stashCount: 0,
          tagCount: 1,
          remoteCount: 1,
          remoteNames: ["origin"],
          pendingPush: true,
          pendingPushContext: "main is 2 commits ahead of origin/main",
          summary: "Git main at 0123456789ab; staged 1; unstaged 1; untracked 1; main is 2 commits ahead of origin/main.",
          auditPath: "projects/demo/.builder/reports/capability-audit.jsonl",
        },
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
      capabilityAudit: {
        auditPath: "projects/demo/.builder/reports/capability-audit.jsonl",
        totalEvents: 3,
        capabilityCounts: { workspace_manipulation: 2, governance_contracts: 1 },
        outcomeCounts: { blocked: 1, cancelled: 1, succeeded: 1 },
        severityCounts: { info: 1, warning: 1, critical: 1 },
        retention: { maxEvents: 250, maxAgeDays: 30, droppedExpiredCount: 0, droppedOverflowCount: 0 },
        recentEvents: [],
      },
      recentRuns: [
        {
          status: "FAILED",
          metadata: {
            review: {
              validation: { passed: false, skipped: false },
              risks: ["compile error", "verification gap"],
              status: "FAILED",
            },
          },
        },
        {
          status: "FAILED",
          metadata: {
            review: {
              validation: { passed: false, skipped: false },
              risks: ["runtime drift"],
              status: "FAILED",
            },
          },
        },
        {
          status: "SUCCEEDED",
          metadata: {
            review: {
              validation: { passed: true, skipped: false },
              risks: [],
              status: "SUCCEEDED",
            },
          },
        },
        {
          status: "SUCCEEDED",
          metadata: {
            review: {
              validation: { passed: true, skipped: false },
              risks: [],
              status: "SUCCEEDED",
            },
          },
        },
      ] as never,
    });

    expect(trust.overallStatus).toBe("blocked");
    expect(trust.runtime.status).toBe("blocked");
    expect(trust.config.status).toBe("warning");
    expect(trust.review.gitDirty).toBe(true);
    expect(trust.review.gitPendingPush).toBe(true);
    expect(trust.governance.status).toBe("blocked");
    expect(trust.approvals.pendingCount).toBe(1);
    expect(trust.governance.gitRemoteAllowlistConfigured).toBe(false);
    expect(trust.governance.gitPushCapableToolsAvailable).toBe(true);
    expect(trust.governance.gitPushRequiresApproval).toBe(true);
    expect(trust.summary).toContain("runtime blocked");
    expect(trust.prioritizedBlockers[0]).toEqual(expect.objectContaining({ key: "runtime", status: "blocked" }));
    expect(trust.prioritizedBlockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "capability_audit", status: "blocked" }),
    ]));
    expect(trust.trend.direction).toBe("degrading");
    expect(trust.trend.basis).toContain("finished Builder runs");
    expect(trust.trend.criticalAuditEvents).toBe(1);
    expect(trust.trend.recentWindow.runCount).toBe(4);
  });
});