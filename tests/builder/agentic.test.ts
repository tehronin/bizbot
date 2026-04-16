import type { BuilderProject } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBuilderCliProfile: vi.fn(),
  getBuilderConfig: vi.fn(),
  listBuilderFilesRecursive: vi.fn(),
  readBuilderFile: vi.fn(),
  runBuilderCliCommand: vi.fn(),
  npmRunScript: vi.fn(),
  pnpmRunScript: vi.fn(),
}));

vi.mock("@/lib/builder/cli-profiles", () => ({
  getBuilderCliProfile: mocks.getBuilderCliProfile,
}));

vi.mock("@/lib/builder/config", () => ({
  getBuilderConfig: mocks.getBuilderConfig,
}));

vi.mock("@/lib/builder/workspace", () => ({
  listBuilderFilesRecursive: mocks.listBuilderFilesRecursive,
  readBuilderFile: mocks.readBuilderFile,
  runBuilderCliCommand: mocks.runBuilderCliCommand,
}));

vi.mock("@/lib/builder/adapters/npm", () => ({
  npmRunScript: mocks.npmRunScript,
}));

vi.mock("@/lib/builder/adapters/pnpm", () => ({
  pnpmRunScript: mocks.pnpmRunScript,
}));

import { executeBuilderAgenticTask } from "@/lib/builder/agentic";

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
}>) {
  return {
    ok: true,
    command: "codex",
    args: [],
    cwd: "projects/demo",
    exitCode: 0,
    signal: null,
    stdout: "ok",
    stderr: "",
    timedOut: false,
    ...overrides,
  };
}

describe("builder agentic loop", () => {
  const project: BuilderProject = {
    id: "project-1",
    name: "Demo",
    slug: "demo",
    relativePath: "projects/demo",
    template: "vite-app",
    packageManager: "NPM",
    gitInitialized: true,
    archivedAt: null,
    lifecycle: "DRAFT",
    lastRunStatus: "IDLE",
    context: null,
    latestSessionSummary: null,
    createdAt: new Date("2026-03-31T00:00:00.000Z"),
    updatedAt: new Date("2026-03-31T00:00:00.000Z"),
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
      defaultAgenticProfile: "codex",
      agenticTimeoutSeconds: 900,
      agenticMaxIterations: 3,
    });
    mocks.getBuilderCliProfile.mockResolvedValue({
      key: "codex",
      displayName: "Codex CLI",
      command: "codex",
      enabled: true,
      supportsNonInteractive: true,
      metadata: {
        available: true,
        ready: true,
        readinessReason: null,
      },
    });
    mocks.listBuilderFilesRecursive.mockImplementation(() => Object.keys(virtualFiles).sort((left, right) => left.localeCompare(right)));
    mocks.readBuilderFile.mockImplementation((path: string) => {
      if (!(path in virtualFiles)) {
        throw new Error(`missing file ${path}`);
      }
      return virtualFiles[path];
    });
    mocks.pnpmRunScript.mockRejectedValue(new Error("pnpmRunScript should not be called in NPM tests"));
  });

  it("retries when verification fails and completes after a repair pass", async () => {
    const actPrompts: string[] = [];

    mocks.runBuilderCliCommand
      .mockImplementationOnce((_command: string, args: string[]) => {
        actPrompts.push(String(args.at(-1)));
        virtualFiles["projects/demo/src/index.ts"] = "export const value = 2;\n";
        return Promise.resolve(commandResult({ stdout: "attempt 1" }));
      })
      .mockImplementationOnce((_command: string, args: string[]) => {
        actPrompts.push(String(args.at(-1)));
        virtualFiles["projects/demo/src/index.ts"] = "export const value = 3;\n";
        return Promise.resolve(commandResult({ stdout: "attempt 2" }));
      });

    mocks.npmRunScript
      .mockResolvedValueOnce(commandResult({ ok: false, exitCode: 1, stdout: "", stderr: "build failed" }))
      .mockResolvedValueOnce(commandResult({ ok: true, stdout: "build ok" }))
      .mockResolvedValueOnce(commandResult({ ok: true, stdout: "test ok" }));

    const result = await executeBuilderAgenticTask(project, {
      profile: "codex",
      prompt: "Add a health check route and tests.",
    });

    expect(result.loop.finalVerdict).toBe("complete");
    expect(result.loop.verified).toBe(true);
    expect(result.loop.iterations).toHaveLength(2);
    expect(result.loop.iterations[0]?.review.verdict).toBe("retry");
    expect(result.loop.iterations[1]?.review.verdict).toBe("complete");
    expect(result.loop.iterations[0]?.changedFiles).toContain("projects/demo/src/index.ts");
    expect(actPrompts[1]).toContain("Previous builder attempt 1 did not finish cleanly.");
  });

  it("blocks when verification fails and no workspace changes are detected", async () => {
    mocks.runBuilderCliCommand.mockResolvedValue(commandResult({ stdout: "attempt 1" }));
    mocks.npmRunScript.mockResolvedValue(commandResult({ ok: false, exitCode: 1, stdout: "", stderr: "build failed" }));

    const result = await executeBuilderAgenticTask(project, {
      profile: "codex",
      prompt: "Fix the build.",
    });

    expect(result.loop.finalVerdict).toBe("blocked");
    expect(result.loop.iterations).toHaveLength(1);
    expect(result.loop.iterations[0]?.review.reason).toContain("did not detect workspace changes");
  });

  it("blocks after repeated low-signal retries do not improve verification", async () => {
    virtualFiles["projects/demo/package-lock.json"] = "{\n  \"lockfileVersion\": 3\n}\n";

    mocks.runBuilderCliCommand
      .mockImplementationOnce((_command: string, args: string[]) => {
        expect(String(args.at(-1))).toContain("Fix the build.");
        virtualFiles["projects/demo/package-lock.json"] = "{\n  \"lockfileVersion\": 3,\n  \"attempt\": 1\n}\n";
        return Promise.resolve(commandResult({ stdout: "attempt 1" }));
      })
      .mockImplementationOnce((_command: string, args: string[]) => {
        expect(String(args.at(-1))).toContain("Previous builder attempt 1 did not finish cleanly.");
        virtualFiles["projects/demo/package-lock.json"] = "{\n  \"lockfileVersion\": 3,\n  \"attempt\": 2\n}\n";
        return Promise.resolve(commandResult({ stdout: "attempt 2" }));
      });
    mocks.npmRunScript
      .mockResolvedValueOnce(commandResult({ ok: false, exitCode: 1, stdout: "", stderr: "build failed" }))
      .mockResolvedValueOnce(commandResult({ ok: false, exitCode: 1, stdout: "", stderr: "build failed" }));

    const result = await executeBuilderAgenticTask(project, {
      profile: "codex",
      prompt: "Fix the build.",
    });

    expect(result.loop.finalVerdict).toBe("blocked");
    expect(result.loop.iterations).toHaveLength(2);
    expect(result.loop.iterations[0]?.review.verdict).toBe("retry");
    expect(result.loop.iterations[1]?.review.reason).toContain("generated or bookkeeping changes");
  });

  it("completes with verification skipped when no deterministic scripts exist", async () => {
    delete virtualFiles["projects/demo/package.json"];
    mocks.runBuilderCliCommand.mockImplementationOnce(() => {
      virtualFiles["projects/demo/src/index.ts"] = "export const value = 4;\n";
      return Promise.resolve(commandResult({ stdout: "attempt 1" }));
    });
    mocks.npmRunScript.mockRejectedValue(new Error("npmRunScript should not be called when verification is skipped"));

    const result = await executeBuilderAgenticTask(project, {
      profile: "codex",
      prompt: "Refactor the entrypoint.",
    });

    expect(result.loop.finalVerdict).toBe("complete");
    expect(result.loop.verified).toBe(false);
    expect(result.loop.verificationSkipped).toBe(true);
    expect(result.loop.iterations[0]?.verification.skipped).toBe(true);
  });

  it("forces NODE_ENV=test when running the test verification script", async () => {
    mocks.runBuilderCliCommand.mockResolvedValue(commandResult({ stdout: "attempt 1" }));
    mocks.npmRunScript
      .mockResolvedValueOnce(commandResult({ ok: true, stdout: "build ok" }))
      .mockResolvedValueOnce(commandResult({ ok: true, stdout: "test ok" }));

    await executeBuilderAgenticTask(project, {
      profile: "codex",
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
});