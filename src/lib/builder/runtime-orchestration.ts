import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import type { BuilderPackageManager } from "@prisma/client";
import { appendBuilderCapabilityAuditEvent } from "@/lib/builder/audit";
import {
  listBuilderManagedProcesses,
  startBuilderManagedProcess,
  stopBuilderManagedProcess,
  streamBuilderManagedProcessLogs,
  waitForBuilderManagedProcess,
  type BuilderManagedProcessSnapshot,
} from "@/lib/builder/process-registry";
import { resolveBuilderWorkspacePath } from "@/lib/builder/config";
import { assertBuilderCommandAllowed, runBuilderCommand, type BuilderCommandResult } from "@/lib/builder/workspace";

const COMPOSE_FILE_NAMES = new Set(["compose.yml", "compose.yaml", "docker-compose.yml", "docker-compose.yaml"]);
const SKIPPED_SCAN_DIRS = new Set([".git", ".builder", "node_modules"]);
const DEFAULT_LOG_TAIL_BYTES = 6000;
const DEFAULT_CONTROL_TIMEOUT_SECONDS = 120;
const FOLLOW_POLL_INTERVAL_MS = 1000;

export type BuilderRuntimeServiceSource = "package_script" | "workspace_package" | "compose_file" | "procfile";
export type BuilderRuntimeServiceRunner = "npm_script" | "compose_service" | "procfile_process";
export type BuilderRuntimeServiceStatus = "running" | "failed" | "stopped" | "declared";
export type BuilderRuntimeHealthStatus = "healthy" | "unhealthy" | "starting" | "stopped" | "declared" | "unknown";

export interface BuilderRuntimeServiceSummary {
  serviceId: string;
  label: string;
  source: BuilderRuntimeServiceSource;
  runner: BuilderRuntimeServiceRunner;
  declaredIn: string;
  workingDirectory: string;
  command: string | null;
  processId: string | null;
  processStatus: "running" | "exited" | "failed" | "cancelled" | "timed_out" | null;
  status: BuilderRuntimeServiceStatus;
  startedAt: string | null;
  logPath: string | null;
  auditPath: string | null;
  supportsRestart: boolean;
  supportsExec: boolean;
  supportsStart: boolean;
  supportsStop: boolean;
  healthStatus: BuilderRuntimeHealthStatus;
  healthReason: string | null;
  containerId: string | null;
  publishedPorts: string[];
}

export interface BuilderRuntimeInspectionOverview {
  summary: string;
  totalServices: number;
  runningServices: number;
  failedServices: number;
  managedServices: number;
  services: BuilderRuntimeServiceSummary[];
}

export interface BuilderRuntimeServiceLogPreview {
  service: BuilderRuntimeServiceSummary;
  logs: string;
  cursorUsed: number;
  nextCursor: number;
  truncatedBeforeCursor: boolean;
  complete: boolean;
  followed: boolean;
  followTimedOut: boolean;
  error?: string;
}

export interface BuilderRuntimeContextArgs {
  projectId: string;
  projectRelativePath: string;
  packageManager: BuilderPackageManager;
}

export interface BuilderRuntimeServiceLogArgs extends BuilderRuntimeContextArgs {
  serviceId: string;
  cursor?: number;
  maxBytes?: number;
  tailBytes?: number;
  followSeconds?: number;
}

export interface BuilderRuntimeServiceControlArgs extends BuilderRuntimeContextArgs {
  serviceId: string;
}

export interface BuilderRuntimeExecArgs extends BuilderRuntimeServiceControlArgs {
  command: string;
  commandArgs?: string[];
  timeoutSeconds?: number;
}

export interface BuilderRuntimeControlResponse {
  status: "completed" | "blocked";
  message: string;
  service: BuilderRuntimeServiceSummary;
  process?: {
    processId: string;
    status: "running" | "exited" | "failed" | "cancelled" | "timed_out";
    logPath: string;
    auditPath: string;
  };
  previousProcess?: {
    processId: string;
    status: "running" | "exited" | "failed" | "cancelled" | "timed_out";
  } | null;
  commandResult?: BuilderCommandResult;
  auditPath?: string;
}

interface ManagedLaunchSpec {
  command: string;
  args: string[];
  cwd: string;
}

interface ComposeDefinition {
  fileRelativePath: string;
  fileAbsolutePath: string;
  serviceName: string;
  workingDirectory: string;
}

interface ComposeRuntimeState {
  state: string | null;
  health: string | null;
  containerId: string | null;
  publishedPorts: string[];
  startedAt: string | null;
  error?: string;
}

interface ResolvedRuntimeService {
  summary: BuilderRuntimeServiceSummary;
  managedLaunch?: ManagedLaunchSpec;
  compose?: ComposeDefinition;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function packageManagerCommand(packageManager: BuilderPackageManager): string {
  return packageManager === "PNPM" ? "pnpm" : "npm";
}

function tokenizeCommand(commandLine: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(commandLine)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens.filter(Boolean);
}

function isRuntimeScriptName(scriptName: string): boolean {
  const normalized = scriptName.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (["build", "test", "lint", "typecheck", "check", "prepare", "postinstall", "prisma:generate"].includes(normalized)) {
    return false;
  }
  return /(dev|start|serve|worker|watch|queue|api|server|web)/.test(normalized);
}

function readJsonFile<T>(absolutePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function walkProjectFiles(projectRelativePath: string): string[] {
  const rootAbsolute = resolveBuilderWorkspacePath(projectRelativePath);
  if (!fs.existsSync(rootAbsolute)) {
    return [];
  }

  const results: string[] = [];
  const queue = [rootAbsolute];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      const relativePath = normalizePath(path.relative(rootAbsolute, absolutePath));
      if (entry.isDirectory()) {
        if (!SKIPPED_SCAN_DIRS.has(entry.name)) {
          queue.push(absolutePath);
        }
        continue;
      }
      results.push(relativePath);
    }
  }
  return results.sort((left, right) => left.localeCompare(right));
}

function parseProcfileEntries(contents: string): Array<{ name: string; command: string }> {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const separator = line.indexOf(":");
      if (separator <= 0) {
        return [];
      }
      const name = line.slice(0, separator).trim();
      const command = line.slice(separator + 1).trim();
      if (!name || !command) {
        return [];
      }
      return [{ name, command }];
    });
}

function parseComposeServiceNames(contents: string): string[] {
  const lines = contents.split(/\r?\n/);
  let servicesIndent: number | null = null;
  const serviceNames: string[] = [];

  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (servicesIndent === null) {
      if (trimmed === "services:") {
        servicesIndent = indent;
      }
      continue;
    }

    if (indent <= servicesIndent) {
      break;
    }

    const match = trimmed.match(/^([A-Za-z0-9._-]+):\s*$/);
    if (match && indent === servicesIndent + 2) {
      serviceNames.push(match[1]);
    }
  }

  return serviceNames;
}

function normalizeCommandName(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  return path.basename(value).replace(/\.cmd$/i, "").replace(/\.exe$/i, "").toLowerCase();
}

function argsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function selectManagedProcess(processes: BuilderManagedProcessSnapshot[], launch: ManagedLaunchSpec): BuilderManagedProcessSnapshot | null {
  const matching = processes.filter((process) =>
    normalizeCommandName(process.command) === normalizeCommandName(launch.command)
    && argsEqual(process.args, launch.args)
    && normalizePath(process.cwd) === normalizePath(launch.cwd),
  );
  if (matching.length === 0) {
    return null;
  }
  return [...matching].sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0] ?? null;
}

function selectAvailableManagedProcess(
  processes: BuilderManagedProcessSnapshot[],
  launch: ManagedLaunchSpec,
  claimedProcessIds: Set<string>,
): BuilderManagedProcessSnapshot | null {
  const process = selectManagedProcess(processes, launch);
  if (!process || claimedProcessIds.has(process.processId)) {
    return null;
  }
  claimedProcessIds.add(process.processId);
  return process;
}

function toManagedServiceStatus(process: BuilderManagedProcessSnapshot | null): {
  status: BuilderRuntimeServiceStatus;
  healthStatus: BuilderRuntimeHealthStatus;
  healthReason: string | null;
} {
  if (!process) {
    return {
      status: "declared",
      healthStatus: "declared",
      healthReason: "Builder has not started this service yet.",
    };
  }
  if (process.status === "running") {
    return {
      status: "running",
      healthStatus: "healthy",
      healthReason: "Managed Builder process is running.",
    };
  }
  if (process.status === "failed" || process.status === "timed_out") {
    return {
      status: "failed",
      healthStatus: "unhealthy",
      healthReason: `Managed Builder process finished with status ${process.status}.`,
    };
  }
  return {
    status: "stopped",
    healthStatus: "stopped",
    healthReason: `Managed Builder process is ${process.status}.`,
  };
}

function parseComposePsOutput(stdout: string): Array<Record<string, unknown>> {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object") : [];
  } catch {
    return trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line) as unknown;
          return parsed && typeof parsed === "object" ? [parsed as Record<string, unknown>] : [];
        } catch {
          return [];
        }
      });
  }
}

function formatComposePort(entry: unknown): string | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const candidate = entry as Record<string, unknown>;
  const published = candidate.PublishedPort ?? candidate.publishedPort;
  const target = candidate.TargetPort ?? candidate.targetPort;
  const protocol = candidate.Protocol ?? candidate.protocol;
  if (typeof published === "number" && typeof target === "number") {
    return `${published}:${target}/${typeof protocol === "string" ? protocol : "tcp"}`;
  }
  return null;
}

function inspectComposeStates(composeDefinitions: ComposeDefinition[]): Map<string, ComposeRuntimeState> {
  const states = new Map<string, ComposeRuntimeState>();
  const byFile = new Map<string, ComposeDefinition[]>();
  for (const definition of composeDefinitions) {
    const key = `${definition.workingDirectory}::${definition.fileAbsolutePath}`;
    const current = byFile.get(key) ?? [];
    current.push(definition);
    byFile.set(key, current);
  }

  for (const definitions of byFile.values()) {
    const first = definitions[0];
    const result = spawnSync("docker", ["compose", "-f", first.fileAbsolutePath, "ps", "--all", "--format", "json"], {
      cwd: resolveBuilderWorkspacePath(first.workingDirectory),
      encoding: "utf-8",
      windowsHide: true,
    });
    const parsed = result.status === 0 ? parseComposePsOutput(result.stdout ?? "") : [];
    const byService = new Map<string, Record<string, unknown>>();
    for (const entry of parsed) {
      const serviceName = typeof entry.Service === "string" ? entry.Service : typeof entry.service === "string" ? entry.service : null;
      if (serviceName) {
        byService.set(serviceName, entry);
      }
    }

    for (const definition of definitions) {
      const entry = byService.get(definition.serviceName);
      const publishers = Array.isArray(entry?.Publishers) ? entry?.Publishers : Array.isArray(entry?.publishers) ? entry?.publishers : [];
      states.set(`${definition.fileRelativePath}:${definition.serviceName}`, {
        state: entry ? String(entry.State ?? entry.state ?? "") || null : null,
        health: entry ? String(entry.Health ?? entry.health ?? "") || null : null,
        containerId: entry ? String(entry.ID ?? entry.Id ?? entry.id ?? "") || null : null,
        publishedPorts: Array.isArray(publishers) ? publishers.map(formatComposePort).filter((value): value is string => Boolean(value)) : [],
        startedAt: entry && typeof (entry.StartedAt ?? entry.startedAt) === "string" ? String(entry.StartedAt ?? entry.startedAt) : null,
        ...(result.status === 0 ? {} : { error: (result.stderr ?? result.stdout ?? "").trim() || "Compose inspection failed." }),
      });
    }
  }

  return states;
}

function buildComposeSummary(state: ComposeRuntimeState | null): {
  status: BuilderRuntimeServiceStatus;
  healthStatus: BuilderRuntimeHealthStatus;
  healthReason: string | null;
} {
  if (!state || !state.state) {
    return {
      status: "declared",
      healthStatus: "declared",
      healthReason: state?.error ?? "Compose service is declared but no container is active yet.",
    };
  }

  const normalizedState = state.state.toLowerCase();
  const normalizedHealth = state.health?.toLowerCase() ?? "";
  if (normalizedHealth === "unhealthy" || normalizedState.includes("restarting") || normalizedState.includes("dead")) {
    return {
      status: "failed",
      healthStatus: "unhealthy",
      healthReason: state.health ?? state.state,
    };
  }
  if (normalizedState.includes("running") || normalizedState.includes("up")) {
    return {
      status: "running",
      healthStatus: normalizedHealth === "healthy"
        ? "healthy"
        : normalizedHealth === "starting"
          ? "starting"
          : "unknown",
      healthReason: state.health ?? state.state,
    };
  }
  return {
    status: "stopped",
    healthStatus: "stopped",
    healthReason: state.health ?? state.state,
  };
}

function discoverRuntimeServices(args: BuilderRuntimeContextArgs): ResolvedRuntimeService[] {
  const projectAbsolutePath = resolveBuilderWorkspacePath(args.projectRelativePath);
  const projectFiles = walkProjectFiles(args.projectRelativePath);
  const managedProcesses = listBuilderManagedProcesses({ projectId: args.projectId, includeFinished: true, limit: 200 }).processes;
  const claimedProcessIds = new Set<string>();
  const discovered: ResolvedRuntimeService[] = [];
  const composeDefinitions: ComposeDefinition[] = [];

  const rootPackageAbsolutePath = path.join(projectAbsolutePath, "package.json");
  if (fs.existsSync(rootPackageAbsolutePath)) {
    const rootPackageJson = readJsonFile<{ scripts?: Record<string, string> }>(rootPackageAbsolutePath);
    for (const [scriptName, scriptCommand] of Object.entries(rootPackageJson?.scripts ?? {})) {
      if (!isRuntimeScriptName(scriptName)) {
        continue;
      }
      const launch = {
        command: packageManagerCommand(args.packageManager),
        args: ["run", scriptName],
        cwd: args.projectRelativePath,
      } satisfies ManagedLaunchSpec;
      const process = selectAvailableManagedProcess(managedProcesses, launch, claimedProcessIds);
      const managedState = toManagedServiceStatus(process);
      discovered.push({
        summary: {
          serviceId: `script:${scriptName}`,
          label: scriptName,
          source: "package_script",
          runner: "npm_script",
          declaredIn: normalizePath(path.posix.join(args.projectRelativePath, "package.json")),
          workingDirectory: args.projectRelativePath,
          command: scriptCommand,
          processId: process?.processId ?? null,
          processStatus: process?.status ?? null,
          status: managedState.status,
          startedAt: process?.startedAt ?? null,
          logPath: process?.logPath ?? null,
          auditPath: process?.auditPath ?? null,
          supportsRestart: true,
          supportsExec: true,
          supportsStart: process?.status !== "running",
          supportsStop: process?.status === "running",
          healthStatus: managedState.healthStatus,
          healthReason: managedState.healthReason,
          containerId: null,
          publishedPorts: [],
        },
        managedLaunch: launch,
      });
    }
  }

  for (const relativePath of projectFiles.filter((entry) => entry.endsWith("package.json") && entry !== "package.json")) {
    const packageJson = readJsonFile<{ scripts?: Record<string, string> }>(path.join(projectAbsolutePath, relativePath));
    const packageWorkingDirectory = normalizePath(path.posix.join(args.projectRelativePath, path.posix.dirname(relativePath)));
    for (const [scriptName, scriptCommand] of Object.entries(packageJson?.scripts ?? {})) {
      if (!isRuntimeScriptName(scriptName)) {
        continue;
      }
      const launch = {
        command: packageManagerCommand(args.packageManager),
        args: ["run", scriptName],
        cwd: packageWorkingDirectory,
      } satisfies ManagedLaunchSpec;
      const process = selectAvailableManagedProcess(managedProcesses, launch, claimedProcessIds);
      const managedState = toManagedServiceStatus(process);
      discovered.push({
        summary: {
          serviceId: `workspace:${normalizePath(relativePath)}:${scriptName}`,
          label: `${normalizePath(path.posix.dirname(relativePath))} · ${scriptName}`,
          source: "workspace_package",
          runner: "npm_script",
          declaredIn: normalizePath(path.posix.join(args.projectRelativePath, relativePath)),
          workingDirectory: packageWorkingDirectory,
          command: scriptCommand,
          processId: process?.processId ?? null,
          processStatus: process?.status ?? null,
          status: managedState.status,
          startedAt: process?.startedAt ?? null,
          logPath: process?.logPath ?? null,
          auditPath: process?.auditPath ?? null,
          supportsRestart: true,
          supportsExec: true,
          supportsStart: process?.status !== "running",
          supportsStop: process?.status === "running",
          healthStatus: managedState.healthStatus,
          healthReason: managedState.healthReason,
          containerId: null,
          publishedPorts: [],
        },
        managedLaunch: launch,
      });
    }
  }

  for (const procfilePath of projectFiles.filter((entry) => path.posix.basename(entry).toLowerCase() === "procfile")) {
    const contents = fs.readFileSync(path.join(projectAbsolutePath, procfilePath), "utf-8");
    const workingDirectory = normalizePath(path.posix.join(args.projectRelativePath, path.posix.dirname(procfilePath)));
    for (const entry of parseProcfileEntries(contents)) {
      const tokens = tokenizeCommand(entry.command);
      if (tokens.length === 0) {
        continue;
      }
      const launch = {
        command: tokens[0],
        args: tokens.slice(1),
        cwd: workingDirectory,
      } satisfies ManagedLaunchSpec;
      const process = selectAvailableManagedProcess(managedProcesses, launch, claimedProcessIds);
      const managedState = toManagedServiceStatus(process);
      discovered.push({
        summary: {
          serviceId: `procfile:${normalizePath(procfilePath)}:${entry.name}`,
          label: entry.name,
          source: "procfile",
          runner: "procfile_process",
          declaredIn: normalizePath(path.posix.join(args.projectRelativePath, procfilePath)),
          workingDirectory,
          command: entry.command,
          processId: process?.processId ?? null,
          processStatus: process?.status ?? null,
          status: managedState.status,
          startedAt: process?.startedAt ?? null,
          logPath: process?.logPath ?? null,
          auditPath: process?.auditPath ?? null,
          supportsRestart: true,
          supportsExec: true,
          supportsStart: process?.status !== "running",
          supportsStop: process?.status === "running",
          healthStatus: managedState.healthStatus,
          healthReason: managedState.healthReason,
          containerId: null,
          publishedPorts: [],
        },
        managedLaunch: launch,
      });
    }
  }

  for (const composeFilePath of projectFiles.filter((entry) => COMPOSE_FILE_NAMES.has(path.posix.basename(entry).toLowerCase()))) {
    const absolutePath = path.join(projectAbsolutePath, composeFilePath);
    const workingDirectory = normalizePath(path.posix.join(args.projectRelativePath, path.posix.dirname(composeFilePath)));
    const contents = fs.readFileSync(absolutePath, "utf-8");
    for (const serviceName of parseComposeServiceNames(contents)) {
      composeDefinitions.push({
        fileRelativePath: normalizePath(composeFilePath),
        fileAbsolutePath: absolutePath,
        serviceName,
        workingDirectory,
      });
    }
  }

  const composeStates = inspectComposeStates(composeDefinitions);
  for (const definition of composeDefinitions) {
    const state = composeStates.get(`${definition.fileRelativePath}:${definition.serviceName}`) ?? null;
    const composeSummary = buildComposeSummary(state);
    discovered.push({
      summary: {
        serviceId: `compose:${definition.fileRelativePath}:${definition.serviceName}`,
        label: definition.serviceName,
        source: "compose_file",
        runner: "compose_service",
        declaredIn: normalizePath(path.posix.join(args.projectRelativePath, definition.fileRelativePath)),
        workingDirectory: definition.workingDirectory,
        command: null,
        processId: state?.containerId ?? null,
        processStatus: null,
        status: composeSummary.status,
        startedAt: state?.startedAt ?? null,
        logPath: null,
        auditPath: null,
        supportsRestart: true,
        supportsExec: composeSummary.status === "running",
        supportsStart: composeSummary.status !== "running",
        supportsStop: composeSummary.status === "running",
        healthStatus: composeSummary.healthStatus,
        healthReason: composeSummary.healthReason,
        containerId: state?.containerId ?? null,
        publishedPorts: state?.publishedPorts ?? [],
      },
      compose: definition,
    });
  }

  return discovered.sort((left, right) => left.summary.serviceId.localeCompare(right.summary.serviceId));
}

function summarizeRuntimeOverview(overview: Omit<BuilderRuntimeInspectionOverview, "summary">): string {
  return `Runtime services: ${overview.totalServices} declared, ${overview.runningServices} running, ${overview.failedServices} failed, ${overview.managedServices} managed.`;
}

function resolveRuntimeServiceOrThrow(args: BuilderRuntimeServiceControlArgs): ResolvedRuntimeService {
  const services = discoverRuntimeServices(args);
  const service = services.find((entry) => entry.summary.serviceId === args.serviceId);
  if (!service) {
    throw new Error(`Unknown Builder runtime service: ${args.serviceId}`);
  }
  return service;
}

function readComposeLogsOnce(service: ResolvedRuntimeService, serviceArgs: BuilderRuntimeServiceLogArgs): BuilderRuntimeServiceLogPreview {
  const tailBytes = Math.max(256, Math.trunc(serviceArgs.tailBytes ?? DEFAULT_LOG_TAIL_BYTES));
  const maxBytes = Math.max(256, Math.trunc(serviceArgs.maxBytes ?? tailBytes));
  if (!service.compose) {
    return {
      service: service.summary,
      logs: "",
      cursorUsed: 0,
      nextCursor: 0,
      truncatedBeforeCursor: false,
      complete: true,
      followed: false,
      followTimedOut: false,
      error: "Compose metadata is unavailable for this service.",
    };
  }
  const lineCount = Math.max(20, Math.ceil(tailBytes / 120));
  const result = spawnSync("docker", ["compose", "-f", service.compose.fileAbsolutePath, "logs", "--no-color", "--timestamps", "--tail", String(lineCount), service.compose.serviceName], {
    cwd: resolveBuilderWorkspacePath(service.compose.workingDirectory),
    encoding: "utf-8",
    windowsHide: true,
  });
  const logsBuffer = (result.status === 0 ? result.stdout : "").slice(-Math.max(maxBytes, tailBytes));
  const requestedCursor = typeof serviceArgs.cursor === "number" ? Math.max(0, Math.trunc(serviceArgs.cursor)) : Math.max(0, logsBuffer.length - tailBytes);
  const truncatedBeforeCursor = requestedCursor > logsBuffer.length;
  const cursorUsed = truncatedBeforeCursor ? 0 : requestedCursor;
  return {
    service: service.summary,
    logs: logsBuffer.slice(cursorUsed, Math.min(logsBuffer.length, cursorUsed + maxBytes)),
    cursorUsed,
    nextCursor: logsBuffer.length,
    truncatedBeforeCursor,
    complete: service.summary.status !== "running",
    followed: false,
    followTimedOut: false,
    ...(result.status === 0 || service.summary.status !== "running"
      ? {}
      : { error: (result.stderr ?? result.stdout ?? "").trim() || "Compose logs are unavailable." }),
  };
}

async function readComposeLogs(service: ResolvedRuntimeService, serviceArgs: BuilderRuntimeServiceLogArgs): Promise<BuilderRuntimeServiceLogPreview> {
  let preview = readComposeLogsOnce(service, serviceArgs);
  const followSeconds = Math.max(0, Math.trunc(serviceArgs.followSeconds ?? 0));
  if (preview.logs || followSeconds === 0 || preview.service.status !== "running") {
    return preview;
  }

  const deadline = Date.now() + followSeconds * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, FOLLOW_POLL_INTERVAL_MS));
    const next = readComposeLogsOnce(resolveRuntimeServiceOrThrow(serviceArgs), serviceArgs);
    if (next.logs || next.service.status !== "running" || next.nextCursor !== preview.nextCursor) {
      return {
        ...next,
        followed: true,
      };
    }
    preview = next;
  }

  return {
    ...preview,
    followed: true,
    followTimedOut: true,
  };
}

function buildProcessPayload(process: BuilderManagedProcessSnapshot | undefined): BuilderRuntimeControlResponse["process"] {
  if (!process) {
    return undefined;
  }
  return {
    processId: process.processId,
    status: process.status,
    logPath: process.logPath,
    auditPath: process.auditPath,
  };
}

function auditRuntimeAction(args: {
  context: BuilderRuntimeContextArgs;
  service: BuilderRuntimeServiceSummary;
  operation: string;
  outcomeStatus: "succeeded" | "failed" | "blocked" | "cancelled" | "timed_out";
  metadata?: Record<string, unknown>;
}): string {
  return appendBuilderCapabilityAuditEvent({
    capabilityKey: "runtime_orchestration",
    projectId: args.context.projectId,
    projectRelativePath: args.context.projectRelativePath,
    outcomeStatus: args.outcomeStatus,
    targets: [{ kind: "service", identifier: args.service.serviceId }],
    metadata: {
      operation: args.operation,
      serviceLabel: args.service.label,
      runner: args.service.runner,
      ...args.metadata,
    },
  }).auditPath;
}

async function startManagedService(context: BuilderRuntimeServiceControlArgs, service: ResolvedRuntimeService): Promise<BuilderRuntimeControlResponse> {
  if (!service.managedLaunch) {
    throw new Error(`Runtime service ${service.summary.serviceId} cannot be started by Builder.`);
  }
  const existing = selectManagedProcess(listBuilderManagedProcesses({ projectId: context.projectId, includeFinished: true, limit: 200 }).processes, service.managedLaunch);
  if (existing?.status === "running") {
    const current = resolveBuilderRuntimeService(context);
    const auditPath = auditRuntimeAction({ context, service: current, operation: "start_service", outcomeStatus: "succeeded", metadata: { alreadyRunning: true } });
    return {
      status: "completed",
      message: `Service ${current.label} is already running.`,
      service: current,
      process: buildProcessPayload(existing),
      previousProcess: existing ? { processId: existing.processId, status: existing.status } : null,
      auditPath,
    };
  }
  const started = await startBuilderManagedProcess({
    command: service.managedLaunch.command,
    args: service.managedLaunch.args,
    cwd: service.managedLaunch.cwd,
    timeoutSeconds: DEFAULT_CONTROL_TIMEOUT_SECONDS,
    projectId: context.projectId,
  });
  const current = resolveBuilderRuntimeService(context);
  const auditPath = auditRuntimeAction({ context, service: current, operation: "start_service", outcomeStatus: "succeeded" });
  return {
    status: "completed",
    message: `Started service ${current.label}.`,
    service: current,
    process: buildProcessPayload(started.process),
    previousProcess: existing ? { processId: existing.processId, status: existing.status } : null,
    auditPath,
  };
}

async function stopManagedService(context: BuilderRuntimeServiceControlArgs, service: ResolvedRuntimeService): Promise<BuilderRuntimeControlResponse> {
  if (!service.summary.processId) {
    const current = resolveBuilderRuntimeService(context);
    const auditPath = auditRuntimeAction({ context, service: current, operation: "stop_service", outcomeStatus: "succeeded", metadata: { alreadyStopped: true } });
    return {
      status: "completed",
      message: `Service ${current.label} is already stopped.`,
      service: current,
      previousProcess: null,
      auditPath,
    };
  }
  const stopped = stopBuilderManagedProcess(service.summary.processId);
  await waitForBuilderManagedProcess({ processId: service.summary.processId, timeoutSeconds: 20 });
  const current = resolveBuilderRuntimeService(context);
  const auditPath = auditRuntimeAction({ context, service: current, operation: "stop_service", outcomeStatus: "succeeded" });
  return {
    status: "completed",
    message: `Stopped service ${current.label}.`,
    service: current,
    process: buildProcessPayload(stopped.process),
    previousProcess: { processId: stopped.process.processId, status: stopped.process.status },
    auditPath,
  };
}

async function runComposeControl(service: ResolvedRuntimeService, subcommand: string[], timeoutSeconds = DEFAULT_CONTROL_TIMEOUT_SECONDS): Promise<BuilderCommandResult> {
  return runBuilderCommand("docker", ["compose", "-f", service.compose!.fileAbsolutePath, ...subcommand], {
    cwd: service.compose!.workingDirectory,
    timeoutSeconds,
  });
}

export function listBuilderRuntimeServices(args: BuilderRuntimeContextArgs): BuilderRuntimeInspectionOverview {
  return getBuilderRuntimeInspectionOverview(args);
}

export function resolveBuilderRuntimeService(args: BuilderRuntimeServiceControlArgs): BuilderRuntimeServiceSummary {
  return resolveRuntimeServiceOrThrow(args).summary;
}

export function getBuilderRuntimeInspectionOverview(args: BuilderRuntimeContextArgs): BuilderRuntimeInspectionOverview {
  const services = discoverRuntimeServices(args).map((entry) => entry.summary);
  const overview = {
    totalServices: services.length,
    runningServices: services.filter((service) => service.status === "running").length,
    failedServices: services.filter((service) => service.status === "failed").length,
    managedServices: services.filter((service) => service.processId || service.containerId).length,
    services,
  };
  return {
    ...overview,
    summary: summarizeRuntimeOverview(overview),
  };
}

export async function getBuilderRuntimeServiceLogs(args: BuilderRuntimeServiceLogArgs): Promise<BuilderRuntimeServiceLogPreview> {
  const service = resolveRuntimeServiceOrThrow(args);
  if (service.summary.runner === "compose_service") {
    return readComposeLogs(service, args);
  }
  if (!service.summary.processId) {
    return {
      service: service.summary,
      logs: "",
      cursorUsed: 0,
      nextCursor: 0,
      truncatedBeforeCursor: false,
      complete: true,
      followed: false,
      followTimedOut: false,
    };
  }
  const result = await streamBuilderManagedProcessLogs({
    processId: service.summary.processId,
    cursor: args.cursor,
    maxBytes: args.maxBytes,
    tailBytes: args.tailBytes,
    followSeconds: args.followSeconds,
  });
  return {
    service: resolveBuilderRuntimeService(args),
    logs: result.logs,
    cursorUsed: result.cursorUsed,
    nextCursor: result.nextCursor,
    truncatedBeforeCursor: result.truncatedBeforeCursor,
    complete: result.complete,
    followed: result.followed,
    followTimedOut: result.followTimedOut,
  };
}

export async function previewBuilderRuntimeServiceLogs(args: BuilderRuntimeServiceLogArgs): Promise<BuilderRuntimeServiceLogPreview> {
  return getBuilderRuntimeServiceLogs({
    ...args,
    tailBytes: args.tailBytes ?? DEFAULT_LOG_TAIL_BYTES,
    followSeconds: undefined,
  });
}

export async function startBuilderRuntimeService(args: BuilderRuntimeServiceControlArgs): Promise<BuilderRuntimeControlResponse> {
  const service = resolveRuntimeServiceOrThrow(args);
  if (service.summary.runner === "compose_service") {
    const commandResult = await runComposeControl(service, ["up", "-d", service.compose!.serviceName]);
    const current = resolveBuilderRuntimeService(args);
    const auditPath = auditRuntimeAction({
      context: args,
      service: current,
      operation: "start_service",
      outcomeStatus: commandResult.ok ? "succeeded" : commandResult.timedOut ? "timed_out" : "failed",
      metadata: { exitCode: commandResult.exitCode },
    });
    return {
      status: commandResult.ok ? "completed" : "blocked",
      message: commandResult.ok ? `Started service ${current.label}.` : `Failed to start service ${current.label}.`,
      service: current,
      commandResult,
      auditPath,
    };
  }
  return startManagedService(args, service);
}

export async function stopBuilderRuntimeService(args: BuilderRuntimeServiceControlArgs): Promise<BuilderRuntimeControlResponse> {
  const service = resolveRuntimeServiceOrThrow(args);
  if (service.summary.runner === "compose_service") {
    const commandResult = await runComposeControl(service, ["stop", service.compose!.serviceName]);
    const current = resolveBuilderRuntimeService(args);
    const auditPath = auditRuntimeAction({
      context: args,
      service: current,
      operation: "stop_service",
      outcomeStatus: commandResult.ok ? "succeeded" : commandResult.timedOut ? "timed_out" : "failed",
      metadata: { exitCode: commandResult.exitCode },
    });
    return {
      status: commandResult.ok ? "completed" : "blocked",
      message: commandResult.ok ? `Stopped service ${current.label}.` : `Failed to stop service ${current.label}.`,
      service: current,
      commandResult,
      auditPath,
    };
  }
  return stopManagedService(args, service);
}

export async function restartBuilderRuntimeService(args: BuilderRuntimeServiceControlArgs): Promise<BuilderRuntimeControlResponse> {
  const service = resolveRuntimeServiceOrThrow(args);
  if (service.summary.runner === "compose_service") {
    const commandResult = service.summary.status === "running"
      ? await runComposeControl(service, ["restart", service.compose!.serviceName])
      : await runComposeControl(service, ["up", "-d", service.compose!.serviceName]);
    const current = resolveBuilderRuntimeService(args);
    const auditPath = auditRuntimeAction({
      context: args,
      service: current,
      operation: "restart_service",
      outcomeStatus: commandResult.ok ? "succeeded" : commandResult.timedOut ? "timed_out" : "failed",
      metadata: { exitCode: commandResult.exitCode },
    });
    return {
      status: commandResult.ok ? "completed" : "blocked",
      message: commandResult.ok ? `Restarted service ${current.label}.` : `Failed to restart service ${current.label}.`,
      service: current,
      commandResult,
      auditPath,
    };
  }

  const previousProcess = service.summary.processId
    ? stopBuilderManagedProcess(service.summary.processId).process
    : null;
  if (service.summary.processId) {
    await waitForBuilderManagedProcess({ processId: service.summary.processId, timeoutSeconds: 20 });
  }
  if (!service.managedLaunch) {
    throw new Error(`Runtime service ${service.summary.serviceId} cannot be restarted by Builder.`);
  }
  const startedProcess = await startBuilderManagedProcess({
    command: service.managedLaunch.command,
    args: service.managedLaunch.args,
    cwd: service.managedLaunch.cwd,
    timeoutSeconds: DEFAULT_CONTROL_TIMEOUT_SECONDS,
    projectId: args.projectId,
  });
  const current = resolveBuilderRuntimeService(args);
  const auditPath = auditRuntimeAction({ context: args, service: current, operation: "restart_service", outcomeStatus: "succeeded" });
  return {
    status: "completed",
    message: `Restarted service ${current.label}.`,
    service: current,
    process: buildProcessPayload(startedProcess.process),
    previousProcess: previousProcess ? { processId: previousProcess.processId, status: previousProcess.status } : null,
    auditPath,
  };
}

export async function execBuilderRuntimeServiceCommand(args: BuilderRuntimeExecArgs): Promise<BuilderRuntimeControlResponse> {
  const service = resolveRuntimeServiceOrThrow(args);
  const command = args.command.trim();
  if (!command) {
    throw new Error("Runtime exec command is required.");
  }
  assertBuilderCommandAllowed(command);

  const commandResult = service.summary.runner === "compose_service"
    ? await runComposeControl(service, ["exec", "-T", service.compose!.serviceName, command, ...(args.commandArgs ?? [])], args.timeoutSeconds ?? DEFAULT_CONTROL_TIMEOUT_SECONDS)
    : await runBuilderCommand(command, args.commandArgs ?? [], {
      cwd: service.managedLaunch?.cwd ?? service.summary.workingDirectory,
      timeoutSeconds: args.timeoutSeconds ?? DEFAULT_CONTROL_TIMEOUT_SECONDS,
    });

  const current = resolveBuilderRuntimeService(args);
  const auditPath = auditRuntimeAction({
    context: args,
    service: current,
    operation: "exec_in_service",
    outcomeStatus: commandResult.ok ? "succeeded" : commandResult.timedOut ? "timed_out" : "failed",
    metadata: {
      execCommand: command,
      execArgs: args.commandArgs ?? [],
      exitCode: commandResult.exitCode,
    },
  });

  return {
    status: commandResult.ok ? "completed" : "blocked",
    message: commandResult.ok ? `Executed ${command} for service ${current.label}.` : `Command ${command} failed for service ${current.label}.`,
    service: current,
    commandResult,
    auditPath,
  };
}