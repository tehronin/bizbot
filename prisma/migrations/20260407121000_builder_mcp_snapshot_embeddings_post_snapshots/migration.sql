ALTER TABLE "mcp_snapshots"
ADD COLUMN IF NOT EXISTS "snapshotEmbedding" vector(1536);

CREATE INDEX IF NOT EXISTS "mcp_snapshots_snapshot_embedding_idx"
ON "mcp_snapshots"
USING ivfflat ("snapshotEmbedding" vector_cosine_ops)
WITH (lists = 100);
