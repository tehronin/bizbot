import type { Job, Queue } from "bullmq";
import { db } from "@/lib/db";
import {
  getMcpCleanupQueue,
  getMcpEmbeddingsQueue,
  getMcpOntologyQueue,
  MCP_CLEANUP_QUEUE_NAME,
  MCP_EMBEDDINGS_QUEUE_NAME,
  MCP_ONTOLOGY_QUEUE_NAME,
  type McpCleanupJobData,
  type McpEmbeddingJobData,
  type McpOntologyJobData,
} from "@/lib/mcp/jobs";

export type McpJobStatus = "waiting" | "active" | "delayed" | "completed" | "failed";

export interface McpQueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
}

export interface McpQueueStatus {
  queueName: string;
  counts: McpQueueCounts;
}

export interface McpWorkerStatus {
  queueNames: string[];
  workerRunning: boolean;
  workerStartedAt: string | null;
  workerLastSeenAt: string | null;
  workerLastJobStartedAt: string | null;
  workerLastJobFinishedAt: string | null;
  counts: Record<string, McpQueueCounts>;
}

export interface McpJobSummary {
  queueName: string;
  id: string;
  name: string;
  status: McpJobStatus | "unknown";
  attemptsMade: number;
  failedReason: string | null;
  createdAt: string;
  processedAt: string | null;
  finishedAt: string | null;
}

type SupportedMcpQueue =
  | Queue<McpEmbeddingJobData>
  | Queue<McpOntologyJobData>
  | Queue<McpCleanupJobData>;

function mapSettings(rows: Array<{ key: string; value: string }>): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function isKnownMcpJobStatus(value: string): value is McpJobStatus {
  return ["waiting", "active", "delayed", "completed", "failed"].includes(value);
}

function toJobSummary(job: Job, queueName: string, status: McpJobStatus | "unknown"): McpJobSummary {
  return {
    queueName,
    id: String(job.id),
    name: job.name,
    status,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason ?? null,
    createdAt: new Date(job.timestamp).toISOString(),
    processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
    finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
  };
}

function normalizeQueueCounts(counts: Record<string, number>): McpQueueCounts {
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
  };
}

function getQueues(): SupportedMcpQueue[] {
  return [
    getMcpEmbeddingsQueue(),
    getMcpOntologyQueue(),
    getMcpCleanupQueue(),
  ];
}

export async function getMcpQueueStatus(): Promise<McpWorkerStatus> {
  const queues = getQueues();
  const [counts, settings] = await Promise.all([
    Promise.all(queues.map(async (queue) => ({
      queueName: queue.name,
      counts: await queue.getJobCounts("waiting", "active", "delayed", "completed", "failed"),
    }))),
    db.setting.findMany({
      where: {
        key: {
          in: [
            "mcp_worker_started_at",
            "mcp_worker_last_seen_at",
            "mcp_worker_last_job_started_at",
            "mcp_worker_last_job_finished_at",
          ],
        },
      },
    }),
  ]);

  const settingMap = mapSettings(settings);
  const workerLastSeenAt = settingMap.mcp_worker_last_seen_at ?? null;
  const workerRunning = workerLastSeenAt !== null
    && (Date.now() - new Date(workerLastSeenAt).getTime()) <= (3 * 60 * 1000);
  const queueCounts = counts.reduce<Record<string, McpQueueCounts>>((accumulator, entry) => {
    accumulator[entry.queueName] = normalizeQueueCounts(entry.counts);
    return accumulator;
  }, {});

  return {
    queueNames: [MCP_EMBEDDINGS_QUEUE_NAME, MCP_ONTOLOGY_QUEUE_NAME, MCP_CLEANUP_QUEUE_NAME],
    workerRunning,
    workerStartedAt: settingMap.mcp_worker_started_at ?? null,
    workerLastSeenAt,
    workerLastJobStartedAt: settingMap.mcp_worker_last_job_started_at ?? null,
    workerLastJobFinishedAt: settingMap.mcp_worker_last_job_finished_at ?? null,
    counts: queueCounts,
  };
}

export async function listMcpJobs(
  statuses: McpJobStatus[] = ["waiting", "active", "delayed", "completed", "failed"],
  limit = 20,
): Promise<McpJobSummary[]> {
  const normalizedLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
  const queues = getQueues();
  const jobs = await Promise.all(queues.map(async (queue) => {
    const entries = await queue.getJobs(statuses, 0, normalizedLimit - 1, false);
    return Promise.all(entries.map(async (job) => {
      try {
        const state = await job.getState();
        return toJobSummary(job, queue.name, isKnownMcpJobStatus(state) ? state : "unknown");
      } catch {
        return toJobSummary(job, queue.name, "unknown");
      }
    }));
  }));

  return jobs
    .flat()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, normalizedLimit);
}

function getQueueByName(queueName: string): SupportedMcpQueue {
  switch (queueName) {
    case MCP_EMBEDDINGS_QUEUE_NAME:
      return getMcpEmbeddingsQueue();
    case MCP_ONTOLOGY_QUEUE_NAME:
      return getMcpOntologyQueue();
    case MCP_CLEANUP_QUEUE_NAME:
      return getMcpCleanupQueue();
    default:
      throw new Error(`Unsupported MCP queue: ${queueName}`);
  }
}

export async function retryMcpJob(queueName: string, jobId: string): Promise<{ retried: boolean; queueName: string; jobId: string }> {
  const queue = getQueueByName(queueName);
  const job = await queue.getJob(jobId);
  if (!job) {
    throw new Error(`MCP job not found: ${queueName}/${jobId}`);
  }

  await job.retry();
  return { retried: true, queueName, jobId };
}