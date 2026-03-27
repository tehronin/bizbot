import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const projectRoot = process.cwd();
const nextRoot = path.join(projectRoot, ".next");
const standaloneSource = path.join(nextRoot, "standalone");
const staticSource = path.join(nextRoot, "static");
const publicSource = path.join(projectRoot, "public");
const envExampleSource = path.join(projectRoot, ".env.example");
const serverBootstrapSource = path.join(projectRoot, "scripts", "server-bootstrap.cjs");
const workerEntrySource = path.join(projectRoot, "src", "workers", "agent-worker.ts");
const tauriResourcesRoot = path.join(projectRoot, "src-tauri", "resources");
const standaloneTarget = path.join(tauriResourcesRoot, "standalone");
const staticTarget = path.join(standaloneTarget, ".next", "static");
const publicTarget = path.join(standaloneTarget, "public");
const envExampleTarget = path.join(tauriResourcesRoot, ".env.example");
const serverBootstrapTarget = path.join(standaloneTarget, "server-bootstrap.cjs");
const workerTarget = path.join(standaloneTarget, "worker.cjs");

if (!fs.existsSync(standaloneSource)) {
  throw new Error("Missing .next/standalone. Run `npm run build:web` before preparing Tauri resources.");
}

fs.rmSync(tauriResourcesRoot, { recursive: true, force: true });
fs.mkdirSync(tauriResourcesRoot, { recursive: true });

fs.cpSync(standaloneSource, standaloneTarget, { recursive: true });

if (fs.existsSync(staticSource)) {
  fs.mkdirSync(path.dirname(staticTarget), { recursive: true });
  fs.cpSync(staticSource, staticTarget, { recursive: true });
}

if (fs.existsSync(publicSource)) {
  fs.cpSync(publicSource, publicTarget, { recursive: true });
}

if (fs.existsSync(envExampleSource)) {
  fs.copyFileSync(envExampleSource, envExampleTarget);
}

fs.copyFileSync(serverBootstrapSource, serverBootstrapTarget);

await build({
  entryPoints: [workerEntrySource],
  outfile: workerTarget,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: ["node20"],
  tsconfig: path.join(projectRoot, "tsconfig.json"),
  external: ["@prisma/client"],
  sourcemap: false,
  logLevel: "info",
});