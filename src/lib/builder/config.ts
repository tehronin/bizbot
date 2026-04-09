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
  allowedCommands: string[];
  allowedHosts: string[];
  allowedDatabases: string[];
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

export function getBuilderAllowedHosts(): string[] {
  return parseCsvEnv(process.env.BIZBOT_BUILDER_ALLOWED_HOSTS);
}

export function getBuilderAllowedDatabases(): string[] {
  return parseCsvEnv(process.env.BIZBOT_BUILDER_ALLOWED_DATABASES);
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
    allowedCommands: getBuilderAllowedCommands(),
    allowedHosts: getBuilderAllowedHosts(),
    allowedDatabases: getBuilderAllowedDatabases(),
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