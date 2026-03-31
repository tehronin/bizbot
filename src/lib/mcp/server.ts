/**
 * MCP Server — Exposes BizBot's agent tools, resources, and prompts
 * over the Model Context Protocol so external agents (Claude Desktop,
 * VS Code Copilot, Cursor, etc.) can interact with the app.
 */

import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAgentWorkerStatus } from "@/lib/agent/heartbeat-queue";
import { getKnowledgeStatus } from "@/lib/agent/knowledge-status";
import { inspectMemories, listRecentConversations } from "@/lib/agent/memory";
import { DEFAULT_AGENT_USER_ID } from "@/lib/agent/user-context";
import { listAgentHeartbeatJobs } from "@/lib/agent/heartbeat-queue";
import { listRecentAgentRuns } from "@/lib/agent/run-journal";
import { listAgentProfileDescriptors } from "@/lib/agent/profiles";
import { createPluginRegistry, getAllToolDefinitions, getBuiltinPlugins, executeTool } from "@/lib/agent/plugins";
import { getActiveCrmProvider, getCrmProviderStatuses, listCrmContacts } from "@/lib/crm";
import { getActiveProvider, getConfiguredProviders, getGenerationConfig, getModelForProvider } from "@/lib/agent/kernel";
import { getAgentRuntimeConfig, getAutonomyDescription, getAgentCapabilities } from "@/lib/agent/runtime";
import type { JsonObject, ToolParametersSchema, ToolPropertySchema } from "@/lib/agent/tools";
import { db } from "@/lib/db";
import { getEmbeddingConfig } from "@/lib/embeddings/embed";
import { getMcpClientStatus, getMcpClientTools } from "@/lib/mcp/client";
import { listBizBotPromptDefinitions, listBizBotResourceDefinitions } from "@/lib/mcp/preview-catalog";
import { getToolAnnotations, getToolDescription, getToolTitle, MCP_AGENT_PROFILE, MCP_BLOCKED_TOOLS } from "@/lib/mcp/tool-presentation";
import { z } from "zod/v4";

const MAX_MCP_RESULT_CHARS = 8_000;
const DEV_LOG_TAIL_LINES = 120;
const DEV_LOG_ISSUE_LIMIT = 30;

type DevLogEntry = {
  timestamp?: string;
  source?: string;
  level?: string;
  message?: string;
};

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n…[truncated ${text.length - max} chars]`;
}

function propertySchemaToZod(schema: ToolPropertySchema): z.ZodTypeAny {
  switch (schema.type) {
    case "string": {
      if (schema.enum?.length) {
        return z.enum(schema.enum as [string, ...string[]]);
      }
      return z.string();
    }
    case "number":
      return z.number().finite();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(schema.items ? propertySchemaToZod(schema.items) : z.unknown());
    case "json":
      return z.unknown();
    case "object": {
      const shape: Record<string, z.ZodTypeAny> = {};
      const properties = schema.properties ?? {};
      const required = new Set(Array.isArray(schema.required) ? schema.required : []);

      for (const [key, nestedSchema] of Object.entries(properties)) {
        if (!nestedSchema) {
          continue;
        }

        let nested = propertySchemaToZod(nestedSchema);
        if (nestedSchema.default !== undefined) {
          nested = nested.default(nestedSchema.default);
        }
        if (!required.has(key) && nestedSchema.default === undefined) {
          nested = nested.optional();
        }
        shape[key] = nested;
      }

      const objectSchema = z.object(shape);
      return schema.additionalProperties === false ? objectSchema.strict() : objectSchema.passthrough();
    }
  }
}

function parametersSchemaToZod(schema: ToolParametersSchema): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);

  for (const [key, propertySchema] of Object.entries(schema.properties)) {
    if (!propertySchema) {
      continue;
    }

    let property = propertySchemaToZod(propertySchema);
    if (propertySchema.default !== undefined) {
      property = property.default(propertySchema.default);
    }
    if (!required.has(key) && propertySchema.default === undefined) {
      property = property.optional();
    }
    shape[key] = property;
  }

  const objectSchema = z.object(shape);
  return schema.additionalProperties === false ? objectSchema.strict() : objectSchema.passthrough();
}

function buildToolResponse(result: unknown) {
  const text = truncate(
    typeof result === "string" ? result : JSON.stringify(result),
    MAX_MCP_RESULT_CHARS,
  );

  if (typeof result === "object" && result !== null && !Array.isArray(result)) {
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: result as JsonObject,
    };
  }

  return {
    content: [{ type: "text" as const, text }],
    structuredContent: { result: text },
  };
}

function getNextDevLogPath(): string {
  return path.join(process.cwd(), ".next", "dev", "logs", "next-development.log");
}

function readRecentDevLogEntries(limit = DEV_LOG_TAIL_LINES): DevLogEntry[] {
  const logPath = getNextDevLogPath();
  if (!fs.existsSync(logPath)) {
    return [];
  }

  const raw = fs.readFileSync(logPath, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const entries = lines.slice(-limit).flatMap((line) => {
    try {
      return [JSON.parse(line) as DevLogEntry];
    } catch {
      return [{ level: "LOG", source: "Server", message: line } satisfies DevLogEntry];
    }
  });

  return entries;
}

function getRecentDevLogIssues(limit = DEV_LOG_ISSUE_LIMIT): DevLogEntry[] {
  return readRecentDevLogEntries(Math.max(limit * 4, DEV_LOG_TAIL_LINES))
    .filter((entry) => ["ERROR", "WARN", "WARNING"].includes((entry.level ?? "").toUpperCase()))
    .slice(-limit);
}

function parseHeartbeatSummary(summary: string | null | undefined): JsonObject | null {
  if (!summary) {
    return null;
  }

  try {
    const parsed = JSON.parse(summary) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
  } catch {
    return { raw: summary };
  }

  return null;
}


async function buildDebugSystemStatus() {
  const activeProvider = getActiveProvider();

  const [workerStatus, knowledgeStatus, inboxCounts, pendingApprovals, mcpClients] = await Promise.all([
    getAgentWorkerStatus(),
    Promise.resolve(getKnowledgeStatus()),
    db.inboxMessage.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    db.postApproval.count({ where: { status: "PENDING" } }),
    Promise.resolve(getMcpClientStatus()),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    runtime: {
      config: getAgentRuntimeConfig(),
      capabilities: getAgentCapabilities(),
      autonomyDescription: getAutonomyDescription(),
    },
    llm: {
      activeProvider,
      activeModel: getModelForProvider(activeProvider),
      configuredProviders: getConfiguredProviders(),
      generation: getGenerationConfig(),
      embedding: getEmbeddingConfig(),
    },
    worker: workerStatus,
    knowledge: knowledgeStatus,
    inbox: {
      countsByStatus: Object.fromEntries(inboxCounts.map((row) => [row.status, row._count._all])),
    },
    approvals: {
      pendingCount: pendingApprovals,
    },
    mcp: {
      importedServers: mcpClients,
      httpEndpoint: "/api/mcp",
      workspaceConfigPath: ".vscode/mcp.json",
    },
  };
}

async function buildDebugDatabaseSummary() {
  const [
    conversationCount,
    messageCount,
    memoryCount,
    postCount,
    pendingApprovalCount,
    inboxCount,
    openInboxCount,
    competitorWatchCount,
  ] = await Promise.all([
    db.conversation.count(),
    db.message.count(),
    db.memory.count(),
    db.post.count(),
    db.postApproval.count({ where: { status: "PENDING" } }),
    db.inboxMessage.count(),
    db.inboxMessage.count({ where: { status: { in: ["OPEN", "PROCESSING"] } } }),
    db.competitorWatch.count(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      conversations: conversationCount,
      messages: messageCount,
      memories: memoryCount,
      posts: postCount,
      pendingApprovals: pendingApprovalCount,
      inboxMessages: inboxCount,
      openInboxMessages: openInboxCount,
      competitorWatches: competitorWatchCount,
    },
  };
}

async function buildDebugRecentHeartbeat() {
  const settings = await db.setting.findMany({
    where: {
      key: {
        in: [
          "agent_last_heartbeat_started_at",
          "agent_last_heartbeat_finished_at",
          "agent_last_heartbeat_summary",
          "agent_stream_abort_count",
          "agent_stream_last_aborted_at",
          "agent_worker_started_at",
          "agent_worker_last_seen_at",
          "agent_worker_last_job_started_at",
          "agent_worker_last_job_finished_at",
        ],
      },
    },
    orderBy: { key: "asc" },
  });

  return {
    generatedAt: new Date().toISOString(),
    settings: Object.fromEntries(settings.map((row) => [row.key, row.value])),
    worker: await getAgentWorkerStatus(),
  };
}

async function buildDebugRecentInbox() {
  const recentItems = await db.inboxMessage.findMany({
    orderBy: { receivedAt: "desc" },
    take: 20,
    select: {
      id: true,
      platform: true,
      channelType: true,
      status: true,
      externalId: true,
      threadId: true,
      authorName: true,
      authorHandle: true,
      content: true,
      replyContent: true,
      leadStage: true,
      leadScore: true,
      leadSummary: true,
      cannedResponseNodeKey: true,
      createdAt: true,
      receivedAt: true,
      updatedAt: true,
    },
  });

  return {
    generatedAt: new Date().toISOString(),
    items: recentItems,
  };
}

async function buildDebugRecentLog() {
  const logPath = getNextDevLogPath();
  const entries = readRecentDevLogEntries();
  const issues = getRecentDevLogIssues();

  return {
    generatedAt: new Date().toISOString(),
    logPath,
    exists: fs.existsSync(logPath),
    issueCount: issues.length,
    recentIssues: issues,
    recentEntries: entries,
  };
}

async function buildDebugRecentFailures() {
  const [failedInbox, failedPosts, heartbeatSettings] = await Promise.all([
    db.inboxMessage.findMany({
      where: { status: "FAILED" },
      include: { platform: true, cannedResponseTree: true },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    db.post.findMany({
      where: { status: "FAILED" },
      include: { platform: true, approval: true },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    db.setting.findMany({
      where: {
        key: {
          in: [
            "agent_last_heartbeat_summary",
            "agent_last_heartbeat_started_at",
            "agent_last_heartbeat_finished_at",
            "agent_stream_abort_count",
            "agent_stream_last_aborted_at",
          ],
        },
      },
    }),
  ]);

  const settingMap = Object.fromEntries(heartbeatSettings.map((row) => [row.key, row.value]));

  return {
    generatedAt: new Date().toISOString(),
    heartbeat: {
      startedAt: settingMap.agent_last_heartbeat_started_at ?? null,
      finishedAt: settingMap.agent_last_heartbeat_finished_at ?? null,
      summary: parseHeartbeatSummary(settingMap.agent_last_heartbeat_summary),
      streamAbortCount: settingMap.agent_stream_abort_count ?? "0",
      streamLastAbortedAt: settingMap.agent_stream_last_aborted_at ?? null,
    },
    failedInbox,
    failedPosts,
    recentLogIssues: getRecentDevLogIssues(),
  };
}

async function buildDebugWorkerJobs() {
  return {
    generatedAt: new Date().toISOString(),
    worker: await getAgentWorkerStatus(),
    jobs: await listAgentHeartbeatJobs(["waiting", "active", "delayed", "completed", "failed"], 25),
  };
}

async function buildDebugMemorySummary() {
  const [memories, conversations] = await Promise.all([
    inspectMemories({ limit: 20 }),
    listRecentConversations({ limit: 20 }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    memories,
    conversations,
  };
}

async function buildDebugAgentRuns() {
  return {
    generatedAt: new Date().toISOString(),
    profiles: listAgentProfileDescriptors().map((profile) => ({
      id: profile.id,
      label: profile.label,
      mission: profile.mission,
      delegationTargets: profile.delegationTargets,
      toolPolicy: profile.toolPolicy,
    })),
    runs: listRecentAgentRuns(20),
  };
}

async function buildCrmPipelineSummary() {
  const [providers, stageCounts, contacts] = await Promise.all([
    getCrmProviderStatuses(),
    db.inboxMessage.groupBy({
      by: ["leadStage"],
      where: {
        leadStage: {
          not: "NONE",
        },
      },
      _count: { _all: true },
    }),
    listCrmContacts({ limit: 25 }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    activeProvider: getActiveCrmProvider(),
    providers,
    countsByStage: Object.fromEntries(stageCounts.map((row) => [row.leadStage, row._count._all])),
    contacts,
  };
}

function buildPluginResourcePayload(allowedTools: Array<{ name: string; description: string }>) {
  const registry = createPluginRegistry(getBuiltinPlugins(), getMcpClientTools());
  const allowedToolNames = new Set(allowedTools.map((tool) => tool.name));

  const plugins = registry.plugins
    .map((plugin) => {
      const tools = plugin.tools
        .filter((tool) => allowedToolNames.has(tool.name))
        .map((tool) => ({
          name: tool.name,
          title: getToolTitle(tool.name),
          description: tool.description,
          annotations: getToolAnnotations(tool.name),
        }));

      return {
        ...plugin.metadata,
        tools,
      };
    })
    .filter((plugin) => plugin.tools.length > 0);

  const toolMap = registry.tools
    .filter((tool) => allowedToolNames.has(tool.name))
    .map((tool) => ({
      toolName: tool.name,
      pluginId: registry.toolToPluginId.get(tool.name) ?? "unknown",
      title: getToolTitle(tool.name),
      description: tool.description,
      annotations: getToolAnnotations(tool.name),
    }));

  const externalTools = toolMap.filter((tool) => tool.pluginId === "external-mcp");

  return {
    generatedAt: new Date().toISOString(),
    plugins,
    externalTools,
    toolMap,
  };
}

/**
 * Creates a fresh McpServer with all BizBot tools, resources, and prompts
 * registered. Returns a new instance each time (needed for stateless HTTP).
 */
export function createBizBotMcpServer(): McpServer {
  const config = getAgentRuntimeConfig();

  const server = new McpServer(
    { name: "bizbot", version: "0.1.0" },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
      },
      instructions: [
        "BizBot is a local-first social media agent.",
        `Autonomy: ${config.autonomyPreset}. ${getAutonomyDescription(config)}`,
        `MCP tool execution is bounded to the ${MCP_AGENT_PROFILE} lane for control-plane safety.`,
        "When debugging, inspect BizBot debug resources before mutating tools.",
        "Tools prefixed with social_ interact with live social platforms.",
        "Tools prefixed with approval_ manage the human review queue.",
        "Tools prefixed with memory_ store and recall long-term knowledge.",
        "Tools prefixed with builder_ operate only inside a dedicated external builder workspace and require explicit command allowlisting.",
        "Tools prefixed with browser_ navigate the web via Playwright.",
      ].join(" "),
    },
  );

  const tools = getAllToolDefinitions(config, { agentProfile: MCP_AGENT_PROFILE })
    .filter((tool) => !MCP_BLOCKED_TOOLS.has(tool.name));
  const pluginResourcePayload = buildPluginResourcePayload(tools);

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: getToolTitle(tool.name),
        description: getToolDescription(tool.name, tool.description),
        inputSchema: parametersSchemaToZod(tool.parameters),
        annotations: getToolAnnotations(tool.name),
      },
      async (args) => {
        try {
          const result = await executeTool(tool.name, args as JsonObject, {
            config,
            access: {
              agentProfile: MCP_AGENT_PROFILE,
              userId: DEFAULT_AGENT_USER_ID,
              provider: getActiveProvider(),
            },
          });
          return buildToolResponse(result);
        } catch (error) {
          return {
            content: [{ type: "text" as const, text: String(error) }],
            isError: true,
          };
        }
      },
    );
  }

  // ── Resources ────────────────────────────────────────────────────
  for (const resource of listBizBotResourceDefinitions()) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        title: resource.title,
        description: resource.description,
        mimeType: resource.mimeType,
      },
      async () => ({
        contents: [
          {
            uri: resource.uri,
            text: JSON.stringify(await resource.read(), null, 2),
            mimeType: resource.mimeType,
          },
        ],
      }),
    );
  }

  // ── Prompts ──────────────────────────────────────────────────────
  for (const prompt of listBizBotPromptDefinitions()) {
    const argsSchema = Object.fromEntries(prompt.arguments.map((argument) => [argument.name, argument.required ? z.string() : z.string().optional()]));

    server.registerPrompt(
      prompt.name,
      {
        title: prompt.title,
        description: prompt.description,
        argsSchema,
      },
      (args: Record<string, string | undefined>) => ({
        messages: prompt.render(args).messages.map((message) => ({
          role: message.role,
          content: {
            type: "text" as const,
            text: message.text,
          },
        })),
      }),
    );
  }

  return server;
}
