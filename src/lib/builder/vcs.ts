import { spawnSync } from "child_process";
import path from "path";
import { getBuilderRepositoryRoot, isPathInside, resolveBuilderWorkspacePath } from "@/lib/builder/config";

export interface BuilderRepoStatusEntry {
  path: string;
  indexStatus: string;
  workingTreeStatus: string;
}

export interface BuilderRepoStatus {
  repoRoot: string;
  currentBranch: string | null;
  ahead: number;
  behind: number;
  staged: BuilderRepoStatusEntry[];
  unstaged: BuilderRepoStatusEntry[];
  untracked: string[];
}

export interface BuilderRepoDiff {
  repoRoot: string;
  scope: "staged" | "unstaged";
  patch: string;
}

export interface BuilderCommitResult {
  repoRoot: string;
  commitSha: string;
  summary: string;
}

interface GitResult {
  stdout: string;
  stderr: string;
  status: number;
}

function safeRepoRoot(subdir = "."): { absolute: string; relative: string } {
  const workspacePath = resolveBuilderWorkspacePath(subdir);
  const result = runGitRaw(["rev-parse", "--show-toplevel"], workspacePath);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Builder VCS target is not inside a git repository.");
  }
  const repoRoot = path.resolve(result.stdout.trim());
  const builderWorkspaceRoot = resolveBuilderWorkspacePath(".");
  if (!isPathInside(builderWorkspaceRoot, repoRoot)) {
    throw new Error("Builder VCS repository escapes the builder workspace.");
  }
  if (isPathInside(getBuilderRepositoryRoot(), repoRoot) || isPathInside(repoRoot, getBuilderRepositoryRoot())) {
    throw new Error("Builder VCS repository overlaps the BizBot repository.");
  }
  return {
    absolute: repoRoot,
    relative: path.relative(builderWorkspaceRoot, repoRoot).replace(/\\/g, "/") || ".",
  };
}

function runGitRaw(args: string[], cwd: string): GitResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    windowsHide: true,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1,
  };
}

function runGit(args: string[], subdir = "."): { repoRoot: string; stdout: string } {
  const repo = safeRepoRoot(subdir);
  const result = runGitRaw(args, repo.absolute);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `Git command failed: ${args.join(" ")}`);
  }
  return {
    repoRoot: repo.relative,
    stdout: result.stdout,
  };
}

function parseAheadBehind(stdout: string): { ahead: number; behind: number } {
  const [aheadRaw, behindRaw] = stdout.trim().split("\t");
  return {
    ahead: Number.parseInt(aheadRaw ?? "0", 10) || 0,
    behind: Number.parseInt(behindRaw ?? "0", 10) || 0,
  };
}

export function getBuilderRepoStatus(subdir = "."): BuilderRepoStatus {
  const branch = runGit(["branch", "--show-current"], subdir);
  const statusResult = runGit(["status", "--porcelain"], subdir);
  const repo = safeRepoRoot(subdir);
  const aheadBehindResult = runGitRaw(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], repo.absolute);
  const { ahead, behind } = aheadBehindResult.status === 0
    ? parseAheadBehind(aheadBehindResult.stdout)
    : { ahead: 0, behind: 0 };

  const staged: BuilderRepoStatusEntry[] = [];
  const unstaged: BuilderRepoStatusEntry[] = [];
  const untracked: string[] = [];

  for (const line of statusResult.stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const indexStatus = line.slice(0, 1);
    const workingTreeStatus = line.slice(1, 2);
    const filePath = line.slice(3).trim().replace(/\\/g, "/");
    if (indexStatus === "?" && workingTreeStatus === "?") {
      untracked.push(filePath);
      continue;
    }
    const entry = { path: filePath, indexStatus, workingTreeStatus };
    if (indexStatus !== " ") {
      staged.push(entry);
    }
    if (workingTreeStatus !== " ") {
      unstaged.push(entry);
    }
  }

  return {
    repoRoot: branch.repoRoot,
    currentBranch: branch.stdout.trim() || null,
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
  };
}

export function getBuilderRepoDiff(args: { subdir?: string; staged?: boolean; paths?: string[] } = {}): BuilderRepoDiff {
  const gitArgs = ["diff"];
  if (args.staged) {
    gitArgs.push("--cached");
  }
  if (args.paths && args.paths.length > 0) {
    gitArgs.push("--", ...args.paths);
  }
  const result = runGit(gitArgs, args.subdir ?? ".");
  return {
    repoRoot: result.repoRoot,
    scope: args.staged ? "staged" : "unstaged",
    patch: result.stdout,
  };
}

export function stageBuilderRepoPaths(paths: string[], subdir = "."): BuilderRepoStatus {
  if (paths.length === 0) {
    throw new Error("Builder VCS stage requires at least one path.");
  }
  runGit(["add", "--", ...paths], subdir);
  return getBuilderRepoStatus(subdir);
}

export function unstageBuilderRepoPaths(paths: string[], subdir = "."): BuilderRepoStatus {
  if (paths.length === 0) {
    throw new Error("Builder VCS unstage requires at least one path.");
  }
  runGit(["reset", "HEAD", "--", ...paths], subdir);
  return getBuilderRepoStatus(subdir);
}

export function commitBuilderRepo(args: { message: string; subdir?: string; allowEmpty?: boolean }): BuilderCommitResult {
  const message = args.message.trim();
  if (!message) {
    throw new Error("Builder VCS commit requires a non-empty message.");
  }
  if (!args.allowEmpty) {
    const stagedCheck = runGit(["diff", "--cached", "--name-only"], args.subdir ?? ".");
    if (!stagedCheck.stdout.trim()) {
      throw new Error("Builder VCS commit rejects empty commits by default. Stage changes first or set allowEmpty.");
    }
  }
  const gitArgs = ["commit", "-m", message];
  if (args.allowEmpty) {
    gitArgs.push("--allow-empty");
  }
  const commitResult = runGit(gitArgs, args.subdir ?? ".");
  const shaResult = runGit(["rev-parse", "HEAD"], args.subdir ?? ".");
  return {
    repoRoot: commitResult.repoRoot,
    commitSha: shaResult.stdout.trim(),
    summary: commitResult.stdout.trim(),
  };
}

export function createBuilderRepoBranch(args: { name: string; subdir?: string; checkout?: boolean }): BuilderRepoStatus {
  const branchName = args.name.trim();
  if (!branchName) {
    throw new Error("Builder VCS branch name is required.");
  }
  runGit(args.checkout ? ["checkout", "-b", branchName] : ["branch", branchName], args.subdir ?? ".");
  return getBuilderRepoStatus(args.subdir ?? ".");
}

export function switchBuilderRepoBranch(args: { name: string; subdir?: string }): BuilderRepoStatus {
  const branchName = args.name.trim();
  if (!branchName) {
    throw new Error("Builder VCS branch name is required.");
  }
  runGit(["checkout", branchName], args.subdir ?? ".");
  return getBuilderRepoStatus(args.subdir ?? ".");
}