import "dotenv/config";
import { Worker } from "bullmq";
import { db } from "@/lib/db";
import { runAgentHeartbeat } from "@/lib/agent/heartbeat";
import {
  AGENT_HEARTBEAT_QUEUE_NAME,
  ensureAgentHeartbeatScheduler,
} from "@/lib/agent/heartbeat-queue";
import { createBullMqConnection } from "@/lib/queue/redis";
import { initMcpClients, closeMcpClients } from "@/lib/mcp/client";

async function setWorkerSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

async function recordWorkerPulse(): Promise<void> {
  await setWorkerSetting("agent_worker_last_seen_at", new Date().toISOString());
}

async function main(): Promise<void> {
  const connection = createBullMqConnection();

  await setWorkerSetting("agent_worker_started_at", new Date().toISOString());
  await recordWorkerPulse();
  await ensureAgentHeartbeatScheduler();

  // Connect to any configured external MCP servers
  await initMcpClients().catch((err) => {
    console.warn("[agent worker] MCP client init skipped:", err);
  });

  const pulseInterval = setInterval(() => {
    void recordWorkerPulse().catch((error) => {
      console.error("[agent worker pulse]", error);
    });
  }, 30_000);

  const worker = new Worker(
    AGENT_HEARTBEAT_QUEUE_NAME,
    async () => {
      await setWorkerSetting("agent_worker_last_job_started_at", new Date().toISOString());
      await recordWorkerPulse();

      const summary = await runAgentHeartbeat();

      await setWorkerSetting("agent_worker_last_job_finished_at", new Date().toISOString());
      await recordWorkerPulse();
      return summary;
    },
    {
      connection,
      concurrency: 1,
    },
  );

  worker.on("completed", (job) => {
    console.info(`[agent worker] completed job ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[agent worker] failed job ${job?.id ?? "unknown"}`, error);
  });

  worker.on("error", (error) => {
    console.error("[agent worker] worker error", error);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.info(`[agent worker] shutting down on ${signal}`);
    clearInterval(pulseInterval);
    await closeMcpClients();
    await worker.close();
    await connection.quit();
    await db.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  console.info(`[agent worker] listening on queue ${AGENT_HEARTBEAT_QUEUE_NAME}`);
}

void main().catch(async (error) => {
  console.error("[agent worker] bootstrap failed", error);
  await db.$disconnect();
  process.exit(1);
});