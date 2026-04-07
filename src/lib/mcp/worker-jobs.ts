import { embed } from "@/lib/embeddings/embed";
import { buildMcpSnapshotEmbeddingDocument, MCP_EMBEDDING_FORMAT_VERSION } from "@/lib/mcp/embedding-document";
import { enqueueMcpOntologyJob, type McpCleanupJobData, type McpEmbeddingJobData, type McpOntologyJobData } from "@/lib/mcp/jobs";
import { syncBuilderMcpSnapshotOntology } from "@/lib/mcp/ontology-sync";
import {
  getLatestBuilderMcpSnapshotForProject,
  loadBuilderMcpSnapshotForJob,
  mergeBuilderMcpSnapshotMetadata,
  storeBuilderMcpSnapshotEmbedding,
} from "@/lib/builder/mcp-snapshots";

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function processMcpEmbeddingJob(job: McpEmbeddingJobData) {
  const snapshot = await loadBuilderMcpSnapshotForJob(job);
  if (!snapshot) {
    return { skipped: true, reason: "snapshot_not_found" };
  }

  const metadata = readObject(snapshot.metadata);
  const enrichment = readObject(metadata?.enrichment);
  const semantic = readObject(enrichment?.semantic);
  if (semantic?.embeddingFormatVersion === job.embeddingFormatVersion && typeof semantic.embeddedAt === "string") {
    if (typeof semantic.ontologySyncedAt !== "string") {
      await enqueueMcpOntologyJob({
        projectId: snapshot.projectId,
        snapshotSequence: snapshot.snapshotSequence,
        snapshotId: snapshot.id,
        reason: "embedding_complete",
        requestedAt: new Date().toISOString(),
      });
    }
    return { skipped: true, reason: "embedding_already_current" };
  }

  try {
    const embeddingText = buildMcpSnapshotEmbeddingDocument(snapshot);
    const embedding = await embed(embeddingText, "document");

    await storeBuilderMcpSnapshotEmbedding({
      snapshotId: snapshot.id,
      embedding,
      formatVersion: job.embeddingFormatVersion || MCP_EMBEDDING_FORMAT_VERSION,
    });

    await enqueueMcpOntologyJob({
      projectId: snapshot.projectId,
      snapshotSequence: snapshot.snapshotSequence,
      snapshotId: snapshot.id,
      reason: "embedding_complete",
      requestedAt: new Date().toISOString(),
    });

    await mergeBuilderMcpSnapshotMetadata(snapshot.id, {
      enrichment: {
        queue: {
          ontology: {
            status: "queued",
            requestedAt: new Date().toISOString(),
          },
        },
      },
    });

    return { ok: true, snapshotId: snapshot.id };
  } catch (error) {
    await mergeBuilderMcpSnapshotMetadata(snapshot.id, {
      enrichment: {
        queue: {
          embedding: {
            status: /snapshotEmbedding|vector/i.test(String(error)) ? "failed" : "failed",
            finishedAt: new Date().toISOString(),
            error: String(error),
          },
        },
      },
    }).catch(() => undefined);

    if (/snapshotEmbedding|vector/i.test(String(error))) {
      return { skipped: true, reason: "semantic_schema_not_ready" };
    }
    throw error;
  }
}

export async function processMcpOntologyJob(job: McpOntologyJobData) {
  const snapshot = await loadBuilderMcpSnapshotForJob(job);
  if (!snapshot) {
    return { skipped: true, reason: "snapshot_not_found" };
  }

  try {
    const result = await syncBuilderMcpSnapshotOntology(snapshot);
    return { ok: true, snapshotId: snapshot.id, ...result };
  } catch (error) {
    await mergeBuilderMcpSnapshotMetadata(snapshot.id, {
      enrichment: {
        queue: {
          ontology: {
            status: "failed",
            finishedAt: new Date().toISOString(),
            error: String(error),
          },
        },
      },
    }).catch(() => undefined);
    throw error;
  }
}

export async function processMcpCleanupJob(job: McpCleanupJobData) {
  const snapshot = job.snapshotSequence
    ? await loadBuilderMcpSnapshotForJob({ projectId: job.projectId, snapshotSequence: job.snapshotSequence })
    : await getLatestBuilderMcpSnapshotForProject(job.projectId);
  if (!snapshot) {
    return { skipped: true, reason: "snapshot_not_found" };
  }

  await mergeBuilderMcpSnapshotMetadata(snapshot.id, {
    enrichment: {
      semantic: {
        cleanupProcessedAt: new Date().toISOString(),
      },
      queue: {
        cleanup: {
          status: "completed",
          finishedAt: new Date().toISOString(),
          reason: job.reason,
        },
      },
    },
  });

  return { ok: true, snapshotId: snapshot.id };
}