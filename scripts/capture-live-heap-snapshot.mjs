import fs from "node:fs";
import path from "node:path";

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getInspectorTargetUrl(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) {
    throw new Error(`Failed to query inspector target list on port ${port}.`);
  }

  const targets = await response.json();
  const target = Array.isArray(targets) ? targets.find((entry) => typeof entry?.webSocketDebuggerUrl === "string") : null;
  if (!target?.webSocketDebuggerUrl) {
    throw new Error(`No inspector target is available on port ${port}.`);
  }

  return target.webSocketDebuggerUrl;
}

async function captureHeapSnapshot({ pid, port, outputPath }) {
  process._debugProcess(pid);
  await delay(1500);

  const debuggerUrl = await getInspectorTargetUrl(port);
  const socket = new WebSocket(debuggerUrl);
  const output = fs.createWriteStream(outputPath, { encoding: "utf8" });
  let nextId = 1;
  const pending = new Map();

  const waitForOpen = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(String(event.data));

    if (payload.method === "HeapProfiler.addHeapSnapshotChunk" && payload.params?.chunk) {
      output.write(payload.params.chunk);
      return;
    }

    if (typeof payload.id === "number" && pending.has(payload.id)) {
      const { resolve, reject } = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) {
        reject(new Error(payload.error.message ?? "Inspector command failed."));
      } else {
        resolve(payload.result ?? null);
      }
    }
  });

  await waitForOpen;

  function send(method, params = {}) {
    const id = nextId++;
    const message = JSON.stringify({ id, method, params });
    socket.send(message);

    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  }

  try {
    await send("HeapProfiler.enable");
    await send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, exposeInternals: false });
  } finally {
    await new Promise((resolve) => output.end(resolve));
    socket.close();
  }
}

const rawPid = process.argv[2];
if (!rawPid) {
  console.error("Usage: node scripts/capture-live-heap-snapshot.mjs <pid> [outputPath] [port]");
  process.exit(1);
}

const pid = Number.parseInt(rawPid, 10);
if (!Number.isInteger(pid) || pid <= 0) {
  console.error(`Invalid pid: ${rawPid}`);
  process.exit(1);
}

const outputPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.resolve(`.bizbot/heapshots/next-dev-${pid}-${Date.now()}.heapsnapshot`);
const port = process.argv[4] ? Number.parseInt(process.argv[4], 10) : 9229;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });

captureHeapSnapshot({ pid, port, outputPath })
  .then(() => {
    console.log(JSON.stringify({ ok: true, pid, port, outputPath }, null, 2));
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });