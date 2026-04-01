import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { getWorkspacePath } from "@/lib/files/workspace";
import { ensureKnowledgeEmbeddingsIndexed } from "@/lib/agent/knowledge";
import { getAgentRuntimeConfig } from "@/lib/agent/runtime";

const TEXT_FILE_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".html"]);
const MAX_INDEXABLE_FILES = 200;
const MAX_FILE_SIZE_BYTES = 256_000;
const MAX_DASHBOARD_FILES = 500;
const KNOWLEDGE_CATEGORY = "knowledge-document";
const KNOWLEDGE_INDEXED_AT_SETTING = "knowledge_indexed_at";
const KNOWLEDGE_MANIFEST_SETTING = "knowledge_index_manifest";
const KNOWLEDGE_FILE_MANIFEST_SETTING = "knowledge_index_file_manifest";
const KNOWLEDGE_USER_ID = "local-user";
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;

type KnowledgeFileStatus = "indexed" | "pending" | "skipped";

interface ScannedKnowledgeFile {
  absolutePath: string;
  relativePath: string;
  name: string;
  extension: string;
  size: number;
  modifiedAt: string;
}

export interface KnowledgeDashboardFile {
  path: string;
  name: string;
  extension: string;
  size: number;
  modifiedAt: string;
  status: KnowledgeFileStatus;
  indexedChunks: number;
  skipReason: string | null;
}

export interface KnowledgeDashboardSummary {
  enabled: boolean;
  folder: string;
  absolutePath: string;
  exists: boolean;
  lastIndexedAt: string | null;
  indexedFileCount: number;
  indexedChunkCount: number;
  pendingFileCount: number;
  skippedFileCount: number;
  totalFileCount: number;
}

export interface KnowledgeDashboardResponse {
  summary: KnowledgeDashboardSummary;
  files: KnowledgeDashboardFile[];
}

export interface KnowledgeUploadResult {
  saved: Array<{ path: string; overwritten: boolean }>;
  rejected: Array<{ name: string; reason: string }>;
  sync: Awaited<ReturnType<typeof ensureKnowledgeEmbeddingsIndexed>>;
}

export interface KnowledgePreviewChunk {
  index: number;
  snippet: string;
  source: "indexed" | "derived";
}

export interface KnowledgeFilePreview {
  path: string;
  indexed: boolean;
  status: KnowledgeFileStatus | "missing";
  chunkCount: number;
  snippetCount: number;
  updatedAt: string | null;
  chunks: KnowledgePreviewChunk[];
}

function resolveKnowledgeRoot(relativeFolder: string): string {
  const workspaceRoot = getWorkspacePath();
  const resolved = relativeFolder && relativeFolder !== "."
    ? path.resolve(workspaceRoot, relativeFolder)
    : workspaceRoot;
  if (!resolved.startsWith(workspaceRoot + path.sep) && resolved !== workspaceRoot) {
    throw new Error("Knowledge path escapes workspace root");
  }
  return resolved;
}

function normalizeKnowledgeRelativePath(relativePath: string): string {
  const value = relativePath.replace(/\\/g, "/").trim().replace(/^\/+/, "");
  if (!value) {
    throw new Error("Knowledge file path is required.");
  }
  if (value.includes("..")) {
    throw new Error("Knowledge file path escapes the knowledge folder.");
  }
  return value;
}

function resolveKnowledgeFilePath(root: string, relativePath: string): string {
  const normalized = normalizeKnowledgeRelativePath(relativePath);
  const absolutePath = path.resolve(root, normalized);
  if (!absolutePath.startsWith(root + path.sep) && absolutePath !== root) {
    throw new Error("Knowledge file path escapes the knowledge folder.");
  }
  return absolutePath;
}

function scanKnowledgeFiles(root: string): ScannedKnowledgeFile[] {
  const workspaceRoot = getWorkspacePath();
  const queue: string[] = [root];
  const files: ScannedKnowledgeFile[] = [];

  while (queue.length > 0 && files.length < MAX_DASHBOARD_FILES) {
    const current = queue.shift();
    if (!current || !fs.existsSync(current)) {
      continue;
    }

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_DASHBOARD_FILES) {
        break;
      }

      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }

      const stat = fs.statSync(absolutePath);
      files.push({
        absolutePath,
        relativePath: path.relative(workspaceRoot, absolutePath).replace(/\\/g, "/"),
        name: entry.name,
        extension: path.extname(entry.name).toLowerCase(),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    }
  }

  return files;
}

function normalizeChunkValue(relativePath: string, value: string): string {
  const prefix = `[${relativePath}] `;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function buildSnippet(value: string, maxLength = 240): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength)}...`;
}

function chunkDocument(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    const nextCursor = Math.min(normalized.length, cursor + CHUNK_SIZE);
    chunks.push(normalized.slice(cursor, nextCursor));
    if (nextCursor >= normalized.length) {
      break;
    }
    cursor = Math.max(0, nextCursor - CHUNK_OVERLAP);
  }

  return chunks;
}

function getSkipReason(file: ScannedKnowledgeFile, indexableCount: number): string | null {
  if (!TEXT_FILE_EXTENSIONS.has(file.extension)) {
    return "Unsupported file type";
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `File exceeds ${Math.trunc(MAX_FILE_SIZE_BYTES / 1024)} KB limit`;
  }
  if (indexableCount >= MAX_INDEXABLE_FILES) {
    return `Index limit reached (${MAX_INDEXABLE_FILES} files max)`;
  }
  return null;
}

async function getIndexedChunkCounts(): Promise<Map<string, number>> {
  const rows = await db.memory.findMany({
    where: {
      userId: KNOWLEDGE_USER_ID,
      category: KNOWLEDGE_CATEGORY,
    },
    select: { key: true },
  });

  const counts = new Map<string, number>();
  for (const row of rows) {
    const match = /^knowledge:(.+):(\d+)$/.exec(row.key);
    const relativePath = match?.[1];
    if (!relativePath) {
      continue;
    }
    counts.set(relativePath, (counts.get(relativePath) ?? 0) + 1);
  }

  return counts;
}

export async function getKnowledgeDashboard(): Promise<KnowledgeDashboardResponse> {
  const config = getAgentRuntimeConfig();
  const absolutePath = resolveKnowledgeRoot(config.knowledgePath);
  const exists = fs.existsSync(absolutePath);

  const [indexedChunkCounts, indexedAtSetting] = await Promise.all([
    getIndexedChunkCounts(),
    db.setting.findUnique({ where: { key: KNOWLEDGE_INDEXED_AT_SETTING } }),
  ]);

  const scannedFiles = exists ? scanKnowledgeFiles(absolutePath) : [];
  let indexableCount = 0;
  const files = scannedFiles.map<KnowledgeDashboardFile>((file) => {
    const skipReason = getSkipReason(file, indexableCount);
    if (!skipReason) {
      indexableCount += 1;
    }

    const indexedChunks = indexedChunkCounts.get(file.relativePath) ?? 0;
    const status: KnowledgeFileStatus = skipReason
      ? "skipped"
      : indexedChunks > 0
        ? "indexed"
        : "pending";

    return {
      path: file.relativePath,
      name: file.name,
      extension: file.extension,
      size: file.size,
      modifiedAt: file.modifiedAt,
      status,
      indexedChunks,
      skipReason,
    };
  });

  const indexedFileCount = files.filter((file) => file.status === "indexed").length;
  const indexedChunkCount = files.reduce((total, file) => total + file.indexedChunks, 0);
  const pendingFileCount = files.filter((file) => file.status === "pending").length;
  const skippedFileCount = files.filter((file) => file.status === "skipped").length;

  return {
    summary: {
      enabled: config.knowledgeEnabled,
      folder: config.knowledgePath,
      absolutePath,
      exists,
      lastIndexedAt: indexedAtSetting?.value ?? null,
      indexedFileCount,
      indexedChunkCount,
      pendingFileCount,
      skippedFileCount,
      totalFileCount: files.length,
    },
    files,
  };
}

export async function reindexAllKnowledgeFiles(): Promise<Awaited<ReturnType<typeof ensureKnowledgeEmbeddingsIndexed>>> {
  await db.setting.deleteMany({
    where: {
      key: {
        in: [KNOWLEDGE_MANIFEST_SETTING, KNOWLEDGE_FILE_MANIFEST_SETTING],
      },
    },
  });

  return ensureKnowledgeEmbeddingsIndexed();
}

export async function reindexKnowledgeFile(relativePath: string): Promise<Awaited<ReturnType<typeof ensureKnowledgeEmbeddingsIndexed>>> {
  const config = getAgentRuntimeConfig();
  const root = resolveKnowledgeRoot(config.knowledgePath);
  const absolutePath = resolveKnowledgeFilePath(root, relativePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Knowledge file not found: ${relativePath}`);
  }

  const now = new Date();
  fs.utimesSync(absolutePath, now, now);
  return ensureKnowledgeEmbeddingsIndexed();
}

export async function deleteKnowledgeWorkspaceFile(relativePath: string): Promise<Awaited<ReturnType<typeof ensureKnowledgeEmbeddingsIndexed>>> {
  const config = getAgentRuntimeConfig();
  const root = resolveKnowledgeRoot(config.knowledgePath);
  const absolutePath = resolveKnowledgeFilePath(root, relativePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Knowledge file not found: ${relativePath}`);
  }

  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) {
    throw new Error("Only files can be deleted from the knowledge folder.");
  }

  fs.unlinkSync(absolutePath);
  return ensureKnowledgeEmbeddingsIndexed();
}

export async function getKnowledgeFilePreview(relativePath: string): Promise<KnowledgeFilePreview> {
  const config = getAgentRuntimeConfig();
  const root = resolveKnowledgeRoot(config.knowledgePath);
  const absolutePath = resolveKnowledgeFilePath(root, relativePath);
  const exists = fs.existsSync(absolutePath);

  const indexedRows = await db.memory.findMany({
    where: {
      userId: KNOWLEDGE_USER_ID,
      category: KNOWLEDGE_CATEGORY,
      key: { startsWith: `knowledge:${relativePath}:` },
    },
    select: { key: true, value: true },
    orderBy: { key: "asc" },
  });

  if (!exists && indexedRows.length === 0) {
    return {
      path: relativePath,
      indexed: false,
      status: "missing",
      chunkCount: 0,
      snippetCount: 0,
      updatedAt: null,
      chunks: [],
    };
  }

  const stat = exists ? fs.statSync(absolutePath) : null;
  const extension = path.extname(relativePath).toLowerCase();
  const skipReason = stat ? getSkipReason({
    absolutePath,
    relativePath,
    name: path.basename(relativePath),
    extension,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  }, 0) : null;

  if (indexedRows.length > 0) {
    const chunks = indexedRows.slice(0, 6).map((row) => {
      const match = /^knowledge:.+:(\d+)$/.exec(row.key);
      return {
        index: Number(match?.[1] ?? 0),
        snippet: buildSnippet(normalizeChunkValue(relativePath, row.value)),
        source: "indexed" as const,
      };
    });

    return {
      path: relativePath,
      indexed: true,
      status: skipReason ? "skipped" : "indexed",
      chunkCount: indexedRows.length,
      snippetCount: chunks.length,
      updatedAt: stat?.mtime.toISOString() ?? null,
      chunks,
    };
  }

  if (!exists || !stat || skipReason) {
    return {
      path: relativePath,
      indexed: false,
      status: skipReason ? "skipped" : "missing",
      chunkCount: 0,
      snippetCount: 0,
      updatedAt: stat?.mtime.toISOString() ?? null,
      chunks: [],
    };
  }

  const content = fs.readFileSync(absolutePath, "utf-8");
  const chunks = chunkDocument(content).slice(0, 6).map((chunk, index) => ({
    index,
    snippet: buildSnippet(chunk),
    source: "derived" as const,
  }));

  return {
    path: relativePath,
    indexed: false,
    status: "pending",
    chunkCount: chunks.length,
    snippetCount: chunks.length,
    updatedAt: stat.mtime.toISOString(),
    chunks,
  };
}

export async function uploadKnowledgeFiles(files: File[]): Promise<KnowledgeUploadResult> {
  const config = getAgentRuntimeConfig();
  const root = resolveKnowledgeRoot(config.knowledgePath);
  fs.mkdirSync(root, { recursive: true });

  const saved: Array<{ path: string; overwritten: boolean }> = [];
  const rejected: Array<{ name: string; reason: string }> = [];

  for (const file of files) {
    const name = path.basename(file.name || "").trim();
    const extension = path.extname(name).toLowerCase();

    if (!name) {
      rejected.push({ name: file.name || "(unnamed)", reason: "Missing file name" });
      continue;
    }

    if (!TEXT_FILE_EXTENSIONS.has(extension)) {
      rejected.push({ name, reason: "Unsupported file type" });
      continue;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      rejected.push({ name, reason: `File exceeds ${Math.trunc(MAX_FILE_SIZE_BYTES / 1024)} KB limit` });
      continue;
    }

    const absolutePath = resolveKnowledgeFilePath(root, name);
    const overwritten = fs.existsSync(absolutePath);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, buffer);
    saved.push({ path: path.relative(getWorkspacePath(), absolutePath).replace(/\\/g, "/"), overwritten });
  }

  const sync = await ensureKnowledgeEmbeddingsIndexed();
  return { saved, rejected, sync };
}