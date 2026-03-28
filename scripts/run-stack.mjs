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
const childRecords = [];
let shuttingDown = false;
const webConflictStrategy = process.env.BIZBOT_DEV_WEB_CONFLICT === "replace" ? "replace" : "reuse";

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

function killProcessByPid(pid) {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" }).on("error", () => {});
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {}
}

function removeChildRecord(name) {
  const index = childRecords.findIndex((record) => record.name === name);
  if (index >= 0) {
    childRecords.splice(index, 1);
  }
}

function wireOutput(record, stream, writer) {
  if (!stream) {
    return;
  }

  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    writer.write(chunk);
    buffer += chunk;

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (record.name !== "web" || mode !== "dev") {
        continue;
      }

      if (line.includes("Another next dev server is already running.")) {
        record.nextConflictDetected = true;
      }

      const pidMatch = line.match(/- PID:\s+(\d+)/);
      if (pidMatch) {
        record.existingNextPid = Number(pidMatch[1]);
      }
    }
  });
}

function startEntry(entry) {
  const record = {
    name: entry.name,
    process: null,
    nextConflictDetected: false,
    existingNextPid: null,
    replacedExistingWeb: false,
  };

  const child = spawn(process.execPath, [npmExecPath, "run", entry.script], {
    cwd: process.cwd(),
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env,
  });

  record.process = child;
  wireOutput(record, child.stdout, process.stdout);
  wireOutput(record, child.stderr, process.stderr);

  child.on("error", (error) => {
    console.error(`[stack] failed to start ${entry.name}:`, error);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (entry.name === "web" && mode === "dev" && record.nextConflictDetected) {
      if (webConflictStrategy === "replace" && record.existingNextPid && !record.replacedExistingWeb) {
        record.replacedExistingWeb = true;
        console.info(`[stack] replacing existing Next dev server ${record.existingNextPid}`);
        killProcessByPid(record.existingNextPid);
        removeChildRecord(entry.name);
        setTimeout(() => {
          if (!shuttingDown) {
            childRecords.push(startEntry(entry));
          }
        }, 750).unref();
        return;
      }

      console.info(`[stack] reusing existing Next dev server${record.existingNextPid ? ` ${record.existingNextPid}` : ""}`);
      removeChildRecord(entry.name);
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

  return record;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of childRecords) {
    if (child.process) {
      killChild(child.process);
    }
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 250).unref();
}

for (const entry of config.processes) {
  childRecords.push(startEntry(entry));
}

console.info(`[stack] ${config.label} supervisor started`);

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
