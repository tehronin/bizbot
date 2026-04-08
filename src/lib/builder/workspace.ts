import fs from "fs";
import os from "os";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { 
  assertBuilderWorkspaceSafe as assertBuilderConfigSafe,
  getBuilderAllowedCommands,
  getBuilderConfig,
  getBuilderRepositoryRoot,
  isPathInside,
  pathsOverlap,
  resolveBuilderWorkspacePath,
} from "@/lib/builder/config";

const DEFAULT_COMMAND_TIMEOUT_SECONDS = 60;
const MAX_COMMAND_TIMEOUT_SECONDS = 600;
const MAX_CAPTURED_OUTPUT_CHARS = 24_000;
const BUILDER_MANAGED_PROJECT_ROOT_ENTRIES = new Set([".builder", "AGENTS.md"]);
const BUILDER_PROTECTED_MUTATION_SEGMENTS = new Set([".git", "node_modules"]);

export interface BuilderPathStat {
  path: string;
  name: string;
  exists: boolean;
  type: "file" | "directory" | "missing";
  size: number | null;
  modifiedAt: string | null;
}

export interface BuilderPatchResult {
  applied: boolean;
  cwd: string;
  touchedPaths: string[];
}

export interface BuilderFileInfo {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modifiedAt?: Date;
}

export type BuilderWorkspaceStatus = ReturnType<typeof getBuilderConfig>;

export interface BuilderCommandResult {
  ok: boolean;
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
}

export interface BuilderCommandOptions {
  cwd?: string;
  timeoutSeconds?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  onStdoutChunk?: (chunk: string) => void | Promise<void>;
  onStderrChunk?: (chunk: string) => void | Promise<void>;
}

export interface BuilderResolvedCommandExecution {
  workspaceRoot: string;
  cwdAbsolute: string;
  cwd: string;
  command: string;
  resolvedCommand: string;
  args: string[];
  timeoutSeconds: number;
  env: NodeJS.ProcessEnv;
}

export function getBuilderWorkspaceStatus(): BuilderWorkspaceStatus {
  return getBuilderConfig();
}

function assertBuilderWorkspaceSafe(): string {
  return assertBuilderConfigSafe().workspaceRoot;
}

function toWorkspaceRelativePath(rootPath: string, absolutePath: string): string {
  const relativePath = path.relative(rootPath, absolutePath);
  return relativePath === "" ? "." : relativePath.replace(/\\/g, "/");
}

function safeBuilderPath(relativePath: string): string {
  const workspaceRoot = assertBuilderWorkspaceSafe();
  const resolved = resolveBuilderWorkspacePath(relativePath);
  if (!isPathInside(workspaceRoot, resolved)) {
    throw new Error("Access denied: path escapes builder workspace root");
  }
  return resolved;
}

function assertBuilderMutationPathAllowed(relativePath: string): void {
  const normalizedPath = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const segments = normalizedPath.split("/").filter(Boolean);
  for (const segment of segments) {
    if (BUILDER_PROTECTED_MUTATION_SEGMENTS.has(segment)) {
      throw new Error(`Access denied: mutation path targets protected builder segment '${segment}'.`);
    }
  }
}

function writeFileAtomic(absolutePath: string, content: string): void {
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(absolutePath),
    `.builder-tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}-${path.basename(absolutePath)}`,
  );
  fs.writeFileSync(tempPath, content, "utf-8");
  fs.renameSync(tempPath, absolutePath);
}

function collectPatchTargetPaths(patch: string): string[] {
  const touched = new Set<string>();
  const lines = patch.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith("+++ ") && !line.startsWith("--- ")) {
      continue;
    }
    const raw = line.slice(4).trim();
    if (!raw || raw === "/dev/null") {
      continue;
    }
    const normalized = raw.replace(/^[ab]\//, "").replace(/^\.\//, "");
    if (!normalized) {
      continue;
    }
    touched.add(normalized.replace(/\\/g, "/"));
  }
  return [...touched];
}

export function listBuilderFiles(subdir = "."): BuilderFileInfo[] {
  const workspaceRoot = assertBuilderWorkspaceSafe();
  const directoryPath = safeBuilderPath(subdir);
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  return fs.readdirSync(directoryPath, { withFileTypes: true }).map((entry) => {
    const entryPath = path.join(/* turbopackIgnore: true */ directoryPath, /* turbopackIgnore: true */ entry.name);
    const relativePath = toWorkspaceRelativePath(workspaceRoot, entryPath);
    if (entry.isDirectory()) {
      return { name: entry.name, path: relativePath, type: "directory" as const };
    }

    const stat = fs.statSync(entryPath);
    return {
      name: entry.name,
      path: relativePath,
      type: "file" as const,
      size: stat.size,
      modifiedAt: stat.mtime,
    };
  });
}

export function listBuilderFilesRecursive(subdir = ".", maxEntries = 500): string[] {
  const rootPath = safeBuilderPath(subdir);
  const workspaceRoot = assertBuilderWorkspaceSafe();
  if (!fs.existsSync(rootPath)) {
    return [];
  }

  const results: string[] = [];
  const queue = [rootPath];

  while (queue.length > 0 && results.length < maxEntries) {
    const currentPath = queue.shift()!;
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const entryPath = path.join(/* turbopackIgnore: true */ currentPath, /* turbopackIgnore: true */ entry.name);
      results.push(toWorkspaceRelativePath(workspaceRoot, entryPath));
      if (entry.isDirectory()) {
        queue.push(entryPath);
      }
      if (results.length >= maxEntries) {
        break;
      }
    }
  }

  return results;
}

export function readBuilderFile(relativePath: string): string {
  const absolutePath = safeBuilderPath(relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${relativePath}`);
  }

  return fs.readFileSync(absolutePath, "utf-8");
}

export function writeBuilderFile(relativePath: string, content: string): void {
  assertBuilderMutationPathAllowed(relativePath);
  const absolutePath = safeBuilderPath(relativePath);
  writeFileAtomic(absolutePath, content);
}

export function createBuilderDirectory(relativePath: string): void {
  assertBuilderMutationPathAllowed(relativePath);
  const absolutePath = safeBuilderPath(relativePath);
  fs.mkdirSync(absolutePath, { recursive: true });
}

export function ensureBuilderDirectory(relativePath: string): void {
  createBuilderDirectory(relativePath);
}

export function appendBuilderFile(relativePath: string, content: string): void {
  assertBuilderMutationPathAllowed(relativePath);
  const absolutePath = safeBuilderPath(relativePath);
  const existing = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf-8") : "";
  writeFileAtomic(absolutePath, `${existing}${content}`);
}

export function deleteBuilderPath(relativePath: string): void {
  assertBuilderMutationPathAllowed(relativePath);
  const absolutePath = safeBuilderPath(relativePath);
  if (!fs.existsSync(absolutePath)) {
    return;
  }
  fs.rmSync(absolutePath, { recursive: true, force: true });
}

export function moveBuilderPath(fromRelativePath: string, toRelativePath: string): void {
  assertBuilderMutationPathAllowed(fromRelativePath);
  assertBuilderMutationPathAllowed(toRelativePath);
  const fromAbsolutePath = safeBuilderPath(fromRelativePath);
  const toAbsolutePath = safeBuilderPath(toRelativePath);
  if (!fs.existsSync(fromAbsolutePath)) {
    throw new Error(`Path not found: ${fromRelativePath}`);
  }
  fs.mkdirSync(path.dirname(toAbsolutePath), { recursive: true });
  fs.renameSync(fromAbsolutePath, toAbsolutePath);
}

export function builderPathExists(relativePath: string): boolean {
  const absolutePath = safeBuilderPath(relativePath);
  return fs.existsSync(absolutePath);
}

export function statBuilderPath(relativePath: string): BuilderPathStat {
  const absolutePath = safeBuilderPath(relativePath);
  const workspaceRoot = assertBuilderWorkspaceSafe();
  if (!fs.existsSync(absolutePath)) {
    return {
      path: relativePath.replace(/\\/g, "/"),
      name: path.posix.basename(relativePath.replace(/\\/g, "/")) || ".",
      exists: false,
      type: "missing",
      size: null,
      modifiedAt: null,
    };
  }

  const stat = fs.statSync(absolutePath);
  return {
    path: toWorkspaceRelativePath(workspaceRoot, absolutePath),
    name: path.basename(absolutePath),
    exists: true,
    type: stat.isDirectory() ? "directory" : "file",
    size: stat.isDirectory() ? null : stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

export async function applyBuilderPatch(patch: string, cwd = "."): Promise<BuilderPatchResult> {
  const touchedPaths = collectPatchTargetPaths(patch);
  if (touchedPaths.length === 0) {
    throw new Error("Builder patch does not reference any target files.");
  }

  for (const targetPath of touchedPaths) {
    assertBuilderMutationPathAllowed(targetPath);
    safeBuilderPath(targetPath);
  }

  const patchCwd = safeBuilderPath(cwd);
  const patchFilePath = path.join(os.tmpdir(), `bizbot-builder-patch-${process.pid}-${Date.now()}.diff`);
  fs.writeFileSync(patchFilePath, patch, "utf-8");

  try {
    const result = await runBuilderCliCommand("git", [
      "apply",
      "--check",
      "--unsafe-paths",
      patchFilePath,
    ], {
      cwd,
      timeoutSeconds: 30,
    });
    if (!result.ok) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || "Builder patch validation failed.");
    }

    const applyResult = await runBuilderCliCommand("git", [
      "apply",
      "--unsafe-paths",
      patchFilePath,
    ], {
      cwd,
      timeoutSeconds: 30,
    });
    if (!applyResult.ok) {
      throw new Error(applyResult.stderr.trim() || applyResult.stdout.trim() || "Builder patch apply failed.");
    }

    return {
      applied: true,
      cwd: toWorkspaceRelativePath(assertBuilderWorkspaceSafe(), patchCwd),
      touchedPaths,
    };
  } finally {
    if (fs.existsSync(patchFilePath)) {
      fs.rmSync(patchFilePath, { force: true });
    }
  }
}

export function listBuilderScaffoldBlockingEntries(relativePath: string): string[] {
  const absolutePath = safeBuilderPath(relativePath);
  if (!fs.existsSync(absolutePath)) {
    return [];
  }

  return fs.readdirSync(absolutePath, { withFileTypes: true })
    .map((entry) => entry.name)
    .filter((name) => !BUILDER_MANAGED_PROJECT_ROOT_ENTRIES.has(name));
}

function appendBoundedOutput(current: string, chunk: string): string {
  if (current.length >= MAX_CAPTURED_OUTPUT_CHARS) {
    return current;
  }

  const next = `${current}${chunk}`;
  if (next.length <= MAX_CAPTURED_OUTPUT_CHARS) {
    return next;
  }

  return `${next.slice(0, MAX_CAPTURED_OUTPUT_CHARS)}\n[truncated output]`;
}

function normalizeCommandName(command: string): string {
  return path.basename(command).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/i, "");
}

function resolveBuilderExecutable(command: string): string {
  if (path.isAbsolute(command)) {
    return command;
  }

  const locator = process.platform === "win32" ? "where.exe" : "which";
  const lookup = spawnSync(locator, [command], {
    encoding: "utf-8",
    windowsHide: true,
  });
  if (lookup.status !== 0) {
    return command;
  }

  const match = (lookup.stdout ?? "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);

  return match ?? command;
}

function resolveBuilderSpawnCommand(execution: BuilderResolvedCommandExecution): {
  command: string;
  args: string[];
} {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(execution.resolvedCommand)) {
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", execution.command, ...execution.args],
    };
  }

  return {
    command: execution.resolvedCommand,
    args: execution.args,
  };
}

export function assertBuilderCommandAllowed(command: string): void {
  const allowedCommands = getBuilderAllowedCommands();
  if (allowedCommands.length === 0) {
    throw new Error("No builder commands are allowed. Configure BIZBOT_BUILDER_ALLOWED_COMMANDS.");
  }

  const normalizedCommand = normalizeCommandName(command);
  const isAllowed = allowedCommands.some((allowedCommand) => normalizeCommandName(allowedCommand) === normalizedCommand);
  if (!isAllowed) {
    throw new Error(`Builder command not allowed: ${command}`);
  }

  if (path.isAbsolute(command) && pathsOverlap(command, getBuilderRepositoryRoot())) {
    throw new Error("Builder command path references the BizBot repository.");
  }
}

function assertCommandArgsSafe(args: string[], cwd: string): void {
  const repositoryRoot = getBuilderRepositoryRoot();
  const normalizedRepositoryRoot = path.resolve(/* turbopackIgnore: true */ repositoryRoot).replace(/\\/g, "/").toLowerCase();

  for (const arg of args) {
    const trimmed = arg.trim();
    if (!trimmed) {
      continue;
    }

    const normalizedArg = trimmed.replace(/\\/g, "/").toLowerCase();
    if (normalizedArg.includes(normalizedRepositoryRoot)) {
      throw new Error("Builder command arguments reference the BizBot repository.");
    }

    if (path.isAbsolute(trimmed)) {
      if (pathsOverlap(trimmed, repositoryRoot)) {
        throw new Error("Builder command arguments reference the BizBot repository.");
      }
      continue;
    }

    if (trimmed.startsWith(".")) {
      const resolved = path.resolve(/* turbopackIgnore: true */ cwd, /* turbopackIgnore: true */ trimmed);
      if (pathsOverlap(resolved, repositoryRoot)) {
        throw new Error("Builder command arguments escape toward the BizBot repository.");
      }
    }
  }
}

export async function runBuilderCommand(
  command: string,
  args: string[] = [],
  options: BuilderCommandOptions = {},
): Promise<BuilderCommandResult> {
  assertBuilderCommandAllowed(command);
  return runBuilderCliCommand(command, args, options);
}

export function resolveBuilderCommandExecution(
  command: string,
  args: string[] = [],
  options: BuilderCommandOptions = {},
): BuilderResolvedCommandExecution {
  if (path.isAbsolute(command) && pathsOverlap(command, getBuilderRepositoryRoot())) {
    throw new Error("Builder command path references the BizBot repository.");
  }

  const workspaceRoot = assertBuilderWorkspaceSafe();
  const cwdAbsolute = safeBuilderPath(options.cwd ?? ".");
  assertCommandArgsSafe(args, cwdAbsolute);

  const timeoutSeconds = Math.min(
    MAX_COMMAND_TIMEOUT_SECONDS,
    Math.max(1, Math.trunc(options.timeoutSeconds ?? DEFAULT_COMMAND_TIMEOUT_SECONDS)),
  );
  const resolvedCommand = resolveBuilderExecutable(command);
  if (path.isAbsolute(resolvedCommand) && pathsOverlap(resolvedCommand, getBuilderRepositoryRoot())) {
    throw new Error("Builder command path references the BizBot repository.");
  }

  return {
    workspaceRoot,
    cwdAbsolute,
    cwd: toWorkspaceRelativePath(workspaceRoot, cwdAbsolute),
    command,
    resolvedCommand,
    args,
    timeoutSeconds,
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
  };
}

export async function runBuilderCliCommand(
  command: string,
  args: string[] = [],
  options: BuilderCommandOptions = {},
): Promise<BuilderCommandResult> {
  const execution = resolveBuilderCommandExecution(command, args, options);
  const spawnExecution = resolveBuilderSpawnCommand(execution);

  return new Promise<BuilderCommandResult>((resolve, reject) => {
    const child = spawn(
      spawnExecution.command,
      spawnExecution.args,
      {
      cwd: execution.cwdAbsolute,
      env: execution.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;
    let resolved = false;

    const finalize = (result: BuilderCommandResult): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve(result);
    };

    const abortListener = (): void => {
      cancelled = true;
      child.kill("SIGTERM");
    };

    if (options.signal) {
      if (options.signal.aborted) {
        cancelled = true;
        child.kill("SIGTERM");
      } else {
        options.signal.addEventListener("abort", abortListener, { once: true });
      }
    }

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, execution.timeoutSeconds * 1000);

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout = appendBoundedOutput(stdout, text);
      void options.onStdoutChunk?.(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr = appendBoundedOutput(stderr, text);
      void options.onStderrChunk?.(text);
    });

    child.once("error", (error) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortListener);
      reject(error);
    });

    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortListener);
      finalize({
        ok: exitCode === 0 && !timedOut && !cancelled,
        command,
        args: execution.args,
        cwd: execution.cwd,
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        cancelled,
      });
    });
  });
}

export function scaffoldBuilderNodePackage(args: {
  projectDir: string;
  packageName: string;
  description?: string;
  entrypoint?: string;
}): { root: string; files: string[] } {
  const projectRoot = safeBuilderPath(args.projectDir);
  const entrypoint = (args.entrypoint ?? "src/index.ts").replace(/\\/g, "/");
  const usesSrcRoot = entrypoint.startsWith("src/");
  const emittedEntrypoint = (usesSrcRoot ? entrypoint.slice(4) : entrypoint).replace(/\.ts$/, ".js");
  const blockingEntries = listBuilderScaffoldBlockingEntries(args.projectDir);

  if (blockingEntries.length > 0) {
    throw new Error(`Builder scaffold target is not empty: ${args.projectDir}`);
  }

  fs.mkdirSync(projectRoot, { recursive: true });

  const files: Array<{ path: string; content: string }> = [
    {
      path: "package.json",
      content: `${JSON.stringify({
        name: args.packageName,
        version: "0.1.0",
        private: true,
        type: "module",
        scripts: {
          build: "tsc -p tsconfig.json",
          typecheck: "tsc --noEmit -p tsconfig.json",
          dev: `tsx ${entrypoint}`,
          start: `node dist/${emittedEntrypoint}`,
        },
        devDependencies: {
          "@types/node": "^24.0.0",
          tsx: "^4.21.0",
          typescript: "^5.9.0",
        },
      }, null, 2)}\n`,
    },
    {
      path: "tsconfig.json",
      content: `${JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          outDir: "dist",
          rootDir: usesSrcRoot ? "src" : ".",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
        include: usesSrcRoot ? ["src/**/*"] : [entrypoint],
      }, null, 2)}\n`,
    },
    {
      path: ".gitignore",
      content: "node_modules\ndist\n.env\n",
    },
    {
      path: "README.md",
      content: `# ${args.packageName}\n\n${args.description ?? "Scaffolded by BizBot Builder Mode."}\n`,
    },
    {
      path: entrypoint,
      content: `export function main(): void {\n  console.log("${args.packageName} ready");\n}\n\nmain();\n`,
    },
  ];

  for (const file of files) {
    const absolutePath = path.join(/* turbopackIgnore: true */ projectRoot, /* turbopackIgnore: true */ file.path);
    fs.mkdirSync(path.dirname(/* turbopackIgnore: true */ absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, file.content, "utf-8");
  }

  const workspaceRoot = assertBuilderWorkspaceSafe();
  return {
    root: toWorkspaceRelativePath(workspaceRoot, projectRoot),
    files: files.map((file) => path.posix.join(toWorkspaceRelativePath(workspaceRoot, projectRoot), file.path.replace(/\\/g, "/"))),
  };
}