import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { DELETE, GET, POST } from "@/app/api/mcp/route";

function createTempBuilderWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-mcp-builder-"));
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

function createTempBuilderRepoWithBareRemote(): {
  workspaceRoot: string;
  repoPath: string;
  remotePath: string;
  branchName: string;
} {
  const { workspaceRoot, repoPath } = createTempBuilderRepo();
  const remotePath = path.join(workspaceRoot, "remotes", "origin.git");
  fs.mkdirSync(path.dirname(remotePath), { recursive: true });
  execFileSync("git", ["init", "--bare", remotePath], { stdio: "ignore" });
  const branchName = execFileSync("git", ["branch", "--show-current"], {
    cwd: repoPath,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  return { workspaceRoot, repoPath, remotePath, branchName };
}

function createTempBuilderRepoWithMetadata(): {
  workspaceRoot: string;
  repoPath: string;
  remotePath: string;
} {
  const { workspaceRoot, repoPath } = createTempBuilderRepo();
  const remotePath = path.join(workspaceRoot, "remotes", "origin.git");
  fs.mkdirSync(path.dirname(remotePath), { recursive: true });
  execFileSync("git", ["init", "--bare", remotePath], { stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", remotePath], { cwd: repoPath, stdio: "ignore" });
  execFileSync("git", ["tag", "v1.0.0"], { cwd: repoPath, stdio: "ignore" });
  execFileSync("git", ["branch", "feature/observer-test"], { cwd: repoPath, stdio: "ignore" });
  fs.writeFileSync(path.join(repoPath, "README.md"), "seed\nobserver change\n", "utf-8");
  return { workspaceRoot, repoPath, remotePath };
}

function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function callMcp(
  method: string,
  params: Record<string, unknown>,
  id: string,
  headers?: Record<string, string>,
) {
  const response = await POST(new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }),
  }));

  return {
    status: response.status,
    body: await response.json(),
  };
}

function uniqueBuilderSlug(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

async function waitForToolStructuredContent(
  name: string,
  args: Record<string, unknown>,
  idPrefix: string,
  attempts = 20,
  delayMs = 2000,
): Promise<Awaited<ReturnType<typeof callMcp>>> {
  let lastResult: Awaited<ReturnType<typeof callMcp>> | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await callMcp("tools/call", { name, arguments: args }, `${idPrefix}-${attempt + 1}`);
    lastResult = result;
    if (result.body?.result?.structuredContent) {
      return result;
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return lastResult!;
}

async function waitForManagedContainerByName(
  namePart: string,
  attempts = 12,
  delayMs = 500,
): Promise<{ containerId: string; name: string; ownership: string } | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await callMcp("tools/call", {
      name: "builder_list_managed_containers",
      arguments: {
        status: "stopped",
      },
    }, `builder-managed-container-wait-${attempt + 1}`);

    const containers = (result.body.result?.structuredContent?.containers ?? []) as Array<{
      containerId: string;
      name: string;
      ownership: string;
    }>;
    const matched = containers.find((entry) => entry.name.includes(namePart));
    if (matched) {
      return matched;
    }

    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return null;
}

afterEach(() => {
  delete process.env.BIZBOT_BUILDER_WORKSPACE_PATH;
  delete process.env.BIZBOT_BUILDER_ALLOWED_REMOTES;
  delete process.env.BIZBOT_BUILDER_ALLOWED_CONTAINER_COMMANDS;
  delete process.env.BIZBOT_BUILDER_ALLOWED_CONTAINER_PATH_PREFIXES;
  delete process.env.BIZBOT_BUILDER_ALLOWED_CONTAINER_TEST_PRESETS;
});

describe("MCP HTTP route", () => {
  it("initializes with server metadata", async () => {
    const result = await callMcp("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "vitest",
        version: "1.0.0",
      },
    }, "init-1");

    expect(result.status).toBe(200);
    expect(result.body.jsonrpc).toBe("2.0");
    expect(result.body.id).toBe("init-1");
    expect(result.body.result.serverInfo.name).toBe("bizbot");
    expect(result.body.result.capabilities).toMatchObject({
      tools: expect.any(Object),
      resources: expect.any(Object),
      prompts: expect.any(Object),
    });
    expect(result.body.result.capabilities.sampling).toBeUndefined();
  });

  it("lists exposed tools and keeps blocked tools hidden", async () => {
    const result = await callMcp("tools/list", {}, "tools-1");

    expect(result.status).toBe(200);
    expect(result.body.result.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "builder_repo_status" }),
      expect.objectContaining({ name: "builder_git_add" }),
      expect.objectContaining({ name: "builder_git_commit" }),
      expect.objectContaining({ name: "builder_git_push" }),
      expect.objectContaining({ name: "builder_list_containers" }),
      expect.objectContaining({ name: "builder_list_managed_containers" }),
      expect.objectContaining({ name: "builder_get_container" }),
      expect.objectContaining({ name: "builder_container_logs" }),
      expect.objectContaining({ name: "builder_read_file_in_container" }),
      expect.objectContaining({ name: "builder_test_in_container" }),
      expect.objectContaining({ name: "builder_validate_container_stage" }),
      expect.objectContaining({ name: "builder_exec_in_container" }),
      expect.objectContaining({ name: "builder_remove_managed_containers" }),
      expect.objectContaining({ name: "builder_clean_stale_containers" }),
      expect.objectContaining({ name: "developer_inspect_plugin_registry" }),
      expect.objectContaining({ name: "developer_inspect_ontology_schema" }),
      expect.objectContaining({ name: "developer_preview_ontology_context" }),
      expect.objectContaining({ name: "developer_list_agent_runs" }),
      expect.objectContaining({ name: "developer_vscode_loop_assist" }),
      expect.objectContaining({ name: "crm_list_contacts" }),
      expect.objectContaining({ name: "local_business_get_status" }),
    ]));
    expect(result.body.result.tools).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "agent_delegate_run" }),
    ]));
  });

  it("executes Builder git tools through JSON-RPC against a temp repo", async () => {
    const { workspaceRoot, repoPath } = createTempBuilderRepo();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const repoStatusResult = await callMcp("tools/call", {
      name: "builder_repo_status",
      arguments: { subdir: "projects/repo-demo" },
    }, "builder-status-1");

    expect(repoStatusResult.status).toBe(200);
    expect(repoStatusResult.body.result.structuredContent).toEqual(expect.objectContaining({
      repoRoot: "projects/repo-demo",
      currentBranch: expect.any(String),
      headCommitSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      dirty: false,
    }));

    fs.writeFileSync(path.join(repoPath, "notes.txt"), "mcp change\n", "utf-8");

    const addResult = await callMcp("tools/call", {
      name: "builder_git_add",
      arguments: { subdir: "projects/repo-demo", paths: ["notes.txt"] },
    }, "builder-add-1");

    expect(addResult.status).toBe(200);
    expect(addResult.body.result.structuredContent).toEqual(expect.objectContaining({
      repoRoot: "projects/repo-demo",
      stagedCount: expect.any(Number),
      unstagedCount: expect.any(Number),
    }));

    const commitResult = await callMcp("tools/call", {
      name: "builder_git_commit",
      arguments: { subdir: "projects/repo-demo", message: "mcp test commit" },
    }, "builder-commit-1");

    expect(commitResult.status).toBe(200);
    expect(commitResult.body.result.structuredContent).toEqual(expect.objectContaining({
      repoRoot: "projects/repo-demo",
      commitSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      summary: expect.stringContaining("mcp test commit"),
    }));
  });

  it("exercises read-only Builder git MCP tools against a seeded repo", async () => {
    const { workspaceRoot } = createTempBuilderRepoWithMetadata();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const [
      statusResult,
      diffResult,
      logResult,
      showResult,
      branchesResult,
      tagsResult,
      remotesResult,
      revParseResult,
    ] = await Promise.all([
      callMcp("tools/call", {
        name: "builder_repo_status",
        arguments: { subdir: "projects/repo-demo" },
      }, "builder-readonly-status-1"),
      callMcp("tools/call", {
        name: "builder_repo_diff",
        arguments: { subdir: "projects/repo-demo" },
      }, "builder-readonly-diff-1"),
      callMcp("tools/call", {
        name: "builder_repo_log",
        arguments: { subdir: "projects/repo-demo", limit: 1 },
      }, "builder-readonly-log-1"),
      callMcp("tools/call", {
        name: "builder_repo_show",
        arguments: { subdir: "projects/repo-demo", revision: "HEAD", stat: true },
      }, "builder-readonly-show-1"),
      callMcp("tools/call", {
        name: "builder_list_branches",
        arguments: { subdir: "projects/repo-demo" },
      }, "builder-readonly-branches-1"),
      callMcp("tools/call", {
        name: "builder_list_tags",
        arguments: { subdir: "projects/repo-demo" },
      }, "builder-readonly-tags-1"),
      callMcp("tools/call", {
        name: "builder_list_remotes",
        arguments: { subdir: "projects/repo-demo" },
      }, "builder-readonly-remotes-1"),
      callMcp("tools/call", {
        name: "builder_rev_parse",
        arguments: { subdir: "projects/repo-demo", revision: "HEAD" },
      }, "builder-readonly-revparse-1"),
    ]);

    expect(statusResult.status).toBe(200);
    expect(statusResult.body.result.structuredContent).toEqual(expect.objectContaining({
      repoRoot: "projects/repo-demo",
      dirty: true,
      unstagedCount: 1,
      tagCount: 1,
      remoteCount: 1,
      remoteNames: ["origin"],
    }));

    expect(diffResult.status).toBe(200);
    expect(diffResult.body.result.structuredContent).toEqual(expect.objectContaining({
      repoRoot: "projects/repo-demo",
      scope: "unstaged",
      patch: expect.stringContaining("observer change"),
    }));

    expect(logResult.status).toBe(200);
    expect(logResult.body.result.structuredContent.entries).toEqual([
      expect.objectContaining({ subject: "seed" }),
    ]);

    expect(showResult.status).toBe(200);
    expect(showResult.body.result.structuredContent).toEqual(expect.objectContaining({
      repoRoot: "projects/repo-demo",
      revision: "HEAD",
      output: expect.stringContaining("seed"),
    }));

    expect(branchesResult.status).toBe(200);
    expect(branchesResult.body.result.structuredContent.branches).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "feature/observer-test", remote: false }),
      expect.objectContaining({ current: true }),
    ]));

    expect(tagsResult.status).toBe(200);
    expect(tagsResult.body.result.structuredContent.tags).toEqual([
      expect.objectContaining({ name: "v1.0.0" }),
    ]);

    expect(remotesResult.status).toBe(200);
    expect(remotesResult.body.result.structuredContent.remotes).toEqual([
      expect.objectContaining({ name: "origin" }),
    ]);

    expect(revParseResult.status).toBe(200);
    expect(revParseResult.body.result.structuredContent).toEqual(expect.objectContaining({
      repoRoot: "projects/repo-demo",
      revision: "HEAD",
      value: expect.stringMatching(/^[0-9a-f]{40}$/),
    }));
  });

  it("pushes to an allowlisted remote through JSON-RPC", async () => {
    const { workspaceRoot, repoPath, remotePath, branchName } = createTempBuilderRepoWithBareRemote();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    process.env.BIZBOT_BUILDER_ALLOWED_REMOTES = remotePath;

    const addRemoteResult = await callMcp("tools/call", {
      name: "builder_git_remote_add",
      arguments: {
        subdir: "projects/repo-demo",
        name: "origin",
        remoteUrl: remotePath,
      },
    }, "builder-remote-add-1");

    expect(addRemoteResult.status).toBe(200);
    expect(addRemoteResult.body.result.structuredContent).toEqual(expect.objectContaining({
      repoRoot: "projects/repo-demo",
      remotes: [expect.objectContaining({ name: "origin" })],
    }));

    fs.writeFileSync(path.join(repoPath, "remote.txt"), "push me\n", "utf-8");

    const stageResult = await callMcp("tools/call", {
      name: "builder_git_add",
      arguments: { subdir: "projects/repo-demo", paths: ["remote.txt"] },
    }, "builder-remote-stage-1");

    expect(stageResult.status).toBe(200);
    expect(stageResult.body.result.structuredContent).toEqual(expect.objectContaining({
      repoRoot: "projects/repo-demo",
      stagedCount: expect.any(Number),
    }));

    const commitResult = await callMcp("tools/call", {
      name: "builder_git_commit",
      arguments: { subdir: "projects/repo-demo", message: "remote push commit" },
    }, "builder-remote-commit-1");

    expect(commitResult.status).toBe(200);
    expect(commitResult.body.result.structuredContent).toEqual(expect.objectContaining({
      repoRoot: "projects/repo-demo",
      commitSha: expect.stringMatching(/^[0-9a-f]{40}$/),
    }));

    const pushResult = await callMcp("tools/call", {
      name: "builder_git_push",
      arguments: {
        subdir: "projects/repo-demo",
        remote: "origin",
        branch: branchName,
        setUpstream: true,
        confirmed: true,
        reason: "verify MCP allowlisted remote push",
      },
    }, "builder-push-1");

    expect(pushResult.status).toBe(200);
    expect(pushResult.body.result.structuredContent).toEqual(expect.objectContaining({
      repoRoot: "projects/repo-demo",
      currentBranch: branchName,
      ahead: 0,
      behind: 0,
    }));
  });

  it("rejects non-allowlisted remotes at the Builder tool boundary", async () => {
    const { workspaceRoot, remotePath } = createTempBuilderRepoWithBareRemote();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    process.env.BIZBOT_BUILDER_ALLOWED_REMOTES = path.join(workspaceRoot, "remotes", "different.git");

    const blockedResult = await callMcp("tools/call", {
      name: "builder_git_remote_add",
      arguments: {
        subdir: "projects/repo-demo",
        name: "origin",
        remoteUrl: remotePath,
      },
    }, "builder-remote-blocked-1");

    expect(blockedResult.status).toBe(200);
    expect(blockedResult.body.result).toEqual(expect.objectContaining({
      isError: true,
      content: expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("Builder VCS remote is not allowlisted"),
        }),
      ]),
    }));
  });

  it("rejects non-allowlisted container commands at the Builder tool boundary", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    process.env.BIZBOT_BUILDER_ALLOWED_COMMANDS = "docker";
    process.env.BIZBOT_BUILDER_ALLOWED_CONTAINER_COMMANDS = "node";
    const slug = uniqueBuilderSlug("container-demo");

    const projectResult = await callMcp("tools/call", {
      name: "builder_create_project",
      arguments: {
        name: "Container Demo",
        slug,
        relativePath: `projects/${slug}`,
      },
    }, "container-project-1");
    expect(projectResult.status).toBe(200);
    expect(projectResult.body.result.structuredContent).toEqual(expect.objectContaining({
      project: expect.objectContaining({ id: expect.any(String) }),
    }));
    const projectId = projectResult.body.result.structuredContent.project.id as string;
    const projectRoot = path.join(workspaceRoot, "projects", slug);
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "compose.yml"), [
      "services:",
      "  app:",
      "    image: alpine:3.20",
    ].join("\n"), "utf-8");

    const blockedResult = await callMcp("tools/call", {
      name: "builder_exec_in_container",
      arguments: {
        projectId,
        serviceId: "compose:compose.yml:app",
        command: "python",
      },
    }, "builder-container-blocked-1");

    expect(blockedResult.status).toBe(200);
    expect(blockedResult.body.result).toEqual(expect.objectContaining({
      isError: true,
      content: expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("Builder container command not allowed"),
        }),
      ]),
    }));
  });

  it("exercises compose-backed container MCP tools against a temp project", async () => {
    if (!dockerAvailable()) {
      return;
    }

    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    process.env.BIZBOT_BUILDER_ALLOWED_COMMANDS = "docker";
    process.env.BIZBOT_BUILDER_ALLOWED_CONTAINER_PATH_PREFIXES = "/workspace";
    process.env.BIZBOT_BUILDER_ALLOWED_CONTAINER_TEST_PRESETS = "npm_test";
    const slug = uniqueBuilderSlug("container-mcp-demo");

    const projectResult = await callMcp("tools/call", {
      name: "builder_create_project",
      arguments: {
        name: "Container MCP Demo",
        slug,
        relativePath: `projects/${slug}`,
      },
    }, "container-project-2");
    expect(projectResult.status).toBe(200);
    expect(projectResult.body.result.structuredContent).toEqual(expect.objectContaining({
      project: expect.objectContaining({ id: expect.any(String) }),
    }));
    const projectId = projectResult.body.result.structuredContent.project.id as string;
    const projectRoot = path.join(workspaceRoot, "projects", slug);
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "compose.yml"), [
      "services:",
      "  app:",
      "    image: node:22-alpine",
      "    working_dir: /workspace",
      "    command:",
      "      - sh",
      "      - -lc",
      "      - mkdir -p /workspace && printf '{\"name\":\"fixture\",\"private\":true,\"scripts\":{\"test\":\"node test.js\"}}' > /workspace/package.json && printf 'console.log(\"container test ok\")\\n' > /workspace/test.js && tail -f /dev/null",
    ].join("\n"), "utf-8");

    const startResult = await callMcp("tools/call", {
      name: "builder_start_service",
      arguments: {
        projectId,
        serviceId: "compose:compose.yml:app",
      },
    }, "builder-container-start-1");

    expect(startResult.status).toBe(200);

    const inspectResult = await waitForToolStructuredContent(
      "builder_get_container",
      {
        projectId,
        serviceId: "compose:compose.yml:app",
      },
      "builder-container-inspect",
    );
    const testResult = await waitForToolStructuredContent(
      "builder_test_in_container",
      {
        projectId,
        serviceId: "compose:compose.yml:app",
        preset: "npm_test",
      },
      "builder-container-test",
    );
    const stopResult = await callMcp("tools/call", {
      name: "builder_stop_service",
      arguments: {
        projectId,
        serviceId: "compose:compose.yml:app",
      },
    }, "builder-container-stop-1");

    expect(inspectResult.status).toBe(200);
    expect(inspectResult.body.result.structuredContent).toEqual(expect.objectContaining({
      container: expect.objectContaining({
        serviceId: "compose:compose.yml:app",
        status: expect.stringMatching(/running|declared|stopped/),
      }),
    }));
    expect(testResult.status).toBe(200);
    expect(testResult.body.result.structuredContent).toEqual(expect.objectContaining({
      preset: "npm_test",
      status: "completed",
    }));
    expect(stopResult.status).toBe(200);
  }, 120000);

  it("removes a legacy-style stopped Builder container fixture through the managed MCP cleanup path", async () => {
    if (!dockerAvailable()) {
      return;
    }

    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    process.env.BIZBOT_BUILDER_ALLOWED_COMMANDS = "docker";
    const slug = uniqueBuilderSlug("container-mcp-demo");

    const projectResult = await callMcp("tools/call", {
      name: "builder_create_project",
      arguments: {
        name: "Legacy Container MCP Demo",
        slug,
        relativePath: `projects/${slug}`,
      },
    }, "container-project-cleanup-1");
    expect(projectResult.status).toBe(200);
    const projectId = projectResult.body.result.structuredContent.project.id as string;
    const projectRoot = path.join(workspaceRoot, "projects", slug);
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "compose.yml"), [
      "services:",
      "  app:",
      "    image: node:22-alpine",
      "    working_dir: /workspace",
      "    command:",
      "      - sh",
      "      - -lc",
      "      - tail -f /dev/null",
    ].join("\n"), "utf-8");

    execFileSync("docker", ["compose", "-f", path.join(projectRoot, "compose.yml"), "up", "-d", "app"], { stdio: "ignore" });
    execFileSync("docker", ["compose", "-f", path.join(projectRoot, "compose.yml"), "stop", "app"], { stdio: "ignore" });

    const legacyFixture = await waitForManagedContainerByName(slug);
    expect(legacyFixture).toEqual(expect.objectContaining({
      ownership: "legacy_test_fixture",
    }));

    const cleanupResult = await callMcp("tools/call", {
      name: "builder_clean_stale_containers",
      arguments: {
        containerIds: [legacyFixture!.containerId],
        confirmed: true,
        reason: "Remove stopped legacy Builder test container fixture",
      },
    }, "builder-container-cleanup-run-1");
    expect(cleanupResult.status).toBe(200);
    expect(cleanupResult.body.result.structuredContent).toEqual(expect.objectContaining({
      removedContainerIds: expect.arrayContaining([legacyFixture!.containerId]),
      totalMatched: 1,
    }));

    const afterResult = await callMcp("tools/call", {
      name: "builder_list_managed_containers",
      arguments: {
        status: "stopped",
      },
    }, "builder-container-cleanup-list-2");
    expect(afterResult.status).toBe(200);
    expect((afterResult.body.result.structuredContent.containers as Array<{ name: string }>).find((entry) => entry.name.includes(slug))).toBeUndefined();
  }, 120000);

  it("executes a real tool call through JSON-RPC", async () => {
    const result = await callMcp("tools/call", {
      name: "developer_list_agent_runs",
      arguments: { limit: 1 },
    }, "call-1");

    expect(result.status).toBe(200);
    expect(result.body.result.structuredContent).toEqual({
      runs: expect.any(Array),
    });
    expect(result.body.result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text" }),
    ]));
  });

  it("lists registered MCP resources including plugin discovery resources", async () => {
    const result = await callMcp("resources/list", {}, "resources-1");

    expect(result.status).toBe(200);
    expect(result.body.result.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        uri: "bizbot://plugins/installed",
        name: "plugins-installed",
        mimeType: "application/json",
      }),
      expect.objectContaining({
        uri: "bizbot://plugins/tool-map",
        name: "plugins-tool-map",
        mimeType: "application/json",
      }),
      expect.objectContaining({
        uri: "bizbot://plugins/registry-report",
        name: "plugins-registry-report",
        mimeType: "application/json",
      }),
      expect.objectContaining({
        uri: "bizbot://debug/system-status",
        name: "debug-system-status",
        mimeType: "application/json",
      }),
      expect.objectContaining({
        uri: "bizbot://ontology/schema",
        name: "ontology-schema",
        mimeType: "application/json",
      }),
      expect.objectContaining({
        uri: "bizbot://ontology/runtime-context-policy",
        name: "ontology-runtime-context-policy",
        mimeType: "application/json",
      }),
    ]));
  });

  it("keeps ontology inspection developer-facing and separate from runtime prompts", async () => {
    const [toolsResult, resourcesResult] = await Promise.all([
      callMcp("tools/list", {}, "tools-ontology"),
      callMcp("resources/list", {}, "resources-ontology"),
    ]);

    expect(toolsResult.body.result.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "developer_search_ontology_entities" }),
      expect.objectContaining({ name: "developer_explain_ontology_alias" }),
      expect.objectContaining({ name: "developer_validate_ontology_relation" }),
    ]));
    expect(resourcesResult.body.result.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ uri: "bizbot://ontology/summary" }),
      expect.objectContaining({ uri: "bizbot://ontology/promotion-rules" }),
    ]));
    expect(toolsResult.body.result.tools).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "ontology_search_entities" }),
    ]));
  });

  it("reads a plugin discovery resource through JSON-RPC", async () => {
    const result = await callMcp("resources/read", {
      uri: "bizbot://plugins/registry-report",
    }, "read-1");

    expect(result.status).toBe(200);
    expect(result.body.result.contents).toHaveLength(1);
    expect(result.body.result.contents[0]).toEqual(expect.objectContaining({
      uri: "bizbot://plugins/registry-report",
      mimeType: "application/json",
      text: expect.any(String),
    }));

    const parsed = JSON.parse(result.body.result.contents[0].text);
    expect(parsed).toEqual(expect.objectContaining({
      generatedAt: expect.any(String),
      plugins: expect.any(Array),
      toolOwnership: expect.any(Array),
      summary: expect.any(Object),
    }));
    expect(parsed.plugins).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "crm" }),
      expect.objectContaining({ id: "local-business" }),
    ]));
    expect(parsed.toolOwnership).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: "crm_list_contacts", ownerId: "crm" }),
    ]));
  });

  it("executes a developer preview tool through JSON-RPC", async () => {
    const result = await callMcp("tools/call", {
      name: "developer_preview_prompt",
      arguments: {
        promptName: "inspect-agent-run",
        args: { runId: "run-42" },
      },
    }, "call-preview-1");

    expect(result.status).toBe(200);
    expect(result.body.result.structuredContent).toEqual(expect.objectContaining({
      prompt: expect.objectContaining({ name: "inspect-agent-run" }),
      rendered: expect.objectContaining({ messages: expect.any(Array) }),
    }));
    expect(result.body.result.structuredContent.rendered.messages[0].text).toContain("run-42");
  });

  it("lists registered MCP prompts", async () => {
    const result = await callMcp("prompts/list", {}, "prompts-1");

    expect(result.status).toBe(200);
    expect(result.body.result.prompts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "debug-runtime",
        title: "Debug Runtime",
        arguments: expect.arrayContaining([
          expect.objectContaining({ name: "symptom", required: false }),
        ]),
      }),
      expect.objectContaining({
        name: "content-brief",
        title: "Content Brief",
      }),
      expect.objectContaining({
        name: "debug-vscode-mcp-loop",
        title: "Debug VS Code MCP Loop",
      }),
      expect.objectContaining({
        name: "inspect-agent-run",
        title: "Inspect Agent Run",
        arguments: expect.arrayContaining([
          expect.objectContaining({ name: "runId", required: true }),
        ]),
      }),
    ]));
  });

  it("gets a real prompt with interpolated arguments", async () => {
    const result = await callMcp("prompts/get", {
      name: "debug-runtime",
      arguments: { symptom: "worker is stalled" },
    }, "prompt-1");

    expect(result.status).toBe(200);
    expect(result.body.result.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: expect.objectContaining({
          type: "text",
          text: expect.stringContaining("Symptom: worker is stalled."),
        }),
      }),
    ]);

    const messageText = result.body.result.messages[0].content.text;
    expect(messageText).toContain("bizbot://debug/system-status");
    expect(messageText).toContain("bizbot://debug/recent-heartbeat");
    expect(messageText).toContain("smallest safe fix");
  });

  it("rejects unauthorized MCP requests when MCP_AUTH_TOKEN is configured", async () => {
    process.env.MCP_AUTH_TOKEN = "secret-token";

    try {
      const result = await callMcp("tools/list", {}, "auth-1");

      expect(result.status).toBe(401);
      expect(result.body).toEqual({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Unauthorized",
        },
        id: null,
      });
    } finally {
      delete process.env.MCP_AUTH_TOKEN;
    }
  });

  it("allows authorized MCP POST requests when MCP_AUTH_TOKEN is configured", async () => {
    process.env.MCP_AUTH_TOKEN = "secret-token";

    try {
      const result = await callMcp("tools/list", {}, "auth-ok", {
        authorization: "Bearer secret-token",
      });

      expect(result.status).toBe(200);
      expect(result.body.result.tools).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "developer_list_agent_runs" }),
      ]));
    } finally {
      delete process.env.MCP_AUTH_TOKEN;
    }
  });

  it("returns stateless-mode 405 for GET /api/mcp", async () => {
    const response = await GET(new Request("http://localhost:3000/api/mcp", {
      method: "GET",
      headers: {
        accept: "application/json, text/event-stream",
      },
    }));

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "SSE not supported in stateless mode",
      },
      id: null,
    });
  });

  it("returns stateless-mode 405 for DELETE /api/mcp", async () => {
    const response = await DELETE(new Request("http://localhost:3000/api/mcp", {
      method: "DELETE",
      headers: {
        accept: "application/json, text/event-stream",
      },
    }));

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Session management not supported in stateless mode",
      },
      id: null,
    });
  });

  it("rejects unauthorized GET /api/mcp requests when MCP_AUTH_TOKEN is configured", async () => {
    process.env.MCP_AUTH_TOKEN = "secret-token";

    try {
      const response = await GET(new Request("http://localhost:3000/api/mcp", {
        method: "GET",
        headers: {
          accept: "application/json, text/event-stream",
        },
      }));

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Unauthorized",
        },
        id: null,
      });
    } finally {
      delete process.env.MCP_AUTH_TOKEN;
    }
  });

  it("rejects unauthorized DELETE /api/mcp requests when MCP_AUTH_TOKEN is configured", async () => {
    process.env.MCP_AUTH_TOKEN = "secret-token";

    try {
      const response = await DELETE(new Request("http://localhost:3000/api/mcp", {
        method: "DELETE",
        headers: {
          accept: "application/json, text/event-stream",
        },
      }));

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Unauthorized",
        },
        id: null,
      });
    } finally {
      delete process.env.MCP_AUTH_TOKEN;
    }
  });

  it("returns method not found for unsupported MCP methods", async () => {
    const result = await callMcp("bogus/method", {}, "bad-method");

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      jsonrpc: "2.0",
      id: "bad-method",
      error: {
        code: -32601,
        message: "Method not found",
      },
    });
  });

  it("returns a parse error for malformed JSON-RPC payloads", async () => {
    const response = await POST(new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ nope: true }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32700,
        message: "Parse error: Invalid JSON-RPC message",
      },
      id: null,
    });
  });

  it("returns a parse error for invalid JSON request bodies", async () => {
    const response = await POST(new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: "{not-json",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32700,
        message: "Parse error: Invalid JSON",
      },
      id: null,
    });
  });

  it("returns invalid params when a required prompt argument is missing", async () => {
    const result = await callMcp("prompts/get", {
      name: "inspect-agent-run",
      arguments: {},
    }, "prompt-missing");

    expect(result.status).toBe(200);
    expect(result.body.error.code).toBe(-32602);
    expect(result.body.error.message).toContain("Invalid arguments for prompt inspect-agent-run");
    expect(result.body.error.message).toContain("runId");
  });
});