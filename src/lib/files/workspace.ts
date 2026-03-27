/**
 * files/workspace.ts — Safe local file operations confined to the workspace folder.
 * The workspace folder is defined by BIZBOT_WORKSPACE_PATH env variable.
 * All paths are resolved and validated against the workspace root to prevent
 * path traversal attacks.
 */

import fs from "fs";
import path from "path";
import { getAppHomeDir } from "@/lib/runtime-paths";

function getWorkspaceRoot(): string {
  const envPath = process.env.BIZBOT_WORKSPACE_PATH ?? "./workspace";
  const resolved = path.resolve(/* turbopackIgnore: true */ getAppHomeDir(), /* turbopackIgnore: true */ envPath);
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }
  return resolved;
}

/** Resolve a relative path and verify it stays within the workspace root. */
function safePath(relativePath: string): string {
  const root = getWorkspaceRoot();
  const resolved = path.resolve(root, relativePath);
  // Security: prevent path traversal
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Access denied: path escapes workspace root`);
  }
  return resolved;
}

export interface FileInfo {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modifiedAt?: Date;
}

/** List files and directories in a workspace subdirectory. */
export function listFiles(subdir = "."): FileInfo[] {
  const dir = safePath(subdir);
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.map((entry) => {
    const entryPath = path.join(dir, entry.name);
    const relativePath = path.relative(getWorkspaceRoot(), entryPath);
    if (entry.isDirectory()) {
      return { name: entry.name, path: relativePath, type: "directory" as const };
    }
    const stat = fs.statSync(entryPath);
    return {
      name: entry.name,
      path: relativePath,
      type: "file" as const,
      size: stat.size,
      modifiedAt: stat.mtime,
    };
  });
}

/** Read a text file from the workspace. */
export function readFile(relativePath: string): string {
  const absPath = safePath(relativePath);
  if (!fs.existsSync(absPath)) throw new Error(`File not found: ${relativePath}`);
  return fs.readFileSync(absPath, "utf-8");
}

/** Write content to a file in the workspace (creates file and directories if needed). */
export function writeFile(relativePath: string, content: string): void {
  const absPath = safePath(relativePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf-8");
}

/** Delete a file from the workspace. Directories are not deleted via this function. */
export function deleteFile(relativePath: string): void {
  const absPath = safePath(relativePath);
  if (!fs.existsSync(absPath)) throw new Error(`File not found: ${relativePath}`);
  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) throw new Error("Use deleteDirectory for directories");
  fs.unlinkSync(absPath);
}

/** Create a directory inside the workspace. */
export function createDirectory(relativePath: string): void {
  const absPath = safePath(relativePath);
  fs.mkdirSync(absPath, { recursive: true });
}

/** Get workspace root path (safe to display in UI). */
export function getWorkspacePath(): string {
  return getWorkspaceRoot();
}
