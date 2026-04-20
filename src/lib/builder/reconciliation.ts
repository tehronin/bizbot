import type { BuilderRun, BuilderRunStatus, BuilderTask, BuilderTaskStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { completeBuilderRun, updateBuilderRun } from "@/lib/builder/projects";
import { hasBuilderRunController } from "@/lib/builder/session";
import { updateBuilderTask } from "@/lib/builder/tasks";
import { normalizeBuilderTaskMetadata } from "@/lib/builder/types";
import { normalizeFailure, type FailureEnvelope } from "@/lib/failures";

const STALE_RUNNING_THRESHOLD_MS = 15 * 60 * 1000;
const NO_PROGRESS_THRESHOLD_MS = 5 * 60 * 1000;
const IDENTICAL_FAILURE_THRESHOLD = 2;

export interface BuilderOperationalThresholds {
  staleRunningMs: number;
  noProgressMs: number;
  identicalFailureThreshold: number;
}

export interface BuilderOperationalAlert {
  code: string;
  runId: string;
  taskId: string | null;
  severity: "warning" | "danger";
  summary: string;
  autoFixable: boolean;
  triggeredAt: string;
  failure?: FailureEnvelope;
}

export interface BuilderReconciliationAuditEntry {
  runId: string;
  taskId: string | null;
  action: string;
  reason: string;
  previousStatus: string;
  nextStatus: string;
  correctedAt: string;
}

export interface BuilderOperationalStateSummary {
  thresholds: BuilderOperationalThresholds;
  alerts: BuilderOperationalAlert[];
  corrections: BuilderReconciliationAuditEntry[];
  activeAlertCount: number;
  reconciledRunCount: number;
  unresolvedAlertCount: number;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function appendAuditEntry(metadata: unknown, entry: BuilderReconciliationAuditEntry): Record<string, unknown> {
  const candidate = readObject(metadata) ?? {};
  const current = Array.isArray(candidate.reconciliationAudit) ? candidate.reconciliationAudit : [];
  return {
    ...candidate,
    reconciliationAudit: [...current, entry],
  };
}

function collectAuditEntries(runs: BuilderRun[] | undefined): BuilderReconciliationAuditEntry[] {
  if (!Array.isArray(runs) || runs.length === 0) {
    return [];
  }

  return runs.flatMap((run) => {
    const metadata = readObject(run.metadata);
    const entries = Array.isArray(metadata?.reconciliationAudit) ? metadata.reconciliationAudit : [];
    return entries.flatMap((entry) => {
      const candidate = readObject(entry);
      const runId = readString(candidate?.runId);
      const correctedAt = readString(candidate?.correctedAt);
      const action = readString(candidate?.action);
      const reason = readString(candidate?.reason);
      const previousStatus = readString(candidate?.previousStatus);
      const nextStatus = readString(candidate?.nextStatus);
      if (!runId || !correctedAt || !action || !reason || !previousStatus || !nextStatus) {
        return [];
      }

      return [{
        runId,
        taskId: readString(candidate?.taskId),
        action,
        reason,
        previousStatus,
        nextStatus,
        correctedAt,
      } satisfies BuilderReconciliationAuditEntry];
    });
  });
}

function mapTaskStatusToRunStatus(status: BuilderTaskStatus): BuilderRunStatus {
  switch (status) {
    case "SUCCEEDED":
      return "SUCCEEDED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return "FAILED";
  }
}

function mapRunStatusToTaskStatus(status: BuilderRunStatus): BuilderTaskStatus {
  switch (status) {
    case "SUCCEEDED":
      return "SUCCEEDED";
    case "CANCELLED":
      return "CANCELLED";
    case "FAILED":
      return "FAILED";
    default:
      return "RUNNING";
  }
}

function deriveTaskStage(task: BuilderTask, run: BuilderRun): BuilderTask["stage"] {
  if (run.status === "SUCCEEDED") {
    return "DONE";
  }
  const metadata = readObject(run.metadata);
  const stage = readString(metadata?.stage);
  return stage === "PLANNING" || stage === "IMPLEMENTING" || stage === "TESTING" || stage === "REVIEW" || stage === "DONE"
    ? stage
    : task.stage;
}

function isTerminalTaskStatus(status: BuilderTaskStatus): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
}

function getFailureSignature(run: BuilderRun): string | null {
  const metadata = readObject(run.metadata);
  const review = readObject(metadata?.review);
  const validation = readObject(review?.validation);
  return readString(validation?.summary)
    ?? readString(review?.summary)
    ?? readString(run.summary);
}

export function inspectBuilderOperationalState(args: {
  runs: BuilderRun[];
  tasks: BuilderTask[];
  now?: Date;
}): BuilderOperationalStateSummary {
  const now = args.now ?? new Date();
  const runs = Array.isArray(args.runs) ? args.runs : [];
  const tasks = Array.isArray(args.tasks) ? args.tasks : [];
  const corrections = collectAuditEntries(runs);
  const alerts: BuilderOperationalAlert[] = [];
  const taskById = new Map<string, BuilderTask>(tasks.map((task) => [task.id, task]));

  for (const run of runs) {
    const task = run.taskId ? taskById.get(run.taskId) ?? null : null;
    const taskMetadata = task ? normalizeBuilderTaskMetadata(task.metadata) : null;
    const ageMs = now.getTime() - run.startedAt.getTime();
    const hasOutput = Boolean((run.stdout?.trim().length ?? 0) > 0 || (run.stderr?.trim().length ?? 0) > 0);

    if (run.status === "RUNNING" && task && isTerminalTaskStatus(task.status) && taskMetadata?.lastRunId === run.id) {
      const summary = "Run is still RUNNING even though the paired task already reached a terminal state.";
      alerts.push({
        code: "task_run_status_mismatch",
        runId: run.id,
        taskId: task.id,
        severity: "danger",
        summary,
        autoFixable: !hasBuilderRunController(run.id),
        triggeredAt: now.toISOString(),
        failure: normalizeFailure(summary, {
          component: "builder_reconciliation",
          operation: "task_run_status_mismatch",
          layer: "infra",
          suggestedNextAction: "reconcile_run_state",
        }),
      });
    }

    if (run.status === "RUNNING" && ageMs >= STALE_RUNNING_THRESHOLD_MS) {
      const summary = `Run has remained RUNNING for ${Math.round(ageMs / 60000)} minutes.`;
      alerts.push({
        code: "stale_running_state",
        runId: run.id,
        taskId: run.taskId ?? null,
        severity: "danger",
        summary,
        autoFixable: !hasBuilderRunController(run.id),
        triggeredAt: now.toISOString(),
        failure: normalizeFailure(summary, {
          component: "builder_reconciliation",
          operation: "stale_running_state",
          layer: "infra",
          suggestedNextAction: "inspect_stale_run",
        }),
      });
    }

    if (run.status === "RUNNING" && !hasOutput && ageMs >= NO_PROGRESS_THRESHOLD_MS) {
      const summary = `Run has produced no stdout/stderr for ${Math.round(ageMs / 60000)} minutes.`;
      alerts.push({
        code: "running_without_progress",
        runId: run.id,
        taskId: run.taskId ?? null,
        severity: "warning",
        summary,
        autoFixable: false,
        triggeredAt: now.toISOString(),
        failure: normalizeFailure(summary, {
          component: "builder_reconciliation",
          operation: "running_without_progress",
          layer: "infra",
          suggestedNextAction: "inspect_stale_run",
        }),
      });
    }
  }

  const runsByTask = new Map<string, BuilderRun[]>();
  for (const run of runs) {
    if (!run.taskId || run.status !== "FAILED") {
      continue;
    }
    const current = runsByTask.get(run.taskId) ?? [];
    current.push(run);
    runsByTask.set(run.taskId, current);
  }
  for (const [taskId, runs] of runsByTask.entries()) {
    const orderedRuns = [...runs].sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
    const signature = getFailureSignature(orderedRuns[0]!);
    if (!signature) {
      continue;
    }
    const identicalFailures = orderedRuns.filter((run) => getFailureSignature(run) === signature);
    if (identicalFailures.length >= IDENTICAL_FAILURE_THRESHOLD) {
      const summary = `Task has repeated the same failure ${identicalFailures.length} times without changing the outcome.`;
      alerts.push({
        code: "repeated_identical_verification_failure",
        runId: orderedRuns[0]!.id,
        taskId,
        severity: "warning",
        summary,
        autoFixable: false,
        triggeredAt: now.toISOString(),
        failure: normalizeFailure(summary, {
          component: "builder_reconciliation",
          operation: "repeated_identical_verification_failure",
          kind: "repeated_failure",
          suggestedNextAction: "inspect_stuck_loop",
        }),
      });
    }
  }

  return {
    thresholds: {
      staleRunningMs: STALE_RUNNING_THRESHOLD_MS,
      noProgressMs: NO_PROGRESS_THRESHOLD_MS,
      identicalFailureThreshold: IDENTICAL_FAILURE_THRESHOLD,
    },
    alerts,
    corrections,
    activeAlertCount: alerts.length,
    reconciledRunCount: corrections.length,
    unresolvedAlertCount: alerts.filter((alert) => !alert.autoFixable).length,
  };
}

export async function reconcileBuilderOperationalState(args: {
  projectId?: string;
  now?: Date;
} = {}): Promise<BuilderOperationalStateSummary> {
  const runs = await db.builderRun.findMany({
    where: args.projectId ? { projectId: args.projectId } : undefined,
    orderBy: { startedAt: "desc" },
    take: 100,
  });
  const tasks = await db.builderTask.findMany({
    where: args.projectId ? { projectId: args.projectId } : undefined,
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  const taskById = new Map<string, (typeof tasks)[number]>(tasks.map((task) => [task.id, task]));
  const now = args.now ?? new Date();

  for (const run of runs) {
    const pairedTask = run.taskId ? taskById.get(run.taskId) ?? null : null;
    if (run.status === "RUNNING" && pairedTask && isTerminalTaskStatus(pairedTask.status)) {
      const taskMetadata = normalizeBuilderTaskMetadata(pairedTask.metadata);
      if (taskMetadata.lastRunId === run.id && !hasBuilderRunController(run.id)) {
        const audit: BuilderReconciliationAuditEntry = {
          runId: run.id,
          taskId: pairedTask.id,
          action: "sync_run_status_from_task",
          reason: "task already terminal while run remained RUNNING",
          previousStatus: run.status,
          nextStatus: pairedTask.status,
          correctedAt: now.toISOString(),
        };
        await completeBuilderRun(run.id, {
          status: mapTaskStatusToRunStatus(pairedTask.status),
          summary: pairedTask.summary ?? run.summary ?? "Reconciled stale running Builder run from task state.",
          metadata: appendAuditEntry(run.metadata, audit),
        });
      }
    }

    if (!run.taskId || run.status === "RUNNING") {
      continue;
    }

    const task = taskById.get(run.taskId) ?? null;
    if (!task) {
      continue;
    }

    const taskMetadata = normalizeBuilderTaskMetadata(task.metadata);
    if ((task.status === "RUNNING" || task.status === "PENDING") && taskMetadata.lastRunId === run.id) {
      const nextStatus = mapRunStatusToTaskStatus(run.status);
      const audit: BuilderReconciliationAuditEntry = {
        runId: run.id,
        taskId: task.id,
        action: "sync_task_status_from_run",
        reason: "task remained non-terminal after its last run completed",
        previousStatus: task.status,
        nextStatus,
        correctedAt: now.toISOString(),
      };
        
      await updateBuilderTask(task.id, {
        status: nextStatus,
        stage: deriveTaskStage(task, run),
        summary: run.summary ?? task.summary ?? `Reconciled task state from run ${run.id}.`,
        metadata: toInputJsonValue(appendAuditEntry(task.metadata, audit)),
      });
      await updateBuilderRun(run.id, {
        status: run.status,
        metadata: appendAuditEntry(run.metadata, audit),
      });
    }
  }

  const refreshedRuns = await db.builderRun.findMany({
    where: args.projectId ? { projectId: args.projectId } : undefined,
    orderBy: { startedAt: "desc" },
    take: 100,
  });
  const refreshedTasks = await db.builderTask.findMany({
    where: args.projectId ? { projectId: args.projectId } : undefined,
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return inspectBuilderOperationalState({ runs: refreshedRuns, tasks: refreshedTasks, now });
}