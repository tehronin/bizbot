import { describe, expect, it } from "vitest";
import { getPrismaLogLevels } from "@/lib/db";
import { configureStdioMcpEnvironment } from "@/lib/mcp/stdio";

describe("stdio MCP environment", () => {
  it("forces stdio-safe environment flags", () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "development" };

    configureStdioMcpEnvironment(env);

    expect(env.BIZBOT_MCP_STDIO).toBe("true");
    expect(env.BIZBOT_DISABLE_QUERY_LOGS).toBe("true");
  });

  it("disables query logs when stdio MCP flags are enabled", () => {
    expect(getPrismaLogLevels({ NODE_ENV: "development", BIZBOT_MCP_STDIO: "true" })).toEqual(["error", "warn"]);
    expect(getPrismaLogLevels({ NODE_ENV: "development", BIZBOT_DISABLE_QUERY_LOGS: "true" })).toEqual(["error", "warn"]);
    expect(getPrismaLogLevels({ NODE_ENV: "development" })).toEqual(["query", "error", "warn"]);
  });
});