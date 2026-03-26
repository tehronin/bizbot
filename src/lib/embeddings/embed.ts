/**
 * embeddings/embed.ts — Generate embeddings using the active LLM provider.
 * Falls back to OpenAI text-embedding-3-small by default.
 */

import OpenAI from "openai";

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

/**
 * Generate a vector embedding for the given text.
 * Returns a Float32Array of 1536 dimensions (OpenAI text-embedding-3-small).
 */
export async function embed(text: string): Promise<number[]> {
  const client = getOpenAI();
  const response = await client.embeddings.create({
    input: text.slice(0, 8000), // token limit safety
    model: "text-embedding-3-small",
  });
  return response.data[0].embedding;
}

/**
 * Batch embed multiple texts in a single API call.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = getOpenAI();
  const response = await client.embeddings.create({
    input: texts.map((t) => t.slice(0, 8000)),
    model: "text-embedding-3-small",
  });
  return response.data.map((d) => d.embedding);
}

/** Format a number[] embedding for use in a pgvector SQL query. */
export function formatEmbedding(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
