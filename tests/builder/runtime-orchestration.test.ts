import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listBuilderManagedProcesses: vi.fn(),
  streamBuilderManagedProcessLogs: vi.fn(),
  startBuilderManagedProcess: vi.fn(),
  stopBuilderManagedProcess: vi.fn(),
  waitForBuilderManagedProcess: vi.fn(),
  appendBuilderCapabilityAuditEvent: vi.fn(),
  assertBuilderCommandAllowed: vi.fn(),
  runBuilderCommand: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof import("child_process")>("child_process");
  return {
    ...actual,
    spawnSync: mocks.spawnSync,
  };
});

vi.mock("@/lib/builder/process-registry", () => ({
  listBuilderManagedProcesses: mocks.listBuilderManagedProcesses,
  streamBuilderManagedProcessLogs: mocks.streamBuilderManagedProcessLogs,
  startBuilderManagedProcess: mocks.startBuilderManagedProcess,
  stopBuilderManagedProcess: mocks.stopBuilderManagedProcess,
  waitForBuilderManagedProcess: mocks.waitForBuilderManagedProcess,
}));

vi.mock("@/lib/builder/audit", () => ({
  appendBuilderCapabilityAuditEvent: mocks.appendBuilderCapabilityAuditEvent,
}));

vi.mock("@/lib/builder/workspace", () => ({
  assertBuilderCommandAllowed: mocks.assertBuilderCommandAllowed,
  runBuilderCommand: mocks.runBuilderCommand,
}));

import {
  execBuilderRuntimeContainerCommand,
  execBuilderRuntimeServiceCommand,
  getBuilderRuntimeContainer,
  getBuilderRuntimeContainerLogs,
  getBuilderRuntimeInspectionOverview,
  listBuilderManagedContainers,
  listBuilderRuntimeContainers,
  listBuilderRuntimeContainerFiles,
  previewBuilderRuntimeServiceLogs,
  readBuilderRuntimeContainerFile,
  removeBuilderManagedContainers,
  restartBuilderRuntimeService,
  startBuilderRuntimeService,
  statBuilderRuntimeContainerPath,
  stopBuilderRuntimeService,
  testBuilderRuntimeContainer,
} from "@/lib/builder/runtime-orchestration";

function createTempBuilderWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-builder-runtime-"));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appendBuilderCapabilityAuditEvent.mockReturnValue({ auditPath: "projects/demo/.builder/reports/capability-audit.jsonl" });
  mocks.assertBuilderCommandAllowed.mockReturnValue(undefined);
  mocks.stopBuilderManagedProcess.mockImplementation((processId: string) => ({
    stopped: true,
    process: { processId, status: "running" },
  }));
  mocks.waitForBuilderManagedProcess.mockResolvedValue({
    completed: true,
    timedOut: false,
    process: { processId: "proc-1", status: "cancelled" },
  });
  mocks.startBuilderManagedProcess.mockResolvedValue({
    started: true,
    process: { processId: "proc-2", status: "running", logPath: ".builder/processes/proc-2.log", auditPath: ".builder/processes/proc-2.audit.jsonl" },
  });
  mocks.runBuilderCommand.mockResolvedValue({
    ok: true,
    command: "node",
    args: ["--version"],
    cwd: "projects/demo",
    exitCode: 0,
    signal: null,
    stdout: "v22.0.0",
    stderr: "",
    timedOut: false,
    cancelled: false,
  });
  mocks.spawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "" });
});

afterEach(() => {
  delete process.env.BIZBOT_BUILDER_WORKSPACE_PATH;
  delete process.env.BIZBOT_BUILDER_ALLOWED_CONTAINER_COMMANDS;
  delete process.env.BIZBOT_BUILDER_ALLOWED_CONTAINER_PATH_PREFIXES;
  delete process.env.BIZBOT_BUILDER_ALLOWED_CONTAINER_TEST_PRESETS;
});

describe("builder runtime orchestration", () => {
  it("discovers runtime services from package scripts, workspace packages, procfiles, and compose files", () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    fs.mkdirSync(path.join(workspaceRoot, "projects", "demo"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "projects", "demo", "apps", "web"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "projects", "demo", "package.json"), JSON.stringify({
      scripts: {
        dev: "next dev",
        build: "next build",
        worker: "node worker.js",
      },
    }, null, 2));
    fs.writeFileSync(path.join(workspaceRoot, "projects", "demo", "apps", "web", "package.json"), JSON.stringify({
      scripts: {
        dev: "vite",
      },
    }, null, 2));
    fs.writeFileSync(path.join(workspaceRoot, "projects", "demo", "Procfile"), "web: npm run dev\nrelease: node scripts/release.js\n");
    fs.writeFileSync(path.join(workspaceRoot, "projects", "demo", "compose.yml"), [
      "services:",
      "  db:",
      "    image: postgres:16",
    ].join("\n"));
    mocks.listBuilderManagedProcesses.mockReturnValue({
      processes: [
        {
          processId: "proc-1",
          command: "npm",
          args: ["run", "dev"],
          cwd: "projects/demo",
          projectId: "project-1",
          taskId: null,
          runId: null,
          pid: 100,
          monitorPid: 101,
          status: "running",
          startedAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          exitedAt: null,
          exitCode: null,
          signal: null,
          timedOut: false,
          cancelled: false,
          timeoutSeconds: 1800,
          stdoutBytes: 0,
          stderrBytes: 0,
          logBytes: 0,
          logStartCursor: 0,
          nextCursor: 0,
          metadataPath: ".builder/processes/proc-1.json",
          logPath: ".builder/processes/proc-1.log",
          auditPath: ".builder/processes/proc-1.audit.jsonl",
        },
      ],
      total: 1,
      returned: 1,
    });

    const overview = getBuilderRuntimeInspectionOverview({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      packageManager: "NPM",
    });

    expect(overview.totalServices).toBe(6);
    expect(overview.runningServices).toBe(1);
    expect(overview.services.map((service) => service.serviceId).sort()).toEqual([
      "compose:compose.yml:db",
      "procfile:Procfile:release",
      "procfile:Procfile:web",
      "script:dev",
      "script:worker",
      "workspace:apps/web/package.json:dev",
    ].sort());
  });

  it("reads passive runtime service logs for a discovered script service", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    fs.mkdirSync(path.join(workspaceRoot, "projects", "demo"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "projects", "demo", "package.json"), JSON.stringify({
      scripts: {
        dev: "next dev",
      },
    }, null, 2));
    mocks.listBuilderManagedProcesses.mockReturnValue({
      processes: [
        {
          processId: "proc-1",
          command: "npm",
          args: ["run", "dev"],
          cwd: "projects/demo",
          projectId: "project-1",
          taskId: null,
          runId: null,
          pid: 100,
          monitorPid: 101,
          status: "running",
          startedAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          exitedAt: null,
          exitCode: null,
          signal: null,
          timedOut: false,
          cancelled: false,
          timeoutSeconds: 1800,
          stdoutBytes: 0,
          stderrBytes: 0,
          logBytes: 0,
          logStartCursor: 0,
          nextCursor: 0,
          metadataPath: ".builder/processes/proc-1.json",
          logPath: ".builder/processes/proc-1.log",
          auditPath: ".builder/processes/proc-1.audit.jsonl",
        },
      ],
      total: 1,
      returned: 1,
    });
    mocks.streamBuilderManagedProcessLogs.mockResolvedValue({
      process: { processId: "proc-1", status: "running" },
      cursorUsed: 0,
      nextCursor: 4,
      logs: "ready",
      truncatedBeforeCursor: false,
      complete: false,
      followed: false,
      followTimedOut: false,
    });

    const preview = await previewBuilderRuntimeServiceLogs({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      packageManager: "NPM",
      serviceId: "script:dev",
    });

    expect(preview.service.serviceId).toBe("script:dev");
    expect(preview.logs).toBe("ready");
  });

  it("reconciles compose runtime state and reads compose logs", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    fs.mkdirSync(path.join(workspaceRoot, "projects", "demo"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "projects", "demo", "compose.yml"), [
      "services:",
      "  db:",
      "    image: postgres:16",
    ].join("\n"));
    mocks.listBuilderManagedProcesses.mockReturnValue({ processes: [], total: 0, returned: 0 });
    mocks.spawnSync
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify([{ Service: "db", State: "running", Health: "healthy", ID: "container-1", Publishers: [{ PublishedPort: 5432, TargetPort: 5432, Protocol: "tcp" }] }]),
        stderr: "",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify([{ Service: "db", State: "running", Health: "healthy", ID: "container-1", Publishers: [{ PublishedPort: 5432, TargetPort: 5432, Protocol: "tcp" }] }]),
        stderr: "",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "2025-01-01T00:00:00Z db | ready\n",
        stderr: "",
      });

    const overview = getBuilderRuntimeInspectionOverview({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      packageManager: "NPM",
    });
    const preview = await previewBuilderRuntimeServiceLogs({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      packageManager: "NPM",
      serviceId: "compose:compose.yml:db",
    });

    expect(overview.services[0]?.status).toBe("running");
    expect(overview.services[0]?.healthStatus).toBe("healthy");
    expect(overview.services[0]?.containerId).toBe("container-1");
    expect(preview.logs).toContain("ready");
  });

  it("restarts a managed npm-script service", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    fs.mkdirSync(path.join(workspaceRoot, "projects", "demo"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "projects", "demo", "package.json"), JSON.stringify({ scripts: { dev: "next dev" } }, null, 2));
    mocks.listBuilderManagedProcesses.mockReturnValue({
      processes: [{
        processId: "proc-1",
        command: "npm",
        args: ["run", "dev"],
        cwd: "projects/demo",
        projectId: "project-1",
        taskId: null,
        runId: null,
        pid: 100,
        monitorPid: 101,
        status: "running",
        startedAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        exitedAt: null,
        exitCode: null,
        signal: null,
        timedOut: false,
        cancelled: false,
        timeoutSeconds: 1800,
        stdoutBytes: 0,
        stderrBytes: 0,
        logBytes: 0,
        logStartCursor: 0,
        nextCursor: 0,
        metadataPath: ".builder/processes/proc-1.json",
        logPath: ".builder/processes/proc-1.log",
        auditPath: ".builder/processes/proc-1.audit.jsonl",
      }],
      total: 1,
      returned: 1,
    });

    const result = await restartBuilderRuntimeService({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      packageManager: "NPM",
      serviceId: "script:dev",
    });

    expect(result.status).toBe("completed");
    expect(mocks.stopBuilderManagedProcess).toHaveBeenCalledWith("proc-1");
    expect(mocks.startBuilderManagedProcess).toHaveBeenCalledWith(expect.objectContaining({
      command: "npm",
      args: ["run", "dev"],
      cwd: "projects/demo",
    }));
  });

  it("executes a one-shot command in a discovered runtime service", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    fs.mkdirSync(path.join(workspaceRoot, "projects", "demo"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "projects", "demo", "package.json"), JSON.stringify({ scripts: { dev: "next dev" } }, null, 2));
    mocks.listBuilderManagedProcesses.mockReturnValue({ processes: [], total: 0, returned: 0 });

    const result = await execBuilderRuntimeServiceCommand({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      packageManager: "NPM",
      serviceId: "script:dev",
      command: "node",
      commandArgs: ["--version"],
    });

    expect(result.status).toBe("completed");
    expect(mocks.runBuilderCommand).toHaveBeenCalledWith("node", ["--version"], expect.objectContaining({ cwd: "projects/demo" }));
  });

  it("starts and stops compose services through runtime helpers", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    fs.mkdirSync(path.join(workspaceRoot, "projects", "demo"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "projects", "demo", "compose.yml"), [
      "services:",
      "  db:",
      "    image: postgres:16",
    ].join("\n"));
    mocks.listBuilderManagedProcesses.mockReturnValue({ processes: [], total: 0, returned: 0 });
    mocks.spawnSync
      .mockReturnValueOnce({ status: 0, stdout: "[]", stderr: "" })
      .mockReturnValue({
        status: 0,
        stdout: JSON.stringify([{ Service: "db", State: "running", Health: "healthy", ID: "container-1", Publishers: [] }]),
        stderr: "",
      });
    mocks.runBuilderCommand.mockResolvedValue({
      ok: true,
      command: "docker",
      args: ["compose", "-f", path.join(workspaceRoot, "projects", "demo", "compose.yml"), "up", "-d", "db"],
      cwd: "projects/demo",
      exitCode: 0,
      signal: null,
      stdout: "started",
      stderr: "",
      timedOut: false,
      cancelled: false,
    });

    const started = await startBuilderRuntimeService({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      packageManager: "NPM",
      serviceId: "compose:compose.yml:db",
    });
    const stopped = await stopBuilderRuntimeService({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      packageManager: "NPM",
      serviceId: "compose:compose.yml:db",
    });

    expect(started.status).toBe("completed");
    expect(stopped.status).toBe("completed");
    expect(mocks.runBuilderCommand).toHaveBeenCalledWith("docker", expect.arrayContaining(["compose"]), expect.objectContaining({ cwd: "projects/demo" }));
  });

  it("lists and inspects compose-backed containers", () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    fs.mkdirSync(path.join(workspaceRoot, "projects", "demo"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "projects", "demo", "compose.yml"), [
      "services:",
      "  db:",
      "    image: postgres:16",
    ].join("\n"));
    mocks.listBuilderManagedProcesses.mockReturnValue({ processes: [], total: 0, returned: 0 });
    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify([{ Service: "db", State: "running", Health: "healthy", ID: "container-1", Publishers: [] }]),
      stderr: "",
    });

    const containers = listBuilderRuntimeContainers({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      packageManager: "NPM",
    });
    const inspection = getBuilderRuntimeContainer({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      packageManager: "NPM",
      serviceId: "compose:compose.yml:db",
    });

    expect(containers).toEqual([
      expect.objectContaining({
        serviceId: "compose:compose.yml:db",
        containerId: "container-1",
        status: "running",
      }),
    ]);
    expect(inspection).toEqual(expect.objectContaining({
      composeServiceName: "db",
      container: expect.objectContaining({ containerId: "container-1" }),
    }));
  });

  it("reads container logs and file metadata for compose-backed services", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    process.env.BIZBOT_BUILDER_ALLOWED_CONTAINER_PATH_PREFIXES = "/workspace";
    fs.mkdirSync(path.join(workspaceRoot, "projects", "demo"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "projects", "demo", "compose.yml"), [
      "services:",
      "  app:",
      "    image: alpine:3.20",
    ].join("\n"));
    mocks.listBuilderManagedProcesses.mockReturnValue({ processes: [], total: 0, returned: 0 });
    mocks.spawnSync
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify([{ Service: "app", State: "running", Health: "healthy", ID: "container-app", Publishers: [] }]), stderr: "" })
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify([{ Service: "app", State: "running", Health: "healthy", ID: "container-app", Publishers: [] }]), stderr: "" })
      .mockReturnValueOnce({ status: 0, stdout: "2025-01-01T00:00:00Z app | ready\n", stderr: "" });
    mocks.runBuilderCommand
      .mockResolvedValueOnce({ ok: true, command: "docker", args: [], cwd: "projects/demo", exitCode: 0, signal: null, stdout: "file\t12\n", stderr: "", timedOut: false, cancelled: false })
      .mockResolvedValueOnce({ ok: true, command: "docker", args: [], cwd: "projects/demo", exitCode: 0, signal: null, stdout: "README.md\tf\t12\n", stderr: "", timedOut: false, cancelled: false })
      .mockResolvedValueOnce({ ok: true, command: "docker", args: [], cwd: "projects/demo", exitCode: 0, signal: null, stdout: "hello container", stderr: "", timedOut: false, cancelled: false });

    const logs = await getBuilderRuntimeContainerLogs({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      packageManager: "NPM",
      serviceId: "compose:compose.yml:app",
    });
    const stat = await statBuilderRuntimeContainerPath({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      packageManager: "NPM",
      serviceId: "compose:compose.yml:app",
      path: "/workspace/README.md",
    });
    const files = await listBuilderRuntimeContainerFiles({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      packageManager: "NPM",
      serviceId: "compose:compose.yml:app",
      path: "/workspace",
    });
    const file = await readBuilderRuntimeContainerFile({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      packageManager: "NPM",
      serviceId: "compose:compose.yml:app",
      path: "/workspace/README.md",
      maxBytes: 32,
    });

    expect(logs.logs).toContain("ready");
    expect(stat).toEqual(expect.objectContaining({ exists: true, type: "file", size: 12 }));
    expect(files.entries).toEqual([expect.objectContaining({ name: "README.md", type: "file" })]);
    expect(file).toEqual(expect.objectContaining({ content: "hello container", truncated: false }));
  });

  it("enforces allowlists for compose-backed container exec and test helpers", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;
    process.env.BIZBOT_BUILDER_ALLOWED_CONTAINER_COMMANDS = "node";
    process.env.BIZBOT_BUILDER_ALLOWED_CONTAINER_TEST_PRESETS = "npm_test";
    fs.mkdirSync(path.join(workspaceRoot, "projects", "demo"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "projects", "demo", "compose.yml"), [
      "services:",
      "  app:",
      "    image: node:22-alpine",
    ].join("\n"));
    mocks.listBuilderManagedProcesses.mockReturnValue({ processes: [], total: 0, returned: 0 });
    mocks.spawnSync.mockReturnValue({ status: 0, stdout: JSON.stringify([{ Service: "app", State: "running", Health: "healthy", ID: "container-app", Publishers: [] }]), stderr: "" });
    mocks.runBuilderCommand
      .mockResolvedValueOnce({ ok: true, command: "docker", args: [], cwd: "projects/demo", exitCode: 0, signal: null, stdout: "v22.0.0", stderr: "", timedOut: false, cancelled: false })
      .mockResolvedValueOnce({ ok: true, command: "docker", args: [], cwd: "projects/demo", exitCode: 0, signal: null, stdout: "tests ok", stderr: "", timedOut: false, cancelled: false });

    const execResult = await execBuilderRuntimeContainerCommand({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      packageManager: "NPM",
      serviceId: "compose:compose.yml:app",
      command: "node",
      commandArgs: ["--version"],
    });
    const testResult = await testBuilderRuntimeContainer({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      packageManager: "NPM",
      serviceId: "compose:compose.yml:app",
      preset: "npm_test",
    });

    await expect(() => execBuilderRuntimeContainerCommand({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      packageManager: "NPM",
      serviceId: "compose:compose.yml:app",
      command: "python",
    })).rejects.toThrow("Builder container command not allowed");
    await expect(() => testBuilderRuntimeContainer({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      packageManager: "NPM",
      serviceId: "compose:compose.yml:app",
      preset: "pytest",
    })).rejects.toThrow("Builder container test preset not allowed");

    expect(execResult.status).toBe("completed");
    expect(testResult.status).toBe("completed");
  });

  it("lists Builder-managed and legacy Builder test-fixture containers", async () => {
    mocks.runBuilderCommand
      .mockResolvedValueOnce({ ok: true, command: "docker", args: [], cwd: ".", exitCode: 0, signal: null, stdout: "container-a\n", stderr: "", timedOut: false, cancelled: false })
      .mockResolvedValueOnce({ ok: true, command: "docker", args: [], cwd: ".", exitCode: 0, signal: null, stdout: "container-a\ncontainer-b\ncontainer-c\n", stderr: "", timedOut: false, cancelled: false })
      .mockResolvedValueOnce({
        ok: true,
        command: "docker",
        args: [],
        cwd: ".",
        exitCode: 0,
        signal: null,
        stdout: JSON.stringify([
          {
            Id: "container-a",
            Name: "/demo-app-1",
            Created: "2025-04-15T00:00:00.000Z",
            State: { Status: "running", Running: true },
            Config: {
              Image: "node:22-alpine",
              Labels: {
                "bizbot.builder.managed": "true",
                "bizbot.builder.project_id": "project-1",
                "bizbot.builder.relative_path": "projects/demo",
                "bizbot.builder.service_id": "compose:compose.yml:app",
                "bizbot.builder.template": "next-app",
                "com.docker.compose.project": "demo-app",
                "com.docker.compose.service": "app",
                "com.docker.compose.project.working_dir": "C:/temp/project",
              },
            },
          },
          {
            Id: "container-b",
            Name: "/container-mcp-demo-old-app-1",
            Created: "2025-04-14T00:00:00.000Z",
            State: { Status: "exited", Running: false },
            Config: {
              Image: "node:22-alpine",
              Labels: {
                "com.docker.compose.project": "container-mcp-demo-old",
                "com.docker.compose.service": "app",
                "com.docker.compose.project.working_dir": "C:\\Users\\test\\AppData\\Local\\Temp\\bizbot-mcp-builder-123\\workspace",
              },
            },
          },
          {
            Id: "container-c",
            Name: "/unrelated-app-1",
            Created: "2025-04-14T00:00:00.000Z",
            State: { Status: "running", Running: true },
            Config: {
              Image: "nginx:latest",
              Labels: {
                "com.docker.compose.project": "other-stack",
                "com.docker.compose.project.working_dir": "C:/temp/other",
              },
            },
          },
        ]),
        stderr: "",
        timedOut: false,
        cancelled: false,
      });

    const result = await listBuilderManagedContainers({ status: "all" });

    expect(result.total).toBe(2);
    expect(result.containers).toEqual([
      expect.objectContaining({ containerId: "container-b", ownership: "legacy_test_fixture", running: false }),
      expect.objectContaining({ containerId: "container-a", ownership: "builder_managed", projectId: "project-1", serviceId: "compose:compose.yml:app" }),
    ]);
  });

  it("removes only matched managed containers", async () => {
    mocks.runBuilderCommand
      .mockResolvedValueOnce({ ok: true, command: "docker", args: [], cwd: ".", exitCode: 0, signal: null, stdout: "container-a\n", stderr: "", timedOut: false, cancelled: false })
      .mockResolvedValueOnce({ ok: true, command: "docker", args: [], cwd: ".", exitCode: 0, signal: null, stdout: "container-a\ncontainer-b\n", stderr: "", timedOut: false, cancelled: false })
      .mockResolvedValueOnce({
        ok: true,
        command: "docker",
        args: [],
        cwd: ".",
        exitCode: 0,
        signal: null,
        stdout: JSON.stringify([
          {
            Id: "container-a",
            Name: "/demo-app-1",
            Created: "2025-04-15T00:00:00.000Z",
            State: { Status: "exited", Running: false },
            Config: {
              Image: "node:22-alpine",
              Labels: {
                "bizbot.builder.managed": "true",
                "bizbot.builder.project_id": "project-1",
              },
            },
          },
          {
            Id: "container-b",
            Name: "/demo-app-2",
            Created: "2025-04-15T00:00:00.000Z",
            State: { Status: "exited", Running: false },
            Config: {
              Image: "node:22-alpine",
              Labels: {
                "bizbot.builder.managed": "true",
                "bizbot.builder.project_id": "project-2",
              },
            },
          },
        ]),
        stderr: "",
        timedOut: false,
        cancelled: false,
      })
      .mockResolvedValueOnce({ ok: true, command: "docker", args: [], cwd: ".", exitCode: 0, signal: null, stdout: "container-a\n", stderr: "", timedOut: false, cancelled: false });

    const result = await removeBuilderManagedContainers({ containerIds: ["container-a"] });

    expect(result).toEqual(expect.objectContaining({
      removedContainerIds: ["container-a"],
      skippedContainerIds: [],
      totalMatched: 1,
    }));
    expect(mocks.runBuilderCommand).toHaveBeenLastCalledWith("docker", ["rm", "-f", "container-a"], expect.objectContaining({ cwd: "." }));
  });
});