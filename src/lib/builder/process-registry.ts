import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { getBuilderConfig, resolveBuilderWorkspacePath } from "@/lib/builder/config";
import { getBuilderProject, getBuilderRun } from "@/lib/builder/projects";
import { getBuilderTask } from "@/lib/builder/tasks";
import { assertBuilderCommandAllowed, resolveBuilderCommandExecution } from "@/lib/builder/workspace";

const DEFAULT_PROCESS_TIMEOUT_SECONDS = 1800;
const MAX_PROCESS_TIMEOUT_SECONDS = 14400;
const DEFAULT_WAIT_TIMEOUT_SECONDS = 60;
const MAX_WAIT_TIMEOUT_SECONDS = 600;
const DEFAULT_LOG_CHUNK_BYTES = 8000;
const MAX_LOG_BUFFER_BYTES = 256000;
const DEFAULT_PROCESS_LIST_LIMIT = 25;
const MAX_PROCESS_LIST_LIMIT = 100;
const DEFAULT_FOLLOW_TIMEOUT_SECONDS = 0;
const MAX_FOLLOW_TIMEOUT_SECONDS = 30;
const PROCESS_STOP_GRACE_MS = 5000;
const PROCESS_POLL_INTERVAL_MS = 250;
const PROCESS_ARTIFACTS_DIR = ".builder/processes";
const MANAGED_PROCESS_MONITOR_PAYLOAD_ENV = "BIZBOT_BUILDER_MANAGED_PROCESS_PAYLOAD";
const PROCESS_RETENTION_MAX_COMPLETED = 100;
const PROCESS_RETENTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type BuilderManagedProcessStatus = "running" | "exited" | "failed" | "cancelled" | "timed_out";

export type BuilderManagedProcessAuditAction = "started" | "stop_requested" | "completed";

export interface BuilderManagedProcessAuditEvent {
  eventId: string;
  processId: string;
  action: BuilderManagedProcessAuditAction;
  timestamp: string;
  status: BuilderManagedProcessStatus | "running";
  projectId: string | null;
  taskId: string | null;
  runId: string | null;
  metadata?: Record<string, unknown>;
}

export interface BuilderManagedProcessSnapshot {
  processId: string;
  command: string;
  args: string[];
  cwd: string;
  projectId: string | null;
  taskId: string | null;
  runId: string | null;
  pid: number | null;
  monitorPid: number | null;
  status: BuilderManagedProcessStatus;
  startedAt: string;
  updatedAt: string;
  exitedAt: string | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
  timeoutSeconds: number;
  stdoutBytes: number;
  stderrBytes: number;
  logBytes: number;
  logStartCursor: number;
  nextCursor: number;
  metadataPath: string;
  logPath: string;
  auditPath: string;
}

export interface BuilderManagedProcessStartArgs {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutSeconds?: number;
  projectId?: string;
  taskId?: string;
  runId?: string;
}

export interface BuilderManagedProcessListArgs {
  statuses?: BuilderManagedProcessStatus[];
  includeFinished?: boolean;
  commandContains?: string;
  cwdPrefix?: string;
  startedAfter?: string;
  startedBefore?: string;
  projectId?: string;
  taskId?: string;
  runId?: string;
  limit?: number;
}

interface BuilderManagedProcessArtifacts {
  root: string;
  metadataAbsolutePath: string;
  metadataPath: string;
  logAbsolutePath: string;
  logPath: string;
  auditAbsolutePath: string;
  auditPath: string;
}

interface BuilderManagedProcessMonitorPayload {
  processId: string;
  command: string;
  args: string[];
  cwd: string;
  cwdAbsolute: string;
  projectId: string | null;
  taskId: string | null;
  runId: string | null;
  resolvedCommand: string;
  env: NodeJS.ProcessEnv;
  timeoutSeconds: number;
  processStopGraceMs: number;
  maxLogBytes: number;
  metadataPath: string;
  logPath: string;
  auditPath: string;
}

interface BuilderManagedProcessScope {
  projectId: string | null;
  taskId: string | null;
  runId: string | null;
}

const MANAGED_PROCESS_MONITOR_SOURCE = [
  "const fs = require('fs');",
  "const { spawn } = require('child_process');",
  `const payload = JSON.parse(Buffer.from(process.env.${MANAGED_PROCESS_MONITOR_PAYLOAD_ENV} || '', 'base64').toString('utf8'));`,
  "function readState() {",
  "  try {",
  "    return JSON.parse(fs.readFileSync(payload.metadataPath, 'utf8'));",
  "  } catch {",
  "    return null;",
  "  }",
  "}",
  "function writeState(next) {",
  "  next.updatedAt = new Date().toISOString();",
  "  const tempPath = `${payload.metadataPath}.tmp-${process.pid}-${Date.now()}`;",
  "  fs.writeFileSync(tempPath, JSON.stringify(next, null, 2), 'utf8');",
  "  fs.renameSync(tempPath, payload.metadataPath);",
  "}",
  "function appendAudit(action, status, metadata) {",
  "  const event = {",
  "    eventId: `${payload.processId}:${action}:${Date.now()}:${Math.random().toString(36).slice(2)}` ,",
  "    processId: payload.processId,",
  "    action,",
  "    timestamp: new Date().toISOString(),",
  "    status,",
  "    projectId: payload.projectId || null,",
  "    taskId: payload.taskId || null,",
  "    runId: payload.runId || null,",
  "    metadata: metadata && typeof metadata === 'object' ? metadata : undefined,",
  "  };",
  "  fs.appendFileSync(payload.auditPath, JSON.stringify(event) + '\\n', 'utf8');",
  "}",
  "function trimLog(state) {",
  "  const size = fs.existsSync(payload.logPath) ? fs.statSync(payload.logPath).size : 0;",
  "  state.logBytes = size;",
  "  if (size <= payload.maxLogBytes) {",
  "    return;",
  "  }",
  "  const buffer = fs.readFileSync(payload.logPath);",
  "  const overflow = buffer.length - payload.maxLogBytes;",
  "  fs.writeFileSync(payload.logPath, buffer.subarray(overflow));",
  "  state.logStartCursor += overflow;",
  "  state.logBytes = payload.maxLogBytes;",
  "}",
  "function persist(state) {",
  "  const existing = readState();",
  "  if (existing && existing.cancelled) {",
  "    state.cancelled = true;",
  "  }",
  "  writeState(state);",
  "}",
  "function appendChunk(state, chunk, stream) {",
  "  if (!chunk || chunk.length === 0) {",
  "    return;",
  "  }",
  "  fs.appendFileSync(payload.logPath, chunk);",
  "  if (stream === 'stdout') {",
  "    state.stdoutBytes += chunk.length;",
  "  } else {",
  "    state.stderrBytes += chunk.length;",
  "  }",
  "  state.nextCursor += chunk.length;",
  "  trimLog(state);",
  "  persist(state);",
  "}",
  "const state = readState();",
  "if (!state) {",
  "  process.exit(1);",
  "}",
  "state.monitorPid = process.pid;",
  "persist(state);",
  "let finalized = false;",
  "let forceKillHandle = null;",
  "const child = spawn(payload.resolvedCommand, payload.args, {",
  "  cwd: payload.cwdAbsolute,",
  "  env: payload.env,",
  "  shell: false,",
  "  stdio: ['ignore', 'pipe', 'pipe'],",
  "  windowsHide: true,",
  "});",
  "state.pid = child.pid || null;",
  "persist(state);",
  "const latest = readState();",
  "if (latest && latest.cancelled && child.pid) {",
  "  state.cancelled = true;",
  "  child.kill('SIGTERM');",
  "  forceKillHandle = setTimeout(() => {",
  "    try {",
  "      child.kill('SIGKILL');",
  "    } catch {}",
  "  }, payload.processStopGraceMs);",
  "}",
  "const timeoutHandle = setTimeout(() => {",
  "  if (finalized) {",
  "    return;",
  "  }",
  "  state.timedOut = true;",
  "  persist(state);",
  "  child.kill('SIGTERM');",
  "  forceKillHandle = setTimeout(() => {",
  "    try {",
  "      child.kill('SIGKILL');",
  "    } catch {}",
  "  }, payload.processStopGraceMs);",
  "}, payload.timeoutSeconds * 1000);",
  "function finalize(exitCode, signal, errorText) {",
  "  if (finalized) {",
  "    return;",
  "  }",
  "  finalized = true;",
  "  clearTimeout(timeoutHandle);",
  "  if (forceKillHandle) {",
  "    clearTimeout(forceKillHandle);",
  "  }",
  "  const latestState = readState();",
  "  if (latestState && latestState.cancelled) {",
  "    state.cancelled = true;",
  "  }",
  "  if (errorText) {",
  "    appendChunk(state, Buffer.from(String(errorText) + '\\n', 'utf8'), 'stderr');",
  "  }",
  "  state.exitCode = typeof exitCode === 'number' ? exitCode : null;",
  "  state.signal = signal || null;",
  "  state.exitedAt = new Date().toISOString();",
  "  state.status = state.timedOut ? 'timed_out' : state.cancelled ? 'cancelled' : state.exitCode === 0 ? 'exited' : 'failed';",
  "  persist(state);",
  "  appendAudit('completed', state.status, { exitCode: state.exitCode, signal: state.signal, timedOut: state.timedOut, cancelled: state.cancelled });",
  "  process.exit(0);",
  "}",
  "child.stdout.on('data', (chunk) => appendChunk(state, Buffer.from(chunk), 'stdout'));",
  "child.stderr.on('data', (chunk) => appendChunk(state, Buffer.from(chunk), 'stderr'));",
  "child.once('error', (error) => finalize(null, null, error instanceof Error ? error.message : String(error)));",
  "child.once('close', (exitCode, signal) => finalize(exitCode, signal, null));",
  "process.on('uncaughtException', (error) => finalize(null, null, error instanceof Error ? error.stack || error.message : String(error)));",
  "process.on('unhandledRejection', (error) => finalize(null, null, error instanceof Error ? error.stack || error.message : String(error)));",
].join("\n");

function clampProcessTimeoutSeconds(value: number | undefined, fallback: number): number {
  return Math.min(MAX_PROCESS_TIMEOUT_SECONDS, Math.max(1, Math.trunc(value ?? fallback)));
}

function clampWaitTimeoutSeconds(value: number | undefined): number {
  return Math.min(MAX_WAIT_TIMEOUT_SECONDS, Math.max(1, Math.trunc(value ?? DEFAULT_WAIT_TIMEOUT_SECONDS)));
}

function clampProcessListLimit(value: number | undefined): number {
  return Math.min(MAX_PROCESS_LIST_LIMIT, Math.max(1, Math.trunc(value ?? DEFAULT_PROCESS_LIST_LIMIT)));
}

function clampFollowTimeoutSeconds(value: number | undefined): number {
  return Math.min(MAX_FOLLOW_TIMEOUT_SECONDS, Math.max(0, Math.trunc(value ?? DEFAULT_FOLLOW_TIMEOUT_SECONDS)));
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function toWorkspaceRelativePath(rootPath: string, absolutePath: string): string {
  const relativePath = path.relative(rootPath, absolutePath);
  return relativePath === "" ? "." : relativePath.replace(/\\/g, "/");
}

function ensureProcessArtifactsRoot(): string {
  const root = resolveBuilderWorkspacePath(PROCESS_ARTIFACTS_DIR);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function getProcessArtifacts(processId: string): BuilderManagedProcessArtifacts {
  const root = ensureProcessArtifactsRoot();
  const metadataAbsolutePath = path.join(root, `${processId}.json`);
  const logAbsolutePath = path.join(root, `${processId}.log`);
  const auditAbsolutePath = path.join(root, `${processId}.audit.jsonl`);
  const workspaceRoot = getBuilderConfig().workspaceRoot;

  return {
    root,
    metadataAbsolutePath,
    metadataPath: toWorkspaceRelativePath(workspaceRoot, metadataAbsolutePath),
    logAbsolutePath,
    logPath: toWorkspaceRelativePath(workspaceRoot, logAbsolutePath),
    auditAbsolutePath,
    auditPath: toWorkspaceRelativePath(workspaceRoot, auditAbsolutePath),
  };
}

function appendManagedProcessAuditEvent(absolutePath: string, event: BuilderManagedProcessAuditEvent): void {
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.appendFileSync(absolutePath, `${JSON.stringify(event)}\n`, "utf-8");
}

function buildManagedProcessAuditEvent(
  snapshot: Pick<BuilderManagedProcessSnapshot, "processId" | "projectId" | "taskId" | "runId">,
  action: BuilderManagedProcessAuditAction,
  status: BuilderManagedProcessStatus | "running",
  metadata?: Record<string, unknown>,
): BuilderManagedProcessAuditEvent {
  return {
    eventId: `${snapshot.processId}:${action}:${Date.now()}:${randomUUID()}`,
    processId: snapshot.processId,
    action,
    timestamp: new Date().toISOString(),
    status,
    projectId: snapshot.projectId,
    taskId: snapshot.taskId,
    runId: snapshot.runId,
    ...(metadata ? { metadata } : {}),
  };
}

function getSnapshotTerminalTimestamp(snapshot: BuilderManagedProcessSnapshot): number {
  const reference = snapshot.exitedAt ?? snapshot.updatedAt ?? snapshot.startedAt;
  const value = Date.parse(reference);
  return Number.isFinite(value) ? value : 0;
}

export function cleanupBuilderManagedProcesses(): { deletedCount: number; deletedProcessIds: string[] } {
  const now = Date.now();
  const completed = listProcessMetadataFiles()
    .map((filePath) => readManagedProcess(path.basename(filePath, ".json")))
    .filter((snapshot) => snapshot.status !== "running")
    .sort((left, right) => getSnapshotTerminalTimestamp(right) - getSnapshotTerminalTimestamp(left));

  const retained = new Set(
    completed
      .filter((snapshot, index) => index < PROCESS_RETENTION_MAX_COMPLETED && (now - getSnapshotTerminalTimestamp(snapshot)) <= PROCESS_RETENTION_MAX_AGE_MS)
      .map((snapshot) => snapshot.processId),
  );

  const deletedProcessIds: string[] = [];
  for (const snapshot of completed) {
    if (retained.has(snapshot.processId)) {
      continue;
    }
    const artifacts = getProcessArtifacts(snapshot.processId);
    for (const artifactPath of [artifacts.metadataAbsolutePath, artifacts.logAbsolutePath, artifacts.auditAbsolutePath]) {
      if (fs.existsSync(artifactPath)) {
        fs.rmSync(artifactPath, { force: true });
      }
    }
    deletedProcessIds.push(snapshot.processId);
  }

  return {
    deletedCount: deletedProcessIds.length,
    deletedProcessIds,
  };
}

async function resolveManagedProcessScope(args: Pick<BuilderManagedProcessStartArgs, "projectId" | "taskId" | "runId">): Promise<BuilderManagedProcessScope> {
  let projectId = typeof args.projectId === "string" && args.projectId.trim() ? args.projectId.trim() : null;
  const taskId = typeof args.taskId === "string" && args.taskId.trim() ? args.taskId.trim() : null;
  const runId = typeof args.runId === "string" && args.runId.trim() ? args.runId.trim() : null;

  if (taskId) {
    const task = await getBuilderTask(taskId);
    if (projectId && task.projectId !== projectId) {
      throw new Error(`Builder managed process task ${taskId} does not belong to project ${projectId}.`);
    }
    projectId = task.projectId;
  }

  if (runId) {
    const run = await getBuilderRun(runId);
    if (projectId && run.projectId !== projectId) {
      throw new Error(`Builder managed process run ${runId} does not belong to project ${projectId}.`);
    }
    if (taskId && run.taskId !== taskId) {
      throw new Error(`Builder managed process run ${runId} does not belong to task ${taskId}.`);
    }
    projectId = run.projectId;
  }

  if (projectId) {
    await getBuilderProject(projectId);
  }

  return { projectId, taskId, runId };
}

function writeJsonAtomic(absolutePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const tempPath = `${absolutePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tempPath, absolutePath);
}

function isAlive(pid: number | null): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function normalizeSnapshot(value: unknown, artifacts: BuilderManagedProcessArtifacts): BuilderManagedProcessSnapshot {
  const snapshot = value as Partial<BuilderManagedProcessSnapshot>;
  return {
    processId: String(snapshot.processId ?? path.basename(artifacts.metadataAbsolutePath, ".json")),
    command: String(snapshot.command ?? ""),
    args: Array.isArray(snapshot.args) ? snapshot.args.map((entry) => String(entry)) : [],
    cwd: String(snapshot.cwd ?? "."),
    projectId: typeof snapshot.projectId === "string" && snapshot.projectId.trim() ? snapshot.projectId.trim() : null,
    taskId: typeof snapshot.taskId === "string" && snapshot.taskId.trim() ? snapshot.taskId.trim() : null,
    runId: typeof snapshot.runId === "string" && snapshot.runId.trim() ? snapshot.runId.trim() : null,
    pid: typeof snapshot.pid === "number" ? snapshot.pid : null,
    monitorPid: typeof snapshot.monitorPid === "number" ? snapshot.monitorPid : null,
    status: snapshot.status === "exited" || snapshot.status === "failed" || snapshot.status === "cancelled" || snapshot.status === "timed_out"
      ? snapshot.status
      : "running",
    startedAt: typeof snapshot.startedAt === "string" ? snapshot.startedAt : new Date(0).toISOString(),
    updatedAt: typeof snapshot.updatedAt === "string" ? snapshot.updatedAt : typeof snapshot.startedAt === "string" ? snapshot.startedAt : new Date(0).toISOString(),
    exitedAt: typeof snapshot.exitedAt === "string" ? snapshot.exitedAt : null,
    exitCode: typeof snapshot.exitCode === "number" ? snapshot.exitCode : null,
    signal: typeof snapshot.signal === "string" ? snapshot.signal as NodeJS.Signals : null,
    timedOut: Boolean(snapshot.timedOut),
    cancelled: Boolean(snapshot.cancelled),
    timeoutSeconds: typeof snapshot.timeoutSeconds === "number" ? snapshot.timeoutSeconds : DEFAULT_PROCESS_TIMEOUT_SECONDS,
    stdoutBytes: typeof snapshot.stdoutBytes === "number" ? snapshot.stdoutBytes : 0,
    stderrBytes: typeof snapshot.stderrBytes === "number" ? snapshot.stderrBytes : 0,
    logBytes: typeof snapshot.logBytes === "number" ? snapshot.logBytes : 0,
    logStartCursor: typeof snapshot.logStartCursor === "number" ? snapshot.logStartCursor : 0,
    nextCursor: typeof snapshot.nextCursor === "number" ? snapshot.nextCursor : 0,
    metadataPath: artifacts.metadataPath,
    logPath: artifacts.logPath,
    auditPath: artifacts.auditPath,
  };
}

function persistSnapshot(snapshot: BuilderManagedProcessSnapshot): BuilderManagedProcessSnapshot {
  const artifacts = getProcessArtifacts(snapshot.processId);
  const nextSnapshot = {
    ...snapshot,
    updatedAt: new Date().toISOString(),
    metadataPath: artifacts.metadataPath,
    logPath: artifacts.logPath,
    auditPath: artifacts.auditPath,
  };
  writeJsonAtomic(artifacts.metadataAbsolutePath, nextSnapshot);
  return nextSnapshot;
}

function reconcileSnapshot(snapshot: BuilderManagedProcessSnapshot): BuilderManagedProcessSnapshot {
  if (snapshot.status !== "running") {
    return snapshot;
  }

  const childAlive = isAlive(snapshot.pid);
  const monitorAlive = isAlive(snapshot.monitorPid);
  if (childAlive || monitorAlive) {
    return snapshot;
  }

  return persistSnapshot({
    ...snapshot,
    status: snapshot.timedOut
      ? "timed_out"
      : snapshot.cancelled
        ? "cancelled"
        : "failed",
    exitedAt: snapshot.exitedAt ?? new Date().toISOString(),
  });
}

function readManagedProcess(processId: string): BuilderManagedProcessSnapshot {
  const artifacts = getProcessArtifacts(processId);
  if (!fs.existsSync(artifacts.metadataAbsolutePath)) {
    throw new Error(`Builder managed process not found: ${processId}`);
  }

  const raw = JSON.parse(fs.readFileSync(artifacts.metadataAbsolutePath, "utf-8")) as unknown;
  return reconcileSnapshot(normalizeSnapshot(raw, artifacts));
}

function listProcessMetadataFiles(): string[] {
  const root = ensureProcessArtifactsRoot();
  return fs.readdirSync(root)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(root, entry));
}

function readLogSlice(snapshot: BuilderManagedProcessSnapshot, args: { cursor?: number; maxBytes?: number; tailBytes?: number }): {
  cursorUsed: number;
  nextCursor: number;
  logs: string;
  truncatedBeforeCursor: boolean;
} {
  const artifacts = getProcessArtifacts(snapshot.processId);
  const maxBytes = Math.min(MAX_LOG_BUFFER_BYTES, Math.max(1, Math.trunc(args.maxBytes ?? DEFAULT_LOG_CHUNK_BYTES)));
  const fileBuffer = fs.existsSync(artifacts.logAbsolutePath) ? fs.readFileSync(artifacts.logAbsolutePath) : Buffer.alloc(0);
  const baseCursor = typeof args.tailBytes === "number" && args.cursor === undefined
    ? Math.max(snapshot.logStartCursor, snapshot.nextCursor - Math.max(1, Math.trunc(args.tailBytes)))
    : Math.max(0, Math.trunc(args.cursor ?? snapshot.logStartCursor));
  const cursorUsed = Math.max(baseCursor, snapshot.logStartCursor);
  const truncatedBeforeCursor = baseCursor < snapshot.logStartCursor;
  const startIndex = Math.max(0, cursorUsed - snapshot.logStartCursor);
  const slice = fileBuffer.subarray(startIndex, Math.min(fileBuffer.length, startIndex + maxBytes));
  const logs = slice.toString("utf-8");
  const nextCursor = cursorUsed + slice.length;

  return {
    cursorUsed,
    nextCursor,
    logs,
    truncatedBeforeCursor,
  };
}

function matchesProcessFilters(snapshot: BuilderManagedProcessSnapshot, filters: BuilderManagedProcessListArgs): boolean {
  if (filters.includeFinished === false && snapshot.status !== "running") {
    return false;
  }
  if (filters.statuses && filters.statuses.length > 0 && !filters.statuses.includes(snapshot.status)) {
    return false;
  }
  if (filters.commandContains && !snapshot.command.toLowerCase().includes(filters.commandContains.toLowerCase())) {
    return false;
  }
  if (filters.cwdPrefix && !snapshot.cwd.startsWith(filters.cwdPrefix)) {
    return false;
  }
  if (filters.startedAfter && snapshot.startedAt < filters.startedAfter) {
    return false;
  }
  if (filters.startedBefore && snapshot.startedAt > filters.startedBefore) {
    return false;
  }
  if (filters.projectId && snapshot.projectId !== filters.projectId) {
    return false;
  }
  if (filters.taskId && snapshot.taskId !== filters.taskId) {
    return false;
  }
  if (filters.runId && snapshot.runId !== filters.runId) {
    return false;
  }
  return true;
}

function sendTerminationSignal(snapshot: BuilderManagedProcessSnapshot, signal: NodeJS.Signals): void {
  if (!snapshot.pid || !isAlive(snapshot.pid)) {
    return;
  }

  try {
    process.kill(snapshot.pid, signal);
  } catch {
    return;
  }
}

function startMonitorProcess(payload: BuilderManagedProcessMonitorPayload): number | null {
  const monitor = spawn(process.execPath, ["-e", MANAGED_PROCESS_MONITOR_SOURCE], {
    cwd: payload.cwdAbsolute,
    env: {
      ...process.env,
      [MANAGED_PROCESS_MONITOR_PAYLOAD_ENV]: Buffer.from(JSON.stringify(payload), "utf-8").toString("base64"),
    },
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  });
  monitor.unref();
  return monitor.pid ?? null;
}

export async function startBuilderManagedProcess(args: BuilderManagedProcessStartArgs): Promise<{ started: true; process: BuilderManagedProcessSnapshot }> {
  cleanupBuilderManagedProcesses();
  assertBuilderCommandAllowed(args.command);
  const timeoutSeconds = clampProcessTimeoutSeconds(args.timeoutSeconds, DEFAULT_PROCESS_TIMEOUT_SECONDS);
  const scope = await resolveManagedProcessScope(args);
  const execution = resolveBuilderCommandExecution(args.command, args.args ?? [], {
    cwd: args.cwd,
    timeoutSeconds,
  });

  const processId = randomUUID();
  const artifacts = getProcessArtifacts(processId);
  fs.mkdirSync(path.dirname(artifacts.metadataAbsolutePath), { recursive: true });
  fs.writeFileSync(artifacts.logAbsolutePath, "", "utf-8");
  fs.writeFileSync(artifacts.auditAbsolutePath, "", "utf-8");

  const initialSnapshot = persistSnapshot({
    processId,
    command: args.command,
    args: [...execution.args],
    cwd: execution.cwd,
    projectId: scope.projectId,
    taskId: scope.taskId,
    runId: scope.runId,
    pid: null,
    monitorPid: null,
    status: "running",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    exitedAt: null,
    exitCode: null,
    signal: null,
    timedOut: false,
    cancelled: false,
    timeoutSeconds,
    stdoutBytes: 0,
    stderrBytes: 0,
    logBytes: 0,
    logStartCursor: 0,
    nextCursor: 0,
    metadataPath: artifacts.metadataPath,
    logPath: artifacts.logPath,
    auditPath: artifacts.auditPath,
  });

  appendManagedProcessAuditEvent(
    artifacts.auditAbsolutePath,
    buildManagedProcessAuditEvent(initialSnapshot, "started", "running", {
      command: args.command,
      args: execution.args,
      cwd: execution.cwd,
      timeoutSeconds,
    }),
  );

  const monitorPid = startMonitorProcess({
    processId,
    command: args.command,
    args: execution.args,
    cwd: execution.cwd,
    cwdAbsolute: execution.cwdAbsolute,
    projectId: scope.projectId,
    taskId: scope.taskId,
    runId: scope.runId,
    resolvedCommand: execution.resolvedCommand,
    env: execution.env,
    timeoutSeconds,
    processStopGraceMs: PROCESS_STOP_GRACE_MS,
    maxLogBytes: MAX_LOG_BUFFER_BYTES,
    metadataPath: artifacts.metadataAbsolutePath,
    logPath: artifacts.logAbsolutePath,
    auditPath: artifacts.auditAbsolutePath,
  });

  return {
    started: true,
    process: persistSnapshot({
      ...initialSnapshot,
      monitorPid,
    }),
  };
}

export function getBuilderManagedProcess(processId: string): { process: BuilderManagedProcessSnapshot } {
  cleanupBuilderManagedProcesses();
  return { process: readManagedProcess(processId) };
}

export function listBuilderManagedProcesses(filters: BuilderManagedProcessListArgs = {}): {
  processes: BuilderManagedProcessSnapshot[];
  total: number;
  returned: number;
} {
  cleanupBuilderManagedProcesses();
  const snapshots = listProcessMetadataFiles()
    .map((filePath) => readManagedProcess(path.basename(filePath, ".json")))
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  const filtered = snapshots.filter((snapshot) => matchesProcessFilters(snapshot, filters));
  const limit = clampProcessListLimit(filters.limit);

  return {
    processes: filtered.slice(0, limit),
    total: snapshots.length,
    returned: Math.min(filtered.length, limit),
  };
}

export async function streamBuilderManagedProcessLogs(args: {
  processId: string;
  cursor?: number;
  maxChars?: number;
  maxBytes?: number;
  tailBytes?: number;
  followSeconds?: number;
}): Promise<{
  process: BuilderManagedProcessSnapshot;
  cursorUsed: number;
  nextCursor: number;
  logs: string;
  truncatedBeforeCursor: boolean;
  complete: boolean;
  followed: boolean;
  followTimedOut: boolean;
}> {
  const followSeconds = clampFollowTimeoutSeconds(args.followSeconds);
  const maxBytes = args.maxBytes ?? args.maxChars;
  let snapshot = readManagedProcess(args.processId);
  let slice = readLogSlice(snapshot, {
    cursor: args.cursor,
    maxBytes,
    tailBytes: args.tailBytes,
  });

  if (!slice.logs && followSeconds > 0 && snapshot.status === "running") {
    const deadline = Date.now() + followSeconds * 1000;
    while (Date.now() < deadline) {
      await sleep(PROCESS_POLL_INTERVAL_MS);
      snapshot = readManagedProcess(args.processId);
      slice = readLogSlice(snapshot, {
        cursor: args.cursor,
        maxBytes,
        tailBytes: args.tailBytes,
      });
      if (slice.logs || snapshot.status !== "running") {
        return {
          process: snapshot,
          cursorUsed: slice.cursorUsed,
          nextCursor: slice.nextCursor,
          logs: slice.logs,
          truncatedBeforeCursor: slice.truncatedBeforeCursor,
          complete: snapshot.status !== "running" && slice.nextCursor >= snapshot.nextCursor,
          followed: true,
          followTimedOut: false,
        };
      }
    }

    snapshot = readManagedProcess(args.processId);
    slice = readLogSlice(snapshot, {
      cursor: args.cursor,
      maxBytes,
      tailBytes: args.tailBytes,
    });
    return {
      process: snapshot,
      cursorUsed: slice.cursorUsed,
      nextCursor: slice.nextCursor,
      logs: slice.logs,
      truncatedBeforeCursor: slice.truncatedBeforeCursor,
      complete: snapshot.status !== "running" && slice.nextCursor >= snapshot.nextCursor,
      followed: true,
      followTimedOut: true,
    };
  }

  return {
    process: snapshot,
    cursorUsed: slice.cursorUsed,
    nextCursor: slice.nextCursor,
    logs: slice.logs,
    truncatedBeforeCursor: slice.truncatedBeforeCursor,
    complete: snapshot.status !== "running" && slice.nextCursor >= snapshot.nextCursor,
    followed: false,
    followTimedOut: false,
  };
}

export function stopBuilderManagedProcess(processId: string): { stopped: boolean; process: BuilderManagedProcessSnapshot } {
  const snapshot = readManagedProcess(processId);
  if (snapshot.status !== "running") {
    return { stopped: true, process: snapshot };
  }

  const flagged = persistSnapshot({
    ...snapshot,
    cancelled: true,
  });
  appendManagedProcessAuditEvent(
    getProcessArtifacts(processId).auditAbsolutePath,
    buildManagedProcessAuditEvent(flagged, "stop_requested", flagged.status, {
      pid: flagged.pid,
      monitorPid: flagged.monitorPid,
    }),
  );
  sendTerminationSignal(flagged, "SIGTERM");
  setTimeout(() => {
    const latest = readManagedProcess(processId);
    if (latest.status === "running") {
      sendTerminationSignal(latest, "SIGKILL");
    }
  }, PROCESS_STOP_GRACE_MS).unref();

  return {
    stopped: true,
    process: flagged,
  };
}

export async function waitForBuilderManagedProcess(args: { processId: string; timeoutSeconds?: number }): Promise<{
  completed: boolean;
  timedOut: boolean;
  process: BuilderManagedProcessSnapshot;
}> {
  const timeoutSeconds = clampWaitTimeoutSeconds(args.timeoutSeconds);
  const deadline = Date.now() + timeoutSeconds * 1000;
  let snapshot = readManagedProcess(args.processId);
  if (snapshot.status !== "running") {
    return {
      completed: true,
      timedOut: false,
      process: snapshot,
    };
  }

  while (Date.now() < deadline) {
    await sleep(PROCESS_POLL_INTERVAL_MS);
    snapshot = readManagedProcess(args.processId);
    if (snapshot.status !== "running") {
      return {
        completed: true,
        timedOut: false,
        process: snapshot,
      };
    }
  }

  return {
    completed: false,
    timedOut: true,
    process: snapshot,
  };
}
