/**
 * env.ts — Read and write the local .env file for storing credentials.
 * Runs only server-side (API routes). The .env file is the user's credential store.
 */

import fs from "fs";
import path from "path";

const ENV_PATH = path.resolve(process.cwd(), ".env");

/** Parse the .env file into a key-value map (skips comments & blank lines). */
function parseEnv(content: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1");
    map[key] = val;
  }
  return map;
}

/** Serialize a key-value map back to .env format, preserving comments. */
function serializeEnv(original: string, updates: Record<string, string>): string {
  const lines = original.split("\n");
  const applied = new Set<string>();

  const updated = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return line;
    const key = trimmed.slice(0, eq).trim();
    if (key in updates) {
      applied.add(key);
      return `${key}="${updates[key]}"`;
    }
    return line;
  });

  // Append any new keys not already in the file
  for (const [key, val] of Object.entries(updates)) {
    if (!applied.has(key)) {
      updated.push(`${key}="${val}"`);
    }
  }

  return updated.join("\n");
}

/** Read all env variables from the .env file. */
export function readEnv(): Record<string, string> {
  if (!fs.existsSync(ENV_PATH)) return {};
  const content = fs.readFileSync(ENV_PATH, "utf-8");
  return parseEnv(content);
}

/** Write / update one or more env variables in the .env file.
 *  Existing keys are updated in-place; new keys are appended.
 *  Values are always quoted. */
export function writeEnv(updates: Record<string, string>): void {
  const existing = fs.existsSync(ENV_PATH)
    ? fs.readFileSync(ENV_PATH, "utf-8")
    : "";
  const serialized = serializeEnv(existing, updates);
  fs.writeFileSync(ENV_PATH, serialized, "utf-8");
}

/** Return a masked version of env values for safe display in the UI.
 *  Short values (<= 4 chars) are fully masked. Longer values show first 4 chars + stars. */
export function maskEnvValues(
  env: Record<string, string>,
): Record<string, string> {
  const sensitivePatterns = [
    "KEY",
    "SECRET",
    "TOKEN",
    "PASSWORD",
    "PASS",
    "CREDENTIALS",
  ];
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(env)) {
    const isSensitive = sensitivePatterns.some((p) => key.toUpperCase().includes(p));
    if (isSensitive && val.length > 0) {
      result[key] = val.length <= 4 ? "****" : `${val.slice(0, 4)}${"*".repeat(Math.min(val.length - 4, 20))}`;
    } else {
      result[key] = val;
    }
  }
  return result;
}
