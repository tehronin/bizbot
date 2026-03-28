/**
 * MCP Client — Connects to external MCP servers and wraps their tools
 * as BizBot RegisteredToolDefinitions so the agent kernel can call them.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { RegisteredToolDefinition, ToolParametersSchema, ToolSchemaProperties } from "@/lib/agent/tools";
import type {
  GetPromptResult,
  Prompt,
  ReadResourceResult,
  Resource,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { db } from "@/lib/db";

function isTextContentPart(value: unknown): value is { type: "text"; text: string } {
  return typeof value === "object" && value !== null && "type" in value && "text" in value
    && (value as { type?: unknown }).type === "text"
    && typeof (value as { text?: unknown }).text === "string";
}

interface McpServerConfig {
  name: string;
  url: string;
  authToken?: string;
}

interface ConnectedServer {
  config: McpServerConfig;
  client: Client;
  transport: StreamableHTTPClientTransport | SSEClientTransport;
  tools: RegisteredToolDefinition[];
  resources: Resource[];
  prompts: Prompt[];
  connected: boolean;
}

type McpClientLogger = Pick<typeof console, "info" | "warn" | "error">;

export type ImportedMcpResource = {
  serverName: string;
  resource: Resource;
};

export type ImportedMcpPrompt = {
  serverName: string;
  prompt: Prompt;
};

const connectedServers: Map<string, ConnectedServer> = new Map();
let initPromise: Promise<void> | null = null;
let mcpClientLogger: McpClientLogger = console;

export function setMcpClientLogger(logger: McpClientLogger): void {
  mcpClientLogger = logger;
}

export function resetMcpClientLogger(): void {
  mcpClientLogger = console;
}

/**
 * Load MCP server configurations from the database Setting table.
 * Expects a JSON array stored under key "mcp_servers":
 *   [{ "name": "github", "url": "http://localhost:4000/mcp", "authToken": "..." }]
 */
async function loadServerConfigs(): Promise<McpServerConfig[]> {
  // Check env first (simple JSON array), fall back to DB settings
  const envValue = process.env.MCP_SERVERS;
  if (envValue) {
    try {
      return JSON.parse(envValue) as McpServerConfig[];
    } catch {
      mcpClientLogger.warn("[mcp-client] MCP_SERVERS env is not valid JSON, skipping");
    }
  }

  try {
    const setting = await db.setting.findUnique({ where: { key: "mcp_servers" } });
    if (!setting) return [];
    return JSON.parse(setting.value) as McpServerConfig[];
  } catch {
    return [];
  }
}

/**
 * Convert an MCP Tool definition to a BizBot RegisteredToolDefinition.
 */
function mcpToolToRegistered(serverName: string, tool: Tool, client: Client): RegisteredToolDefinition {
  const prefixedName = `mcp_${serverName}_${tool.name}`;

  const inputSchema = tool.inputSchema ?? { type: "object", properties: {} };
  const parameters: ToolParametersSchema = {
    type: "object",
    properties: (inputSchema.properties ?? {}) as ToolSchemaProperties,
    ...(inputSchema.required ? { required: inputSchema.required } : {}),
  };

  return {
    name: prefixedName,
    description: `[${serverName}] ${tool.description ?? tool.name}`,
    parameters,
    execute: async (args) => {
      const result = await client.callTool({ name: tool.name, arguments: args });
      const content = Array.isArray(result.content) ? result.content : [];

      if (result.isError) {
        const errorText = content
          .filter(isTextContentPart)
          .map((c) => c.text)
          .join("\n") ?? "Unknown MCP tool error";
        throw new Error(errorText);
      }
      const texts = content
        .filter(isTextContentPart)
        .map((c) => c.text) ?? [];
      if (texts.length === 1) {
        try { return JSON.parse(texts[0]); } catch { return { result: texts[0] }; }
      }
      return { result: texts.join("\n") };
    },
  };
}

/**
 * Connect to a single MCP server with Streamable HTTP, falling back to SSE.
 */
async function connectToServer(config: McpServerConfig): Promise<ConnectedServer | null> {
  const url = new URL(config.url);
  const fetchOptions = config.authToken
    ? {
        requestInit: {
          headers: { Authorization: `Bearer ${config.authToken}` },
        },
      }
    : undefined;

  // Try Streamable HTTP first, fall back to SSE
  let client: Client;
  let transport: StreamableHTTPClientTransport | SSEClientTransport;

  try {
    client = new Client({ name: "bizbot", version: "0.1.0" });
    transport = new StreamableHTTPClientTransport(url, fetchOptions);
    await client.connect(transport);
  } catch {
    try {
      client = new Client({ name: "bizbot", version: "0.1.0" });
      transport = new SSEClientTransport(url, fetchOptions);
      await client.connect(transport);
    } catch (err) {
      mcpClientLogger.error(`[mcp-client] Failed to connect to ${config.name} at ${config.url}:`, err);
      return null;
    }
  }

  // Discover tools
  const allTools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const { tools, nextCursor } = await client.listTools({ cursor });
    allTools.push(...tools);
    cursor = nextCursor;
  } while (cursor);

  const wrappedTools = allTools.map((t) => mcpToolToRegistered(config.name, t, client));

  const allResources: Resource[] = [];
  cursor = undefined;
  do {
    const { resources, nextCursor } = await client.listResources({ cursor });
    allResources.push(...resources);
    cursor = nextCursor;
  } while (cursor);

  const allPrompts: Prompt[] = [];
  cursor = undefined;
  do {
    const { prompts, nextCursor } = await client.listPrompts({ cursor });
    allPrompts.push(...prompts);
    cursor = nextCursor;
  } while (cursor);

  mcpClientLogger.info(
    `[mcp-client] Connected to ${config.name} — ${wrappedTools.length} tools, ${allResources.length} resources, ${allPrompts.length} prompts`,
  );

  return {
    config,
    client,
    transport,
    tools: wrappedTools,
    resources: allResources,
    prompts: allPrompts,
    connected: true,
  };
}

/**
 * Initialize all configured MCP clients. Call once at startup.
 * Safe to call multiple times — reconnects stale connections.
 */
export async function initMcpClients(): Promise<void> {
  const configs = await loadServerConfigs();
  if (configs.length === 0) return;

  for (const config of configs) {
    // Skip if already connected
    if (connectedServers.has(config.name)) continue;

    const connected = await connectToServer(config);
    if (connected) {
      connected.client.onclose = () => {
        mcpClientLogger.info(`[mcp-client] Disconnected from ${config.name}`);
        connected.connected = false;
        connectedServers.delete(config.name);
      };
      connectedServers.set(config.name, connected);
    }
  }
}

export async function ensureMcpClientsInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = initMcpClients().catch((error) => {
      initPromise = null;
      throw error;
    });
  }

  await initPromise;
}

/**
 * Get all tool definitions from connected MCP servers.
 */
export function getMcpClientTools(): RegisteredToolDefinition[] {
  const tools: RegisteredToolDefinition[] = [];
  for (const server of connectedServers.values()) {
    tools.push(...server.tools);
  }
  return tools;
}

export function getMcpClientResources(): ImportedMcpResource[] {
  return Array.from(connectedServers.values()).flatMap((server) => server.resources.map((resource) => ({
    serverName: server.config.name,
    resource,
  })));
}

export function getMcpClientPrompts(): ImportedMcpPrompt[] {
  return Array.from(connectedServers.values()).flatMap((server) => server.prompts.map((prompt) => ({
    serverName: server.config.name,
    prompt,
  })));
}

export async function readMcpClientResource(serverName: string, uri: string): Promise<ReadResourceResult> {
  const server = connectedServers.get(serverName);
  if (!server) {
    throw new Error(`No connected MCP server named ${serverName}`);
  }

  return server.client.readResource({ uri });
}

export async function getMcpClientPrompt(
  serverName: string,
  name: string,
  arguments_: Record<string, string> = {},
): Promise<GetPromptResult> {
  const server = connectedServers.get(serverName);
  if (!server) {
    throw new Error(`No connected MCP server named ${serverName}`);
  }

  return server.client.getPrompt({ name, arguments: arguments_ });
}

/**
 * Disconnect all MCP clients. Call on shutdown.
 */
export async function closeMcpClients(): Promise<void> {
  for (const [name, connected] of connectedServers) {
    try {
      await connected.client.close();
    } catch {
      // Ignore close errors
    }
    connectedServers.delete(name);
    mcpClientLogger.info(`[mcp-client] Closed ${name}`);
  }

  initPromise = null;
}

/**
 * Get status of all configured/connected MCP servers.
 */
export function getMcpClientStatus(): { name: string; url: string; connected: boolean; toolCount: number }[] {
  return Array.from(connectedServers.values()).map((s) => ({
    name: s.config.name,
    url: s.config.url,
    connected: s.connected,
    toolCount: s.tools.length,
  }));
}
