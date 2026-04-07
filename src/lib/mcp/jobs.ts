import { Queue, type JobsOptions } from "bullmq";
import { getBullMqConnection } from "@/lib/queue/redis";

export const MCP_EMBEDDINGS_QUEUE_NAME = "bizbot-mcp-embeddings";
export const MCP_ONTOLOGY_QUEUE_NAME = "bizbot-mcp-ontology";
export const MCP_CLEANUP_QUEUE_NAME = "bizbot-mcp-cleanup";

export interface McpEmbeddingJobData {
  projectId: string;
  snapshotSequence: number;
  snapshotId?: string;
  reason: "build_complete" | "snapshot_rollover" | "reindex" | "embedding_format_upgrade";
  requestedAt: string;
  embeddingFormatVersion: string;
}

export interface McpOntologyJobData {
  projectId: string;
  snapshotSequence: number;
  snapshotId?: string;
  reason: "embedding_complete" | "snapshot_rollover" | "rebuild";
  requestedAt: string;
}

export interface McpCleanupJobData {
  projectId: string;
  snapshotSequence?: number;
  reason: "post_build" | "retention" | "manual";
  requestedAt: string;
}

type McpQueueRegistry = {
  embeddings?: Queue<McpEmbeddingJobData>;
  ontology?: Queue<McpOntologyJobData>;
  cleanup?: Queue<McpCleanupJobData>;
};

const globalForMcpQueues = globalThis as typeof globalThis & {
  bizbotMcpQueues?: McpQueueRegistry;
};

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 5_000,
  },
  removeOnComplete: 100,
  removeOnFail: 100,
};

function buildMcpJobId(...parts: Array<string | number>) {
  return parts.join("__");
}

function getRegistry(): McpQueueRegistry {
  if (!globalForMcpQueues.bizbotMcpQueues) {
    globalForMcpQueues.bizbotMcpQueues = {};
  }

  return globalForMcpQueues.bizbotMcpQueues;
}

export function shouldEnqueueMcpSnapshotJobs(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = env.BIZBOT_ENABLE_MCP_SNAPSHOT_JOBS;
  if (explicit === "0" || explicit === "false") {
    return false;
  }
  if (env.NODE_ENV === "test") {
    return false;
  }
  return true;
}

export function getMcpEmbeddingsQueue(): Queue<McpEmbeddingJobData> {
  const registry = getRegistry();
  if (!registry.embeddings) {
    registry.embeddings = new Queue<McpEmbeddingJobData>(MCP_EMBEDDINGS_QUEUE_NAME, {
      connection: getBullMqConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }

  return registry.embeddings;
}

export function getMcpOntologyQueue(): Queue<McpOntologyJobData> {
  const registry = getRegistry();
  if (!registry.ontology) {
    registry.ontology = new Queue<McpOntologyJobData>(MCP_ONTOLOGY_QUEUE_NAME, {
      connection: getBullMqConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }

  return registry.ontology;
}

export function getMcpCleanupQueue(): Queue<McpCleanupJobData> {
  const registry = getRegistry();
  if (!registry.cleanup) {
    registry.cleanup = new Queue<McpCleanupJobData>(MCP_CLEANUP_QUEUE_NAME, {
      connection: getBullMqConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }

  return registry.cleanup;
}

export async function enqueueMcpEmbeddingJob(data: McpEmbeddingJobData) {
  return getMcpEmbeddingsQueue().add("generate-snapshot-embedding", data, {
    jobId: buildMcpJobId("mcp-embed", data.projectId, data.snapshotSequence, data.embeddingFormatVersion),
  });
}

export async function enqueueMcpOntologyJob(data: McpOntologyJobData) {
  return getMcpOntologyQueue().add("maintain-snapshot-ontology", data, {
    jobId: buildMcpJobId("mcp-ontology", data.projectId, data.snapshotSequence),
  });
}

export async function enqueueMcpCleanupJob(data: McpCleanupJobData) {
  return getMcpCleanupQueue().add("cleanup-snapshot-artifacts", data, {
    jobId: buildMcpJobId("mcp-cleanup", data.projectId, data.snapshotSequence ?? "project"),
    delay: data.reason === "post_build" ? 30 * 60 * 1000 : 0,
  });
}