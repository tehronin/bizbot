import { createHash } from "crypto";
import path from "path";
import type { BuilderPlannerCritiqueState } from "@/lib/builder/types";
import { readBuilderFile, writeBuilderFile } from "@/lib/builder/workspace";

const BUILDER_CACHE_VERSION = 1;
const CONTEXT_PACKET_CACHE_FILE = "context-packets.json";
const PLANNING_CACHE_FILE = "planning-latest.json";
const CACHE_STATS_FILE = "stats.json";

export interface BuilderProjectionArtifact {
  packetId: string;
  relativePath: string;
  content: string;
}

export interface BuilderContextPacketManifestEntry {
  packetId: string;
  relativePath: string;
  contentHash: string;
  bytes: number;
}

export interface BuilderContextPacketManifest {
  version: number;
  projectRelativePath: string;
  generatedAt: string;
  fingerprint: string;
  packets: BuilderContextPacketManifestEntry[];
}

export interface BuilderPlanningCacheArtifact {
  version: number;
  key: string;
  projectId: string;
  projectRelativePath: string;
  generatedAt: string;
  prompt: string;
  critique: BuilderPlannerCritiqueState;
}

export interface BuilderPlanningCacheStats {
  lookups: number;
  hits: number;
  misses: number;
  bypasses: number;
  writes: number;
  keyChanges: number;
  lastKey: string | null;
  lastLookupAt: string | null;
  lastWriteAt: string | null;
}

export interface BuilderProjectionCacheStats {
  syncs: number;
  filesWritten: number;
  filesSkipped: number;
  manifestWrites: number;
  manifestReused: number;
  lastSyncAt: string | null;
}

export interface BuilderCacheStats {
  version: number;
  projectRelativePath: string;
  updatedAt: string;
  planning: BuilderPlanningCacheStats;
  projection: BuilderProjectionCacheStats;
}

function cacheDir(projectRelativePath: string): string {
  return path.posix.join(projectRelativePath, ".builder", "cache");
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`);
  return `{${entries.join(",")}}`;
}

function hashValue(value: unknown): string {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function readOptionalJson<T>(relativePath: string): T | null {
  try {
    return JSON.parse(readBuilderFile(relativePath)) as T;
  } catch {
    return null;
  }
}

function defaultBuilderCacheStats(projectRelativePath: string): BuilderCacheStats {
  return {
    version: BUILDER_CACHE_VERSION,
    projectRelativePath,
    updatedAt: new Date().toISOString(),
    planning: {
      lookups: 0,
      hits: 0,
      misses: 0,
      bypasses: 0,
      writes: 0,
      keyChanges: 0,
      lastKey: null,
      lastLookupAt: null,
      lastWriteAt: null,
    },
    projection: {
      syncs: 0,
      filesWritten: 0,
      filesSkipped: 0,
      manifestWrites: 0,
      manifestReused: 0,
      lastSyncAt: null,
    },
  };
}

function writeBuilderCacheStats(stats: BuilderCacheStats): BuilderCacheStats {
  writeBuilderFile(path.posix.join(cacheDir(stats.projectRelativePath), CACHE_STATS_FILE), `${JSON.stringify(stats, null, 2)}\n`);
  return stats;
}

function updateBuilderCacheStats(
  projectRelativePath: string,
  updater: (stats: BuilderCacheStats, now: string) => BuilderCacheStats,
): BuilderCacheStats {
  const current = readOptionalJson<BuilderCacheStats>(path.posix.join(cacheDir(projectRelativePath), CACHE_STATS_FILE));
  const now = new Date().toISOString();
  const base = current && current.version === BUILDER_CACHE_VERSION
    ? current
    : defaultBuilderCacheStats(projectRelativePath);
  const next = updater(base, now);
  return writeBuilderCacheStats({
    ...next,
    version: BUILDER_CACHE_VERSION,
    projectRelativePath,
    updatedAt: now,
  });
}

export function buildBuilderPlanningCacheKey(input: {
  project: unknown;
  brief: unknown;
  architecture: unknown;
  mcpPlanningContext: unknown;
  dependencyPlanningContext: unknown;
  dependencyContext: unknown;
  fileTopologyPlanningContext: unknown;
  fileTopologyContext: unknown;
}): string {
  return hashValue(input);
}

export function buildBuilderReviewCacheKey(input: {
  taskId: string;
  projectId: string;
  status: string;
  stage: string;
  loop: unknown;
  config?: unknown;
  vcs?: unknown;
  process?: unknown;
  audit?: unknown;
  database?: unknown;
  runtime?: unknown;
  containerStage?: unknown;
  architecture?: unknown;
  adrAdjudication?: unknown;
}): string {
  return hashValue(input);
}

export function hashBuilderProjectionArtifactContent(content: string): string {
  return hashContent(content);
}

export function readBuilderContextPacketManifest(projectRelativePath: string): BuilderContextPacketManifest | null {
  return readOptionalJson<BuilderContextPacketManifest>(path.posix.join(cacheDir(projectRelativePath), CONTEXT_PACKET_CACHE_FILE));
}

export function readBuilderCacheStats(projectRelativePath: string): BuilderCacheStats {
  const stats = readOptionalJson<BuilderCacheStats>(path.posix.join(cacheDir(projectRelativePath), CACHE_STATS_FILE));
  if (!stats || stats.version !== BUILDER_CACHE_VERSION) {
    return defaultBuilderCacheStats(projectRelativePath);
  }
  return {
    ...defaultBuilderCacheStats(projectRelativePath),
    ...stats,
    planning: {
      ...defaultBuilderCacheStats(projectRelativePath).planning,
      ...stats.planning,
    },
    projection: {
      ...defaultBuilderCacheStats(projectRelativePath).projection,
      ...stats.projection,
    },
  };
}

export function recordBuilderPlanningCacheLookup(args: {
  projectRelativePath: string;
  key: string;
  outcome: "hit" | "miss" | "bypass";
}): BuilderCacheStats {
  return updateBuilderCacheStats(args.projectRelativePath, (stats, now) => ({
    ...stats,
    planning: {
      ...stats.planning,
      lookups: stats.planning.lookups + 1,
      hits: stats.planning.hits + (args.outcome === "hit" ? 1 : 0),
      misses: stats.planning.misses + (args.outcome === "miss" ? 1 : 0),
      bypasses: stats.planning.bypasses + (args.outcome === "bypass" ? 1 : 0),
      lastKey: args.key,
      lastLookupAt: now,
    },
  }));
}

export function recordBuilderPlanningCacheWrite(args: {
  projectRelativePath: string;
  key: string;
}): BuilderCacheStats {
  const previous = readBuilderPlanningCache({
    projectRelativePath: args.projectRelativePath,
    key: args.key,
  });
  const previousArtifact = previous ?? readOptionalJson<BuilderPlanningCacheArtifact>(path.posix.join(cacheDir(args.projectRelativePath), PLANNING_CACHE_FILE));
  return updateBuilderCacheStats(args.projectRelativePath, (stats, now) => ({
    ...stats,
    planning: {
      ...stats.planning,
      writes: stats.planning.writes + 1,
      keyChanges: stats.planning.keyChanges + (previousArtifact && previousArtifact.key !== args.key ? 1 : 0),
      lastKey: args.key,
      lastWriteAt: now,
    },
  }));
}

export function recordBuilderProjectionCacheSync(args: {
  projectRelativePath: string;
  filesWritten: number;
  filesSkipped: number;
  manifestReused: boolean;
}): BuilderCacheStats {
  return updateBuilderCacheStats(args.projectRelativePath, (stats, now) => ({
    ...stats,
    projection: {
      ...stats.projection,
      syncs: stats.projection.syncs + 1,
      filesWritten: stats.projection.filesWritten + args.filesWritten,
      filesSkipped: stats.projection.filesSkipped + args.filesSkipped,
      manifestWrites: stats.projection.manifestWrites + (args.manifestReused ? 0 : 1),
      manifestReused: stats.projection.manifestReused + (args.manifestReused ? 1 : 0),
      lastSyncAt: now,
    },
  }));
}

export function persistBuilderContextPacketCache(args: {
  projectRelativePath: string;
  artifacts: BuilderProjectionArtifact[];
}): { manifest: BuilderContextPacketManifest; reused: boolean } {
  const packets = args.artifacts.map((artifact) => ({
    packetId: artifact.packetId,
    relativePath: artifact.relativePath,
    contentHash: hashBuilderProjectionArtifactContent(artifact.content),
    bytes: Buffer.byteLength(artifact.content, "utf-8"),
  }));
  const manifest: BuilderContextPacketManifest = {
    version: BUILDER_CACHE_VERSION,
    projectRelativePath: args.projectRelativePath,
    generatedAt: new Date().toISOString(),
    fingerprint: hashValue(packets),
    packets,
  };
  const manifestPath = path.posix.join(cacheDir(args.projectRelativePath), CONTEXT_PACKET_CACHE_FILE);
  const previous = readBuilderContextPacketManifest(args.projectRelativePath);
  const reused = previous?.fingerprint === manifest.fingerprint;
  if (!reused) {
    writeBuilderFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return { manifest, reused };
}

export function readBuilderPlanningCache(args: {
  projectRelativePath: string;
  key: string;
}): BuilderPlanningCacheArtifact | null {
  const cache = readOptionalJson<BuilderPlanningCacheArtifact>(path.posix.join(cacheDir(args.projectRelativePath), PLANNING_CACHE_FILE));
  if (!cache || cache.version !== BUILDER_CACHE_VERSION || cache.key !== args.key) {
    return null;
  }
  return cache;
}

export function writeBuilderPlanningCache(args: {
  projectId: string;
  projectRelativePath: string;
  key: string;
  prompt: string;
  critique: BuilderPlannerCritiqueState;
}): BuilderPlanningCacheArtifact {
  const artifact: BuilderPlanningCacheArtifact = {
    version: BUILDER_CACHE_VERSION,
    key: args.key,
    projectId: args.projectId,
    projectRelativePath: args.projectRelativePath,
    generatedAt: new Date().toISOString(),
    prompt: args.prompt,
    critique: args.critique,
  };
  writeBuilderFile(path.posix.join(cacheDir(args.projectRelativePath), PLANNING_CACHE_FILE), `${JSON.stringify(artifact, null, 2)}\n`);
  recordBuilderPlanningCacheWrite({
    projectRelativePath: args.projectRelativePath,
    key: args.key,
  });
  return artifact;
}
