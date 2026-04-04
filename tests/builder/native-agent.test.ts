import type { BuilderProject } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeAgentConversation: vi.fn(),
  getBuilderConfig: vi.fn(),
  resolveBuilderWorkspacePath: vi.fn(),
  listBuilderFilesRecursive: vi.fn(),
  readBuilderFile: vi.fn(),
  npmInstall: vi.fn(),
  npmRunScript: vi.fn(),
  pnpmInstall: vi.fn(),
  pnpmRunScript: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, existsSync: mocks.existsSync };
});

vi.mock("@/lib/agent/executor", () => ({
  executeAgentConversation: mocks.executeAgentConversation,
}));

vi.mock("@/lib/builder/config", () => ({
  getBuilderConfig: mocks.getBuilderConfig,
  resolveBuilderWorkspacePath: mocks.resolveBuilderWorkspacePath,
}));

vi.mock("@/lib/builder/workspace", () => ({
  listBuilderFilesRecursive: mocks.listBuilderFilesRecursive,
  readBuilderFile: mocks.readBuilderFile,
}));

vi.mock("@/lib/builder/adapters/npm", () => ({
  npmInstall: mocks.npmInstall,
  npmRunScript: mocks.npmRunScript,
}));

vi.mock("@/lib/builder/adapters/pnpm", () => ({
  pnpmInstall: mocks.pnpmInstall,
  pnpmRunScript: mocks.pnpmRunScript,
}));

import { executeNativeBuilderTask } from "@/lib/builder/native-agent";

function commandResult(overrides?: Partial<{
  ok: boolean;
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
}>) {
  return {
    ok: true,
    command: "npm",
    args: [],
    cwd: "projects/demo",
    exitCode: 0,
    signal: null,
    stdout: "ok",
    stderr: "",
    timedOut: false,
    cancelled: false,
    ...overrides,
  };
}

describe("native builder agent", () => {
  const project: BuilderProject = {
    id: "project-1",
    name: "Demo",
    slug: "demo",
    relativePath: "projects/demo",
    template: "vite-app",
    packageManager: "NPM",
    gitInitialized: true,
    lifecycle: "DRAFT",
    lastRunStatus: "IDLE",
    context: null,
    latestSessionSummary: null,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
  };

  let virtualFiles: Record<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();

    virtualFiles = {
      "projects/demo/package.json": JSON.stringify({
        name: "demo",
        scripts: {
          build: "tsc -p tsconfig.json",
          test: "vitest run",
        },
      }),
      "projects/demo/src/index.ts": "export const value = 1;\n",
    };

    mocks.getBuilderConfig.mockReturnValue({
      agenticTimeoutSeconds: 60,
      agenticMaxIterations: 3,
    });
    mocks.listBuilderFilesRecursive.mockImplementation(() => Object.keys(virtualFiles).sort((left, right) => left.localeCompare(right)));
    mocks.readBuilderFile.mockImplementation((filePath: string) => {
      if (!(filePath in virtualFiles)) {
        throw new Error(`missing file ${filePath}`);
      }
      return virtualFiles[filePath];
    });
    mocks.pnpmRunScript.mockRejectedValue(new Error("pnpmRunScript should not be called in NPM tests"));
    mocks.pnpmInstall.mockRejectedValue(new Error("pnpmInstall should not be called in NPM tests"));
    mocks.existsSync.mockReturnValue(true);
    mocks.resolveBuilderWorkspacePath.mockImplementation((p: string) => `/workspace/${p}`);
  });

  it("retries through the native builder operator when verification fails on the first pass", async () => {
    mocks.executeAgentConversation
      .mockImplementationOnce(async ({ forcedProfile, message, onEvent }: { forcedProfile: string; message: string; onEvent?: (event: unknown) => Promise<void> }) => {
        expect(forcedProfile).toBe("builder_operator");
        expect(message).toContain("Builder project id: project-1");
        virtualFiles["projects/demo/src/index.ts"] = "export const value = 2;\n";
        await onEvent?.({ type: "status", message: "Inspecting workspace." });
        await onEvent?.({ type: "tool_call", round: 1, toolCallId: "call-1", name: "builder_write_file", args: { projectId: "project-1" } });
        await onEvent?.({ type: "tool_result", round: 1, toolCallId: "call-1", name: "builder_write_file", result: "ok" });
        return {
          reply: "Implemented the first pass.",
          runId: "run-1",
          conversationId: "conv-1",
          profile: "builder_operator",
          provider: "google",
          model: "gemini-3-flash-preview",
        };
      })
      .mockImplementationOnce(async ({ onEvent }: { onEvent?: (event: unknown) => Promise<void> }) => {
        virtualFiles["projects/demo/src/index.ts"] = "export const value = 3;\n";
        await onEvent?.({ type: "status", message: "Repairing verification failure." });
        return {
          reply: "Repaired the failing validation.",
          runId: "run-2",
          conversationId: "conv-2",
          profile: "builder_operator",
          provider: "google",
          model: "gemini-3-flash-preview",
        };
      });

    mocks.npmRunScript
      .mockResolvedValueOnce(commandResult({ ok: false, exitCode: 1, stdout: "", stderr: "build failed" }))
      .mockResolvedValueOnce(commandResult({ ok: true, stdout: "build ok" }))
      .mockResolvedValueOnce(commandResult({ ok: true, stdout: "test ok" }));

    const result = await executeNativeBuilderTask(project, {
      prompt: "Add a health check route and tests.",
    });

    expect(result.loop.finalVerdict).toBe("complete");
    expect(result.loop.verified).toBe(true);
    expect(result.loop.iterations).toHaveLength(2);
    expect(result.loop.iterations[0]?.review.verdict).toBe("retry");
    expect(result.loop.iterations[1]?.review.verdict).toBe("complete");
    expect(result.loop.iterations[0]?.changedFiles).toContain("projects/demo/src/index.ts");
  });

  it("blocks when the native builder agent does not change the workspace", async () => {
    mocks.executeAgentConversation.mockResolvedValue({
      reply: "I inspected the project.",
      runId: "run-1",
      conversationId: "conv-1",
      profile: "builder_operator",
      provider: "google",
      model: "gemini-3-flash-preview",
    });
    mocks.npmRunScript.mockResolvedValue(commandResult({ ok: false, exitCode: 1, stdout: "", stderr: "build failed" }));

    const result = await executeNativeBuilderTask(project, {
      prompt: "Fix the build.",
    });

    expect(result.loop.finalVerdict).toBe("blocked");
    expect(result.loop.iterations).toHaveLength(1);
    expect(result.loop.iterations[0]?.review.verdict).toBe("blocked");
  });

  it("blocks after repeated low-signal retries do not improve verification", async () => {
    virtualFiles["projects/demo/package-lock.json"] = "{\n  \"lockfileVersion\": 3\n}\n";

    mocks.executeAgentConversation
      .mockImplementationOnce(async () => {
        virtualFiles["projects/demo/package-lock.json"] = "{\n  \"lockfileVersion\": 3,\n  \"attempt\": 1\n}\n";
        return {
          reply: "Adjusted package metadata.",
          runId: "run-1",
          conversationId: "conv-1",
          profile: "builder_operator",
          provider: "google",
          model: "gemini-3-flash-preview",
        };
      })
      .mockImplementationOnce(async () => {
        virtualFiles["projects/demo/package-lock.json"] = "{\n  \"lockfileVersion\": 3,\n  \"attempt\": 2\n}\n";
        return {
          reply: "Adjusted package metadata again.",
          runId: "run-2",
          conversationId: "conv-2",
          profile: "builder_operator",
          provider: "google",
          model: "gemini-3-flash-preview",
        };
      });

    mocks.npmRunScript
      .mockResolvedValueOnce(commandResult({ ok: false, exitCode: 1, stdout: "", stderr: "build failed" }))
      .mockResolvedValueOnce(commandResult({ ok: false, exitCode: 1, stdout: "", stderr: "build failed" }));

    const result = await executeNativeBuilderTask(project, {
      prompt: "Fix the build.",
    });

    expect(result.loop.finalVerdict).toBe("blocked");
    expect(result.loop.iterations).toHaveLength(2);
    expect(result.loop.iterations[0]?.review.verdict).toBe("retry");
    expect(result.loop.iterations[1]?.review.reason).toContain("generated or bookkeeping changes");
  });

  it("streams preflight executor output through progress events before the builder operator finishes", async () => {
    const onProgress = vi.fn();

    mocks.executeAgentConversation.mockImplementation(async ({ onEvent }: { onEvent?: (event: unknown) => Promise<void> }) => {
      await onEvent?.({ type: "status", message: "Preparing agent conversation state." });
      await onEvent?.({ type: "status", message: "Initializing MCP clients." });
      return {
        reply: "Built the page.",
        runId: "run-1",
        conversationId: "conv-1",
        profile: "builder_operator",
        provider: "google",
        model: "gemini-3-flash-preview",
      };
    });
    mocks.npmRunScript
      .mockResolvedValueOnce(commandResult({ ok: true, stdout: "build ok" }))
      .mockResolvedValueOnce(commandResult({ ok: true, stdout: "test ok" }));

    await executeNativeBuilderTask(project, {
      prompt: "Build a hello world page.",
    }, {
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      latestResult: expect.objectContaining({
        stdout: expect.stringContaining("[status] Preparing agent conversation state."),
      }),
    }));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      latestResult: expect.objectContaining({
        stdout: expect.stringContaining("[status] Initializing MCP clients."),
      }),
    }));
  });

  it("forces NODE_ENV=test when running the test verification script", async () => {
    mocks.executeAgentConversation.mockImplementation(async () => ({
      reply: "Added tests.",
      runId: "run-1",
      conversationId: "conv-1",
      profile: "builder_operator",
      provider: "google",
      model: "gemini-3-flash-preview",
    }));
    mocks.npmRunScript
      .mockResolvedValueOnce(commandResult({ ok: true, stdout: "build ok" }))
      .mockResolvedValueOnce(commandResult({ ok: true, stdout: "test ok" }));

    await executeNativeBuilderTask(project, {
      prompt: "Add endpoint tests.",
    });

    expect(mocks.npmRunScript).toHaveBeenNthCalledWith(
      1,
      "projects/demo",
      "build",
      [],
      expect.not.objectContaining({
        env: expect.objectContaining({ NODE_ENV: "test" }),
      }),
    );
    expect(mocks.npmRunScript).toHaveBeenNthCalledWith(
      2,
      "projects/demo",
      "test",
      [],
      expect.objectContaining({
        env: expect.objectContaining({ NODE_ENV: "test" }),
      }),
    );
  });

  it("skips deterministic verification for analysis-only manual-review tasks", async () => {
    mocks.executeAgentConversation.mockImplementation(async () => ({
      reply: "Captured the API contract.",
      runId: "run-1",
      conversationId: "conv-1",
      profile: "builder_operator",
      provider: "google",
      model: "gemini-3-flash-preview",
    }));

    const result = await executeNativeBuilderTask(project, {
      prompt: "Capture runtime and endpoint decisions.",
    }, {
      verification: {
        mode: "analysis_only",
        validators: ["MANUAL_REVIEW"],
      },
    });

    expect(result.loop.finalVerdict).toBe("complete");
    expect(result.loop.verificationSkipped).toBe(true);
    expect(result.loop.selectedScripts).toEqual([]);
    expect(mocks.npmRunScript).not.toHaveBeenCalled();
  });
});