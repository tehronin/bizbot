import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { appendBuilderCapabilityAuditEvent, type BuilderCapabilityAuditContext } from "@/lib/builder/audit";
import {
  getBuilderAllowedRemotes,
  getBuilderRepositoryRoot,
  isPathInside,
  normalizeBuilderRemoteUrl,
  resolveBuilderWorkspacePath,
} from "@/lib/builder/config";

export interface BuilderRepoStatusEntry {
  path: string;
  indexStatus: string;
  workingTreeStatus: string;
}

export interface BuilderRepoStatus {
  repoRoot: string;
  currentBranch: string | null;
  upstreamBranch: string | null;
  headCommitSha: string | null;
  ahead: number;
  behind: number;
  dirty: boolean;
  conflictedFiles: string[];
  staged: BuilderRepoStatusEntry[];
  stagedCount: number;
  unstaged: BuilderRepoStatusEntry[];
  unstagedCount: number;
  untracked: string[];
  untrackedCount: number;
  stashCount: number;
  tagCount: number;
  remoteCount: number;
  remoteNames: string[];
  pendingPush: boolean;
  pendingPushContext: string | null;
}

export interface BuilderRepoDiff {
  repoRoot: string;
  scope: "staged" | "unstaged";
  patch: string;
}

export interface BuilderRepoLogEntry {
  commitSha: string;
  shortSha: string;
  authorName: string;
  authorEmail: string;
  committedAt: string;
  refs: string[];
  subject: string;
}

export interface BuilderRepoLogResult {
  repoRoot: string;
  entries: BuilderRepoLogEntry[];
}

export interface BuilderRepoShowResult {
  repoRoot: string;
  revision: string;
  output: string;
}

export interface BuilderRepoBranch {
  name: string;
  current: boolean;
  remote: boolean;
  upstream: string | null;
  headCommitSha: string | null;
}

export interface BuilderRepoTag {
  name: string;
  commitSha: string | null;
}

export interface BuilderRepoRemote {
  name: string;
  fetchUrl: string | null;
  pushUrl: string | null;
}

export interface BuilderRepoRevParseResult {
  repoRoot: string;
  revision: string;
  value: string;
}

export interface BuilderCommitResult {
  repoRoot: string;
  commitSha: string;
  summary: string;
}

export interface BuilderCloneResult {
  repoRoot: string;
  currentBranch: string | null;
  headCommitSha: string | null;
}

interface GitResult {
  stdout: string;
  stderr: string;
  status: number;
}

interface SafeRepoRoot {
  absolute: string;
  relative: string;
}

type VcsAuditTarget = {
  kind: "repository" | "file" | "host";
  identifier: string;
  metadata?: Record<string, unknown>;
};

function appendVcsAuditEvent(args: BuilderCapabilityAuditContext & {
  capabilityKey?: "version_control" | "version_control_remote";
  projectRelativePath: string;
  outcomeStatus: "succeeded" | "failed" | "blocked";
  targets: VcsAuditTarget[];
  metadata?: Record<string, unknown>;
}): string {
  return appendBuilderCapabilityAuditEvent({
    capabilityKey: args.capabilityKey ?? "version_control",
    projectRelativePath: args.projectRelativePath,
    projectId: args.projectId,
    taskId: args.taskId,
    runId: args.runId,
    outcomeStatus: args.outcomeStatus,
    targets: args.targets,
    metadata: args.metadata,
  }).auditPath;
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

function safeRepoRoot(subdir = "."): SafeRepoRoot {
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

function runGitInRepo(args: string[], repo: SafeRepoRoot): { repoRoot: string; stdout: string } {
  const result = runGitRaw(args, repo.absolute);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `Git command failed: ${args.join(" ")}`);
  }
  return {
    repoRoot: repo.relative,
    stdout: result.stdout,
  };
}

function runGit(args: string[], subdir = "."): { repoRoot: string; stdout: string } {
  return runGitInRepo(args, safeRepoRoot(subdir));
}

function readOptionalGitValue(args: string[], repo: SafeRepoRoot): string | null {
  const result = runGitRaw(args, repo.absolute);
  if (result.status !== 0) {
    return null;
  }
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

function parseAheadBehind(stdout: string): { ahead: number; behind: number } {
  const [aheadRaw, behindRaw] = stdout.trim().split("\t");
  return {
    ahead: Number.parseInt(aheadRaw ?? "0", 10) || 0,
    behind: Number.parseInt(behindRaw ?? "0", 10) || 0,
  };
}

function parseCount(stdout: string): number {
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
}

function isConflictedStatus(indexStatus: string, workingTreeStatus: string): boolean {
  return ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(`${indexStatus}${workingTreeStatus}`);
}

function normalizeRefs(raw: string): string[] {
  return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function buildPendingPushContext(args: {
  ahead: number;
  currentBranch: string | null;
  upstreamBranch: string | null;
}): string | null {
  if (args.ahead <= 0 || !args.upstreamBranch) {
    return null;
  }
  return `${args.currentBranch ?? "HEAD"} is ${args.ahead} commit${args.ahead === 1 ? "" : "s"} ahead of ${args.upstreamBranch}`;
}

function assertRemoteAllowed(args: {
  repo: SafeRepoRoot;
  remoteUrl: string;
  operation: string;
  auditContext?: BuilderCapabilityAuditContext;
}): string {
  const normalizedRemote = normalizeBuilderRemoteUrl(args.remoteUrl);
  const allowedRemotes = getBuilderAllowedRemotes();
  if (allowedRemotes.length === 0 || !allowedRemotes.includes(normalizedRemote)) {
    const auditPath = appendVcsAuditEvent({
      ...(args.auditContext ?? {}),
      capabilityKey: "version_control_remote",
      projectRelativePath: args.repo.relative,
      outcomeStatus: "blocked",
      targets: [
        { kind: "repository", identifier: args.repo.relative },
        { kind: "host", identifier: normalizedRemote },
      ],
      metadata: {
        operation: args.operation,
        reason: "remote_not_allowlisted",
        remoteUrl: normalizedRemote,
      },
    });
    throw new Error(`Builder VCS remote is not allowlisted: ${normalizedRemote}. Audit: ${auditPath}`);
  }
  return normalizedRemote;
}

function assertNamedRemoteAllowed(args: {
  repo: SafeRepoRoot;
  remoteName: string;
  operation: string;
  auditContext?: BuilderCapabilityAuditContext;
}): string[] {
  const result = runGitInRepo(["remote", "get-url", "--all", args.remoteName], args.repo);
  const urls = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (urls.length === 0) {
    throw new Error(`Builder VCS remote not found: ${args.remoteName}`);
  }
  return urls.map((remoteUrl) => assertRemoteAllowed({
    repo: args.repo,
    remoteUrl,
    operation: args.operation,
    auditContext: args.auditContext,
  }));
}

function safeCloneTarget(targetPath: string): SafeRepoRoot {
  const absolute = resolveBuilderWorkspacePath(targetPath);
  const workspaceRoot = resolveBuilderWorkspacePath(".");
  if (isPathInside(getBuilderRepositoryRoot(), absolute) || isPathInside(absolute, getBuilderRepositoryRoot())) {
    throw new Error("Builder VCS repository overlaps the BizBot repository.");
  }
  if (fs.existsSync(absolute) && fs.readdirSync(absolute).length > 0) {
    throw new Error("Builder VCS clone target already exists and is not empty.");
  }
  return {
    absolute,
    relative: path.relative(workspaceRoot, absolute).replace(/\\/g, "/") || ".",
  };
}

export function getBuilderRepoStatus(subdir = ".", auditContext?: BuilderCapabilityAuditContext): BuilderRepoStatus & { auditPath: string } {
  const repo = safeRepoRoot(subdir);
  const branch = runGitInRepo(["branch", "--show-current"], repo);
  const statusResult = runGitInRepo(["status", "--porcelain"], repo);
  const aheadBehindResult = runGitRaw(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], repo.absolute);
  const { ahead, behind } = aheadBehindResult.status === 0
    ? parseAheadBehind(aheadBehindResult.stdout)
    : { ahead: 0, behind: 0 };
  const upstreamBranch = readOptionalGitValue(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], repo);
  const headCommitSha = readOptionalGitValue(["rev-parse", "HEAD"], repo);
  const stashCount = parseCount(runGitRaw(["stash", "list"], repo.absolute).stdout);
  const tagCount = parseCount(runGitInRepo(["tag", "--list"], repo).stdout);
  const remoteNames = runGitInRepo(["remote"], repo).stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  const staged: BuilderRepoStatusEntry[] = [];
  const unstaged: BuilderRepoStatusEntry[] = [];
  const untracked: string[] = [];
  const conflictedFiles: string[] = [];

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
    if (isConflictedStatus(indexStatus, workingTreeStatus)) {
      conflictedFiles.push(filePath);
    }
    const entry = { path: filePath, indexStatus, workingTreeStatus };
    if (indexStatus !== " ") {
      staged.push(entry);
    }
    if (workingTreeStatus !== " ") {
      unstaged.push(entry);
    }
  }

  const dirty = staged.length > 0 || unstaged.length > 0 || untracked.length > 0 || conflictedFiles.length > 0;
  const pendingPush = ahead > 0 && Boolean(upstreamBranch);
  const auditPath = appendVcsAuditEvent({
    ...(auditContext ?? {}),
    projectRelativePath: repo.relative,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: repo.relative }],
    metadata: {
      operation: "repo_status",
      currentBranch: branch.stdout.trim() || null,
      headCommitSha,
      dirty,
      conflictedCount: conflictedFiles.length,
      stagedCount: staged.length,
      unstagedCount: unstaged.length,
      untrackedCount: untracked.length,
      stashCount,
      tagCount,
      remoteCount: remoteNames.length,
      pendingPush,
    },
  });

  return {
    repoRoot: repo.relative,
    currentBranch: branch.stdout.trim() || null,
    upstreamBranch,
    headCommitSha,
    ahead,
    behind,
    dirty,
    conflictedFiles,
    staged,
    stagedCount: staged.length,
    unstaged,
    unstagedCount: unstaged.length,
    untracked,
    untrackedCount: untracked.length,
    stashCount,
    tagCount,
    remoteCount: remoteNames.length,
    remoteNames,
    pendingPush,
    pendingPushContext: buildPendingPushContext({
      ahead,
      currentBranch: branch.stdout.trim() || null,
      upstreamBranch,
    }),
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

export function getBuilderRepoLog(args: {
  subdir?: string;
  limit?: number;
  ref?: string;
  paths?: string[];
  audit?: BuilderCapabilityAuditContext;
} = {}): BuilderRepoLogResult & { auditPath: string } {
  const limit = Math.max(1, Math.trunc(args.limit ?? 20));
  const gitArgs = [
    "log",
    `--max-count=${limit}`,
    "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%cI%x1f%D%x1f%s",
  ];
  if (args.ref?.trim()) {
    gitArgs.push(args.ref.trim());
  }
  if (args.paths && args.paths.length > 0) {
    gitArgs.push("--", ...args.paths);
  }
  const result = runGit(gitArgs, args.subdir ?? ".");
  const entries = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [commitSha, shortSha, authorName, authorEmail, committedAt, refsRaw, subject] = line.split("\u001f");
    return {
      commitSha,
      shortSha,
      authorName,
      authorEmail,
      committedAt,
      refs: normalizeRefs(refsRaw ?? ""),
      subject: subject ?? "",
    } satisfies BuilderRepoLogEntry;
  });
  const auditPath = appendVcsAuditEvent({
    ...(args.audit ?? {}),
    projectRelativePath: result.repoRoot,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: result.repoRoot }],
    metadata: { operation: "repo_log", limit, ref: args.ref ?? null },
  });
  return {
    repoRoot: result.repoRoot,
    entries,
    auditPath,
  };
}

export function showBuilderRepoObject(args: {
  revision: string;
  subdir?: string;
  stat?: boolean;
  audit?: BuilderCapabilityAuditContext;
}): BuilderRepoShowResult & { auditPath: string } {
  const revision = args.revision.trim();
  if (!revision) {
    throw new Error("Builder VCS show requires a revision.");
  }
  const gitArgs = ["show"];
  if (args.stat) {
    gitArgs.push("--stat");
  }
  gitArgs.push(revision);
  const result = runGit(gitArgs, args.subdir ?? ".");
  const auditPath = appendVcsAuditEvent({
    ...(args.audit ?? {}),
    projectRelativePath: result.repoRoot,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: result.repoRoot }],
    metadata: { operation: "repo_show", revision, stat: Boolean(args.stat) },
  });
  return {
    repoRoot: result.repoRoot,
    revision,
    output: result.stdout,
    auditPath,
  };
}

export function listBuilderRepoBranches(args: {
  subdir?: string;
  includeRemote?: boolean;
  audit?: BuilderCapabilityAuditContext;
} = {}): { repoRoot: string; branches: BuilderRepoBranch[]; auditPath: string } {
  const refs = args.includeRemote ? ["refs/heads", "refs/remotes"] : ["refs/heads"];
  const result = runGit([
    "for-each-ref",
    "--format=%(refname)\t%(refname:short)\t%(if)%(HEAD)%(then)true%(else)false%(end)\t%(upstream:short)\t%(objectname)",
    ...refs,
  ], args.subdir ?? ".");
  const branches = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [fullRef, name, currentRaw, upstream, headCommitSha] = line.split("\t");
    return {
      name,
      current: currentRaw === "true",
      remote: fullRef.startsWith("refs/remotes/"),
      upstream: upstream || null,
      headCommitSha: headCommitSha || null,
    } satisfies BuilderRepoBranch;
  });
  const auditPath = appendVcsAuditEvent({
    ...(args.audit ?? {}),
    projectRelativePath: result.repoRoot,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: result.repoRoot }],
    metadata: { operation: "list_branches", includeRemote: Boolean(args.includeRemote), count: branches.length },
  });
  return { repoRoot: result.repoRoot, branches, auditPath };
}

export function listBuilderRepoTags(args: { subdir?: string; audit?: BuilderCapabilityAuditContext } = {}): { repoRoot: string; tags: BuilderRepoTag[]; auditPath: string } {
  const result = runGit(["tag", "--list", "--format=%(refname:short)\t%(objectname)"], args.subdir ?? ".");
  const tags = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name, commitSha] = line.split("\t");
    return { name, commitSha: commitSha || null } satisfies BuilderRepoTag;
  });
  const auditPath = appendVcsAuditEvent({
    ...(args.audit ?? {}),
    projectRelativePath: result.repoRoot,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: result.repoRoot }],
    metadata: { operation: "list_tags", count: tags.length },
  });
  return { repoRoot: result.repoRoot, tags, auditPath };
}

export function listBuilderRepoRemotes(args: { subdir?: string; audit?: BuilderCapabilityAuditContext } = {}): { repoRoot: string; remotes: BuilderRepoRemote[]; auditPath: string } {
  const repo = safeRepoRoot(args.subdir ?? ".");
  const result = runGitInRepo(["remote"], repo);
  const remotes = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((name) => ({
    name,
    fetchUrl: readOptionalGitValue(["remote", "get-url", name], repo),
    pushUrl: readOptionalGitValue(["remote", "get-url", "--push", name], repo),
  } satisfies BuilderRepoRemote));
  const auditPath = appendVcsAuditEvent({
    ...(args.audit ?? {}),
    projectRelativePath: result.repoRoot,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: result.repoRoot }],
    metadata: { operation: "list_remotes", count: remotes.length, remoteNames: remotes.map((entry) => entry.name) },
  });
  return { repoRoot: result.repoRoot, remotes, auditPath };
}

export function revParseBuilderRepo(args: { revision?: string; subdir?: string; audit?: BuilderCapabilityAuditContext } = {}): BuilderRepoRevParseResult & { auditPath: string } {
  const revision = args.revision?.trim() || "HEAD";
  const result = runGit(["rev-parse", revision], args.subdir ?? ".");
  const auditPath = appendVcsAuditEvent({
    ...(args.audit ?? {}),
    projectRelativePath: result.repoRoot,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: result.repoRoot }],
    metadata: { operation: "rev_parse", revision },
  });
  return {
    repoRoot: result.repoRoot,
    revision,
    value: result.stdout.trim(),
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
    ...(auditContext ?? {}),
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
    ...(auditContext ?? {}),
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

export function manageBuilderRepoBranch(args: {
  action: "create" | "delete";
  name: string;
  subdir?: string;
  checkout?: boolean;
  force?: boolean;
  audit?: BuilderCapabilityAuditContext;
}): BuilderRepoStatus & { auditPath: string } {
  const branchName = args.name.trim();
  if (!branchName) {
    throw new Error("Builder VCS branch name is required.");
  }
  if (args.action === "create") {
    runGit(args.checkout ? ["checkout", "-b", branchName] : ["branch", branchName], args.subdir ?? ".");
  } else {
    runGit(["branch", args.force ? "-D" : "-d", branchName], args.subdir ?? ".");
  }
  const status = getBuilderRepoStatus(args.subdir ?? ".", args.audit);
  appendVcsAuditEvent({
    ...(args.audit ?? {}),
    projectRelativePath: status.repoRoot,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: status.repoRoot }],
    metadata: {
      operation: "branch",
      action: args.action,
      branchName,
      checkout: Boolean(args.checkout),
      force: Boolean(args.force),
    },
  });
  return status;
}

export function createBuilderRepoBranch(args: { name: string; subdir?: string; checkout?: boolean; audit?: BuilderCapabilityAuditContext }): BuilderRepoStatus & { auditPath: string } {
  return manageBuilderRepoBranch({ ...args, action: "create" });
}

export function switchBuilderRepoBranch(args: { name: string; subdir?: string; create?: boolean; audit?: BuilderCapabilityAuditContext }): BuilderRepoStatus & { auditPath: string } {
  const branchName = args.name.trim();
  if (!branchName) {
    throw new Error("Builder VCS branch name is required.");
  }
  runGit(args.create ? ["checkout", "-b", branchName] : ["checkout", branchName], args.subdir ?? ".");
  const status = getBuilderRepoStatus(args.subdir ?? ".", args.audit);
  appendVcsAuditEvent({
    ...(args.audit ?? {}),
    projectRelativePath: status.repoRoot,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: status.repoRoot }],
    metadata: { operation: "checkout", branchName, create: Boolean(args.create) },
  });
  return status;
}

export function mergeBuilderRepoBranch(args: {
  name: string;
  subdir?: string;
  ffOnly?: boolean;
  noCommit?: boolean;
  audit?: BuilderCapabilityAuditContext;
}): BuilderRepoStatus & { auditPath: string } {
  const branchName = args.name.trim();
  if (!branchName) {
    throw new Error("Builder VCS merge target is required.");
  }
  const gitArgs = ["merge"];
  if (args.ffOnly) {
    gitArgs.push("--ff-only");
  }
  if (args.noCommit) {
    gitArgs.push("--no-commit");
  }
  gitArgs.push(branchName);
  runGit(gitArgs, args.subdir ?? ".");
  const status = getBuilderRepoStatus(args.subdir ?? ".", args.audit);
  appendVcsAuditEvent({
    ...(args.audit ?? {}),
    projectRelativePath: status.repoRoot,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: status.repoRoot }],
    metadata: { operation: "merge", branchName, ffOnly: Boolean(args.ffOnly), noCommit: Boolean(args.noCommit) },
  });
  return status;
}

export function rebaseBuilderRepo(args: {
  upstream: string;
  subdir?: string;
  audit?: BuilderCapabilityAuditContext;
}): BuilderRepoStatus & { auditPath: string } {
  const upstream = args.upstream.trim();
  if (!upstream) {
    throw new Error("Builder VCS rebase requires an upstream reference.");
  }
  runGit(["rebase", upstream], args.subdir ?? ".");
  const status = getBuilderRepoStatus(args.subdir ?? ".", args.audit);
  appendVcsAuditEvent({
    ...(args.audit ?? {}),
    projectRelativePath: status.repoRoot,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: status.repoRoot }],
    metadata: { operation: "rebase", upstream },
  });
  return status;
}

export function cleanBuilderRepo(args: {
  subdir?: string;
  force?: boolean;
  directories?: boolean;
  includeIgnored?: boolean;
  audit?: BuilderCapabilityAuditContext;
}): BuilderRepoStatus & { auditPath: string } {
  if (!args.force) {
    throw new Error("Builder VCS clean requires force=true.");
  }
  const gitArgs = ["clean", "-f"];
  if (args.directories) {
    gitArgs.push("-d");
  }
  if (args.includeIgnored) {
    gitArgs.push("-x");
  }
  runGit(gitArgs, args.subdir ?? ".");
  const status = getBuilderRepoStatus(args.subdir ?? ".", args.audit);
  appendVcsAuditEvent({
    ...(args.audit ?? {}),
    projectRelativePath: status.repoRoot,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: status.repoRoot }],
    metadata: {
      operation: "clean",
      directories: Boolean(args.directories),
      includeIgnored: Boolean(args.includeIgnored),
    },
  });
  return status;
}

export function addBuilderRepoRemote(args: {
  name: string;
  remoteUrl: string;
  subdir?: string;
  audit?: BuilderCapabilityAuditContext;
}): { repoRoot: string; remotes: BuilderRepoRemote[]; auditPath: string } {
  const repo = safeRepoRoot(args.subdir ?? ".");
  const remoteName = args.name.trim();
  if (!remoteName) {
    throw new Error("Builder VCS remote name is required.");
  }
  const normalizedRemoteUrl = assertRemoteAllowed({
    repo,
    remoteUrl: args.remoteUrl,
    operation: "add_remote",
    auditContext: args.audit,
  });
  runGitInRepo(["remote", "add", remoteName, args.remoteUrl.trim()], repo);
  const remotes = listBuilderRepoRemotes({ subdir: args.subdir ?? ".", audit: args.audit });
  appendVcsAuditEvent({
    ...(args.audit ?? {}),
    capabilityKey: "version_control_remote",
    projectRelativePath: repo.relative,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: repo.relative }, { kind: "host", identifier: normalizedRemoteUrl }],
    metadata: { operation: "add_remote", remoteName, remoteUrl: normalizedRemoteUrl },
  });
  return remotes;
}

export function removeBuilderRepoRemote(args: {
  name: string;
  subdir?: string;
  audit?: BuilderCapabilityAuditContext;
}): { repoRoot: string; remotes: BuilderRepoRemote[]; auditPath: string } {
  const repo = safeRepoRoot(args.subdir ?? ".");
  const remoteName = args.name.trim();
  if (!remoteName) {
    throw new Error("Builder VCS remote name is required.");
  }
  runGitInRepo(["remote", "remove", remoteName], repo);
  const remotes = listBuilderRepoRemotes({ subdir: args.subdir ?? ".", audit: args.audit });
  appendVcsAuditEvent({
    ...(args.audit ?? {}),
    capabilityKey: "version_control_remote",
    projectRelativePath: repo.relative,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: repo.relative }],
    metadata: { operation: "remove_remote", remoteName },
  });
  return remotes;
}

export function fetchBuilderRepoRemote(args: {
  remote?: string;
  refspec?: string;
  subdir?: string;
  audit?: BuilderCapabilityAuditContext;
}): BuilderRepoStatus & { auditPath: string } {
  const repo = safeRepoRoot(args.subdir ?? ".");
  if (args.remote?.trim()) {
    assertNamedRemoteAllowed({
      repo,
      remoteName: args.remote.trim(),
      operation: "fetch",
      auditContext: args.audit,
    });
  }
  const gitArgs = ["fetch"];
  if (args.remote?.trim()) {
    gitArgs.push(args.remote.trim());
  }
  if (args.refspec?.trim()) {
    gitArgs.push(args.refspec.trim());
  }
  runGitInRepo(gitArgs, repo);
  const status = getBuilderRepoStatus(args.subdir ?? ".", args.audit);
  appendVcsAuditEvent({
    ...(args.audit ?? {}),
    capabilityKey: "version_control_remote",
    projectRelativePath: repo.relative,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: repo.relative }],
    metadata: { operation: "fetch", remoteName: args.remote?.trim() || null, refspec: args.refspec?.trim() || null },
  });
  return status;
}

export function pullBuilderRepoRemote(args: {
  remote?: string;
  branch?: string;
  subdir?: string;
  audit?: BuilderCapabilityAuditContext;
}): BuilderRepoStatus & { auditPath: string } {
  const repo = safeRepoRoot(args.subdir ?? ".");
  if (args.remote?.trim()) {
    assertNamedRemoteAllowed({
      repo,
      remoteName: args.remote.trim(),
      operation: "pull",
      auditContext: args.audit,
    });
  }
  const gitArgs = ["pull"];
  if (args.remote?.trim()) {
    gitArgs.push(args.remote.trim());
  }
  if (args.branch?.trim()) {
    gitArgs.push(args.branch.trim());
  }
  runGitInRepo(gitArgs, repo);
  const status = getBuilderRepoStatus(args.subdir ?? ".", args.audit);
  appendVcsAuditEvent({
    ...(args.audit ?? {}),
    capabilityKey: "version_control_remote",
    projectRelativePath: repo.relative,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: repo.relative }],
    metadata: { operation: "pull", remoteName: args.remote?.trim() || null, branchName: args.branch?.trim() || null },
  });
  return status;
}

export function pushBuilderRepoRemote(args: {
  remote?: string;
  branch?: string;
  setUpstream?: boolean;
  force?: boolean;
  subdir?: string;
  audit?: BuilderCapabilityAuditContext;
}): BuilderRepoStatus & { auditPath: string } {
  const repo = safeRepoRoot(args.subdir ?? ".");
  if (args.remote?.trim()) {
    assertNamedRemoteAllowed({
      repo,
      remoteName: args.remote.trim(),
      operation: "push",
      auditContext: args.audit,
    });
  }
  const gitArgs = ["push"];
  if (args.setUpstream) {
    gitArgs.push("--set-upstream");
  }
  if (args.force) {
    gitArgs.push("--force");
  }
  if (args.remote?.trim()) {
    gitArgs.push(args.remote.trim());
  }
  if (args.branch?.trim()) {
    gitArgs.push(args.branch.trim());
  }
  runGitInRepo(gitArgs, repo);
  const status = getBuilderRepoStatus(args.subdir ?? ".", args.audit);
  appendVcsAuditEvent({
    ...(args.audit ?? {}),
    capabilityKey: "version_control_remote",
    projectRelativePath: repo.relative,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: repo.relative }],
    metadata: {
      operation: "push",
      remoteName: args.remote?.trim() || null,
      branchName: args.branch?.trim() || null,
      setUpstream: Boolean(args.setUpstream),
      force: Boolean(args.force),
    },
  });
  return status;
}

export function cloneBuilderRepo(args: {
  remoteUrl: string;
  targetPath: string;
  branch?: string;
  audit?: BuilderCapabilityAuditContext;
}): BuilderCloneResult & { auditPath: string } {
  const repo = safeCloneTarget(args.targetPath);
  const normalizedRemoteUrl = assertRemoteAllowed({
    repo,
    remoteUrl: args.remoteUrl,
    operation: "clone",
    auditContext: args.audit,
  });
  const workspaceRoot = resolveBuilderWorkspacePath(".");
  const gitArgs = ["clone"];
  if (args.branch?.trim()) {
    gitArgs.push("--branch", args.branch.trim());
  }
  gitArgs.push(args.remoteUrl.trim(), repo.absolute);
  const result = runGitRaw(gitArgs, workspaceRoot);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "Builder VCS clone failed.");
  }
  const status = getBuilderRepoStatus(args.targetPath, args.audit);
  const auditPath = appendVcsAuditEvent({
    ...(args.audit ?? {}),
    capabilityKey: "version_control_remote",
    projectRelativePath: repo.relative,
    outcomeStatus: "succeeded",
    targets: [{ kind: "repository", identifier: repo.relative }, { kind: "host", identifier: normalizedRemoteUrl }],
    metadata: { operation: "clone", branchName: args.branch?.trim() || null, remoteUrl: normalizedRemoteUrl },
  });
  return {
    repoRoot: status.repoRoot,
    currentBranch: status.currentBranch,
    headCommitSha: status.headCommitSha,
    auditPath,
  };
}