import { spawn } from "node:child_process";

const mode = process.argv[2] ?? "dev";

const modeMap = {
  dev: {
    label: "dev",
    processes: [
      { name: "web", script: "dev:web" },
      { name: "worker", script: "worker" },
    ],
  },
  start: {
    label: "start",
    processes: [
      { name: "web", script: "start:web" },
      { name: "worker", script: "worker" },
    ],
  },
};

if (!(mode in modeMap)) {
  console.error(`[stack] unknown mode: ${mode}`);
  process.exit(1);
}

const config = modeMap[mode];
const npmExecPath = process.env.npm_execpath;
const children = [];
let shuttingDown = false;

if (!npmExecPath) {
  console.error("[stack] npm_execpath is not available in the environment");
  process.exit(1);
}

function killChild(child) {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    });
    killer.on("error", () => {
      child.kill("SIGTERM");
    });
    return;
  }

  child.kill("SIGTERM");
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    killChild(child.process);
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 250).unref();
}

for (const entry of config.processes) {
  const child = spawn(process.execPath, [npmExecPath, "run", entry.script], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });

  child.on("error", (error) => {
    console.error(`[stack] failed to start ${entry.name}:`, error);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (signal) {
      console.error(`[stack] ${entry.name} exited from signal ${signal}`);
      shutdown(1);
      return;
    }

    if ((code ?? 0) !== 0) {
      console.error(`[stack] ${entry.name} exited with code ${code}`);
      shutdown(code ?? 1);
      return;
    }

    console.error(`[stack] ${entry.name} exited unexpectedly`);
    shutdown(1);
  });

  children.push({ name: entry.name, process: child });
}

console.info(`[stack] ${config.label} supervisor started`);

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
