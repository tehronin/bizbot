import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

function waitForStartup(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for stdio MCP startup."));
    }, 15_000);

    const onData = (chunk: Buffer | string) => {
      const text = String(chunk);
      if (text.includes("[bizbot-mcp] stdio server started")) {
        clearTimeout(timeout);
        child.stderr?.off("data", onData);
        resolve();
      }
    };

    child.once("error", (error) => {
      clearTimeout(timeout);
      child.stderr?.off("data", onData);
      reject(error);
    });

    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      child.stderr?.off("data", onData);
      reject(new Error(`stdio MCP exited before startup (code=${code ?? "null"}, signal=${signal ?? "null"}).`));
    });

    child.stderr?.on("data", onData);
  });
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Timed out waiting for stdio MCP shutdown after stdin closed."));
    }, 15_000);

    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

describe("stdio MCP host lifecycle", () => {
  it("shuts down cleanly when the stdio client disconnects", async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "bizbot-mcp-stdio-"));
    const homeDir = path.join(tempRoot, "home");
    const builderDir = path.join(tempRoot, "builder");
    const child = spawn(
      process.execPath,
      ["./node_modules/tsx/dist/cli.mjs", "scripts/mcp-stdio.mjs"],
      {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: "test",
          BIZBOT_HOME_DIR: homeDir,
          BIZBOT_BUILDER_WORKSPACE_PATH: builderDir,
          BIZBOT_DISABLE_QUERY_LOGS: "true",
        },
      },
    );

    try {
      await waitForStartup(child);
      child.stdin?.end();
      const exit = await waitForExit(child);
      expect(exit.signal).toBeNull();
      expect(exit.code).toBe(0);
    } finally {
      if (!child.killed && child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }
  }, 20_000);
});