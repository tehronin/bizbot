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
import { listAgentHeartbeatJobs } from "@/lib/agent/heartbeat-queue";
import { listRecentAgentRuns } from "@/lib/agent/run-journal";
import { listAgentProfileDescriptors } from "@/lib/agent/profiles";
import { getAllToolDefinitions, executeTool } from "@/lib/agent/plugins";
import { getActiveCrmProvider, getCrmProviderStatuses, listCrmContacts } from "@/lib/crm";
import { getActiveProvider, getConfiguredProviders, getGenerationConfig, getModelForProvider } from "@/lib/agent/kernel";
import { getAgentRuntimeConfig, getAutonomyDescription, getAgentCapabilities } from "@/lib/agent/runtime";
import type { JsonObject, ToolParametersSchema, ToolPropertySchema } from "@/lib/agent/tools";
import { db } from "@/lib/db";
import { getEmbeddingConfig } from "@/lib/embeddings/embed";
import { getMcpClientStatus } from "@/lib/mcp/client";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";

const MAX_MCP_RESULT_CHARS = 8_000;
const DEV_LOG_TAIL_LINES = 120;
const DEV_LOG_ISSUE_LIMIT = 30;
const MCP_AGENT_PROFILE = "mcp_operator";
const MCP_BLOCKED_TOOLS = new Set(["agent_delegate_run"]);

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

function getToolTitle(name: string): string {
  if (name.startsWith("social_")) return `Social: ${name.replace("social_", "").replaceAll("_", " ")}`;
  if (name.startsWith("content_")) return `Content: ${name.replace("content_", "").replaceAll("_", " ")}`;
  if (name.startsWith("crm_")) return `CRM: ${name.replace("crm_", "").replaceAll("_", " ")}`;
  if (name.startsWith("commerce_")) return `Commerce: ${name.replace("commerce_", "").replaceAll("_", " ")}`;
  if (name.startsWith("local_business_")) return `Local Business: ${name.replace("local_business_", "").replaceAll("_", " ")}`;
  if (name.startsWith("agent_")) return `Agent Runtime: ${name.replace("agent_", "").replaceAll("_", " ")}`;
  if (name.startsWith("memory_")) return `Memory: ${name.replace("memory_", "").replaceAll("_", " ")}`;
  if (name.startsWith("file_")) return `Workspace Files: ${name.replace("file_", "").replaceAll("_", " ")}`;
  if (name.startsWith("graph_")) return `Knowledge Graph: ${name.replace("graph_", "").replaceAll("_", " ")}`;
  if (name.startsWith("schedule_")) return `Scheduling: ${name.replace("schedule_", "").replaceAll("_", " ")}`;
  if (name.startsWith("approval_")) return `Approvals: ${name.replace("approval_", "").replaceAll("_", " ")}`;
  if (name.startsWith("browser_")) return `Browser: ${name.replace("browser_", "").replaceAll("_", " ")}`;
  if (name.startsWith("competitor_")) return `Competitors: ${name.replace("competitor_", "").replaceAll("_", " ")}`;
  return name.replaceAll("_", " ");
}

function getToolAnnotations(name: string): ToolAnnotations {
  const readOnly = [
    "crm_get_provider_status",
    "crm_list_contacts",
    "crm_get_contact",
    "crm_list_activities",
    "crm_get_activity",
    "commerce_get_status",
    "commerce_list_products",
    "commerce_list_orders",
    "local_business_get_status",
    "local_business_get_dashboard",
    "local_business_list_reviews",
    "developer_list_agent_runs",
    "developer_get_agent_run",
    "social_get_mentions",
    "social_get_analytics",
    "content_check_policy",
    "memory_recall",
    "file_list",
    "file_read",
    "graph_search",
    "graph_get_context",
    "schedule_list",
    "approval_get_pending",
    "browser_navigate",
    "browser_extract_text",
    "browser_extract_links",
    "competitor_watch_list",
    "competitor_watch_check",
  ];

  const destructive = [
    "crm_upsert_contact",
    "crm_create_contact_from_inbox",
    "crm_sync_contact",
    "crm_create_activity",
    "crm_sync_activity",
    "commerce_upsert_product",
    "commerce_create_order",
    "agent_delegate_run",
    "social_post",
    "social_reply",
    "file_delete",
    "approval_decide",
    "browser_screenshot",
    "local_business_sync_reviews",
    "local_business_sync_posts",
    "local_business_reply_review",
    "local_business_create_post",
    "local_business_update_hours",
  ];

  const idempotent = [
    "crm_get_provider_status",
    "crm_list_contacts",
    "crm_get_contact",
    "crm_list_activities",
    "crm_get_activity",
    "developer_list_agent_runs",
    "developer_get_agent_run",
    "commerce_get_status",
    "commerce_list_products",
    "commerce_list_orders",
    "content_draft",
    "content_refine",
    "content_check_policy",
    "local_business_get_status",
    "local_business_get_dashboard",
    "local_business_list_reviews",
    "memory_recall",
    "file_list",
    "file_read",
    "graph_search",
    "graph_get_context",
    "schedule_list",
    "approval_get_pending",
    "browser_extract_text",
    "browser_extract_links",
    "competitor_watch_list",
  ];

  const openWorld = [
    "browser_navigate",
    "browser_screenshot",
    "browser_extract_text",
    "browser_extract_links",
    "competitor_watch_check",
  ];

  return {
    readOnlyHint: readOnly.includes(name),
    destructiveHint: destructive.includes(name),
    idempotentHint: idempotent.includes(name),
    openWorldHint: openWorld.includes(name),
  };
}

function getToolDescription(name: string, description: string): string {
  const hints: string[] = [];

  if (name.startsWith("social_")) {
    hints.push("Use for live social platform reads or writes.");
  } else if (name.startsWith("crm_")) {
    hints.push("Use for inbox-backed CRM lead management and optional external CRM sync.");
  } else if (name.startsWith("approval_")) {
    hints.push("Use when inspecting or resolving the approval queue.");
  } else if (name.startsWith("browser_")) {
    hints.push("Use for web inspection through Playwright when local files or DB state are insufficient.");
  } else if (name.startsWith("file_")) {
    hints.push("Use for workspace file inspection or editing.");
  } else if (name.startsWith("graph_")) {
    hints.push("Use for Memgraph-backed knowledge graph inspection or updates.");
  } else if (name.startsWith("memory_")) {
    hints.push("Use for BizBot long-term memory recall or storage.");
  } else if (name.startsWith("schedule_")) {
    hints.push("Use for inspecting or changing scheduled posts.");
  } else if (name.startsWith("competitor_")) {
    hints.push("Use for competitor watch inspection or control.");
  }

  if (getToolAnnotations(name).readOnlyHint) {
    hints.push("Read-only.");
  }
  if (getToolAnnotations(name).destructiveHint) {
    hints.push("Changes external or persisted state.");
  }
  if (name === "social_post" || name === "social_reply") {
    hints.push("Respect BizBot autonomy and approval rules.");
  }
  if (name === "approval_decide") {
    hints.push("Only use when you intend to approve or reject queued content.");
  }

  return `${description} ${hints.join(" ")}`.trim();
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
        "Tools prefixed with browser_ navigate the web via Playwright.",
      ].join(" "),
    },
  );

  const tools = getAllToolDefinitions(config, { agentProfile: MCP_AGENT_PROFILE })
    .filter((tool) => !MCP_BLOCKED_TOOLS.has(tool.name));

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
  server.registerResource(
    "inbox-open",
    "bizbot://inbox/open",
    {
      title: "Open Inbox Items",
      description: "All inbox items currently in open/processing state",
      mimeType: "application/json",
    },
    async () => {
      const items = await db.inboxMessage.findMany({
        where: { status: { in: ["OPEN", "PROCESSING"] } },
        orderBy: { receivedAt: "desc" },
        take: 50,
      });
      return {
        contents: [
          {
            uri: "bizbot://inbox/open",
            text: JSON.stringify(items, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  server.registerResource(
    "posts-scheduled",
    "bizbot://posts/scheduled",
    {
      title: "Scheduled Posts",
      description: "Posts scheduled for future publishing",
      mimeType: "application/json",
    },
    async () => {
      const posts = await db.post.findMany({
        where: { status: "SCHEDULED" },
        orderBy: { scheduledAt: "asc" },
        take: 50,
        include: { platform: true },
      });
      return {
        contents: [
          {
            uri: "bizbot://posts/scheduled",
            text: JSON.stringify(posts, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  server.registerResource(
    "approvals-pending",
    "bizbot://approvals/pending",
    {
      title: "Pending Approvals",
      description: "Posts waiting for human approval",
      mimeType: "application/json",
    },
    async () => {
      const approvals = await db.postApproval.findMany({
        where: { status: "PENDING" },
        include: { post: { include: { platform: true } } },
        orderBy: { createdAt: "asc" },
      });
      return {
        contents: [
          {
            uri: "bizbot://approvals/pending",
            text: JSON.stringify(approvals, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  server.registerResource(
    "settings",
    "bizbot://settings",
    {
      title: "BizBot Settings",
      description: "Current agent settings and autonomy configuration",
      mimeType: "application/json",
    },
    async () => {
      const settings = await db.setting.findMany();
      const mapped = Object.fromEntries(settings.map((s) => [s.key, s.value]));
      return {
        contents: [
          {
            uri: "bizbot://settings",
            text: JSON.stringify({ ...mapped, runtimeConfig: config }, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  server.registerResource(
    "crm-pipeline-summary",
    "bizbot://crm/pipeline-summary",
    {
      title: "CRM Pipeline Summary",
      description: "Inbox-backed CRM pipeline state, provider readiness, and recent contacts",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "bizbot://crm/pipeline-summary",
          text: JSON.stringify(await buildCrmPipelineSummary(), null, 2),
          mimeType: "application/json",
        },
      ],
    }),
  );

  server.registerResource(
    "debug-system-status",
    "bizbot://debug/system-status",
    {
      title: "Debug System Status",
      description: "Runtime, LLM, worker, knowledge, inbox, and MCP state for debugging BizBot",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "bizbot://debug/system-status",
          text: JSON.stringify(await buildDebugSystemStatus(), null, 2),
          mimeType: "application/json",
        },
      ],
    }),
  );

  server.registerResource(
    "debug-database-summary",
    "bizbot://debug/database-summary",
    {
      title: "Debug Database Summary",
      description: "High-level row counts for core BizBot tables",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "bizbot://debug/database-summary",
          text: JSON.stringify(await buildDebugDatabaseSummary(), null, 2),
          mimeType: "application/json",
        },
      ],
    }),
  );

  server.registerResource(
    "debug-recent-heartbeat",
    "bizbot://debug/recent-heartbeat",
    {
      title: "Debug Recent Heartbeat",
      description: "Recent heartbeat and worker timestamps plus the last summary payload",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "bizbot://debug/recent-heartbeat",
          text: JSON.stringify(await buildDebugRecentHeartbeat(), null, 2),
          mimeType: "application/json",
        },
      ],
    }),
  );

  server.registerResource(
    "debug-recent-inbox",
    "bizbot://debug/recent-inbox",
    {
      title: "Debug Recent Inbox",
      description: "Recent inbox items with status, sender, and lead metadata for triage",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "bizbot://debug/recent-inbox",
          text: JSON.stringify(await buildDebugRecentInbox(), null, 2),
          mimeType: "application/json",
        },
      ],
    }),
  );

  server.registerResource(
    "debug-recent-log",
    "bizbot://debug/recent-log",
    {
      title: "Debug Recent Log",
      description: "Recent Next.js development log entries and warning/error lines for runtime debugging",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "bizbot://debug/recent-log",
          text: JSON.stringify(await buildDebugRecentLog(), null, 2),
          mimeType: "application/json",
        },
      ],
    }),
  );

  server.registerResource(
    "debug-recent-failures",
    "bizbot://debug/recent-failures",
    {
      title: "Debug Recent Failures",
      description: "Failed inbox items, failed posts, recent heartbeat failure summary, and recent runtime log issues",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "bizbot://debug/recent-failures",
          text: JSON.stringify(await buildDebugRecentFailures(), null, 2),
          mimeType: "application/json",
        },
      ],
    }),
  );

  server.registerResource(
    "debug-worker-jobs",
    "bizbot://debug/worker-jobs",
    {
      title: "Debug Worker Jobs",
      description: "Recent BullMQ heartbeat jobs and worker state for queue inspection",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "bizbot://debug/worker-jobs",
          text: JSON.stringify(await buildDebugWorkerJobs(), null, 2),
          mimeType: "application/json",
        },
      ],
    }),
  );

  server.registerResource(
    "debug-memory-summary",
    "bizbot://debug/memory-summary",
    {
      title: "Debug Memory Summary",
      description: "Recent memories and conversations for operator inspection",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "bizbot://debug/memory-summary",
          text: JSON.stringify(await buildDebugMemorySummary(), null, 2),
          mimeType: "application/json",
        },
      ],
    }),
  );

  server.registerResource(
    "debug-agent-runs",
    "bizbot://debug/agent-runs",
    {
      title: "Debug Agent Runs",
      description: "Recent BizBot agent runs with specialist lane metadata, tool policy, and tool trace summaries",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "bizbot://debug/agent-runs",
          text: JSON.stringify(await buildDebugAgentRuns(), null, 2),
          mimeType: "application/json",
        },
      ],
    }),
  );

  // ── Prompts ──────────────────────────────────────────────────────
  server.registerPrompt(
    "draft-reply",
    {
      title: "Draft Reply",
      description:
        "Draft a reply to an inbox message using brand voice and knowledge context",
      argsSchema: {
        inboxItemId: z.string().optional(),
      },
    },
    ({ inboxItemId }: { inboxItemId?: string }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: inboxItemId
              ? `Draft a brand-voice reply for inbox item ${inboxItemId}. Use the memory_recall tool to fetch relevant knowledge first, then compose the reply.`
              : "Draft a brand-voice reply for the most recent open inbox item. Use the memory_recall tool to fetch relevant knowledge first, then compose the reply.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "content-brief",
    {
      title: "Content Brief",
      description: "Generate a content brief for a social media post",
      argsSchema: {
        topic: z.string().optional(),
        platform: z.string().optional(),
      },
    },
    ({ topic, platform }: { topic?: string; platform?: string }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Create a content brief for a social media post.",
              topic ? `Topic: ${topic}.` : "",
              platform ? `Platform: ${platform}.` : "",
              "Include suggested copy, hashtags, and best posting time. Check content_check_policy before finalizing.",
            ]
              .filter(Boolean)
              .join(" "),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "debug-runtime",
    {
      title: "Debug Runtime",
      description: "Investigate BizBot runtime issues using MCP debug resources before proposing changes",
      argsSchema: {
        symptom: z.string().optional(),
      },
    },
    ({ symptom }: { symptom?: string }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Debug the BizBot runtime issue.",
              symptom ? `Symptom: ${symptom}.` : "",
              "First read these MCP resources: bizbot://debug/system-status, bizbot://debug/recent-heartbeat, and bizbot://debug/database-summary.",
              "Then identify the most likely failure point, call only the minimum necessary BizBot tools, and end with: root cause, evidence, code/files to inspect, and the smallest safe fix.",
            ].filter(Boolean).join(" "),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "debug-inbox-flow",
    {
      title: "Debug Inbox Flow",
      description: "Trace why inbox items are not being processed or replied to",
      argsSchema: {
        inboxItemId: z.string().optional(),
      },
    },
    ({ inboxItemId }: { inboxItemId?: string }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Investigate the inbox processing flow in BizBot.",
              inboxItemId ? `Focus on inbox item ${inboxItemId}.` : "Start with the most recent open or processing inbox items.",
              "Read bizbot://debug/recent-inbox and bizbot://debug/system-status first.",
              "Check whether the issue is ingestion, heartbeat scheduling, tool execution, approval gating, or outbound reply delivery.",
              "Return a short trace of the failure path and the next concrete code-level action.",
            ].filter(Boolean).join(" "),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "debug-vscode-mcp-loop",
    {
      title: "Debug VS Code MCP Loop",
      description: "Diagnose why Copilot or VS Code cannot see or use BizBot MCP capabilities",
      argsSchema: {
        symptom: z.string().optional(),
      },
    },
    ({ symptom }: { symptom?: string }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Diagnose the VS Code to BizBot MCP dev loop.",
              symptom ? `Symptom: ${symptom}.` : "",
              "First inspect bizbot://debug/system-status and confirm the workspace MCP config at .vscode/mcp.json.",
              "Check whether the stdio server starts, whether tools/resources/prompts are exposed, and whether authorization or trust configuration could block discovery.",
              "Return findings ordered by severity with the smallest fix first.",
            ].filter(Boolean).join(" "),
          },
        },
      ],
    }),
  );

  return server;
}
