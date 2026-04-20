/**
 * MCP Client — Connects to external MCP servers and wraps their tools
 * as BizBot RegisteredToolDefinitions so the agent kernel can call them.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { RegisteredToolDefinition, ToolExecutionResult, ToolParametersSchema, ToolSchemaProperties } from "@/lib/agent/tools";
import type {
  GetPromptResult,
  Prompt,
  ReadResourceResult,
  Resource,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { db } from "@/lib/db";
import { createMcpTraceCorrelationId, getMcpTraceServerSummary, recordMcpTraceEvent } from "@/lib/mcp/trace";

function isTextContentPart(value: unknown): value is { type: "text"; text: string } {
  return typeof value === "object" && value !== null && "type" in value && "text" in value
    && (value as { type?: unknown }).type === "text"
    && typeof (value as { text?: unknown }).text === "string";
}

export interface McpServerConfig {
  name: string;
  url: string;
  authToken?: string;
  enabled?: boolean;
}

interface ConnectedServer {
  config: McpServerConfig;
  client: Client;
  transport: StreamableHTTPClientTransport | SSEClientTransport;
  tools: RegisteredToolDefinition[];
  resources: Resource[];
  prompts: Prompt[];
  connected: boolean;
  connectedAt: string;
  lastInventorySyncAt: string;
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
function normalizeServerConfigs(configs: McpServerConfig[]): McpServerConfig[] {
  return configs.map((config) => ({
    ...config,
    enabled: config.enabled ?? true,
  }));
}

function getConnectedServer(serverName: string): ConnectedServer {
  const server = connectedServers.get(serverName);
  if (!server) {
    throw new Error(`No connected MCP server named ${serverName}`);
  }
  return server;
}

function summarizeToolResult(result: unknown): string {
  if (result === null || result === undefined) {
    return "empty result";
  }
  if (Array.isArray(result)) {
    return `${result.length} item(s)`;
  }
  if (typeof result === "object") {
    return `${Object.keys(result as Record<string, unknown>).length} field(s)`;
  }
  return typeof result;
}

function unwrapToolResult(result: Awaited<ReturnType<Client["callTool"]>>): ToolExecutionResult {
  const content = Array.isArray(result.content) ? result.content : [];

  if (result.isError) {
    const errorText = content
      .filter(isTextContentPart)
      .map((entry) => entry.text)
      .join("\n") || "Unknown MCP tool error";
    throw new Error(errorText);
  }

  const texts = content.filter(isTextContentPart).map((entry) => entry.text);
  if (texts.length === 1) {
    try {
      return JSON.parse(texts[0]);
    } catch {
      return { result: texts[0] };
    }
  }

  return { result: texts.join("\n") };
}

async function executeImportedTool(
  server: ConnectedServer,
  originalName: string,
  args: Record<string, unknown>,
  prefixedName?: string,
): Promise<ToolExecutionResult> {
  const startedAt = Date.now();
  const correlationId = createMcpTraceCorrelationId();

  try {
    const rawResult = await server.client.callTool({ name: originalName, arguments: args });
    const parsedResult = unwrapToolResult(rawResult);
    recordMcpTraceEvent({
      correlationId,
      serverName: server.config.name,
      serverUrl: server.config.url,
      operation: "tool_call",
      target: originalName,
      success: true,
      durationMs: Date.now() - startedAt,
      requestKeys: Object.keys(args ?? {}),
      resultSummary: summarizeToolResult(parsedResult),
      provenance: {
        ...(prefixedName ? { prefixedToolName: prefixedName } : {}),
        originalToolName: originalName,
      },
    });
    return parsedResult;
  } catch (error) {
    recordMcpTraceEvent({
      correlationId,
      serverName: server.config.name,
      serverUrl: server.config.url,
      operation: "tool_call",
      target: originalName,
      success: false,
      durationMs: Date.now() - startedAt,
      requestKeys: Object.keys(args ?? {}),
      error: error instanceof Error ? error.message : String(error),
      provenance: {
        ...(prefixedName ? { prefixedToolName: prefixedName } : {}),
        originalToolName: originalName,
      },
    });
    throw error;
  }
}

export async function getConfiguredMcpServerConfigs(): Promise<McpServerConfig[]> {
  // Check env first (simple JSON array), fall back to DB settings
  const envValue = process.env.MCP_SERVERS;
  if (envValue) {
    try {
      return normalizeServerConfigs(JSON.parse(envValue) as McpServerConfig[]);
    } catch {
      mcpClientLogger.warn("[mcp-client] MCP_SERVERS env is not valid JSON, skipping");
    }
  }

  try {
    const setting = await db.setting.findUnique({ where: { key: "mcp_servers" } });
    if (!setting) return [];
    return normalizeServerConfigs(JSON.parse(setting.value) as McpServerConfig[]);
  } catch {
    return [];
  }
}

async function loadServerConfigs(): Promise<McpServerConfig[]> {
  const configs = await getConfiguredMcpServerConfigs();
  return configs.filter((config) => config.enabled !== false);
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
    execute: async (args) => executeImportedTool(getConnectedServer(serverName), tool.name, args as Record<string, unknown>, prefixedName),
  };
}

/**
 * Connect to a single MCP server with Streamable HTTP, falling back to SSE.
 */
async function connectToServer(config: McpServerConfig): Promise<ConnectedServer | null> {
  const correlationId = createMcpTraceCorrelationId();
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

  const connectedAt = new Date().toISOString();
  recordMcpTraceEvent({
    correlationId,
    serverName: config.name,
    serverUrl: config.url,
    operation: "connect",
    target: config.url,
    success: true,
    resultSummary: "Connected successfully.",
  });
  recordMcpTraceEvent({
    correlationId,
    serverName: config.name,
    serverUrl: config.url,
    operation: "inventory_sync",
    target: config.url,
    success: true,
    resultSummary: `${wrappedTools.length} tools, ${allResources.length} resources, ${allPrompts.length} prompts`,
  });

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
    connectedAt,
    lastInventorySyncAt: connectedAt,
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
        recordMcpTraceEvent({
          correlationId: createMcpTraceCorrelationId(),
          serverName: config.name,
          serverUrl: config.url,
          operation: "disconnect",
          target: config.url,
          success: true,
        });
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

export function getMcpClientToolCatalog(): Array<{
  prefixedName: string;
  originalName: string;
  serverName: string;
  description: string;
}> {
  return Array.from(connectedServers.values()).flatMap((server) => server.tools.map((tool) => ({
    prefixedName: tool.name,
    originalName: tool.name.replace(new RegExp(`^mcp_${server.config.name}_`), ""),
    serverName: server.config.name,
    description: tool.description,
  })));
}

export async function invokeMcpClientTool(
  serverName: string,
  name: string,
  arguments_: Record<string, unknown> = {},
): Promise<unknown> {
  const server = getConnectedServer(serverName);
  return executeImportedTool(server, name, arguments_, `mcp_${serverName}_${name}`);
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
  const server = getConnectedServer(serverName);
  const startedAt = Date.now();
  const correlationId = createMcpTraceCorrelationId();
  try {
    const result = await server.client.readResource({ uri });
    recordMcpTraceEvent({
      correlationId,
      serverName,
      serverUrl: server.config.url,
      operation: "resource_read",
      target: uri,
      success: true,
      durationMs: Date.now() - startedAt,
      resultSummary: `${Array.isArray(result.contents) ? result.contents.length : 0} content part(s)`,
    });
    return result;
  } catch (error) {
    recordMcpTraceEvent({
      correlationId,
      serverName,
      serverUrl: server.config.url,
      operation: "resource_read",
      target: uri,
      success: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function getMcpClientPrompt(
  serverName: string,
  name: string,
  arguments_: Record<string, string> = {},
): Promise<GetPromptResult> {
  const server = getConnectedServer(serverName);
  const startedAt = Date.now();
  const correlationId = createMcpTraceCorrelationId();
  try {
    const result = await server.client.getPrompt({ name, arguments: arguments_ });
    recordMcpTraceEvent({
      correlationId,
      serverName,
      serverUrl: server.config.url,
      operation: "prompt_get",
      target: name,
      success: true,
      durationMs: Date.now() - startedAt,
      requestKeys: Object.keys(arguments_),
      resultSummary: `${Array.isArray(result.messages) ? result.messages.length : 0} message(s)`,
    });
    return result;
  } catch (error) {
    recordMcpTraceEvent({
      correlationId,
      serverName,
      serverUrl: server.config.url,
      operation: "prompt_get",
      target: name,
      success: false,
      durationMs: Date.now() - startedAt,
      requestKeys: Object.keys(arguments_),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
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

export async function reconnectMcpClients(): Promise<void> {
  await closeMcpClients();
  await ensureMcpClientsInitialized();
}

/**
 * Get status of all configured/connected MCP servers.
 */
export function getMcpClientStatus(): Array<{
  name: string;
  url: string;
  connected: boolean;
  toolCount: number;
  promptCount: number;
  resourceCount: number;
  hasAuthToken: boolean;
  lastSeenAt: string | null;
  latencyClass: "unknown" | "fast" | "moderate" | "slow";
}> {
  return Array.from(connectedServers.values()).map((s) => ({
    name: s.config.name,
    url: s.config.url,
    connected: s.connected,
    toolCount: s.tools.length,
    promptCount: s.prompts.length,
    resourceCount: s.resources.length,
    hasAuthToken: typeof s.config.authToken === "string" && s.config.authToken.trim().length > 0,
    lastSeenAt: getMcpTraceServerSummary(s.config.name).lastSeenAt ?? s.lastInventorySyncAt ?? s.connectedAt,
    latencyClass: getMcpTraceServerSummary(s.config.name).latencyClass,
  }));
}
