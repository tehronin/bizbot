import fs from "fs";
import path from "path";
import { spawn } from "child_process";
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
  onStdoutChunk?: (chunk: string) => void | Promise<void>;
  onStderrChunk?: (chunk: string) => void | Promise<void>;
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
  const absolutePath = safeBuilderPath(relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf-8");
}

export function createBuilderDirectory(relativePath: string): void {
  const absolutePath = safeBuilderPath(relativePath);
  fs.mkdirSync(absolutePath, { recursive: true });
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

function assertCommandAllowed(command: string): void {
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
  assertCommandAllowed(command);
  return runBuilderCliCommand(command, args, options);
}

export async function runBuilderCliCommand(
  command: string,
  args: string[] = [],
  options: BuilderCommandOptions = {},
): Promise<BuilderCommandResult> {
  if (path.isAbsolute(command) && pathsOverlap(command, getBuilderRepositoryRoot())) {
    throw new Error("Builder command path references the BizBot repository.");
  }

  const workspaceRoot = assertBuilderWorkspaceSafe();
  const cwd = safeBuilderPath(options.cwd ?? ".");
  assertCommandArgsSafe(args, cwd);

  const timeoutSeconds = Math.min(
    MAX_COMMAND_TIMEOUT_SECONDS,
    Math.max(1, Math.trunc(options.timeoutSeconds ?? DEFAULT_COMMAND_TIMEOUT_SECONDS)),
  );

  return new Promise<BuilderCommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

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
    }, timeoutSeconds * 1000);

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
        args,
        cwd: toWorkspaceRelativePath(workspaceRoot, cwd),
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
  const entrypoint = args.entrypoint ?? "src/index.ts";

  if (fs.existsSync(projectRoot) && fs.readdirSync(projectRoot).length > 0) {
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
          dev: `tsx ${entrypoint}`,
          start: `node ${entrypoint.replace(/\.ts$/, ".js")}`,
        },
        devDependencies: {
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
          rootDir: ".",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
        include: [entrypoint],
      }, null, 2)}\n`,
    },
    {
      path: ".gitignore",
      content: "node_modules\ndist\n",
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