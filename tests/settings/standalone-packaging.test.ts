import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const prepareStandaloneScript = path.join(repoRoot, "scripts", "prepare-standalone.mjs");
const packageJsonPath = path.join(repoRoot, "package.json");

const tempDirs: string[] = [];

function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-standalone-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("standalone packaging", () => {
  it("copies public and static assets into the standalone bundle", () => {
    const workspace = createTempWorkspace();

    fs.mkdirSync(path.join(workspace, "public"), { recursive: true });
    fs.mkdirSync(path.join(workspace, ".next", "static", "chunks"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "public", "smoke.txt"), "public-asset");
    fs.writeFileSync(path.join(workspace, ".next", "static", "chunks", "app.js"), "static-asset");

    execFileSync(process.execPath, [prepareStandaloneScript], { cwd: workspace, stdio: "pipe" });

    expect(fs.readFileSync(path.join(workspace, ".next", "standalone", "public", "smoke.txt"), "utf8")).toBe("public-asset");
    expect(fs.readFileSync(path.join(workspace, ".next", "standalone", ".next", "static", "chunks", "app.js"), "utf8")).toBe("static-asset");
  });

  it("keeps package scripts pointed at the standalone production flow", () => {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.build).toBe("next build && node scripts/prepare-standalone.mjs");
    expect(packageJson.scripts?.["build:web"]).toBe("next build && node scripts/prepare-standalone.mjs");
    expect(packageJson.scripts?.["start:web"]).toBe("node .next/standalone/server.js");
  });
});