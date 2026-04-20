import IORedis from "ioredis";

const globalForBullMq = globalThis as typeof globalThis & {
  bizbotBullMqConnection?: IORedis;
};

export function getRedisUrl(): string {
  return process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
}

export function createBullMqConnection(): IORedis {
  const connection = new IORedis(getRedisUrl(), {
    maxRetriesPerRequest: null,
  });

  connection.on("error", () => {
    // Status probes intentionally handle unavailable Redis downstream.
  });

  return connection;
}

export async function isBullMqRedisAvailable(timeoutMs = 500): Promise<boolean> {
  const connection = new IORedis(getRedisUrl(), {
    lazyConnect: true,
    connectTimeout: timeoutMs,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });

  connection.on("error", () => {
    // Availability probing should degrade quietly when Redis is offline.
  });

  try {
    await connection.connect();
    await connection.ping();
    return true;
  } catch {
    return false;
  } finally {
    connection.disconnect();
  }
}

export function getBullMqConnection(): IORedis {
  if (!globalForBullMq.bizbotBullMqConnection) {
    globalForBullMq.bizbotBullMqConnection = createBullMqConnection();
  }

  return globalForBullMq.bizbotBullMqConnection;
}