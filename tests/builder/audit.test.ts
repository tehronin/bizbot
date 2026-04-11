import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listBuilderCapabilityAuditEvents } from "@/lib/builder/audit";

function createTempBuilderWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-builder-audit-"));
}

describe("builder capability audit", () => {
  it("derives severity and prunes expired and overflow audit records", () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const auditPath = path.join(workspaceRoot, "projects/demo/.builder/reports/capability-audit.jsonl");
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });

    const now = Date.now();
    const records = [
      {
        eventId: "expired-blocked",
        version: 1,
        capabilityKey: "workspace_manipulation",
        eventName: "builder.workspace.mutation",
        timestamp: new Date(now - (35 * 24 * 60 * 60 * 1000)).toISOString(),
        actor: "builder_operator",
        projectId: "project-1",
        taskId: null,
        runId: null,
        scope: "project_or_workspace",
        targets: [],
        outcomeStatus: "blocked",
      },
      ...Array.from({ length: 250 }, (_, index) => ({
        eventId: `recent-success-${index}`,
        version: 1,
        capabilityKey: "workspace_manipulation",
        eventName: "builder.workspace.mutation",
        timestamp: new Date(now - ((252 - index) * 1000)).toISOString(),
        actor: "builder_operator",
        projectId: "project-1",
        taskId: null,
        runId: null,
        scope: "project_or_workspace",
        targets: [],
        outcomeStatus: "succeeded",
      })),
      {
        eventId: "recent-cancelled",
        version: 1,
        capabilityKey: "process_execution",
        eventName: "builder.process.execution",
        timestamp: new Date(now - 500).toISOString(),
        actor: "builder_operator",
        projectId: "project-1",
        taskId: null,
        runId: null,
        scope: "project_or_workspace",
        targets: [],
        outcomeStatus: "cancelled",
      },
      {
        eventId: "recent-failed",
        version: 1,
        capabilityKey: "governance_contracts",
        eventName: "builder.governance.reconciliation",
        timestamp: new Date(now).toISOString(),
        actor: "builder_operator",
        projectId: "project-1",
        taskId: null,
        runId: null,
        scope: "project",
        targets: [],
        outcomeStatus: "failed",
      },
    ];

    fs.writeFileSync(auditPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf-8");

    const overview = listBuilderCapabilityAuditEvents("projects/demo", { limit: 3 });

    expect(overview.totalEvents).toBe(250);
    expect(overview.retention).toEqual(expect.objectContaining({
      maxEvents: 250,
      maxAgeDays: 30,
      droppedExpiredCount: 1,
      droppedOverflowCount: 2,
    }));
    expect(overview.severityCounts).toEqual(expect.objectContaining({
      info: 248,
      warning: 1,
      critical: 1,
    }));
    expect(overview.recentEvents[0]).toEqual(expect.objectContaining({
      eventId: "recent-failed",
      severity: "critical",
    }));

    const retainedLines = fs.readFileSync(auditPath, "utf-8").trim().split(/\r?\n/);
    expect(retainedLines).toHaveLength(250);
  });
});