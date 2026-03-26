import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const nextRoot = path.join(projectRoot, ".next");
const standaloneSource = path.join(nextRoot, "standalone");
const staticSource = path.join(nextRoot, "static");
const publicSource = path.join(projectRoot, "public");
const tauriResourcesRoot = path.join(projectRoot, "src-tauri", "resources");
const standaloneTarget = path.join(tauriResourcesRoot, "standalone");
const staticTarget = path.join(standaloneTarget, ".next", "static");
const publicTarget = path.join(standaloneTarget, "public");

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