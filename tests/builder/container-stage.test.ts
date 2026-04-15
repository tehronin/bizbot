import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBuilderRuntimeContainer: vi.fn(),
  startBuilderRuntimeService: vi.fn(),
  teardownBuilderRuntimeService: vi.fn(),
  statBuilderRuntimeContainerPath: vi.fn(),
  readBuilderRuntimeContainerFile: vi.fn(),
  execBuilderRuntimeContainerCommand: vi.fn(),
  getBuilderRuntimeContainerLogs: vi.fn(),
}));

vi.mock("@/lib/builder/runtime-orchestration", () => ({
  getBuilderRuntimeContainer: mocks.getBuilderRuntimeContainer,
  startBuilderRuntimeService: mocks.startBuilderRuntimeService,
  teardownBuilderRuntimeService: mocks.teardownBuilderRuntimeService,
  statBuilderRuntimeContainerPath: mocks.statBuilderRuntimeContainerPath,
  readBuilderRuntimeContainerFile: mocks.readBuilderRuntimeContainerFile,
  execBuilderRuntimeContainerCommand: mocks.execBuilderRuntimeContainerCommand,
  getBuilderRuntimeContainerLogs: mocks.getBuilderRuntimeContainerLogs,
}));

import { validateBuilderContainerStage } from "@/lib/builder/container-stage";

describe("builder container stage workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getBuilderRuntimeContainer
      .mockReturnValueOnce({
        container: { status: "declared", containerId: null },
        composeFile: "compose.yml",
        composeServiceName: "app",
        auditPath: "audit-before",
      })
      .mockReturnValueOnce({
        container: { status: "running", containerId: "container-1" },
        composeFile: "compose.yml",
        composeServiceName: "app",
        auditPath: "audit-inspect",
      });
    mocks.startBuilderRuntimeService.mockResolvedValue({
      status: "completed",
      message: "Started service app.",
      service: { containerId: "container-1" },
      auditPath: "audit-start",
    });
    mocks.teardownBuilderRuntimeService.mockResolvedValue({
      status: "completed",
      message: "Tore down compose project for service app.",
      service: { containerId: null },
      auditPath: "audit-stop",
    });
    mocks.statBuilderRuntimeContainerPath.mockResolvedValue({
      exists: true,
      type: "file",
      size: 12,
      auditPath: "audit-stat",
    });
    mocks.readBuilderRuntimeContainerFile.mockResolvedValue({
      content: '{"name":"demo"}',
      truncated: false,
      auditPath: "audit-read",
    });
    mocks.execBuilderRuntimeContainerCommand.mockResolvedValue({
      status: "completed",
      message: "Executed npm run build for service app.",
      commandResult: { exitCode: 0 },
      auditPath: "audit-exec",
    });
    mocks.getBuilderRuntimeContainerLogs.mockResolvedValue({
      logs: "build ok",
      auditPath: "audit-logs",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("validates the declared Docker-ready stage for a Builder template", async () => {
    const result = await validateBuilderContainerStage({
      project: {
        id: "project-1",
        template: "node-cli",
        relativePath: "projects/demo",
        packageManager: "NPM",
      },
    });

    expect(result).toEqual(expect.objectContaining({
      available: true,
      status: "passed",
      serviceId: "compose:compose.yml:app",
      startedService: true,
      stoppedService: true,
    }));
    expect(result.fileChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "/workspace/package.json", exists: true }),
      expect.objectContaining({ path: "/workspace/src/index.ts", exists: true }),
    ]));
    expect(result.scriptChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ script: "typecheck", passed: true, command: "npm run typecheck" }),
      expect.objectContaining({ script: "build", passed: true, command: "npm run build" }),
    ]));
    expect(mocks.teardownBuilderRuntimeService).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: "compose:compose.yml:app",
    }));
  });
});