/**
 * embeddings/search.ts — Semantic similarity search over the Memory table using pgvector.
 * Uses raw SQL since Prisma doesn't support the vector type natively.
 */

import { db } from "@/lib/db";
import { embed, formatEmbedding } from "./embed";

export interface MemorySearchResult {
  id: string;
  key: string;
  value: string;
  category: string;
  similarity: number;
}

/**
 * Search memories semantically similar to the given query text.
 * Returns memories sorted by cosine similarity (most relevant first).
 */
export async function searchMemories(
  userId: string,
  query: string,
  limit = 5,
  category?: string,
): Promise<MemorySearchResult[]> {
  const embedding = await embed(query, "query");
  const embeddingStr = formatEmbedding(embedding);

  const categoryFilter = category ? `AND m."category" = '${category}'` : "";

  const results = (await db.$queryRawUnsafe(
    `SELECT 
       m.id,
       m.key,
       m.value,
       m.category,
       1 - (m.embedding <=> $1::vector) AS similarity
     FROM "Memory" m
     WHERE m."userId" = $2
       AND m.embedding IS NOT NULL
       ${categoryFilter}
     ORDER BY m.embedding <=> $1::vector
     LIMIT $3`,
    embeddingStr,
    userId,
    limit,
  )) as MemorySearchResult[];

  return results;
}

/**
 * Store an embedding for an existing Memory record.
 */
export async function storeMemoryEmbedding(
  memoryId: string,
  text: string,
): Promise<void> {
  const embedding = await embed(text, "document");
  const embeddingStr = formatEmbedding(embedding);

  await db.$executeRawUnsafe(
    `UPDATE "Memory" SET embedding = $1::vector WHERE id = $2`,
    embeddingStr,
    memoryId,
  );
}
