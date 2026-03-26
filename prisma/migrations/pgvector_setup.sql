-- BizBot — pgvector setup migration
-- Run this after: npx prisma migrate dev --name init

-- Enable the pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to memory table (Prisma can't manage vector type natively)
ALTER TABLE "Memory" ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Create HNSW index for fast approximate nearest-neighbor search
CREATE INDEX IF NOT EXISTS memory_embedding_idx
  ON "Memory" USING hnsw (embedding vector_cosine_ops);
