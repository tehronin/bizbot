import { Queue, type Job } from "bullmq";
import { db } from "@/lib/db";
import { getAgentRuntimeConfig } from "@/lib/agent/runtime";
import { getBullMqConnection, getRedisUrl } from "@/lib/queue/redis";

export const AGENT_HEARTBEAT_QUEUE_NAME = "bizbot-agent-heartbeat";
export const AGENT_HEARTBEAT_SCHEDULER_ID = "primary";
const AGENT_HEARTBEAT_JOB_NAME = "tick";

export interface AgentHeartbeatJobData {
  trigger: "manual" | "scheduler";
  requestedAt: string;
}

export interface AgentWorkerStatus {
  queueName: string;
  schedulerId: string;
  redisUrl: string;
  schedulerRegistered: boolean;
  schedulerEveryMs: number | null;
  workerRunning: boolean;
  workerStartedAt: string | null;
  workerLastSeenAt: string | null;
  workerLastJobStartedAt: string | null;
  workerLastJobFinishedAt: string | null;
  counts: {
    waiting: number;
    active: number;
    delayed: number;
    completed: number;
    failed: number;
  };
}

export type AgentHeartbeatJobStatus = "waiting" | "active" | "delayed" | "completed" | "failed";

export interface AgentHeartbeatJobSummary {
  id: string;
  name: string;
  status: AgentHeartbeatJobStatus | "unknown";
  data: AgentHeartbeatJobData;
  attemptsMade: number;
  failedReason: string | null;
  createdAt: string;
  processedAt: string | null;
  finishedAt: string | null;
}

const globalForAgentQueue = globalThis as typeof globalThis & {
  bizbotAgentHeartbeatQueue?: Queue<AgentHeartbeatJobData>;
};

function getAgentHeartbeatQueue(): Queue<AgentHeartbeatJobData> {
  if (!globalForAgentQueue.bizbotAgentHeartbeatQueue) {
    globalForAgentQueue.bizbotAgentHeartbeatQueue = new Queue<AgentHeartbeatJobData>(
      AGENT_HEARTBEAT_QUEUE_NAME,
      {
        connection: getBullMqConnection(),
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      },
    );
  }

  return globalForAgentQueue.bizbotAgentHeartbeatQueue;
}

function mapSettings(rows: Array<{ key: string; value: string }>): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

async function setWorkerSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function ensureAgentHeartbeatScheduler(): Promise<{
  queueName: string;
  schedulerId: string;
  heartbeatSeconds: number;
}> {
  const queue = getAgentHeartbeatQueue();
  const heartbeatSeconds = Math.max(15, getAgentRuntimeConfig().heartbeatSeconds);

  await queue.upsertJobScheduler(
    AGENT_HEARTBEAT_SCHEDULER_ID,
    { every: heartbeatSeconds * 1000 },
    {
      name: AGENT_HEARTBEAT_JOB_NAME,
      data: {
        trigger: "scheduler",
        requestedAt: new Date().toISOString(),
      },
      opts: {
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    },
  );

  await setWorkerSetting("agent_worker_scheduler_updated_at", new Date().toISOString());

  return {
    queueName: AGENT_HEARTBEAT_QUEUE_NAME,
    schedulerId: AGENT_HEARTBEAT_SCHEDULER_ID,
    heartbeatSeconds,
  };
}

export async function enqueueAgentHeartbeat(
  trigger: AgentHeartbeatJobData["trigger"] = "manual",
): Promise<Job<AgentHeartbeatJobData>> {
  const queue = getAgentHeartbeatQueue();
  return queue.add(AGENT_HEARTBEAT_JOB_NAME, {
    trigger,
    requestedAt: new Date().toISOString(),
  });
}

function toJobSummary(job: Job<AgentHeartbeatJobData>, status: AgentHeartbeatJobStatus | "unknown"): AgentHeartbeatJobSummary {
  return {
    id: String(job.id),
    name: job.name,
    status,
    data: job.data,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason ?? null,
    createdAt: new Date(job.timestamp).toISOString(),
    processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
    finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
  };
}

export async function listAgentHeartbeatJobs(
  statuses: AgentHeartbeatJobStatus[] = ["waiting", "active", "delayed", "completed", "failed"],
  limit = 20,
): Promise<AgentHeartbeatJobSummary[]> {
  const queue = getAgentHeartbeatQueue();
  const normalizedLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
  const jobs = await queue.getJobs(statuses, 0, normalizedLimit - 1, false);

  return Promise.all(jobs.map(async (job) => {
    let status: AgentHeartbeatJobStatus | "unknown" = "unknown";
    try {
      const state = await job.getState();
      if (["waiting", "active", "delayed", "completed", "failed"].includes(state)) {
        status = state as AgentHeartbeatJobStatus;
      }
    } catch {
      status = "unknown";
    }

    return toJobSummary(job, status);
  }));
}

export async function retryAgentHeartbeatJob(jobId: string): Promise<{ retried: boolean; jobId: string }> {
  const queue = getAgentHeartbeatQueue();
  const job = await queue.getJob(jobId);
  if (!job) {
    throw new Error(`Heartbeat job not found: ${jobId}`);
  }

  await job.retry();
  return { retried: true, jobId };
}

export async function getAgentWorkerStatus(): Promise<AgentWorkerStatus> {
  const queue = getAgentHeartbeatQueue();
  const heartbeatSeconds = Math.max(15, getAgentRuntimeConfig().heartbeatSeconds);

  const [scheduler, counts, settings] = await Promise.all([
    queue.getJobScheduler(AGENT_HEARTBEAT_SCHEDULER_ID),
    queue.getJobCounts("waiting", "active", "delayed", "completed", "failed"),
    db.setting.findMany({
      where: {
        key: {
          in: [
            "agent_worker_started_at",
            "agent_worker_last_seen_at",
            "agent_worker_last_job_started_at",
            "agent_worker_last_job_finished_at",
          ],
        },
      },
    }),
  ]);

  const settingMap = mapSettings(settings);
  const workerLastSeenAt = settingMap.agent_worker_last_seen_at ?? null;
  const workerRunning = workerLastSeenAt !== null
    && (Date.now() - new Date(workerLastSeenAt).getTime()) <= ((heartbeatSeconds * 2) + 120) * 1000;

  return {
    queueName: AGENT_HEARTBEAT_QUEUE_NAME,
    schedulerId: AGENT_HEARTBEAT_SCHEDULER_ID,
    redisUrl: getRedisUrl(),
    schedulerRegistered: scheduler !== undefined,
    schedulerEveryMs: typeof scheduler?.every === "number" ? scheduler.every : null,
    workerRunning,
    workerStartedAt: settingMap.agent_worker_started_at ?? null,
    workerLastSeenAt,
    workerLastJobStartedAt: settingMap.agent_worker_last_job_started_at ?? null,
    workerLastJobFinishedAt: settingMap.agent_worker_last_job_finished_at ?? null,
    counts: {
      waiting: counts.waiting,
      active: counts.active,
      delayed: counts.delayed,
      completed: counts.completed,
      failed: counts.failed,
    },
  };
}