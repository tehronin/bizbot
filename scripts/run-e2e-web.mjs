import path from "node:path";
import { spawn } from "node:child_process";
import { loadLocalEnv } from "./load-local-env.mjs";

const workspaceRoot = process.cwd();

const env = loadLocalEnv({ workspaceRoot, env: { ...process.env } });

if (process.platform === "win32" && !env.PRISMA_CLIENT_ENGINE_TYPE) {
  env.PRISMA_CLIENT_ENGINE_TYPE = "binary";
}

const nextBin = path.join(workspaceRoot, "node_modules", "next", "dist", "bin", "next");

const child = spawn(process.execPath, [nextBin, "dev", "--port", "3200"], {
  stdio: "inherit",
  shell: false,
  env: {
    ...env,
    BIZBOT_PLUGIN_ORACLE_ENABLED: env.BIZBOT_PLUGIN_ORACLE_ENABLED ?? "true",
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});