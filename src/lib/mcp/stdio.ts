export function configureStdioMcpEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  env.BIZBOT_MCP_STDIO = "true";
  if (!env.BIZBOT_DISABLE_QUERY_LOGS) {
    env.BIZBOT_DISABLE_QUERY_LOGS = "true";
  }
  return env;
}