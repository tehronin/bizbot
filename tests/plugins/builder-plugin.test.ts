import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { builderPlugin } from "@/lib/agent/plugins/BuilderPlugin";
import { executeTool, getAllToolDefinitions, getBuiltinPlugins } from "@/lib/agent/plugins";
import { canProfileUseTool } from "@/lib/agent/profiles";
import { cleanupBuilderManagedProcesses, listBuilderManagedProcesses } from "@/lib/builder/process-registry";

function asObjectResult<T extends object>(value: unknown): T {
  return value as T;
}

function requireTool(name: string) {
  const tool = builderPlugin.tools.find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

function createTempBuilderWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-builder-"));
}

function createTempBuilderRepo(): { workspaceRoot: string; repoPath: string } {
  const workspaceRoot = createTempBuilderWorkspace();
  const repoPath = path.join(workspaceRoot, "apps", "repo-demo");
  fs.mkdirSync(repoPath, { recursive: true });
  execFileSync("git", ["init"], { cwd: repoPath, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "builder@example.com"], { cwd: repoPath, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Builder Test"], { cwd: repoPath, stdio: "ignore" });
  fs.writeFileSync(path.join(repoPath, "README.md"), "seed\n", "utf-8");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "seed"], { cwd: repoPath, stdio: "ignore" });
  return { workspaceRoot, repoPath };
}

function writeManagedProcessFixture(args: {
  workspaceRoot: string;
  processId: string;
  status: "running" | "exited" | "failed" | "cancelled" | "timed_out";
  startedAt: string;
  updatedAt?: string;
  exitedAt?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  runId?: string | null;
}): void {
  const processesRoot = path.join(args.workspaceRoot, ".builder", "processes");
  fs.mkdirSync(processesRoot, { recursive: true });
  const baseName = path.join(processesRoot, args.processId);
  fs.writeFileSync(`${baseName}.log`, `${args.processId}-log\n`, "utf-8");
  fs.writeFileSync(`${baseName}.audit.jsonl`, "", "utf-8");
  fs.writeFileSync(`${baseName}.json`, JSON.stringify({
    processId: args.processId,
    command: "node",
    args: ["-e", "console.log('fixture')"],
    cwd: ".",
    projectId: args.projectId ?? null,
    taskId: args.taskId ?? null,
    runId: args.runId ?? null,
    pid: null,
    monitorPid: null,
    status: args.status,
    startedAt: args.startedAt,
    updatedAt: args.updatedAt ?? args.startedAt,
    exitedAt: args.exitedAt ?? (args.status === "running" ? null : args.startedAt),
    exitCode: args.status === "exited" ? 0 : args.status === "running" ? null : 1,
    signal: null,
    timedOut: args.status === "timed_out",
    cancelled: args.status === "cancelled",
    timeoutSeconds: 30,
    stdoutBytes: 0,
    stderrBytes: 0,
    logBytes: 0,
    logStartCursor: 0,
    nextCursor: 0,
    metadataPath: `.builder/processes/${args.processId}.json`,
    logPath: `.builder/processes/${args.processId}.log`,
    auditPath: `.builder/processes/${args.processId}.audit.jsonl`,
  }, null, 2), "utf-8");
}

afterEach(() => {
  delete process.env.BIZBOT_BUILDER_WORKSPACE_PATH;
  delete process.env.BIZBOT_BUILDER_ALLOWED_COMMANDS;
});

describe("builder plugin", () => {
  it("is included in the builtin plugin registry", () => {
    const plugin = getBuiltinPlugins().find((entry) => entry.metadata.id === "builder");

    expect(plugin?.metadata.displayName).toBe("Builder");
    expect(plugin?.tools.map((tool) => tool.name)).toContain("builder_plan_project");
    expect(plugin?.tools.map((tool) => tool.name)).toContain("builder_run_command");
    expect(plugin?.tools.map((tool) => tool.name)).toContain("builder_start_process");
    expect(plugin?.tools.map((tool) => tool.name)).toContain("builder_list_processes");
    expect(plugin?.tools.map((tool) => tool.name)).toContain("builder_run_agentic_task");
  });

  it("reports an unsafe default workspace when it overlaps the repo", async () => {
    const tool = requireTool("builder_get_status");
    const result = asObjectResult<{ safe: boolean; reason: string }>(await tool.execute({}, {}));

    expect(result.safe).toBe(false);
    expect(String(result.reason)).toContain("BIZBOT_BUILDER_WORKSPACE_PATH");
  });

  it("mutates files and directories inside the dedicated builder workspace", async () => {
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = createTempBuilderWorkspace();

    await requireTool("builder_ensure_directory").execute({ path: "apps/demo/src" }, {});
    await requireTool("builder_write_file").execute({ path: "apps/demo/src/value.txt", content: "42" }, {});
    await requireTool("builder_append_file").execute({ path: "apps/demo/src/value.txt", content: "\n43" }, {});
    const readResult = await requireTool("builder_read_file").execute({ path: "apps/demo/src/value.txt" }, {});
    const listResult = asObjectResult<{ files: Array<{ path: string }> }>(await requireTool("builder_list_files").execute({ subdir: "apps/demo/src" }, {}));
    const statResult = asObjectResult<{ exists: boolean; type: string; size: number | null }>(await requireTool("builder_stat_path").execute({ path: "apps/demo/src/value.txt" }, {}));
    const existsBeforeMove = asObjectResult<{ exists: boolean }>(await requireTool("builder_path_exists").execute({ path: "apps/demo/src/value.txt" }, {}));
    await requireTool("builder_move_path").execute({ fromPath: "apps/demo/src/value.txt", toPath: "apps/demo/src/value-renamed.txt" }, {});
    const existsAfterMove = asObjectResult<{ exists: boolean }>(await requireTool("builder_path_exists").execute({ path: "apps/demo/src/value-renamed.txt" }, {}));
    const scaffoldResult = await requireTool("builder_scaffold_node_package").execute({
      projectDir: "apps/pkg",
      packageName: "pkg-demo",
      description: "fixture package",
    }, {});
    await requireTool("builder_delete_path").execute({ path: "apps/demo/src/value-renamed.txt" }, {});
    const existsAfterDelete = asObjectResult<{ exists: boolean }>(await requireTool("builder_path_exists").execute({ path: "apps/demo/src/value-renamed.txt" }, {}));

    expect(readResult).toEqual({ content: "42\n43" });
    expect(listResult.files.map((entry: { path: string }) => entry.path)).toContain("apps/demo/src/value.txt");
    expect(statResult.exists).toBe(true);
    expect(statResult.type).toBe("file");
    expect(statResult.size).toBe(5);
    expect(existsBeforeMove.exists).toBe(true);
    expect(existsAfterMove.exists).toBe(true);
    expect(existsAfterDelete.exists).toBe(false);
    expect(scaffoldResult).toEqual({
      scaffolded: true,
      root: "apps/pkg",
      files: [
        "apps/pkg/package.json",
        "apps/pkg/tsconfig.json",
        "apps/pkg/.gitignore",
        "apps/pkg/README.md",
        "apps/pkg/src/index.ts",
      ],
    });
  });

  it("applies patches and performs first-class VCS operations inside a builder repo", async () => {
    const { workspaceRoot } = createTempBuilderRepo();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    await requireTool("builder_apply_patch").execute({
      cwd: "apps/repo-demo",
      patch: [
        "diff --git a/README.md b/README.md",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1 +1,2 @@",
        " seed",
        "+patched",
        "",
      ].join("\n"),
    }, {});

    const diffResult = asObjectResult<{ patch: string }>(await requireTool("builder_diff").execute({ subdir: "apps/repo-demo" }, {}));
    const statusAfterPatch = asObjectResult<{ unstaged: Array<{ path: string }>; staged: Array<{ path: string }>; currentBranch: string | null }>(await requireTool("builder_repo_status").execute({ subdir: "apps/repo-demo" }, {}));
    const initialBranch = statusAfterPatch.currentBranch;
    expect(initialBranch).toBeTruthy();
    const statusAfterStage = asObjectResult<{ staged: Array<{ path: string }> }>(await requireTool("builder_stage_paths").execute({ subdir: "apps/repo-demo", paths: ["README.md"] }, {}));
    const stagedDiff = asObjectResult<{ patch: string }>(await requireTool("builder_diff").execute({ subdir: "apps/repo-demo", staged: true }, {}));
    const statusAfterUnstage = asObjectResult<{ staged: Array<{ path: string }> }>(await requireTool("builder_unstage_paths").execute({ subdir: "apps/repo-demo", paths: ["README.md"] }, {}));
    await requireTool("builder_stage_paths").execute({ subdir: "apps/repo-demo", paths: ["README.md"] }, {});
    const commitResult = asObjectResult<{ commitSha: string; summary: string }>(await requireTool("builder_commit").execute({ subdir: "apps/repo-demo", message: "Patch readme" }, {}));
    const branchStatus = asObjectResult<{ currentBranch: string | null }>(await requireTool("builder_create_branch").execute({ subdir: "apps/repo-demo", name: "feature/test-branch", checkout: true }, {}));
    const switchedStatus = asObjectResult<{ currentBranch: string | null }>(await requireTool("builder_switch_branch").execute({ subdir: "apps/repo-demo", name: initialBranch ?? "main" }, {}));

    expect(diffResult.patch).toContain("+patched");
    expect(statusAfterPatch.currentBranch).toBeTruthy();
    expect(statusAfterPatch.unstaged.map((entry) => entry.path)).toContain("README.md");
    expect(statusAfterPatch.staged).toHaveLength(0);
    expect(statusAfterStage.staged.map((entry) => entry.path)).toContain("README.md");
    expect(stagedDiff.patch).toContain("+patched");
    expect(statusAfterUnstage.staged).toHaveLength(0);
    expect(commitResult.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(commitResult.summary).toContain("Patch readme");
    expect(branchStatus.currentBranch).toBe("feature/test-branch");
    expect(switchedStatus.currentBranch).toBe(initialBranch);
  });

  it("runs only allowlisted commands and blocks repo path references", async () => {
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_ALLOWED_COMMANDS = "node";

    const commandResult = await requireTool("builder_run_command").execute({
      command: "node",
      args: ["-e", "console.log('builder-ok')"],
    }, {});
    const command = asObjectResult<{ ok: boolean; stdout: string }>(commandResult);

    expect(command.ok).toBe(true);
    expect(command.stdout.trim()).toBe("builder-ok");

    await expect(() => requireTool("builder_run_command").execute({
      command: "npm",
      args: ["--version"],
    }, {})).rejects.toThrow("Builder command not allowed");

    await expect(() => requireTool("builder_run_command").execute({
      command: "node",
      args: [process.cwd()],
    }, {})).rejects.toThrow("Builder command arguments reference the BizBot repository");
  });

  it("persists managed builder processes and supports filtered listing plus tail/follow logs", async () => {
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_ALLOWED_COMMANDS = "node";

    const started = asObjectResult<{ started: boolean; process: { processId: string; status: string; metadataPath: string; logPath: string; auditPath: string } }>(await requireTool("builder_start_process").execute({
      command: "node",
      args: ["-e", "let count = 0; const timer = setInterval(() => { console.log(`tick-${++count}`); if (count === 2) { clearInterval(timer); process.exit(0); } }, 50);"] ,
      timeoutSeconds: 30,
    }, {}));
    const workspaceRoot = process.env.BIZBOT_BUILDER_WORKSPACE_PATH!;
    expect(fs.existsSync(path.join(workspaceRoot, started.process.metadataPath))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, started.process.logPath))).toBe(true);
    expect(fs.existsSync(path.join(workspaceRoot, started.process.auditPath))).toBe(true);

    const finished = asObjectResult<{ completed: boolean; timedOut: boolean; process: { processId: string; status: string; exitCode: number | null } }>(await requireTool("builder_wait_for_process").execute({
      processId: started.process.processId,
      timeoutSeconds: 5,
    }, {}));
    const listedExited = asObjectResult<{ returned: number; processes: Array<{ processId: string; status: string }> }>(await requireTool("builder_list_processes").execute({
      statuses: ["exited"],
      commandContains: "node",
      cwdPrefix: ".",
    }, {}));
    const logs = asObjectResult<{ logs: string; complete: boolean; nextCursor: number }>(await requireTool("builder_stream_process_logs").execute({
      processId: started.process.processId,
    }, {}));
    const tailed = asObjectResult<{ logs: string }>(await requireTool("builder_stream_process_logs").execute({
      processId: started.process.processId,
      tailBytes: 8,
    }, {}));
    const finishedState = asObjectResult<{ process: { status: string; exitCode: number | null } }>(await requireTool("builder_get_process").execute({
      processId: started.process.processId,
    }, {}));

    const stoppable = asObjectResult<{ process: { processId: string } }>(await requireTool("builder_start_process").execute({
      command: "node",
      args: ["-e", "setTimeout(() => console.log('late-log'), 150); setInterval(() => {}, 1000);"],
      timeoutSeconds: 30,
    }, {}));
    const listedRunning = asObjectResult<{ returned: number; processes: Array<{ processId: string; status: string }> }>(await requireTool("builder_list_processes").execute({
      statuses: ["running"],
      includeFinished: false,
    }, {}));
    const followed = asObjectResult<{ logs: string; followed: boolean; followTimedOut: boolean }>(await requireTool("builder_stream_process_logs").execute({
      processId: stoppable.process.processId,
      followSeconds: 2,
    }, {}));
    const stopped = asObjectResult<{ stopped: boolean; process: { status: string } }>(await requireTool("builder_stop_process").execute({
      processId: stoppable.process.processId,
    }, {}));
    const stoppedWait = asObjectResult<{ completed: boolean; process: { status: string } }>(await requireTool("builder_wait_for_process").execute({
      processId: stoppable.process.processId,
      timeoutSeconds: 5,
    }, {}));

    expect(started.started).toBe(true);
    expect(finished.completed).toBe(true);
    expect(finished.timedOut).toBe(false);
    expect(finished.process.status).toBe("exited");
    expect(finished.process.exitCode).toBe(0);
    expect(listedExited.processes.map((entry) => entry.processId)).toContain(started.process.processId);
    expect(logs.logs).toContain("tick-1");
    expect(logs.logs).toContain("tick-2");
    expect(logs.complete).toBe(true);
    expect(tailed.logs).toContain("tick-2");
    const startedAudit = fs.readFileSync(path.join(workspaceRoot, started.process.auditPath), "utf-8");
    expect(startedAudit).toContain('"action":"started"');
    expect(startedAudit).toContain('"action":"completed"');
    expect(finishedState.process.status).toBe("exited");
    expect(listedRunning.processes.map((entry) => entry.processId)).toContain(stoppable.process.processId);
    expect(followed.followed).toBe(true);
    expect(followed.followTimedOut).toBe(false);
    expect(followed.logs).toContain("late-log");
    expect(stopped.stopped).toBe(true);
    expect(["running", "cancelled"]).toContain(stopped.process.status);
    expect(stoppedWait.completed).toBe(true);
    expect(stoppedWait.process.status).toBe("cancelled");
    const stoppedAudit = fs.readFileSync(path.join(workspaceRoot, ".builder", "processes", `${stoppable.process.processId}.audit.jsonl`), "utf-8");
    expect(stoppedAudit).toContain('"action":"stop_requested"');
  });

  it("filters scoped process metadata and prunes stale completed artifacts", () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const staleTimestamp = new Date(Date.now() - (8 * 24 * 60 * 60 * 1000)).toISOString();
    const recentTimestamp = new Date().toISOString();
    writeManagedProcessFixture({
      workspaceRoot,
      processId: "process-stale",
      status: "exited",
      startedAt: staleTimestamp,
      updatedAt: staleTimestamp,
      exitedAt: staleTimestamp,
      projectId: "project-stale",
    });
    writeManagedProcessFixture({
      workspaceRoot,
      processId: "process-recent",
      status: "exited",
      startedAt: recentTimestamp,
      updatedAt: recentTimestamp,
      exitedAt: recentTimestamp,
      projectId: "project-1",
      taskId: "task-1",
      runId: "run-1",
    });

    const cleanup = cleanupBuilderManagedProcesses();
    const filtered = listBuilderManagedProcesses({
      projectId: "project-1",
      taskId: "task-1",
      runId: "run-1",
    });

    expect(cleanup.deletedProcessIds).toContain("process-stale");
    expect(fs.existsSync(path.join(workspaceRoot, ".builder", "processes", "process-stale.json"))).toBe(false);
    expect(fs.existsSync(path.join(workspaceRoot, ".builder", "processes", "process-recent.json"))).toBe(true);
    expect(filtered.processes.map((entry) => entry.processId)).toEqual(["process-recent"]);
  });

  it("enforces lane gating for builder tools and exposes them to the MCP lane", () => {
    expect(canProfileUseTool("builder_operator", "builder_get_status")).toBe(true);
    expect(canProfileUseTool("builder_operator", "builder_continue_task")).toBe(false);
    expect(canProfileUseTool("builder_operator", "builder_run_agentic_task")).toBe(false);
    expect(canProfileUseTool("builder_operator", "builder_run_script")).toBe(false);
    expect(canProfileUseTool("builder_operator", "builder_run_command")).toBe(false);
    expect(canProfileUseTool("general_operator", "builder_get_status")).toBe(false);
    expect(canProfileUseTool("mcp_operator", "builder_get_status")).toBe(true);

    const mcpTools = getAllToolDefinitions(undefined, { agentProfile: "mcp_operator" }).map((tool) => tool.name);
    expect(mcpTools).toContain("builder_get_status");
    expect(mcpTools).toContain("builder_run_command");
    expect(mcpTools).toContain("builder_start_process");
    expect(mcpTools).toContain("builder_list_processes");
  });

  it("rejects unsafe builder workspace execution through the shared tool executor", async () => {
    await expect(() => executeTool("builder_write_file", { path: "demo.txt", content: "bad" }, {
      access: { agentProfile: "builder_operator" },
    })).rejects.toThrow("Builder workspace overlaps the BizBot repository");
  });
});