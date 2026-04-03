-- Enable the pgvector extension.
CREATE EXTENSION IF NOT EXISTS vector;

-- Prisma cannot model vector columns directly, so keep this as a manual follow-up migration.
ALTER TABLE "Memory" ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS memory_embedding_idx
  ON "Memory" USING hnsw (embedding vector_cosine_ops);