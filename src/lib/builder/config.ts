import fs from "fs";
import path from "path";
import { getAppHomeDir } from "@/lib/runtime-paths";

const DEFAULT_BUILDER_WORKSPACE_DIRNAME = "builder-workspace";
const DEFAULT_TEMPLATE = "node-cli";
const DEFAULT_PACKAGE_MANAGER = "NPM";
const DEFAULT_AGENTIC_PROFILE = "";
const DEFAULT_AGENTIC_TIMEOUT_SECONDS = 900;
const DEFAULT_AGENTIC_MAX_ITERATIONS = 3;

export interface BuilderConfig {
  workspaceRoot: string;
  projectsRoot: string;
  repositoryRoot: string;
  configuredByEnv: boolean;
  safe: boolean;
  reason?: string;
  disableToolSubsetting: boolean;
  allowedCommands: string[];
  allowedContainerCommands: string[];
  allowedContainerPathPrefixes: string[];
  allowedContainerTestPresets: string[];
  allowedHosts: string[];
  allowedDatabases: string[];
  allowedRemotes: string[];
  defaultTemplate: string;
  defaultPackageManager: "NPM" | "PNPM";
  initializeGitByDefault: boolean;
  installDependenciesByDefault: boolean;
  defaultAgenticProfile: string;
  agenticTimeoutSeconds: number;
  agenticMaxIterations: number;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizePathForComparison(targetPath: string): string {
  const resolved = path.resolve(/* turbopackIgnore: true */ targetPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function isPathInside(rootPath: string, candidatePath: string): boolean {
  const normalizedRoot = normalizePathForComparison(rootPath);
  const normalizedCandidate = normalizePathForComparison(candidatePath);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

export function pathsOverlap(firstPath: string, secondPath: string): boolean {
  return isPathInside(firstPath, secondPath) || isPathInside(secondPath, firstPath);
}

export function getBuilderRepositoryRoot(): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd());
}

function resolveBuilderWorkspaceRoot(): { workspaceRoot: string; configuredByEnv: boolean } {
  const configuredPath = process.env.BIZBOT_BUILDER_WORKSPACE_PATH?.trim();
  if (!configuredPath) {
    return {
      workspaceRoot: path.resolve(/* turbopackIgnore: true */ getAppHomeDir(), DEFAULT_BUILDER_WORKSPACE_DIRNAME),
      configuredByEnv: false,
    };
  }

  return {
    workspaceRoot: path.isAbsolute(configuredPath)
      ? path.resolve(/* turbopackIgnore: true */ configuredPath)
      : path.resolve(/* turbopackIgnore: true */ getAppHomeDir(), /* turbopackIgnore: true */ configuredPath),
    configuredByEnv: true,
  };
}

export function getBuilderAllowedCommands(): string[] {
  const raw = process.env.BIZBOT_BUILDER_ALLOWED_COMMANDS?.trim();
  if (!raw) {
    return [];
  }

  return Array.from(new Set(raw.split(",").map((value) => value.trim()).filter(Boolean)));
}

function parseCsvEnv(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }

  return Array.from(new Set(raw.split(",").map((value) => value.trim()).filter(Boolean)));
}

function normalizeContainerPathPrefix(raw: string): string {
  const normalized = raw.replace(/\\/g, "/").trim();
  if (!normalized.startsWith("/")) {
    throw new Error(`Builder container path prefix must be absolute: ${raw}`);
  }
  const collapsed = normalized.replace(/\/+/g, "/");
  return collapsed === "/" ? "/" : collapsed.replace(/\/$/, "");
}

function normalizeRemoteUrlPathname(pathname: string): string {
  return pathname.replace(/\\/g, "/");
}

export function normalizeBuilderRemoteUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Builder remote URL cannot be empty.");
  }

  if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed.startsWith(".\\") || trimmed.startsWith("..\\") || trimmed.startsWith("/") || trimmed.startsWith("\\\\")) {
    return new URL(`file://${normalizeRemoteUrlPathname(path.resolve(/* turbopackIgnore: true */ trimmed))}`).toString().toLowerCase();
  }

  const scpMatch = trimmed.match(/^([^@\s]+)@([^:\s]+):(.+)$/);
  if (scpMatch) {
    const [, user, host, remotePath] = scpMatch;
    return `ssh://${user}@${host.toLowerCase()}/${normalizeRemoteUrlPathname(remotePath)}`;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "file:") {
      parsed.pathname = normalizeRemoteUrlPathname(parsed.pathname);
    }
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString().toLowerCase();
  } catch {
    throw new Error(`Builder remote URL is invalid: ${trimmed}`);
  }
}

export function getBuilderAllowedHosts(): string[] {
  return parseCsvEnv(process.env.BIZBOT_BUILDER_ALLOWED_HOSTS);
}

export function getBuilderAllowedContainerCommands(): string[] {
  return parseCsvEnv(process.env.BIZBOT_BUILDER_ALLOWED_CONTAINER_COMMANDS);
}

export function getBuilderAllowedContainerPathPrefixes(): string[] {
  return parseCsvEnv(process.env.BIZBOT_BUILDER_ALLOWED_CONTAINER_PATH_PREFIXES)
    .flatMap((value) => {
      try {
        return [normalizeContainerPathPrefix(value)];
      } catch {
        return [];
      }
    });
}

export function getBuilderAllowedContainerTestPresets(): string[] {
  return parseCsvEnv(process.env.BIZBOT_BUILDER_ALLOWED_CONTAINER_TEST_PRESETS);
}

export function getBuilderAllowedDatabases(): string[] {
  return parseCsvEnv(process.env.BIZBOT_BUILDER_ALLOWED_DATABASES);
}

export function getBuilderAllowedRemotes(): string[] {
  return parseCsvEnv(process.env.BIZBOT_BUILDER_ALLOWED_REMOTES)
    .flatMap((value) => {
      try {
        return [normalizeBuilderRemoteUrl(value)];
      } catch {
        return [];
      }
    });
}

export function getBuilderConfig(): BuilderConfig {
  const { workspaceRoot, configuredByEnv } = resolveBuilderWorkspaceRoot();
  const repositoryRoot = getBuilderRepositoryRoot();
  const projectsRoot = path.resolve(/* turbopackIgnore: true */ workspaceRoot, "projects");

  return {
    workspaceRoot,
    projectsRoot,
    repositoryRoot,
    configuredByEnv,
    safe: !pathsOverlap(workspaceRoot, repositoryRoot),
    reason: pathsOverlap(workspaceRoot, repositoryRoot)
      ? "Builder workspace overlaps the BizBot repository. Configure BIZBOT_BUILDER_WORKSPACE_PATH to an external directory."
      : undefined,
    disableToolSubsetting: parseBoolean(process.env.BIZBOT_BUILDER_DISABLE_TOOL_SUBSETTING, false),
    allowedCommands: getBuilderAllowedCommands(),
    allowedContainerCommands: getBuilderAllowedContainerCommands(),
    allowedContainerPathPrefixes: getBuilderAllowedContainerPathPrefixes(),
    allowedContainerTestPresets: getBuilderAllowedContainerTestPresets(),
    allowedHosts: getBuilderAllowedHosts(),
    allowedDatabases: getBuilderAllowedDatabases(),
    allowedRemotes: getBuilderAllowedRemotes(),
    defaultTemplate: process.env.BIZBOT_BUILDER_DEFAULT_TEMPLATE?.trim() || DEFAULT_TEMPLATE,
    defaultPackageManager: process.env.BIZBOT_BUILDER_DEFAULT_PACKAGE_MANAGER === "PNPM" ? "PNPM" : DEFAULT_PACKAGE_MANAGER,
    initializeGitByDefault: parseBoolean(process.env.BIZBOT_BUILDER_INIT_GIT, true),
    installDependenciesByDefault: parseBoolean(process.env.BIZBOT_BUILDER_INSTALL_DEPS, false),
    defaultAgenticProfile: process.env.BIZBOT_BUILDER_DEFAULT_AGENTIC_PROFILE?.trim() || DEFAULT_AGENTIC_PROFILE,
    agenticTimeoutSeconds: parsePositiveInteger(process.env.BIZBOT_BUILDER_AGENTIC_TIMEOUT_SECONDS, DEFAULT_AGENTIC_TIMEOUT_SECONDS),
    agenticMaxIterations: Math.max(1, parsePositiveInteger(process.env.BIZBOT_BUILDER_AGENTIC_MAX_ITERATIONS, DEFAULT_AGENTIC_MAX_ITERATIONS)),
  };
}

export function assertBuilderWorkspaceSafe(): BuilderConfig {
  const config = getBuilderConfig();
  if (!config.safe) {
    throw new Error(config.reason ?? "Builder workspace is not safe.");
  }

  if (!fs.existsSync(config.workspaceRoot)) {
    fs.mkdirSync(config.workspaceRoot, { recursive: true });
  }
  if (!fs.existsSync(config.projectsRoot)) {
    fs.mkdirSync(config.projectsRoot, { recursive: true });
  }

  return config;
}

export function resolveBuilderWorkspacePath(relativePath: string): string {
  const config = assertBuilderWorkspaceSafe();
  const resolved = path.resolve(/* turbopackIgnore: true */ config.workspaceRoot, /* turbopackIgnore: true */ relativePath);
  if (!isPathInside(config.workspaceRoot, resolved)) {
    throw new Error("Access denied: path escapes builder workspace root");
  }
  return resolved;
}