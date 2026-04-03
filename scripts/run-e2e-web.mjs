import path from "node:path";
import { spawn } from "node:child_process";

const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");

const child = spawn(process.execPath, [nextBin, "dev", "--port", "3200"], {
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    BIZBOT_PLUGIN_ORACLE_ENABLED: process.env.BIZBOT_PLUGIN_ORACLE_ENABLED ?? "true",
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});