import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  commitBuilderRepo,
  createBuilderRepoBranch,
  getBuilderRepoStatus,
  getBuilderRepoLog,
  listBuilderRepoBranches,
  listBuilderRepoRemotes,
  listBuilderRepoTags,
  revParseBuilderRepo,
  showBuilderRepoObject,
} from "@/lib/builder/vcs";

function createTempBuilderWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-builder-vcs-"));
}

function createTempBuilderRepo(): { workspaceRoot: string; repoPath: string } {
  const workspaceRoot = createTempBuilderWorkspace();
  const repoPath = path.join(workspaceRoot, "projects", "repo-demo");
  fs.mkdirSync(repoPath, { recursive: true });
  execFileSync("git", ["init"], { cwd: repoPath, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "builder@example.com"], { cwd: repoPath, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Builder Test"], { cwd: repoPath, stdio: "ignore" });
  fs.writeFileSync(path.join(repoPath, "README.md"), "seed\n", "utf-8");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "seed"], { cwd: repoPath, stdio: "ignore" });
  return { workspaceRoot, repoPath };
}

function createTempBuilderRepoWithMetadata(): { workspaceRoot: string; repoPath: string; remotePath: string } {
  const { workspaceRoot, repoPath } = createTempBuilderRepo();
  const remotePath = path.join(workspaceRoot, "remotes", "origin.git");
  fs.mkdirSync(path.dirname(remotePath), { recursive: true });
  execFileSync("git", ["init", "--bare", remotePath], { stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", remotePath], { cwd: repoPath, stdio: "ignore" });
  execFileSync("git", ["tag", "v1.0.0"], { cwd: repoPath, stdio: "ignore" });
  execFileSync("git", ["branch", "feature/observer-test"], { cwd: repoPath, stdio: "ignore" });
  return { workspaceRoot, repoPath, remotePath };
}

afterEach(() => {
  delete process.env.BIZBOT_BUILDER_WORKSPACE_PATH;
});

describe("builder vcs", () => {
  it("rejects empty commits by default and allows them only when requested", () => {
    const { workspaceRoot } = createTempBuilderRepo();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    expect(() => commitBuilderRepo({ subdir: "projects/repo-demo", message: "empty commit" })).toThrow(
      "Builder VCS commit rejects empty commits by default",
    );

    const committed = commitBuilderRepo({
      subdir: "projects/repo-demo",
      message: "empty commit",
      allowEmpty: true,
    });

    expect(committed.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(committed.summary).toContain("empty commit");
    expect(fs.existsSync(path.join(workspaceRoot, committed.auditPath))).toBe(true);
  });

  it("blocks repository access when the builder workspace overlaps the BizBot repo", () => {
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = process.cwd();

    expect(() => getBuilderRepoStatus(".")).toThrow("overlaps the BizBot repository");
  });

  it("returns updated branch status after branch creation", () => {
    const { workspaceRoot } = createTempBuilderRepo();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const status = createBuilderRepoBranch({
      subdir: "projects/repo-demo",
      name: "feature/direct-vcs-test",
      checkout: true,
    });

    expect(status.currentBranch).toBe("feature/direct-vcs-test");
    expect(fs.existsSync(path.join(workspaceRoot, status.auditPath))).toBe(true);
  });

  it("returns rich observer state for log, show, branches, tags, remotes, and rev-parse", () => {
    const { workspaceRoot } = createTempBuilderRepoWithMetadata();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const status = getBuilderRepoStatus("projects/repo-demo");
    const log = getBuilderRepoLog({ subdir: "projects/repo-demo", limit: 1 });
    const show = showBuilderRepoObject({ subdir: "projects/repo-demo", revision: "HEAD", stat: true });
    const branches = listBuilderRepoBranches({ subdir: "projects/repo-demo" });
    const tags = listBuilderRepoTags({ subdir: "projects/repo-demo" });
    const remotes = listBuilderRepoRemotes({ subdir: "projects/repo-demo" });
    const revParse = revParseBuilderRepo({ subdir: "projects/repo-demo", revision: "HEAD" });

    expect(status.headCommitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(status.dirty).toBe(false);
    expect(status.conflictedFiles).toEqual([]);
    expect(status.tagCount).toBe(1);
    expect(status.remoteCount).toBe(1);
    expect(status.remoteNames).toEqual(["origin"]);

    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]?.subject).toBe("seed");
    expect(show.output).toContain("seed");
    expect(branches.branches.map((entry) => entry.name)).toEqual(expect.arrayContaining(["feature/observer-test", status.currentBranch ?? ""]));
    expect(tags.tags.map((entry) => entry.name)).toEqual(["v1.0.0"]);
    expect(remotes.remotes[0]).toEqual(expect.objectContaining({ name: "origin" }));
    expect(revParse.value).toBe(status.headCommitSha);
  });
});