import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const standaloneDir = path.join(rootDir, ".next", "standalone");
const standaloneNextDir = path.join(standaloneDir, ".next");

function copyIfPresent(source, destination) {
  if (!existsSync(source)) {
    return;
  }

  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, force: true });
}

copyIfPresent(path.join(rootDir, "public"), path.join(standaloneDir, "public"));
copyIfPresent(path.join(rootDir, ".next", "static"), path.join(standaloneNextDir, "static"));
