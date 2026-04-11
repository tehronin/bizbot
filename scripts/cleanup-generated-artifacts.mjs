import { readdirSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const DEFAULT_OLDER_THAN_HOURS = 24;
const CANDIDATE_DIRECTORIES = [
  ".next",
  "test-results",
  "playwright-report",
  "coverage",
  ".turbo",
  "src-tauri/resources/standalone",
  "src-tauri/target/debug/standalone",
];

function parseArgs(argv) {
  let dryRun = false;
  let olderThanHours = DEFAULT_OLDER_THAN_HOURS;
  let includeFresh = false;

  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--include-fresh") {
      includeFresh = true;
      continue;
    }
    if (arg.startsWith("--older-than-hours=")) {
      const raw = arg.slice("--older-than-hours=".length);
      const parsed = Number.parseFloat(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`Invalid --older-than-hours value: ${raw}`);
      }
      olderThanHours = parsed;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { dryRun, olderThanHours, includeFresh };
}

function isIgnoredByGit(relativePath) {
  const result = spawnSync("git", ["check-ignore", "--no-index", "--", relativePath], {
    cwd: process.cwd(),
    encoding: "utf-8",
    windowsHide: true,
  });
  return result.status === 0;
}

function walkDirectoryMetrics(absolutePath) {
  const stack = [absolutePath];
  let latestMtimeMs = 0;
  let totalBytes = 0;
  let fileCount = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    const stat = statSync(current, { throwIfNoEntry: false });
    if (!stat) {
      continue;
    }
    latestMtimeMs = Math.max(latestMtimeMs, stat.mtimeMs);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        stack.push(path.join(current, entry.name));
      }
      continue;
    }
    totalBytes += stat.size;
    fileCount += 1;
  }

  return { latestMtimeMs, totalBytes, fileCount };
}

function formatAgeHours(ageMs) {
  return Math.round((ageMs / 36e5) * 10) / 10;
}

function formatSizeMB(totalBytes) {
  return Math.round((totalBytes / (1024 * 1024)) * 100) / 100;
}

function inspectCandidate(relativePath, options) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const exists = statSync(absolutePath, { throwIfNoEntry: false });
  if (!exists) {
    return {
      path: relativePath,
      status: "absent",
      ignored: false,
      eligible: false,
      reason: "not present",
    };
  }

  if (!exists.isDirectory()) {
    return {
      path: relativePath,
      status: "skipped",
      ignored: false,
      eligible: false,
      reason: "not a directory",
    };
  }

  const ignored = isIgnoredByGit(relativePath);
  if (!ignored) {
    return {
      path: relativePath,
      status: "skipped",
      ignored,
      eligible: false,
      reason: "not ignored by git",
    };
  }

  const metrics = walkDirectoryMetrics(absolutePath);
  const ageMs = Date.now() - metrics.latestMtimeMs;
  const ageHours = formatAgeHours(ageMs);
  const olderThanMs = options.olderThanHours * 36e5;
  const staleEnough = options.includeFresh || ageMs >= olderThanMs;

  return {
    path: relativePath,
    status: staleEnough ? (options.dryRun ? "would_delete" : "deleted") : "kept",
    ignored,
    eligible: staleEnough,
    reason: staleEnough ? undefined : `newer than ${options.olderThanHours}h threshold`,
    latestAgeHours: ageHours,
    sizeMB: formatSizeMB(metrics.totalBytes),
    fileCount: metrics.fileCount,
    absolutePath,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const results = [];

  for (const relativePath of CANDIDATE_DIRECTORIES) {
    const inspection = inspectCandidate(relativePath, options);
    results.push(inspection);
    if (inspection.eligible && !options.dryRun) {
      rmSync(inspection.absolutePath, { recursive: true, force: true });
    }
  }

  const summary = {
    dryRun: options.dryRun,
    olderThanHours: options.olderThanHours,
    includeFresh: options.includeFresh,
    deletedCount: results.filter((entry) => entry.status === "deleted").length,
    deletedSizeMB: Math.round(results.filter((entry) => entry.status === "deleted").reduce((sum, entry) => sum + (entry.sizeMB ?? 0), 0) * 100) / 100,
    results: results.map((entry) => {
      const next = { ...entry };
      delete next.absolutePath;
      return next;
    }),
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}