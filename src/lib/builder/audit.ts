import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  type BuilderAuditOutcomeStatus,
  type BuilderAuditTargetKind,
  getBuilderCapability,
} from "@/lib/builder/capabilities";
import { resolveBuilderWorkspacePath } from "@/lib/builder/config";

export interface BuilderCapabilityAuditEventRecord {
  eventId: string;
  version: 1;
  capabilityKey: string;
  eventName: string;
  timestamp: string;
  actor: "builder_operator";
  projectId: string | null;
  taskId: string | null;
  runId: string | null;
  scope: "project" | "workspace" | "project_or_workspace";
  targets: Array<{
    kind: BuilderAuditTargetKind;
    identifier: string;
    metadata?: Record<string, unknown>;
  }>;
  outcomeStatus: BuilderAuditOutcomeStatus;
  metadata?: Record<string, unknown>;
}

export interface BuilderCapabilityAuditOverview {
  auditPath: string;
  totalEvents: number;
  capabilityCounts: Record<string, number>;
  outcomeCounts: Record<string, number>;
  recentEvents: BuilderCapabilityAuditEventRecord[];
}

function resolveCapabilityAuditRelativePath(projectRelativePath?: string | null): string {
  if (projectRelativePath && projectRelativePath.trim()) {
    return path.posix.join(projectRelativePath, ".builder", "reports", "capability-audit.jsonl");
  }
  return path.posix.join(".builder", "reports", "capability-audit.jsonl");
}

export function appendBuilderCapabilityAuditEvent(args: {
  capabilityKey: string;
  projectRelativePath?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  runId?: string | null;
  outcomeStatus: BuilderAuditOutcomeStatus;
  targets: BuilderCapabilityAuditEventRecord["targets"];
  metadata?: Record<string, unknown>;
}): { event: BuilderCapabilityAuditEventRecord; auditPath: string } {
  const capability = getBuilderCapability(args.capabilityKey);
  if (!capability) {
    throw new Error(`Unknown Builder capability for audit event: ${args.capabilityKey}`);
  }

  const auditPath = resolveCapabilityAuditRelativePath(args.projectRelativePath);
  const absolutePath = resolveBuilderWorkspacePath(auditPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

  const event: BuilderCapabilityAuditEventRecord = {
    eventId: randomUUID(),
    version: 1,
    capabilityKey: capability.key,
    eventName: capability.audit.eventName,
    timestamp: new Date().toISOString(),
    actor: "builder_operator",
    projectId: args.projectId ?? null,
    taskId: args.taskId ?? null,
    runId: args.runId ?? null,
    scope: capability.audit.scope,
    targets: args.targets,
    outcomeStatus: args.outcomeStatus,
    metadata: args.metadata,
  };

  fs.appendFileSync(absolutePath, `${JSON.stringify(event)}\n`, "utf-8");
  return { event, auditPath };
}

export function listBuilderCapabilityAuditEvents(projectRelativePath: string, options?: { limit?: number }): BuilderCapabilityAuditOverview {
  const auditPath = resolveCapabilityAuditRelativePath(projectRelativePath);
  const absolutePath = resolveBuilderWorkspacePath(auditPath);
  if (!fs.existsSync(absolutePath)) {
    return {
      auditPath,
      totalEvents: 0,
      capabilityCounts: {},
      outcomeCounts: {},
      recentEvents: [],
    };
  }

  const limit = Math.max(1, Math.trunc(options?.limit ?? 12));
  const records = fs.readFileSync(absolutePath, "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as BuilderCapabilityAuditEventRecord];
      } catch {
        return [];
      }
    })
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));

  const capabilityCounts = records.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.capabilityKey] = (counts[entry.capabilityKey] ?? 0) + 1;
    return counts;
  }, {});
  const outcomeCounts = records.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.outcomeStatus] = (counts[entry.outcomeStatus] ?? 0) + 1;
    return counts;
  }, {});

  return {
    auditPath,
    totalEvents: records.length,
    capabilityCounts,
    outcomeCounts,
    recentEvents: records.slice(0, limit),
  };
}