import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  type BuilderAuditOutcomeStatus,
  type BuilderAuditTargetKind,
  getBuilderCapability,
} from "@/lib/builder/capabilities";
import { resolveBuilderWorkspacePath } from "@/lib/builder/config";

export const BUILDER_CAPABILITY_AUDIT_RETENTION_MAX_EVENTS = 250;
export const BUILDER_CAPABILITY_AUDIT_RETENTION_MAX_AGE_DAYS = 30;

export type BuilderCapabilityAuditSeverity = "info" | "warning" | "critical";

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
  severity: BuilderCapabilityAuditSeverity;
  metadata?: Record<string, unknown>;
}

export interface BuilderCapabilityAuditRetentionState {
  maxEvents: number;
  maxAgeDays: number;
  droppedExpiredCount: number;
  droppedOverflowCount: number;
}

export interface BuilderCapabilityAuditOverview {
  auditPath: string;
  totalEvents: number;
  capabilityCounts: Record<string, number>;
  outcomeCounts: Record<string, number>;
  severityCounts: Record<BuilderCapabilityAuditSeverity, number>;
  retention: BuilderCapabilityAuditRetentionState;
  recentEvents: BuilderCapabilityAuditEventRecord[];
}

export interface BuilderCapabilityAuditContext {
  projectRelativePath?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  runId?: string | null;
}

function resolveCapabilityAuditRelativePath(projectRelativePath?: string | null): string {
  if (projectRelativePath && projectRelativePath.trim()) {
    return path.posix.join(projectRelativePath, ".builder", "reports", "capability-audit.jsonl");
  }
  return path.posix.join(".builder", "reports", "capability-audit.jsonl");
}

function buildEmptySeverityCounts(): Record<BuilderCapabilityAuditSeverity, number> {
  return {
    info: 0,
    warning: 0,
    critical: 0,
  };
}

function buildDefaultRetentionState(): BuilderCapabilityAuditRetentionState {
  return {
    maxEvents: BUILDER_CAPABILITY_AUDIT_RETENTION_MAX_EVENTS,
    maxAgeDays: BUILDER_CAPABILITY_AUDIT_RETENTION_MAX_AGE_DAYS,
    droppedExpiredCount: 0,
    droppedOverflowCount: 0,
  };
}

function deriveCapabilityAuditSeverity(outcomeStatus: BuilderAuditOutcomeStatus): BuilderCapabilityAuditSeverity {
  switch (outcomeStatus) {
    case "failed":
    case "blocked":
    case "timed_out":
      return "critical";
    case "cancelled":
      return "warning";
    default:
      return "info";
  }
}

function normalizeCapabilityAuditEvent(record: BuilderCapabilityAuditEventRecord): BuilderCapabilityAuditEventRecord {
  return {
    ...record,
    severity: record.severity ?? deriveCapabilityAuditSeverity(record.outcomeStatus),
  };
}

function getEventTimestampValue(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readCapabilityAuditRecords(absolutePath: string): BuilderCapabilityAuditEventRecord[] {
  if (!fs.existsSync(absolutePath)) {
    return [];
  }

  return fs.readFileSync(absolutePath, "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [normalizeCapabilityAuditEvent(JSON.parse(line) as BuilderCapabilityAuditEventRecord)];
      } catch {
        return [];
      }
    });
}

function retainCapabilityAuditRecords(records: BuilderCapabilityAuditEventRecord[]): {
  retainedChronological: BuilderCapabilityAuditEventRecord[];
  retention: BuilderCapabilityAuditRetentionState;
} {
  const now = Date.now();
  const maxAgeMs = BUILDER_CAPABILITY_AUDIT_RETENTION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const chronological = [...records].sort((left, right) => getEventTimestampValue(left.timestamp) - getEventTimestampValue(right.timestamp));
  const fresh = chronological.filter((entry) => {
    const timestampValue = getEventTimestampValue(entry.timestamp);
    return timestampValue === 0 || (now - timestampValue) <= maxAgeMs;
  });
  const droppedExpiredCount = chronological.length - fresh.length;
  const droppedOverflowCount = Math.max(0, fresh.length - BUILDER_CAPABILITY_AUDIT_RETENTION_MAX_EVENTS);
  const retainedChronological = droppedOverflowCount > 0
    ? fresh.slice(droppedOverflowCount)
    : fresh;

  return {
    retainedChronological,
    retention: {
      maxEvents: BUILDER_CAPABILITY_AUDIT_RETENTION_MAX_EVENTS,
      maxAgeDays: BUILDER_CAPABILITY_AUDIT_RETENTION_MAX_AGE_DAYS,
      droppedExpiredCount,
      droppedOverflowCount,
    },
  };
}

function persistCapabilityAuditRecords(absolutePath: string, records: BuilderCapabilityAuditEventRecord[]): void {
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const serialized = records.map((record) => JSON.stringify(record)).join("\n");
  fs.writeFileSync(absolutePath, serialized.length > 0 ? `${serialized}\n` : "", "utf-8");
}

function reconcileCapabilityAuditLog(absolutePath: string): {
  retainedDescending: BuilderCapabilityAuditEventRecord[];
  retention: BuilderCapabilityAuditRetentionState;
} {
  const records = readCapabilityAuditRecords(absolutePath);
  const { retainedChronological, retention } = retainCapabilityAuditRecords(records);
  if (records.length !== retainedChronological.length
    || retention.droppedExpiredCount > 0
    || retention.droppedOverflowCount > 0) {
    persistCapabilityAuditRecords(absolutePath, retainedChronological);
  }

  return {
    retainedDescending: [...retainedChronological].sort((left, right) => right.timestamp.localeCompare(left.timestamp)),
    retention,
  };
}

export function appendBuilderCapabilityAuditEvent(args: {
  capabilityKey: string;
  projectRelativePath?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  runId?: string | null;
  outcomeStatus: BuilderAuditOutcomeStatus;
  targets: BuilderCapabilityAuditEventRecord["targets"];
  severity?: BuilderCapabilityAuditSeverity;
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
    severity: args.severity ?? deriveCapabilityAuditSeverity(args.outcomeStatus),
    metadata: args.metadata,
  };

  const { retainedChronological } = retainCapabilityAuditRecords([
    ...readCapabilityAuditRecords(absolutePath),
    event,
  ]);
  persistCapabilityAuditRecords(absolutePath, retainedChronological);
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
      severityCounts: buildEmptySeverityCounts(),
      retention: buildDefaultRetentionState(),
      recentEvents: [],
    };
  }

  const limit = Math.max(1, Math.trunc(options?.limit ?? 12));
  const { retainedDescending: records, retention } = reconcileCapabilityAuditLog(absolutePath);

  const capabilityCounts = records.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.capabilityKey] = (counts[entry.capabilityKey] ?? 0) + 1;
    return counts;
  }, {});
  const outcomeCounts = records.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.outcomeStatus] = (counts[entry.outcomeStatus] ?? 0) + 1;
    return counts;
  }, {});
  const severityCounts = records.reduce<Record<BuilderCapabilityAuditSeverity, number>>((counts, entry) => {
    counts[entry.severity] = (counts[entry.severity] ?? 0) + 1;
    return counts;
  }, buildEmptySeverityCounts());

  return {
    auditPath,
    totalEvents: records.length,
    capabilityCounts,
    outcomeCounts,
    severityCounts,
    retention,
    recentEvents: records.slice(0, limit),
  };
}