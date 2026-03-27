import crypto from "crypto";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { getWorkspacePath } from "@/lib/files/workspace";
import { getAgentRuntimeConfig } from "@/lib/agent/runtime";
import { searchMemories, storeMemoryEmbedding } from "@/lib/embeddings/search";
export { getKnowledgeStatus, type KnowledgeStatus } from "@/lib/agent/knowledge-status";

export interface KnowledgeSnippet {
  path: string;
  score: number;
  snippet: string;
}

const TEXT_FILE_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".html"]);
const MAX_FILE_COUNT = 200;
const MAX_FILE_SIZE_BYTES = 256_000;
const KNOWLEDGE_CATEGORY = "knowledge-document";
const KNOWLEDGE_MANIFEST_SETTING = "knowledge_index_manifest";
const KNOWLEDGE_INDEXED_AT_SETTING = "knowledge_indexed_at";
const KNOWLEDGE_USER_ID = "local-user";
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;

interface KnowledgeFile {
  absolutePath: string;
  relativePath: string;
  content: string;
  statSignature: string;
}

function resolveKnowledgeRoot(relativeFolder: string): string {
  const workspaceRoot = getWorkspacePath();
  const resolved = path.resolve(workspaceRoot, relativeFolder || ".");
  if (!resolved.startsWith(workspaceRoot + path.sep) && resolved !== workspaceRoot) {
    throw new Error("Knowledge path escapes workspace root");
  }
  return resolved;
}

function listKnowledgeFiles(root: string): KnowledgeFile[] {
  const workspaceRoot = getWorkspacePath();
  const collected: KnowledgeFile[] = [];
  const queue: string[] = [root];

  while (queue.length > 0 && collected.length < MAX_FILE_COUNT) {
    const current = queue.shift();
    if (!current || !fs.existsSync(current)) {
      continue;
    }

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (collected.length >= MAX_FILE_COUNT) {
        break;
      }

      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!TEXT_FILE_EXTENSIONS.has(extension)) {
        continue;
      }

      const stat = fs.statSync(absolutePath);
      if (stat.size > MAX_FILE_SIZE_BYTES) {
        continue;
      }

      const content = fs.readFileSync(absolutePath, "utf-8");
      collected.push({
        absolutePath,
        relativePath: path.relative(workspaceRoot, absolutePath).replace(/\\/g, "/"),
        content,
        statSignature: `${path.relative(root, absolutePath)}:${stat.mtimeMs}:${stat.size}`,
      });
    }
  }

  return collected;
}

function buildSnippet(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 420);
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

function buildManifest(files: KnowledgeFile[]): string {
  return crypto.createHash("sha256").update(files.map((file) => file.statSignature).sort().join("|"), "utf-8").digest("hex");
}

async function getStoredManifest(): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key: KNOWLEDGE_MANIFEST_SETTING } });
  return row?.value ?? null;
}

async function setKnowledgeIndexMetadata(manifest: string): Promise<void> {
  await db.setting.upsert({
    where: { key: KNOWLEDGE_MANIFEST_SETTING },
    update: { value: manifest },
    create: { key: KNOWLEDGE_MANIFEST_SETTING, value: manifest },
  });
  await db.setting.upsert({
    where: { key: KNOWLEDGE_INDEXED_AT_SETTING },
    update: { value: new Date().toISOString() },
    create: { key: KNOWLEDGE_INDEXED_AT_SETTING, value: new Date().toISOString() },
  });
}

async function rebuildKnowledgeIndex(files: KnowledgeFile[]): Promise<number> {
  await db.user.upsert({
    where: { id: KNOWLEDGE_USER_ID },
    create: { id: KNOWLEDGE_USER_ID, name: "User" },
    update: {},
  });

  await db.memory.deleteMany({
    where: { userId: KNOWLEDGE_USER_ID, category: KNOWLEDGE_CATEGORY },
  });

  let chunkCount = 0;

  for (const file of files) {
    const chunks = chunkDocument(file.content);
    for (let index = 0; index < chunks.length; index += 1) {
      const key = `knowledge:${file.relativePath}:${index}`;
      const value = `[${file.relativePath}] ${chunks[index]}`;
      const memory = await db.memory.create({
        data: {
          userId: KNOWLEDGE_USER_ID,
          key,
          value,
          category: KNOWLEDGE_CATEGORY,
        },
      });
      await storeMemoryEmbedding(memory.id, value);
      chunkCount += 1;
    }
  }

  return chunkCount;
}

export async function ensureKnowledgeEmbeddingsIndexed(): Promise<{ indexed: boolean; chunkCount: number }> {
  const config = getAgentRuntimeConfig();
  if (!config.knowledgeEnabled) {
    return { indexed: false, chunkCount: 0 };
  }

  const root = resolveKnowledgeRoot(config.knowledgePath);
  if (!fs.existsSync(root)) {
    return { indexed: false, chunkCount: 0 };
  }

  const files = listKnowledgeFiles(root);
  const manifest = buildManifest(files);
  const currentManifest = await getStoredManifest();
  if (manifest === currentManifest) {
    const chunkCount = await db.memory.count({
      where: { userId: KNOWLEDGE_USER_ID, category: KNOWLEDGE_CATEGORY },
    });
    return { indexed: false, chunkCount };
  }

  const chunkCount = await rebuildKnowledgeIndex(files);
  await setKnowledgeIndexMetadata(manifest);
  return { indexed: true, chunkCount };
}

export async function searchKnowledgeDocuments(query: string, limit = 3): Promise<KnowledgeSnippet[]> {
  const config = getAgentRuntimeConfig();
  if (!config.knowledgeEnabled) {
    return [];
  }

  const root = resolveKnowledgeRoot(config.knowledgePath);
  if (!fs.existsSync(root)) {
    return [];
  }

  await ensureKnowledgeEmbeddingsIndexed();

  const results = await searchMemories(KNOWLEDGE_USER_ID, query, limit, KNOWLEDGE_CATEGORY);
  return results.map((entry) => {
    const match = /^knowledge:(.+):(\d+)$/.exec(entry.key);
    const relativePath = match?.[1] ?? entry.key;
    return {
      path: relativePath,
      score: entry.similarity,
      snippet: buildSnippet(entry.value),
    };
  });
}