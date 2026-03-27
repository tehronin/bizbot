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