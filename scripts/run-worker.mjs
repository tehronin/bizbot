import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const currentFilePath = fileURLToPath(import.meta.url);
const scriptsDir = dirname(currentFilePath);
const workspaceDir = dirname(scriptsDir);

const env = { ...process.env };
if (process.platform === "win32" && !env.PRISMA_CLIENT_ENGINE_TYPE) {
  env.PRISMA_CLIENT_ENGINE_TYPE = "binary";
}

const child = spawn(
  process.execPath,
  [resolve(workspaceDir, "node_modules", "tsx", "dist", "cli.mjs"), "--env-file=.env", "src/workers/agent-worker.ts"],
  {
    cwd: workspaceDir,
    env,
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
