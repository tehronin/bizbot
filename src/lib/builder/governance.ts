import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { BuilderGovernanceCommandInput, BuilderGovernanceSourceSurface } from "@/lib/builder/governance-shared";
import { resolveBuilderWorkspacePath } from "@/lib/builder/config";

export interface BuilderGovernanceDecisionRecord {
  eventId: string;
  version: 1;
  timestamp: string;
  projectId: string;
  action: BuilderGovernanceCommandInput["action"];
  decision: "approve" | "reject" | "reconcile";
  reason: string;
  sourceSurface: BuilderGovernanceSourceSurface;
  commandRunId: string;
  targetRunId: string | null;
  outcome: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

function getGovernanceDecisionRelativePath(projectRelativePath: string): string {
  return path.posix.join(projectRelativePath, ".builder", "reports", "governance-decisions.jsonl");
}

export function appendBuilderGovernanceDecision(args: {
  projectId: string;
  projectRelativePath: string;
  action: BuilderGovernanceCommandInput["action"];
  decision: "approve" | "reject" | "reconcile";
  reason: string;
  sourceSurface: BuilderGovernanceSourceSurface;
  commandRunId: string;
  targetRunId?: string | null;
  outcome: string;
  summary: string;
  metadata?: Record<string, unknown>;
}): { event: BuilderGovernanceDecisionRecord; auditPath: string } {
  const auditPath = getGovernanceDecisionRelativePath(args.projectRelativePath);
  const absolutePath = resolveBuilderWorkspacePath(auditPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

  const event: BuilderGovernanceDecisionRecord = {
    eventId: randomUUID(),
    version: 1,
    timestamp: new Date().toISOString(),
    projectId: args.projectId,
    action: args.action,
    decision: args.decision,
    reason: args.reason,
    sourceSurface: args.sourceSurface,
    commandRunId: args.commandRunId,
    targetRunId: args.targetRunId ?? null,
    outcome: args.outcome,
    summary: args.summary,
    metadata: args.metadata,
  };

  fs.appendFileSync(absolutePath, `${JSON.stringify(event)}\n`, "utf-8");
  return { event, auditPath };
}

export function listBuilderGovernanceDecisions(projectRelativePath: string, options?: { limit?: number }): {
  auditPath: string;
  totalEvents: number;
  recentEvents: BuilderGovernanceDecisionRecord[];
} {
  const auditPath = getGovernanceDecisionRelativePath(projectRelativePath);
  const absolutePath = resolveBuilderWorkspacePath(auditPath);
  if (!fs.existsSync(absolutePath)) {
    return {
      auditPath,
      totalEvents: 0,
      recentEvents: [],
    };
  }

  const limit = Math.max(1, Math.trunc(options?.limit ?? 8));
  const records = fs.readFileSync(absolutePath, "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as BuilderGovernanceDecisionRecord];
      } catch {
        return [];
      }
    })
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));

  return {
    auditPath,
    totalEvents: records.length,
    recentEvents: records.slice(0, limit),
  };
}