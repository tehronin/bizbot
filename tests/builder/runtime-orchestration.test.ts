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
  execBuilderRuntimeServiceCommand,
  getBuilderRuntimeInspectionOverview,
  previewBuilderRuntimeServiceLogs,
  restartBuilderRuntimeService,
  startBuilderRuntimeService,
  stopBuilderRuntimeService,
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
    mocks.spawnSync.mockReturnValue({ status: 0, stdout: "[]", stderr: "" });
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
});