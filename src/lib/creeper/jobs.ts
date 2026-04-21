import { Queue, type JobsOptions } from "bullmq";
import { getBullMqConnection } from "@/lib/queue/redis";

export const CREEPER_INGESTION_QUEUE_NAME = "bizbot-creeper-ingestion";

export interface CreeperIngestionJobData {
  runId: string;
  planId: string;
  companyProfileId: string;
  sourceId: string;
  requestedAt: string;
}

type CreeperQueueRegistry = {
  ingestion?: Queue<CreeperIngestionJobData>;
};

const globalForCreeperQueues = globalThis as typeof globalThis & {
  bizbotCreeperQueues?: CreeperQueueRegistry;
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

function getRegistry(): CreeperQueueRegistry {
  if (!globalForCreeperQueues.bizbotCreeperQueues) {
    globalForCreeperQueues.bizbotCreeperQueues = {};
  }

  return globalForCreeperQueues.bizbotCreeperQueues;
}

export function getCreeperIngestionQueue(): Queue<CreeperIngestionJobData> {
  const registry = getRegistry();
  if (!registry.ingestion) {
    registry.ingestion = new Queue<CreeperIngestionJobData>(CREEPER_INGESTION_QUEUE_NAME, {
      connection: getBullMqConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }

  return registry.ingestion;
}

export async function enqueueCreeperIngestionJob(data: CreeperIngestionJobData) {
  return getCreeperIngestionQueue().add("run-company-ingestion", data, {
    jobId: ["creeper-ingest", data.runId, data.planId].join("__"),
  });
}