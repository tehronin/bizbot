import fs from "fs";
import path from "path";
import { getWorkspacePath } from "@/lib/files/workspace";
import { getAgentRuntimeConfig } from "@/lib/agent/runtime";

export interface KnowledgeStatus {
  enabled: boolean;
  folder: string;
  absolutePath: string;
  exists: boolean;
  documentCount: number;
}

const TEXT_FILE_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".html"]);
const MAX_FILE_COUNT = 200;

function resolveKnowledgeRoot(relativeFolder: string): string {
  const workspaceRoot = getWorkspacePath();
  const resolved = path.resolve(/* turbopackIgnore: true */ workspaceRoot, /* turbopackIgnore: true */ (relativeFolder || "."));
  if (!resolved.startsWith(workspaceRoot + path.sep) && resolved !== workspaceRoot) {
    throw new Error("Knowledge path escapes workspace root");
  }
  return resolved;
}

function countKnowledgeFiles(root: string): number {
  const queue: string[] = [root];
  let count = 0;

  while (queue.length > 0 && count < MAX_FILE_COUNT) {
    const current = queue.shift();
    if (!current || !fs.existsSync(current)) {
      continue;
    }

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (count >= MAX_FILE_COUNT) {
        break;
      }

      const absolutePath = path.join(/* turbopackIgnore: true */ current, /* turbopackIgnore: true */ entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }

      if (TEXT_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        count += 1;
      }
    }
  }

  return count;
}

export function getKnowledgeStatus(): KnowledgeStatus {
  const config = getAgentRuntimeConfig();
  const absolutePath = resolveKnowledgeRoot(config.knowledgePath);
  const exists = fs.existsSync(absolutePath);
  const documentCount = exists ? countKnowledgeFiles(absolutePath) : 0;

  return {
    enabled: config.knowledgeEnabled,
    folder: config.knowledgePath,
    absolutePath,
    exists,
    documentCount,
  };
}