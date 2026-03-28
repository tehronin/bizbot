import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

export function getPrismaLogLevels(env: NodeJS.ProcessEnv = process.env): Array<"query" | "error" | "warn"> {
  if (env.NODE_ENV !== "development") {
    return ["error"];
  }

  const disableQueryLogs = [env.BIZBOT_DISABLE_QUERY_LOGS, env.BIZBOT_MCP_STDIO]
    .some((value) => value === "1" || value === "true");

  return disableQueryLogs ? ["error", "warn"] : ["query", "error", "warn"];
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: getPrismaLogLevels(),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
