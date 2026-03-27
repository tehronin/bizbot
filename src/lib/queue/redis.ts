import IORedis from "ioredis";

const globalForBullMq = globalThis as typeof globalThis & {
  bizbotBullMqConnection?: IORedis;
};

export function getRedisUrl(): string {
  return process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
}

export function createBullMqConnection(): IORedis {
  return new IORedis(getRedisUrl(), {
    maxRetriesPerRequest: null,
  });
}

export function getBullMqConnection(): IORedis {
  if (!globalForBullMq.bizbotBullMqConnection) {
    globalForBullMq.bizbotBullMqConnection = createBullMqConnection();
  }

  return globalForBullMq.bizbotBullMqConnection;
}