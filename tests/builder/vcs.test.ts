import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  commitBuilderRepo,
  createBuilderRepoBranch,
  getBuilderRepoStatus,
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
  });
});