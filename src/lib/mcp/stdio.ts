import type { BizBotMcpServerOptions } from "@/lib/mcp/policy";

export function configureStdioMcpEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  env.BIZBOT_MCP_STDIO = "true";
  env.BIZBOT_MCP_TRANSPORT = "stdio";
  env.BIZBOT_MCP_SAMPLING_ENABLED = "true";
  if (!env.BIZBOT_DISABLE_QUERY_LOGS) {
    env.BIZBOT_DISABLE_QUERY_LOGS = "true";
  }
  return env;
}

export function getStdioMcpServerOptions(): BizBotMcpServerOptions {
  return {
    transportKind: "stdio",
    enableSampling: true,
  };
}