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
import {
  getBuilderAllowedContainerCommands,
  getBuilderAllowedContainerPathPrefixes,
  getBuilderAllowedContainerTestPresets,
  resolveBuilderWorkspacePath,
} from "@/lib/builder/config";
import { assertBuilderCommandAllowed, runBuilderCommand, type BuilderCommandResult } from "@/lib/builder/workspace";

const COMPOSE_FILE_NAMES = new Set(["compose.yml", "compose.yaml", "docker-compose.yml", "docker-compose.yaml"]);
const SKIPPED_SCAN_DIRS = new Set([".git", ".builder", "node_modules"]);
const DEFAULT_LOG_TAIL_BYTES = 6000;
const DEFAULT_CONTROL_TIMEOUT_SECONDS = 120;
const FOLLOW_POLL_INTERVAL_MS = 1000;
const DEFAULT_CONTAINER_FILE_MAX_BYTES = 4096;
const DEFAULT_CONTAINER_LIST_MAX_ENTRIES = 100;
const MANAGED_CONTAINER_INSPECT_BATCH_SIZE = 1;
const BIZBOT_BUILDER_CONTAINER_MANAGED_LABEL = "bizbot.builder.managed";
const BIZBOT_BUILDER_CONTAINER_PROJECT_ID_LABEL = "bizbot.builder.project_id";
const BIZBOT_BUILDER_CONTAINER_RELATIVE_PATH_LABEL = "bizbot.builder.relative_path";
const BIZBOT_BUILDER_CONTAINER_SERVICE_ID_LABEL = "bizbot.builder.service_id";
const BIZBOT_BUILDER_CONTAINER_TEMPLATE_LABEL = "bizbot.builder.template";
const LEGACY_TEST_COMPOSE_PROJECT_RE = /^container-mcp-demo-/;

const BUILDER_CONTAINER_TEST_PRESETS = {
  npm_test: { command: "npm", args: ["test"] },
  npm_vitest: { command: "npm", args: ["run", "test", "--", "--runInBand"] },
  pnpm_test: { command: "pnpm", args: ["test"] },
  pnpm_vitest: { command: "pnpm", args: ["vitest", "run"] },
  pytest: { command: "pytest", args: [] },
} as const;

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

export interface BuilderRuntimeContainerSummary {
  serviceId: string;
  label: string;
  containerId: string | null;
  status: BuilderRuntimeServiceStatus;
  healthStatus: BuilderRuntimeHealthStatus;
  healthReason: string | null;
  publishedPorts: string[];
  declaredIn: string;
  workingDirectory: string;
}

export interface BuilderRuntimeContainerInspection {
  container: BuilderRuntimeContainerSummary;
  composeFile: string;
  composeServiceName: string;
  auditPath: string;
}

export interface BuilderManagedContainerSummary {
  containerId: string;
  name: string;
  status: string;
  running: boolean;
  image: string | null;
  projectId: string | null;
  projectRelativePath: string | null;
  serviceId: string | null;
  template: string | null;
  composeProject: string | null;
  composeService: string | null;
  composeWorkingDirectory: string | null;
  ownership: "builder_managed" | "legacy_test_fixture";
  createdAt: string | null;
}

export interface BuilderManagedContainerListArgs {
  projectId?: string;
  status?: "running" | "stopped" | "all";
  olderThanMinutes?: number;
  limit?: number;
}

export interface BuilderManagedContainerListResult {
  containers: BuilderManagedContainerSummary[];
  total: number;
  auditPath: string;
}

export interface BuilderManagedContainerRemoveArgs extends BuilderManagedContainerListArgs {
  containerIds?: string[];
}

export interface BuilderManagedContainerCleanupArgs extends Omit<BuilderManagedContainerRemoveArgs, "status"> {}

export interface BuilderManagedContainerRemoveResult {
  removedContainerIds: string[];
  skippedContainerIds: string[];
  totalMatched: number;
  auditPath: string;
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

export interface BuilderRuntimeContainerListArgs extends BuilderRuntimeContextArgs {
  includeStopped?: boolean;
}

export interface BuilderRuntimeContainerPathArgs extends BuilderRuntimeServiceControlArgs {
  path: string;
}

export interface BuilderRuntimeContainerFileListArgs extends BuilderRuntimeContainerPathArgs {
  maxEntries?: number;
  includeHidden?: boolean;
}

export interface BuilderRuntimeContainerFileReadArgs extends BuilderRuntimeContainerPathArgs {
  maxBytes?: number;
}

export interface BuilderRuntimeContainerPathStat {
  serviceId: string;
  containerId: string | null;
  path: string;
  exists: boolean;
  type: "file" | "directory" | "other" | "missing";
  size: number | null;
  auditPath: string;
}

export interface BuilderRuntimeContainerFileEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "other";
  size: number | null;
}

export interface BuilderRuntimeContainerFileList {
  serviceId: string;
  containerId: string | null;
  path: string;
  entries: BuilderRuntimeContainerFileEntry[];
  truncated: boolean;
  auditPath: string;
}

export interface BuilderRuntimeContainerFileRead {
  serviceId: string;
  containerId: string | null;
  path: string;
  content: string;
  truncated: boolean;
  bytesRead: number;
  maxBytes: number;
  auditPath: string;
}

export interface BuilderRuntimeContainerTestArgs extends BuilderRuntimeServiceControlArgs {
  preset: keyof typeof BUILDER_CONTAINER_TEST_PRESETS;
  args?: string[];
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

function toContainerSummary(service: BuilderRuntimeServiceSummary): BuilderRuntimeContainerSummary {
  return {
    serviceId: service.serviceId,
    label: service.label,
    containerId: service.containerId,
    status: service.status,
    healthStatus: service.healthStatus,
    healthReason: service.healthReason,
    publishedPorts: service.publishedPorts,
    declaredIn: service.declaredIn,
    workingDirectory: service.workingDirectory,
  };
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

function resolveRuntimeContainerOrThrow(args: BuilderRuntimeServiceControlArgs): ResolvedRuntimeService {
  const service = resolveRuntimeServiceOrThrow(args);
  if (service.summary.runner !== "compose_service" || !service.compose) {
    throw new Error(`Builder runtime service ${args.serviceId} is not a compose-backed container service.`);
  }
  return service;
}

function normalizeContainerPath(rawPath: string): string {
  const normalized = path.posix.normalize(rawPath.replace(/\\/g, "/").trim());
  if (!normalized.startsWith("/")) {
    throw new Error("Container path must be absolute.");
  }
  return normalized;
}

function isAllowedContainerPath(normalizedPath: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => prefix === "/" || normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`));
}

function assertBuilderContainerPathAllowed(rawPath: string): string {
  const normalizedPath = normalizeContainerPath(rawPath);
  const prefixes = getBuilderAllowedContainerPathPrefixes();
  if (!isAllowedContainerPath(normalizedPath, prefixes)) {
    throw new Error(`Builder container path is not allowlisted: ${normalizedPath}`);
  }
  return normalizedPath;
}

function assertBuilderContainerCommandAllowed(command: string): void {
  const normalized = command.trim().toLowerCase();
  const allowed = new Set(getBuilderAllowedContainerCommands().map((entry) => entry.toLowerCase()));
  if (!normalized || !allowed.has(normalized)) {
    throw new Error(`Builder container command not allowed: ${command}`);
  }
}

function assertBuilderContainerTestPresetAllowed(preset: string): void {
  const allowed = new Set(getBuilderAllowedContainerTestPresets().map((entry) => entry.toLowerCase()));
  if (!allowed.has(preset.toLowerCase())) {
    throw new Error(`Builder container test preset not allowed: ${preset}`);
  }
}

function parseContainerStatOutput(stdout: string): { exists: boolean; type: "file" | "directory" | "other" | "missing"; size: number | null } {
  const [typeToken = "missing", sizeToken = ""] = stdout.trim().split(/\t/, 2);
  const normalizedType = ["file", "directory", "other", "missing"].includes(typeToken)
    ? typeToken as "file" | "directory" | "other" | "missing"
    : "missing";
  const size = Number.parseInt(sizeToken, 10);
  return {
    exists: normalizedType !== "missing",
    type: normalizedType,
    size: Number.isFinite(size) ? size : null,
  };
}

function parseContainerFileListOutput(stdout: string): BuilderRuntimeContainerFileEntry[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [name, typeToken, sizeToken] = line.split(/\t/);
      if (!name || !typeToken) {
        return [];
      }
      const type = typeToken === "d"
        ? "directory"
        : typeToken === "f"
          ? "file"
          : "other";
      const size = Number.parseInt(sizeToken ?? "", 10);
      return [{
        name,
        path: name,
        type,
        size: Number.isFinite(size) ? size : null,
      }];
    });
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

function auditContainerAction(args: {
  capabilityKey: "container_inspection" | "container_execution";
  context: BuilderRuntimeContextArgs;
  service: BuilderRuntimeServiceSummary;
  operation: string;
  outcomeStatus: "succeeded" | "failed" | "blocked" | "cancelled" | "timed_out";
  metadata?: Record<string, unknown>;
}): string {
  return appendBuilderCapabilityAuditEvent({
    capabilityKey: args.capabilityKey,
    projectId: args.context.projectId,
    projectRelativePath: args.context.projectRelativePath,
    outcomeStatus: args.outcomeStatus,
    targets: [
      { kind: "service", identifier: args.service.serviceId, metadata: { serviceId: args.service.serviceId } },
      ...(args.service.containerId
        ? [{ kind: "container" as const, identifier: args.service.containerId, metadata: { serviceId: args.service.serviceId } }]
        : []),
    ],
    metadata: {
      operation: args.operation,
      serviceLabel: args.service.label,
      containerId: args.service.containerId,
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

async function runComposeExecCommand(service: ResolvedRuntimeService, command: string, args: string[], timeoutSeconds = DEFAULT_CONTROL_TIMEOUT_SECONDS): Promise<BuilderCommandResult> {
  return runComposeControl(service, ["exec", "-T", service.compose!.serviceName, command, ...args], timeoutSeconds);
}

export function listBuilderRuntimeServices(args: BuilderRuntimeContextArgs): BuilderRuntimeInspectionOverview {
  return getBuilderRuntimeInspectionOverview(args);
}

export function listBuilderRuntimeContainers(args: BuilderRuntimeContainerListArgs): BuilderRuntimeContainerSummary[] {
  return discoverRuntimeServices(args)
    .filter((service) => service.summary.runner === "compose_service")
    .map((service) => service.summary)
    .filter((service) => args.includeStopped ?? true ? true : service.status === "running")
    .map(toContainerSummary);
}

export function getBuilderRuntimeContainer(args: BuilderRuntimeServiceControlArgs): BuilderRuntimeContainerInspection {
  const service = resolveRuntimeContainerOrThrow(args);
  const current = resolveBuilderRuntimeService(args);
  const auditPath = auditContainerAction({
    capabilityKey: "container_inspection",
    context: args,
    service: current,
    operation: "inspect_container",
    outcomeStatus: "succeeded",
  });
  return {
    container: toContainerSummary(current),
    composeFile: service.compose!.fileRelativePath,
    composeServiceName: service.compose!.serviceName,
    auditPath,
  };
}

export async function getBuilderRuntimeContainerLogs(args: BuilderRuntimeServiceLogArgs): Promise<BuilderRuntimeServiceLogPreview & { auditPath: string }> {
  const service = resolveRuntimeContainerOrThrow(args);
  const preview = await getBuilderRuntimeServiceLogs(args);
  const auditPath = auditContainerAction({
    capabilityKey: "container_inspection",
    context: args,
    service: service.summary,
    operation: "container_logs",
    outcomeStatus: preview.error ? "failed" : "succeeded",
    metadata: { followSeconds: args.followSeconds ?? 0 },
  });
  return {
    ...preview,
    auditPath,
  };
}

export async function statBuilderRuntimeContainerPath(args: BuilderRuntimeContainerPathArgs): Promise<BuilderRuntimeContainerPathStat> {
  const service = resolveRuntimeContainerOrThrow(args);
  const normalizedPath = assertBuilderContainerPathAllowed(args.path);
  const result = await runComposeExecCommand(service, "sh", ["-lc", 'if [ -d "$1" ]; then printf "directory\\t0\\n"; elif [ -f "$1" ]; then size=$(wc -c < "$1" 2>/dev/null | tr -d " "); printf "file\\t%s\\n" "${size:-0}"; elif [ -e "$1" ]; then printf "other\\t0\\n"; else printf "missing\\t0\\n"; fi', "sh", normalizedPath]);
  const parsed = parseContainerStatOutput(result.stdout);
  const current = resolveBuilderRuntimeService(args);
  const auditPath = auditContainerAction({
    capabilityKey: "container_inspection",
    context: args,
    service: current,
    operation: "stat_path",
    outcomeStatus: result.ok ? "succeeded" : result.timedOut ? "timed_out" : "failed",
    metadata: { path: normalizedPath, exitCode: result.exitCode },
  });
  return {
    serviceId: current.serviceId,
    containerId: current.containerId,
    path: normalizedPath,
    exists: parsed.exists,
    type: parsed.type,
    size: parsed.size,
    auditPath,
  };
}

export async function listBuilderRuntimeContainerFiles(args: BuilderRuntimeContainerFileListArgs): Promise<BuilderRuntimeContainerFileList> {
  const service = resolveRuntimeContainerOrThrow(args);
  const normalizedPath = assertBuilderContainerPathAllowed(args.path);
  const maxEntries = Math.max(1, Math.min(DEFAULT_CONTAINER_LIST_MAX_ENTRIES, Math.trunc(args.maxEntries ?? DEFAULT_CONTAINER_LIST_MAX_ENTRIES)));
  const includeHidden = args.includeHidden ? "1" : "0";
  const listScript = "if [ ! -d \"$1\" ]; then exit 12; fi; find \"$1\" -mindepth 1 -maxdepth 1 -printf \"%f\\t%y\\t%s\\n\" | awk -v includeHidden=\"$2\" -F \"\\t\" \"includeHidden == 1 || substr(\\$1, 1, 1) != \\\".\\\" { print \\$0 }\" | sort | head -n \"$3\"";
  const result = await runComposeExecCommand(service, "sh", ["-lc", listScript, "sh", normalizedPath, includeHidden, String(maxEntries + 1)]);
  const entries = parseContainerFileListOutput(result.stdout);
  const current = resolveBuilderRuntimeService(args);
  const auditPath = auditContainerAction({
    capabilityKey: "container_inspection",
    context: args,
    service: current,
    operation: "list_files",
    outcomeStatus: result.ok || result.exitCode === 12 ? "succeeded" : result.timedOut ? "timed_out" : "failed",
    metadata: { path: normalizedPath, maxEntries, includeHidden: args.includeHidden ?? false, exitCode: result.exitCode },
  });
  return {
    serviceId: current.serviceId,
    containerId: current.containerId,
    path: normalizedPath,
    entries: entries.slice(0, maxEntries),
    truncated: entries.length > maxEntries,
    auditPath,
  };
}

export async function readBuilderRuntimeContainerFile(args: BuilderRuntimeContainerFileReadArgs): Promise<BuilderRuntimeContainerFileRead> {
  const service = resolveRuntimeContainerOrThrow(args);
  const normalizedPath = assertBuilderContainerPathAllowed(args.path);
  const maxBytes = Math.max(1, Math.min(64_000, Math.trunc(args.maxBytes ?? DEFAULT_CONTAINER_FILE_MAX_BYTES)));
  const result = await runComposeExecCommand(service, "sh", ["-lc", 'if [ ! -f "$1" ]; then exit 14; fi; cat "$1"', "sh", normalizedPath]);
  const content = result.stdout.slice(0, maxBytes);
  const current = resolveBuilderRuntimeService(args);
  const auditPath = auditContainerAction({
    capabilityKey: "container_inspection",
    context: args,
    service: current,
    operation: "read_file",
    outcomeStatus: result.ok || result.exitCode === 14 ? "succeeded" : result.timedOut ? "timed_out" : "failed",
    metadata: { path: normalizedPath, maxBytes, exitCode: result.exitCode, truncated: result.stdout.length > maxBytes },
  });
  return {
    serviceId: current.serviceId,
    containerId: current.containerId,
    path: normalizedPath,
    content,
    truncated: result.stdout.length > maxBytes,
    bytesRead: content.length,
    maxBytes,
    auditPath,
  };
}

export async function testBuilderRuntimeContainer(args: BuilderRuntimeContainerTestArgs): Promise<BuilderRuntimeControlResponse & { preset: keyof typeof BUILDER_CONTAINER_TEST_PRESETS }> {
  const service = resolveRuntimeContainerOrThrow(args);
  const presetSpec = BUILDER_CONTAINER_TEST_PRESETS[args.preset];
  if (!presetSpec) {
    throw new Error(`Unknown Builder container test preset: ${args.preset}`);
  }
  assertBuilderContainerTestPresetAllowed(args.preset);
  const commandResult = await runComposeExecCommand(service, presetSpec.command, [...presetSpec.args, ...(args.args ?? [])], args.timeoutSeconds ?? DEFAULT_CONTROL_TIMEOUT_SECONDS);
  const current = resolveBuilderRuntimeService(args);
  const auditPath = auditContainerAction({
    capabilityKey: "container_execution",
    context: args,
    service: current,
    operation: "test_in_container",
    outcomeStatus: commandResult.ok ? "succeeded" : commandResult.timedOut ? "timed_out" : "failed",
    metadata: { preset: args.preset, args: args.args ?? [], exitCode: commandResult.exitCode },
  });
  return {
    status: commandResult.ok ? "completed" : "blocked",
    message: commandResult.ok ? `Executed ${args.preset} for service ${current.label}.` : `Preset ${args.preset} failed for service ${current.label}.`,
    service: current,
    commandResult,
    auditPath,
    preset: args.preset,
  };
}

export async function execBuilderRuntimeContainerCommand(args: BuilderRuntimeExecArgs): Promise<BuilderRuntimeControlResponse> {
  const service = resolveRuntimeContainerOrThrow(args);
  const command = args.command.trim();
  if (!command) {
    throw new Error("Runtime exec command is required.");
  }
  assertBuilderContainerCommandAllowed(command);
  const commandResult = await runComposeExecCommand(service, command, args.commandArgs ?? [], args.timeoutSeconds ?? DEFAULT_CONTROL_TIMEOUT_SECONDS);
  const current = resolveBuilderRuntimeService(args);
  const auditPath = auditContainerAction({
    capabilityKey: "container_execution",
    context: args,
    service: current,
    operation: "exec_in_container",
    outcomeStatus: commandResult.ok ? "succeeded" : commandResult.timedOut ? "timed_out" : "failed",
    metadata: { execCommand: command, execArgs: args.commandArgs ?? [], exitCode: commandResult.exitCode },
  });
  return {
    status: commandResult.ok ? "completed" : "blocked",
    message: commandResult.ok ? `Executed ${command} for service ${current.label}.` : `Command ${command} failed for service ${current.label}.`,
    service: current,
    commandResult,
    auditPath,
  };
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

export async function teardownBuilderRuntimeService(args: BuilderRuntimeServiceControlArgs): Promise<BuilderRuntimeControlResponse> {
  const service = resolveRuntimeServiceOrThrow(args);
  if (service.summary.runner === "compose_service") {
    const commandResult = await runComposeControl(service, ["down", "--remove-orphans"]);
    const current = resolveBuilderRuntimeService(args);
    const auditPath = auditRuntimeAction({
      context: args,
      service: current,
      operation: "teardown_service",
      outcomeStatus: commandResult.ok ? "succeeded" : commandResult.timedOut ? "timed_out" : "failed",
      metadata: { exitCode: commandResult.exitCode },
    });
    return {
      status: commandResult.ok ? "completed" : "blocked",
      message: commandResult.ok ? `Tore down compose project for service ${current.label}.` : `Failed to tear down compose project for service ${current.label}.`,
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

function parseDockerInspectContainers(stdout: string): Array<Record<string, unknown>> {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
      : [];
  } catch {
    return [];
  }
}

function parseDockerIdList(stdout: string): string[] {
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toManagedContainerSummary(entry: Record<string, unknown>): BuilderManagedContainerSummary | null {
  const state = readRecord(entry.State);
  const config = readRecord(entry.Config);
  const labels = readRecord(config?.Labels) ?? {};
  const name = getString(entry.Name)?.replace(/^\/+/, "") ?? null;
  const containerId = getString(entry.Id) ?? null;
  if (!name || !containerId) {
    return null;
  }

  const composeProject = getString(labels["com.docker.compose.project"]);
  const composeWorkingDirectory = getString(labels["com.docker.compose.project.working_dir"]);
  const normalizedComposeWorkingDirectory = composeWorkingDirectory
    ? composeWorkingDirectory.replace(/\\/g, "/")
    : null;
  const managed = getString(labels[BIZBOT_BUILDER_CONTAINER_MANAGED_LABEL]) === "true";
  const legacyFixture = !managed
    && Boolean(composeProject && LEGACY_TEST_COMPOSE_PROJECT_RE.test(composeProject))
    && Boolean(normalizedComposeWorkingDirectory && /bizbot-mcp-builder-/i.test(normalizedComposeWorkingDirectory));
  if (!managed && !legacyFixture) {
    return null;
  }

  return {
    containerId,
    name,
    status: getString(state?.Status) ?? "unknown",
    running: Boolean(state?.Running),
    image: getString(config?.Image),
    projectId: getString(labels[BIZBOT_BUILDER_CONTAINER_PROJECT_ID_LABEL]),
    projectRelativePath: getString(labels[BIZBOT_BUILDER_CONTAINER_RELATIVE_PATH_LABEL]),
    serviceId: getString(labels[BIZBOT_BUILDER_CONTAINER_SERVICE_ID_LABEL]),
    template: getString(labels[BIZBOT_BUILDER_CONTAINER_TEMPLATE_LABEL]),
    composeProject,
    composeService: getString(labels["com.docker.compose.service"]),
    composeWorkingDirectory,
    ownership: managed ? "builder_managed" : "legacy_test_fixture",
    createdAt: getString(entry.Created),
  };
}

function filterManagedContainers(containers: BuilderManagedContainerSummary[], args: BuilderManagedContainerListArgs): BuilderManagedContainerSummary[] {
  const status = args.status ?? "all";
  const now = Date.now();
  return containers.filter((container) => {
    if (args.projectId && container.projectId !== args.projectId) {
      return false;
    }
    if (status === "running" && !container.running) {
      return false;
    }
    if (status === "stopped" && container.running) {
      return false;
    }
    if (typeof args.olderThanMinutes === "number" && container.createdAt) {
      const ageMinutes = Math.max(0, (now - Date.parse(container.createdAt)) / 60_000);
      if (!Number.isFinite(ageMinutes) || ageMinutes < args.olderThanMinutes) {
        return false;
      }
    }
    return true;
  });
}

function auditManagedContainerHostAction(args: {
  operation: string;
  outcomeStatus: "succeeded" | "failed" | "blocked" | "cancelled" | "timed_out";
  metadata?: Record<string, unknown>;
  targets?: BuilderManagedContainerSummary[];
}): string {
  return appendBuilderCapabilityAuditEvent({
    capabilityKey: "container_execution",
    projectId: null,
    projectRelativePath: ".",
    outcomeStatus: args.outcomeStatus,
    targets: (args.targets ?? []).map((container) => ({
      kind: "container" as const,
      identifier: container.containerId,
      metadata: {
        name: container.name,
        projectId: container.projectId,
        serviceId: container.serviceId,
        ownership: container.ownership,
      },
    })),
    metadata: {
      operation: args.operation,
      ...args.metadata,
    },
  }).auditPath;
}

export async function listBuilderManagedContainers(args: BuilderManagedContainerListArgs = {}): Promise<BuilderManagedContainerListResult> {
  const filters = [`label=${BIZBOT_BUILDER_CONTAINER_MANAGED_LABEL}=true`];
  const legacyFilters = ["label=com.docker.compose.project", "name=container-mcp-demo-"];
  if (args.status === "running") {
    filters.push("status=running");
    legacyFilters.push("status=running");
  }
  if (args.status === "stopped") {
    filters.push("status=exited");
    legacyFilters.push("status=exited");
  }

  const idsResult = await runBuilderCommand("docker", ["ps", "-aq", ...filters.flatMap((filter) => ["--filter", filter])], { cwd: "." });
  const managedIds = parseDockerIdList(idsResult.stdout);
  const legacyIdsResult = await runBuilderCommand("docker", ["ps", "-aq", ...legacyFilters.flatMap((filter) => ["--filter", filter])], { cwd: "." });
  const legacyIds = parseDockerIdList(legacyIdsResult.stdout);
  const ids = Array.from(new Set([...managedIds, ...legacyIds]));
  if (ids.length === 0) {
    const auditPath = auditManagedContainerHostAction({ operation: "list_managed_containers", outcomeStatus: "succeeded", metadata: { total: 0 } });
    return { containers: [], total: 0, auditPath };
  }

  const inspected: BuilderManagedContainerSummary[] = [];
  for (let index = 0; index < ids.length; index += MANAGED_CONTAINER_INSPECT_BATCH_SIZE) {
    const batch = ids.slice(index, index + MANAGED_CONTAINER_INSPECT_BATCH_SIZE);
    const inspectResult = await runBuilderCommand("docker", ["inspect", "--type", "container", ...batch], { cwd: "." });
    inspected.push(...parseDockerInspectContainers(inspectResult.stdout)
      .flatMap((entry) => {
        const container = toManagedContainerSummary(entry);
        return container ? [container] : [];
      }));
  }
  const filtered = filterManagedContainers(inspected, args)
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, Math.max(1, Math.min(args.limit ?? 200, 500)));
  const auditPath = auditManagedContainerHostAction({
    operation: "list_managed_containers",
    outcomeStatus: "succeeded",
    metadata: { total: filtered.length },
    targets: filtered,
  });
  return {
    containers: filtered,
    total: filtered.length,
    auditPath,
  };
}

export async function removeBuilderManagedContainers(args: BuilderManagedContainerRemoveArgs = {}): Promise<BuilderManagedContainerRemoveResult> {
  const listing = await listBuilderManagedContainers(args);
  const targetIds = new Set(args.containerIds ?? []);
  const matched = targetIds.size > 0
    ? listing.containers.filter((container) => targetIds.has(container.containerId))
    : listing.containers;
  if (matched.length === 0) {
    const auditPath = auditManagedContainerHostAction({ operation: "remove_managed_containers", outcomeStatus: "succeeded", metadata: { removed: 0 } });
    return { removedContainerIds: [], skippedContainerIds: [], totalMatched: 0, auditPath };
  }

  const removeResult = await runBuilderCommand("docker", ["rm", "-f", ...matched.map((container) => container.containerId)], { cwd: "." });
  const removedContainerIds = removeResult.ok ? matched.map((container) => container.containerId) : [];
  const skippedContainerIds = removeResult.ok ? [] : matched.map((container) => container.containerId);
  const auditPath = auditManagedContainerHostAction({
    operation: "remove_managed_containers",
    outcomeStatus: removeResult.ok ? "succeeded" : removeResult.timedOut ? "timed_out" : "failed",
    metadata: { exitCode: removeResult.exitCode, removed: removedContainerIds.length },
    targets: matched,
  });
  return {
    removedContainerIds,
    skippedContainerIds,
    totalMatched: matched.length,
    auditPath,
  };
}

export async function cleanStaleBuilderManagedContainers(args: BuilderManagedContainerCleanupArgs = {}): Promise<BuilderManagedContainerRemoveResult> {
  return removeBuilderManagedContainers({
    ...args,
    status: "stopped",
  });
}