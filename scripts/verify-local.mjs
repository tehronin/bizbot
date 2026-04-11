import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadLocalEnv } from "./load-local-env.mjs";

const workspaceRoot = process.cwd();
const env = loadLocalEnv({ workspaceRoot, env: { ...process.env } });
const verifyArtifactsDir = path.join(workspaceRoot, "test-results", "verify-local");

if (process.platform === "win32" && !env.PRISMA_CLIENT_ENGINE_TYPE) {
  env.PRISMA_CLIENT_ENGINE_TYPE = "binary";
}

async function ensureRuntimeDirectories() {
  await fs.mkdir(verifyArtifactsDir, { recursive: true });

  if (!env.BIZBOT_HOME_DIR) {
    env.BIZBOT_HOME_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "bizbot-home-"));
  }

  if (!env.BIZBOT_BUILDER_WORKSPACE_PATH) {
    env.BIZBOT_BUILDER_WORKSPACE_PATH = await fs.mkdtemp(path.join(os.tmpdir(), "bizbot-builder-workspace-"));
  }
}

function getExecutable(name) {
  if (process.platform !== "win32") {
    return name;
  }

  if (name === "npm") {
    return "npm.cmd";
  }

  if (name === "npx") {
    return "npx.cmd";
  }

  return `${name}.exe`;
}

async function runCommand(command, args, label) {
  await new Promise((resolve, reject) => {
    const useShell = process.platform === "win32" && /\.cmd$/i.test(command);
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env,
      stdio: "inherit",
      shell: useShell,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${label} exited from signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${label} failed with exit code ${code ?? "unknown"}`));
        return;
      }

      resolve();
    });
  });
}

async function captureComposeLogs() {
  const outputPath = path.join(verifyArtifactsDir, "docker-compose.log");
  const stream = fsSync.createWriteStream(outputPath, { encoding: "utf8" });

  await new Promise((resolve, reject) => {
    const child = spawn(getExecutable("docker"), ["compose", "logs", "--no-color"], {
      cwd: workspaceRoot,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
      stream.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stream.write(chunk);
    });

    child.on("error", (error) => {
      stream.end();
      reject(error);
    });
    child.on("exit", () => {
      stream.end(() => resolve());
    });
  });

  return outputPath;
}

async function main() {
  await ensureRuntimeDirectories();

  let infrastructureStarted = false;
  try {
    console.log("[verify:local] starting Docker infrastructure");
    await runCommand(getExecutable("docker"), ["compose", "up", "-d"], "docker compose up");
    infrastructureStarted = true;

    console.log("[verify:local] generating Prisma client");
    await runCommand(getExecutable("npx"), ["prisma", "generate"], "prisma generate");

    console.log("[verify:local] syncing Prisma schema");
    await runCommand(getExecutable("npx"), ["prisma", "db", "push", "--skip-generate"], "prisma db push");

    console.log("[verify:local] running app tests");
    await runCommand(getExecutable("npm"), ["run", "test:app"], "test:app");

    console.log("[verify:local] running MCP sampling tests");
    await runCommand(getExecutable("npm"), ["run", "test:mcp:sampling"], "test:mcp:sampling");

    console.log("[verify:local] running Builder Playwright spec");
    await runCommand(getExecutable("npm"), ["run", "test:e2e:builder"], "test:e2e:builder");

    console.log("[verify:local] completed successfully");
  } catch (error) {
    if (infrastructureStarted) {
      const logsPath = await captureComposeLogs();
      console.error(`[verify:local] captured Docker logs at ${logsPath}`);
    }
    throw error;
  } finally {
    if (infrastructureStarted) {
      console.log("[verify:local] stopping Docker infrastructure");
      try {
        await runCommand(getExecutable("docker"), ["compose", "down", "-v"], "docker compose down");
      } catch (error) {
        console.error("[verify:local] failed to stop Docker infrastructure", error);
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});