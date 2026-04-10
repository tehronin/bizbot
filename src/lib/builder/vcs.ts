import { spawnSync } from "child_process";
import path from "path";
import { appendBuilderCapabilityAuditEvent, type BuilderCapabilityAuditContext } from "@/lib/builder/audit";
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

function appendVcsAuditEvent(args: BuilderCapabilityAuditContext & {
  projectRelativePath: string;
  outcomeStatus: "succeeded" | "failed" | "blocked";
  targets: Array<{ kind: "repository" | "file"; identifier: string; metadata?: Record<string, unknown> }>;
  metadata?: Record<string, unknown>;
}): string {
  return appendBuilderCapabilityAuditEvent({
    capabilityKey: "version_control",
    projectRelativePath: args.projectRelativePath,
    projectId: args.projectId,
    taskId: args.taskId,
    runId: args.runId,
    outcomeStatus: args.outcomeStatus,
    targets: args.targets,
    metadata: args.metadata,
  }).auditPath;
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

export function getBuilderRepoStatus(subdir = ".", auditContext?: BuilderCapabilityAuditContext): BuilderRepoStatus & { auditPath: string } {
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

  const auditPath = appendVcsAuditEvent({
    ...auditContext,
    projectRelativePath: repo.relative,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: repo.relative }],
    metadata: {
      operation: "repo_status",
      currentBranch: branch.stdout.trim() || null,
      stagedCount: staged.length,
      unstagedCount: unstaged.length,
      untrackedCount: untracked.length,
    },
  });

  return {
    repoRoot: branch.repoRoot,
    currentBranch: branch.stdout.trim() || null,
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
    auditPath,
  };
}

export function getBuilderRepoDiff(args: { subdir?: string; staged?: boolean; paths?: string[]; audit?: BuilderCapabilityAuditContext } = {}): BuilderRepoDiff & { auditPath: string } {
  const gitArgs = ["diff"];
  if (args.staged) {
    gitArgs.push("--cached");
  }
  if (args.paths && args.paths.length > 0) {
    gitArgs.push("--", ...args.paths);
  }
  const result = runGit(gitArgs, args.subdir ?? ".");
  const auditPath = appendVcsAuditEvent({
    ...(args.audit ?? {}),
    projectRelativePath: result.repoRoot,
    outcomeStatus: "succeeded",
    targets: [
      { kind: "repository", identifier: result.repoRoot },
      ...((args.paths ?? []).map((entry) => ({ kind: "file" as const, identifier: entry.replace(/\\/g, "/") }))),
    ],
    metadata: { operation: "diff", scope: args.staged ? "staged" : "unstaged" },
  });
  return {
    repoRoot: result.repoRoot,
    scope: args.staged ? "staged" : "unstaged",
    patch: result.stdout,
    auditPath,
  };
}

export function stageBuilderRepoPaths(paths: string[], subdir = ".", auditContext?: BuilderCapabilityAuditContext): BuilderRepoStatus & { auditPath: string } {
  if (paths.length === 0) {
    throw new Error("Builder VCS stage requires at least one path.");
  }
  runGit(["add", "--", ...paths], subdir);
  const status = getBuilderRepoStatus(subdir, auditContext);
  appendVcsAuditEvent({
    ...auditContext,
    projectRelativePath: status.repoRoot,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: status.repoRoot }, ...paths.map((entry) => ({ kind: "file" as const, identifier: entry.replace(/\\/g, "/") }))],
    metadata: { operation: "stage_paths", pathCount: paths.length },
  });
  return status;
}

export function unstageBuilderRepoPaths(paths: string[], subdir = ".", auditContext?: BuilderCapabilityAuditContext): BuilderRepoStatus & { auditPath: string } {
  if (paths.length === 0) {
    throw new Error("Builder VCS unstage requires at least one path.");
  }
  runGit(["reset", "HEAD", "--", ...paths], subdir);
  const status = getBuilderRepoStatus(subdir, auditContext);
  appendVcsAuditEvent({
    ...auditContext,
    projectRelativePath: status.repoRoot,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: status.repoRoot }, ...paths.map((entry) => ({ kind: "file" as const, identifier: entry.replace(/\\/g, "/") }))],
    metadata: { operation: "unstage_paths", pathCount: paths.length },
  });
  return status;
}

export function commitBuilderRepo(args: { message: string; subdir?: string; allowEmpty?: boolean; audit?: BuilderCapabilityAuditContext }): BuilderCommitResult & { auditPath: string } {
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
  const auditPath = appendVcsAuditEvent({
    ...(args.audit ?? {}),
    projectRelativePath: commitResult.repoRoot,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: commitResult.repoRoot }],
    metadata: { operation: "commit", allowEmpty: Boolean(args.allowEmpty), commitSha: shaResult.stdout.trim() },
  });
  return {
    repoRoot: commitResult.repoRoot,
    commitSha: shaResult.stdout.trim(),
    summary: commitResult.stdout.trim(),
    auditPath,
  };
}

export function createBuilderRepoBranch(args: { name: string; subdir?: string; checkout?: boolean; audit?: BuilderCapabilityAuditContext }): BuilderRepoStatus & { auditPath: string } {
  const branchName = args.name.trim();
  if (!branchName) {
    throw new Error("Builder VCS branch name is required.");
  }
  runGit(args.checkout ? ["checkout", "-b", branchName] : ["branch", branchName], args.subdir ?? ".");
  const status = getBuilderRepoStatus(args.subdir ?? ".", args.audit);
  appendVcsAuditEvent({
    ...(args.audit ?? {}),
    projectRelativePath: status.repoRoot,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: status.repoRoot }],
    metadata: { operation: "create_branch", branchName, checkout: Boolean(args.checkout) },
  });
  return status;
}

export function switchBuilderRepoBranch(args: { name: string; subdir?: string; audit?: BuilderCapabilityAuditContext }): BuilderRepoStatus & { auditPath: string } {
  const branchName = args.name.trim();
  if (!branchName) {
    throw new Error("Builder VCS branch name is required.");
  }
  runGit(["checkout", branchName], args.subdir ?? ".");
  const status = getBuilderRepoStatus(args.subdir ?? ".", args.audit);
  appendVcsAuditEvent({
    ...(args.audit ?? {}),
    projectRelativePath: status.repoRoot,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: status.repoRoot }],
    metadata: { operation: "switch_branch", branchName },
  });
  return status;
}