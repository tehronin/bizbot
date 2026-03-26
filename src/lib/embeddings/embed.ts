/**
 * embeddings/embed.ts — Generate embeddings using a dedicated embedding provider.
 * Defaults to Google Gemini embeddings and keeps chat model selection separate.
 */

import OpenAI from "openai";

export type EmbeddingProvider = "google" | "openai" | "ollama";
export type EmbeddingPurpose = "query" | "document";

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  model: string;
  dimensions: number;
}

interface GoogleEmbeddingResponse {
  embedding?: {
    values?: number[];
  };
}

interface GoogleBatchEmbeddingResponse {
  embeddings?: Array<{
    values?: number[];
  }>;
}

interface OllamaEmbeddingResponse {
  embeddings?: number[][];
}

const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
const MAX_EMBEDDING_INPUT_CHARS = 8000;

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

function getOllamaApiBaseUrl(): string {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
  return baseUrl.endsWith("/v1") ? baseUrl.slice(0, -3) : baseUrl;
}

function parseEmbeddingDimensions(raw: string | undefined): number {
  if (!raw) {
    return DEFAULT_EMBEDDING_DIMENSIONS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_EMBEDDING_DIMENSIONS;
  }

  return Math.trunc(parsed);
}

export function getEmbeddingConfig(): EmbeddingConfig {
  const provider = (process.env.EMBEDDING_PROVIDER as EmbeddingProvider | undefined) ?? "google";
  const model = process.env.EMBEDDING_MODEL
    ?? (provider === "google"
      ? "gemini-embedding-001"
      : provider === "ollama"
        ? "mxbai-embed-large"
        : "text-embedding-3-small");

  return {
    provider,
    model,
    dimensions: parseEmbeddingDimensions(process.env.EMBEDDING_DIMENSIONS),
  };
}

function toGoogleModelPath(model: string): string {
  return model.startsWith("models/") ? model : `models/${model}`;
}

function getGoogleTaskType(purpose: EmbeddingPurpose): "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT" {
  return purpose === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
}

function normalizeEmbedding(embedding: number[]): number[] {
  const magnitude = Math.hypot(...embedding);
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    return embedding;
  }

  return embedding.map((value) => value / magnitude);
}

function validateEmbeddingDimensions(embedding: number[], expectedDimensions: number): number[] {
  if (embedding.length !== expectedDimensions) {
    throw new Error(
      `Embedding dimension mismatch: expected ${expectedDimensions}, received ${embedding.length}. `
      + "Current pgvector storage is fixed to one dimension per column.",
    );
  }

  return embedding;
}

async function embedWithGoogle(
  text: string,
  purpose: EmbeddingPurpose,
  config: EmbeddingConfig,
): Promise<number[]> {
  const apiKey = process.env.GOOGLE_AI_API_KEY ?? "";
  if (!apiKey) {
    throw new Error("GOOGLE_AI_API_KEY is required when EMBEDDING_PROVIDER=google");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${toGoogleModelPath(config.model)}:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: {
          parts: [{ text: text.slice(0, MAX_EMBEDDING_INPUT_CHARS) }],
        },
        taskType: getGoogleTaskType(purpose),
        outputDimensionality: config.dimensions,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Google embedding request failed with status ${response.status}`);
  }

  const data = (await response.json()) as GoogleEmbeddingResponse;
  const values = data.embedding?.values;
  if (!values || values.length === 0) {
    throw new Error("Google embedding response did not include embedding values");
  }

  return normalizeEmbedding(validateEmbeddingDimensions(values, config.dimensions));
}

async function embedBatchWithGoogle(
  texts: string[],
  purpose: EmbeddingPurpose,
  config: EmbeddingConfig,
): Promise<number[][]> {
  const apiKey = process.env.GOOGLE_AI_API_KEY ?? "";
  if (!apiKey) {
    throw new Error("GOOGLE_AI_API_KEY is required when EMBEDDING_PROVIDER=google");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${toGoogleModelPath(config.model)}:batchEmbedContents?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          content: {
            parts: [{ text: text.slice(0, MAX_EMBEDDING_INPUT_CHARS) }],
          },
          taskType: getGoogleTaskType(purpose),
          outputDimensionality: config.dimensions,
        })),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Google batch embedding request failed with status ${response.status}`);
  }

  const data = (await response.json()) as GoogleBatchEmbeddingResponse;
  return (data.embeddings ?? []).map((embedding) => {
    const values = embedding.values ?? [];
    return normalizeEmbedding(validateEmbeddingDimensions(values, config.dimensions));
  });
}

async function embedWithOllama(text: string, config: EmbeddingConfig): Promise<number[]> {
  const response = await fetch(`${getOllamaApiBaseUrl()}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      input: text.slice(0, MAX_EMBEDDING_INPUT_CHARS),
      dimensions: config.dimensions,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama embedding request failed with status ${response.status}`);
  }

  const data = (await response.json()) as OllamaEmbeddingResponse;
  const embedding = data.embeddings?.[0] ?? [];
  return normalizeEmbedding(validateEmbeddingDimensions(embedding, config.dimensions));
}

async function embedBatchWithOllama(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  const response = await fetch(`${getOllamaApiBaseUrl()}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      input: texts.map((text) => text.slice(0, MAX_EMBEDDING_INPUT_CHARS)),
      dimensions: config.dimensions,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama batch embedding request failed with status ${response.status}`);
  }

  const data = (await response.json()) as OllamaEmbeddingResponse;
  return (data.embeddings ?? []).map((embedding) =>
    normalizeEmbedding(validateEmbeddingDimensions(embedding, config.dimensions)),
  );
}

async function embedWithOpenAI(text: string, config: EmbeddingConfig): Promise<number[]> {
  const client = getOpenAI();
  const response = await client.embeddings.create({
    input: text.slice(0, MAX_EMBEDDING_INPUT_CHARS),
    model: config.model,
  });
  return response.data[0].embedding;
}

async function embedBatchWithOpenAI(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  const client = getOpenAI();
  const response = await client.embeddings.create({
    input: texts.map((text) => text.slice(0, MAX_EMBEDDING_INPUT_CHARS)),
    model: config.model,
  });
  return response.data.map((item) => item.embedding);
}

/**
 * Generate a vector embedding for the given text.
 * Defaults to 1536 dimensions to stay aligned with the current pgvector schema.
 */
export async function embed(
  text: string,
  purpose: EmbeddingPurpose = "query",
): Promise<number[]> {
  const config = getEmbeddingConfig();

  switch (config.provider) {
    case "google":
      return embedWithGoogle(text, purpose, config);
    case "ollama":
      return embedWithOllama(text, config);
    case "openai":
      return embedWithOpenAI(text, config);
  }
}

/**
 * Batch embed multiple texts in a single API call when supported.
 */
export async function embedBatch(
  texts: string[],
  purpose: EmbeddingPurpose = "document",
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const config = getEmbeddingConfig();

  switch (config.provider) {
    case "google":
      return embedBatchWithGoogle(texts, purpose, config);
    case "ollama":
      return embedBatchWithOllama(texts, config);
    case "openai":
      return embedBatchWithOpenAI(texts, config);
  }
}

export async function testEmbeddingProvider(): Promise<{
  ok: boolean;
  provider: EmbeddingProvider;
  model: string;
  dimensions: number;
  error?: string;
}> {
  const config = getEmbeddingConfig();

  try {
    const result = await embed("BizBot embedding connectivity check.");
    return {
      ok: true,
      provider: config.provider,
      model: config.model,
      dimensions: result.length,
    };
  } catch (error) {
    return {
      ok: false,
      provider: config.provider,
      model: config.model,
      dimensions: config.dimensions,
      error: String(error),
    };
  }
}

/** Format a number[] embedding for use in a pgvector SQL query. */
export function formatEmbedding(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
