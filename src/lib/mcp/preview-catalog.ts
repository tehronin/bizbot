import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { filterVisibleSettings } from "@/lib/runtime-secrets";
import { getAgentWorkerStatus, listAgentHeartbeatJobs } from "@/lib/agent/heartbeat-queue";
import { getKnowledgeStatus } from "@/lib/agent/knowledge-status";
import { inspectMemories, listRecentConversations } from "@/lib/agent/memory";
import { listRecentAgentRuns } from "@/lib/agent/run-journal";
import { listAgentProfileDescriptors } from "@/lib/agent/profiles";
import { getActiveCrmProvider, getCrmProviderStatuses, listCrmContacts } from "@/lib/crm";
import { getActiveProvider, getConfiguredProviders, getGenerationConfig, getModelForProvider } from "@/lib/agent/kernel";
import { getAgentCapabilities, getAgentRuntimeConfig, getAutonomyDescription } from "@/lib/agent/runtime";
import { getEmbeddingConfig } from "@/lib/embeddings/embed";
import { getBuiltinPlugins, getEnabledBuiltinPlugins } from "@/lib/agent/plugins/registry";
import { createPluginRegistry } from "@/lib/agent/plugins/registry";
import { canProfileUseTool } from "@/lib/agent/profiles";
import { getCurrentBuilderProjectOverview } from "@/lib/builder/orchestrator";
import { listBuilderProjects } from "@/lib/builder/projects";
import { getMcpClientStatus, getMcpClientToolCatalog, getMcpClientTools } from "@/lib/mcp/client";
import { inspectPluginRegistry } from "@/lib/agent/plugins/inspection";
import { getToolAnnotations, getToolDescription, getToolTitle, MCP_AGENT_PROFILE, MCP_BLOCKED_TOOLS } from "@/lib/mcp/tool-presentation";
import {
  ONTOLOGY_ENTITY_TYPES,
  ONTOLOGY_PROMOTION_RULE_SUMMARY,
  ONTOLOGY_RELATION_TYPES,
  ONTOLOGY_RUNTIME_CONTEXT_POLICY,
} from "@/lib/ontology/constants";
import { getOntologySchemaSummary, getOntologySummary } from "@/lib/ontology/service";
import { getBizBotPlatformContract } from "@/lib/platform/contract";
import type { JsonObject, ToolDescriptor } from "@/lib/agent/tools";

const DEV_LOG_TAIL_LINES = 120;
const DEV_LOG_ISSUE_LIMIT = 30;

export interface BizBotPromptArgDefinition {
  name: string;
  required?: boolean;
  description: string;
}

export interface BizBotPromptDefinition {
  name: string;
  title: string;
  description: string;
  ownerId: string;
  group: string;
  arguments: BizBotPromptArgDefinition[];
  render: (args: Record<string, string | undefined>) => { messages: Array<{ role: "user"; text: string }> };
}

export interface BizBotResourceDefinition {
  name: string;
  uri: string;
  title: string;
  description: string;
  mimeType: string;
  ownerId: string;
  group: string;
  read: () => Promise<JsonObject | object | string>;
}

function canExposeToolInMcp(name: string): boolean {
  const config = getAgentRuntimeConfig();
  if (MCP_BLOCKED_TOOLS.has(name)) {
    return false;
  }
  if (config.autonomyPreset === "manual_only" && (name === "social_post" || name === "social_reply")) {
    return false;
  }
  if (config.autonomyPreset === "reply_only" && name === "social_post") {
    return false;
  }
  return canProfileUseTool(MCP_AGENT_PROFILE, name);
}

export function listCurrentMcpToolDescriptors(): Array<ToolDescriptor & { title: string; annotations: ReturnType<typeof getToolAnnotations>; ownerId: string; ownerKind: string }> {
  const registry = createPluginRegistry(getEnabledBuiltinPlugins(), getMcpClientTools());
  return registry.tools
    .filter((tool) => canExposeToolInMcp(tool.name))
    .map((tool) => ({
      name: tool.name,
      title: getToolTitle(tool.name),
      description: getToolDescription(tool.name, tool.description),
      parameters: tool.parameters,
      annotations: getToolAnnotations(tool.name),
      ownerId: registry.toolToPluginId.get(tool.name) ?? "unknown",
      ownerKind: registry.toolToPluginId.get(tool.name) === "external-mcp" ? "imported-mcp" : "builtin-plugin",
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getNextDevLogPath(): string {
  return path.join(process.cwd(), ".next", "dev", "logs", "next-development.log");
}

type DevLogEntry = { timestamp?: string; source?: string; level?: string; message?: string };

function readRecentDevLogEntries(limit = DEV_LOG_TAIL_LINES): DevLogEntry[] {
  const logPath = getNextDevLogPath();
  if (!fs.existsSync(logPath)) {
    return [];
  }

  const raw = fs.readFileSync(logPath, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.slice(-limit).flatMap((line) => {
    try {
      return [JSON.parse(line) as DevLogEntry];
    } catch {
      return [{ level: "LOG", source: "Server", message: line } satisfies DevLogEntry];
    }
  });
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
    db.inboxMessage.groupBy({ by: ["status"], _count: { _all: true } }),
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
    approvals: { pendingCount: pendingApprovals },
    mcp: {
      importedServers: mcpClients,
      httpEndpoint: "/api/mcp",
      workspaceConfigPath: ".vscode/mcp.json",
    },
  };
}

async function buildDebugDatabaseSummary() {
  const [conversationCount, messageCount, memoryCount, postCount, pendingApprovalCount, inboxCount, openInboxCount, competitorWatchCount] = await Promise.all([
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

  return { generatedAt: new Date().toISOString(), items: recentItems };
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

  return { generatedAt: new Date().toISOString(), memories, conversations };
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

async function buildBuilderProjectsResource() {
  const projects = await listBuilderProjects();
  return {
    generatedAt: new Date().toISOString(),
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      relativePath: project.relativePath,
      template: project.template,
      packageManager: project.packageManager,
      lastRunStatus: project.lastRunStatus,
      updatedAt: project.updatedAt,
    })),
  };
}

async function buildCurrentBuilderProjectResource() {
  const overview = await getCurrentBuilderProjectOverview();
  return overview ? {
    generatedAt: new Date().toISOString(),
    project: overview.project,
    currentTask: overview.currentTask,
    mcpSnapshot: overview.mcpSnapshot,
    nextRecommendedStep: overview.nextRecommendedStep,
  } : { generatedAt: new Date().toISOString(), project: null, currentTask: null, mcpSnapshot: null, nextRecommendedStep: null };
}

async function buildCurrentBuilderPlanResource() {
  const overview = await getCurrentBuilderProjectOverview();
  return {
    generatedAt: new Date().toISOString(),
    projectId: overview?.project.id ?? null,
    currentPlan: overview?.context.currentPlan ?? [],
    currentTask: overview?.currentTask ?? null,
  };
}

async function buildCurrentBuilderTasksResource() {
  const overview = await getCurrentBuilderProjectOverview();
  return {
    generatedAt: new Date().toISOString(),
    projectId: overview?.project.id ?? null,
    tasks: overview?.tasks ?? [],
  };
}

async function buildCurrentBuilderRunsResource() {
  const overview = await getCurrentBuilderProjectOverview();
  return {
    generatedAt: new Date().toISOString(),
    projectId: overview?.project.id ?? null,
    runs: overview?.runs ?? [],
    mcpSnapshot: overview?.mcpSnapshot ?? null,
  };
}

async function buildCurrentBuilderReviewResource() {
  const overview = await getCurrentBuilderProjectOverview();
  return {
    generatedAt: new Date().toISOString(),
    projectId: overview?.project.id ?? null,
    review: overview?.latestReview ?? null,
  };
}

async function buildCrmPipelineSummary() {
  const [providers, stageCounts, contacts] = await Promise.all([
    getCrmProviderStatuses(),
    db.inboxMessage.groupBy({
      by: ["leadStage"],
      where: { leadStage: { not: "NONE" } },
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

export const NAMING_RULES = {
  prefixes: ["crm_", "memory_", "builder_", "developer_", "local_business_", "commerce_", "social_", "approval_", "browser_", "graph_", "schedule_", "sidecar_", "oracle_"],
  rules: [
    "Use lowercase snake_case.",
    "Start every builtin tool with a stable namespace prefix.",
    "Prefer explicit verbs such as list, get, inspect, preview, suggest, create, update, sync, or check.",
    "Avoid generic names such as get_data, run_task, or do_thing.",
    "Keep imported MCP tools clearly separate by preserving the mcp_<server>_ prefix.",
  ],
  examples: {
    good: ["crm_list_contacts", "memory_set_fact", "developer_preview_tool_descriptor", "local_business_sync_reviews"],
    bad: ["get_data", "run_task", "tool", "preview"],
  },
};

export const AUTHORING_CHECKLIST = [
  "Define plugin metadata id, displayName, description, and tags.",
  "Keep tool names inside one namespace prefix aligned to the plugin id.",
  "Write tool descriptions that explain task, scope, and side effects.",
  "Prefer strict parameter schemas and consider additionalProperties: false for structured inputs.",
  "Add registry and tool exposure tests in tests/plugins/.",
  "Review tests/mcp/contracts.test.ts if your work changes tools/list, prompts/list, or resources/list.",
  "Review tests/mcp/http-route.test.ts when your work changes MCP prompt/resource reads, tool calls, or route-visible behavior.",
  "Use developer_* inspection and preview tools before relying on a new plugin in the runtime.",
];

export function listBizBotPromptDefinitions(): BizBotPromptDefinition[] {
  return [
    {
      name: "draft-reply",
      title: "Draft Reply",
      description: "Draft a reply to an inbox message using brand voice and knowledge context",
      ownerId: "content",
      group: "content",
      arguments: [{ name: "inboxItemId", required: false, description: "Optional inbox item id to focus on." }],
      render: ({ inboxItemId }) => ({
        messages: [{ role: "user", text: inboxItemId ? `Draft a brand-voice reply for inbox item ${inboxItemId}. Use the memory_recall tool to fetch relevant knowledge first, then compose the reply.` : "Draft a brand-voice reply for the most recent open inbox item. Use the memory_recall tool to fetch relevant knowledge first, then compose the reply." }],
      }),
    },
    {
      name: "content-brief",
      title: "Content Brief",
      description: "Generate a content brief for a social media post",
      ownerId: "content",
      group: "content",
      arguments: [
        { name: "topic", required: false, description: "Optional topic to center the brief around." },
        { name: "platform", required: false, description: "Optional target platform." },
      ],
      render: ({ topic, platform }) => ({
        messages: [{ role: "user", text: ["Create a content brief for a social media post.", topic ? `Topic: ${topic}.` : "", platform ? `Platform: ${platform}.` : "", "Include suggested copy, hashtags, and best posting time. Check content_check_policy before finalizing."].filter(Boolean).join(" ") }],
      }),
    },
    {
      name: "debug-runtime",
      title: "Debug Runtime",
      description: "Investigate BizBot runtime issues using MCP debug resources before proposing changes",
      ownerId: "developer",
      group: "developer",
      arguments: [{ name: "symptom", required: false, description: "Optional symptom summary." }],
      render: ({ symptom }) => ({
        messages: [{ role: "user", text: ["Debug the BizBot runtime issue.", symptom ? `Symptom: ${symptom}.` : "", "First read these MCP resources: bizbot://debug/system-status, bizbot://debug/recent-heartbeat, and bizbot://debug/database-summary.", "Then identify the most likely failure point, call only the minimum necessary BizBot tools, and end with: root cause, evidence, code/files to inspect, and the smallest safe fix."].filter(Boolean).join(" ") }],
      }),
    },
    {
      name: "debug-inbox-flow",
      title: "Debug Inbox Flow",
      description: "Trace why inbox items are not being processed or replied to",
      ownerId: "developer",
      group: "developer",
      arguments: [{ name: "inboxItemId", required: false, description: "Optional inbox item id to focus the trace." }],
      render: ({ inboxItemId }) => ({
        messages: [{ role: "user", text: ["Investigate the inbox processing flow in BizBot.", inboxItemId ? `Focus on inbox item ${inboxItemId}.` : "Start with the most recent open or processing inbox items.", "Read bizbot://debug/recent-inbox and bizbot://debug/system-status first.", "Check whether the issue is ingestion, heartbeat scheduling, tool execution, approval gating, or outbound reply delivery.", "Return a short trace of the failure path and the next concrete code-level action."].filter(Boolean).join(" ") }],
      }),
    },
    {
      name: "debug-vscode-mcp-loop",
      title: "Debug VS Code MCP Loop",
      description: "Diagnose why Copilot or VS Code cannot see or use BizBot MCP capabilities",
      ownerId: "developer",
      group: "developer",
      arguments: [{ name: "symptom", required: false, description: "Optional symptom summary." }],
      render: ({ symptom }) => ({
        messages: [{ role: "user", text: ["Diagnose the VS Code to BizBot MCP dev loop.", symptom ? `Symptom: ${symptom}.` : "", "First inspect bizbot://debug/system-status and confirm the workspace MCP config at .vscode/mcp.json.", "Check whether the stdio server starts, whether tools/resources/prompts are exposed, and whether authorization or trust configuration could block discovery.", "Return findings ordered by severity with the smallest fix first."].filter(Boolean).join(" ") }],
      }),
    },
    {
      name: "inspect-agent-run",
      title: "Inspect Agent Run",
      description: "Inspect a specific BizBot agent run by id using the run journal tools",
      ownerId: "developer",
      group: "developer",
      arguments: [{ name: "runId", required: true, description: "Required BizBot run id." }],
      render: ({ runId }) => ({
        messages: [{ role: "user", text: [`Inspect BizBot agent run ${runId}.`, "Use developer_get_agent_run to retrieve the full run journal.", "Summarize the lane, tool trace, failure point, and the smallest corrective action."].join(" ") }],
      }),
    },
  ];
}

export function listBizBotResourceDefinitions(): BizBotResourceDefinition[] {
  return [
    { name: "inbox-open", uri: "bizbot://inbox/open", title: "Open Inbox Items", description: "All inbox items currently in open/processing state", mimeType: "application/json", ownerId: "inbox", group: "inbox", read: async () => db.inboxMessage.findMany({ where: { status: { in: ["OPEN", "PROCESSING"] } }, orderBy: { receivedAt: "desc" }, take: 50 }) },
    { name: "posts-scheduled", uri: "bizbot://posts/scheduled", title: "Scheduled Posts", description: "Posts scheduled for future publishing", mimeType: "application/json", ownerId: "schedule", group: "publishing", read: async () => db.post.findMany({ where: { status: "SCHEDULED" }, orderBy: { scheduledAt: "asc" }, take: 50, include: { platform: true } }) },
    { name: "approvals-pending", uri: "bizbot://approvals/pending", title: "Pending Approvals", description: "Posts waiting for human approval", mimeType: "application/json", ownerId: "approval", group: "publishing", read: async () => db.postApproval.findMany({ where: { status: "PENDING" }, include: { post: { include: { platform: true } } }, orderBy: { createdAt: "asc" } }) },
    { name: "settings", uri: "bizbot://settings", title: "BizBot Settings", description: "Current agent settings and autonomy configuration", mimeType: "application/json", ownerId: "core", group: "runtime", read: async () => {
      const settings: Array<{ key: string; value: string }> = filterVisibleSettings(await db.setting.findMany());
      const mapped = Object.fromEntries(settings.map((s) => [s.key, s.value]));
      return { ...mapped, runtimeConfig: getAgentRuntimeConfig() };
    } },
    { name: "plugins-installed", uri: "bizbot://plugins/installed", title: "Installed Plugins", description: "Builtin plugin metadata plus exposed MCP tool coverage for each plugin", mimeType: "application/json", ownerId: "developer", group: "plugins", read: async () => {
      const registry = createPluginRegistry(getEnabledBuiltinPlugins(), getMcpClientTools());
      const allowedToolNames = new Set(listCurrentMcpToolDescriptors().map((tool) => tool.name));
      const plugins = registry.plugins.map((plugin) => ({
        ...plugin.metadata,
        tools: plugin.tools.filter((tool) => allowedToolNames.has(tool.name)).map((tool) => ({ name: tool.name, title: getToolTitle(tool.name), description: tool.description, annotations: getToolAnnotations(tool.name) })),
      })).filter((plugin) => plugin.tools.length > 0);
      const externalTools = listCurrentMcpToolDescriptors().filter((tool) => tool.ownerKind === "imported-mcp");
      return { generatedAt: new Date().toISOString(), plugins, externalTools };
    } },
    { name: "plugins-tool-map", uri: "bizbot://plugins/tool-map", title: "Plugin Tool Map", description: "Resolved mapping from exposed MCP tools to their source plugin ids", mimeType: "application/json", ownerId: "developer", group: "plugins", read: async () => ({ generatedAt: new Date().toISOString(), toolMap: listCurrentMcpToolDescriptors().map((tool) => ({ toolName: tool.name, pluginId: tool.ownerId, title: tool.title, description: tool.description, annotations: tool.annotations })) }) },
    { name: "plugins-registry-report", uri: "bizbot://plugins/registry-report", title: "Plugin Registry Report", description: "Structured registry report with provenance, warnings, conflicts, and imported MCP origins", mimeType: "application/json", ownerId: "developer", group: "plugins", read: async () => inspectPluginRegistry({ plugins: getBuiltinPlugins(), importedTools: getMcpClientToolCatalog() }) },
    { name: "plugins-naming-rules", uri: "bizbot://plugins/naming-rules", title: "Plugin Naming Rules", description: "BizBot naming conventions, prefix guidance, and good versus bad tool-name examples", mimeType: "application/json", ownerId: "developer", group: "plugins", read: async () => ({ generatedAt: new Date().toISOString(), ...NAMING_RULES }) },
    { name: "plugins-authoring-checklist", uri: "bizbot://plugins/authoring-checklist", title: "Plugin Authoring Checklist", description: "Checklist for metadata, schemas, tests, registry registration, and MCP contract review", mimeType: "application/json", ownerId: "developer", group: "plugins", read: async () => ({ generatedAt: new Date().toISOString(), checklist: AUTHORING_CHECKLIST }) },
    { name: "plugins-mcp-surface-preview", uri: "bizbot://plugins/mcp-surface-preview", title: "Plugin MCP Surface Preview", description: "Current MCP tool, prompt, and resource catalogs with ownership and grouping details", mimeType: "application/json", ownerId: "developer", group: "plugins", read: async () => ({ generatedAt: new Date().toISOString(), tools: listCurrentMcpToolDescriptors(), prompts: listBizBotPromptDefinitions().map((prompt) => ({ name: prompt.name, title: prompt.title, description: prompt.description, ownerId: prompt.ownerId, group: prompt.group, arguments: prompt.arguments })), resources: listBizBotResourceDefinitions().map((resource) => ({ name: resource.name, uri: resource.uri, title: resource.title, description: resource.description, ownerId: resource.ownerId, group: resource.group, mimeType: resource.mimeType })) }) },
    { name: "plugins-contracts-status", uri: "bizbot://plugins/contracts-status", title: "Plugin Contracts Status", description: "Current MCP contract catalog shape, compatibility policy, and test coverage guidance for plugin authors", mimeType: "application/json", ownerId: "developer", group: "plugins", read: async () => {
      const platformContract = getBizBotPlatformContract();
      return {
        generatedAt: new Date().toISOString(),
        platformContract,
        contractTests: {
          file: "tests/mcp/contracts.test.ts",
          routeFile: "tests/mcp/http-route.test.ts",
          snapshots: ["tools/list", "prompts/list", "resources/list"],
          builderSnapshots: "tests/builder/mcp-snapshots.test.ts",
        },
        currentCatalog: {
          toolNames: listCurrentMcpToolDescriptors().map((tool) => tool.name),
          toolDescriptors: listCurrentMcpToolDescriptors().map((tool) => ({
            name: tool.name,
            ownerId: tool.ownerId,
            ownerKind: tool.ownerKind,
            parameters: tool.parameters,
          })),
          promptDefinitions: listBizBotPromptDefinitions().map((prompt) => ({
            name: prompt.name,
            ownerId: prompt.ownerId,
            arguments: prompt.arguments,
          })),
          resourceMetadata: listBizBotResourceDefinitions().map((resource) => ({
            uri: resource.uri,
            ownerId: resource.ownerId,
            mimeType: resource.mimeType,
          })),
        },
        history: {
          detectable: true,
          note: "Builder MCP snapshots persist accepted MCP catalog baselines and runtime provenance.",
          changelog: platformContract.docs.changelog,
        },
      };
    } },
    { name: "ontology-schema", uri: "bizbot://ontology/schema", title: "Ontology Schema", description: "Ontology v1 scopes, statuses, sources, types, and budget policy for developer inspection", mimeType: "application/json", ownerId: "developer", group: "ontology", read: async () => getOntologySchemaSummary() },
    { name: "ontology-entity-types", uri: "bizbot://ontology/entity-types", title: "Ontology Entity Types", description: "Canonical ontology entity types supported in v1", mimeType: "application/json", ownerId: "developer", group: "ontology", read: async () => ({ generatedAt: new Date().toISOString(), entityTypes: ONTOLOGY_ENTITY_TYPES }) },
    { name: "ontology-relation-types", uri: "bizbot://ontology/relation-types", title: "Ontology Relation Types", description: "Canonical ontology relation types supported in v1", mimeType: "application/json", ownerId: "developer", group: "ontology", read: async () => ({ generatedAt: new Date().toISOString(), relationTypes: ONTOLOGY_RELATION_TYPES }) },
    { name: "ontology-summary", uri: "bizbot://ontology/summary", title: "Ontology Summary", description: "Current ontology persistence counts and scope/status summary for inspection", mimeType: "application/json", ownerId: "developer", group: "ontology", read: async () => getOntologySummary() },
    { name: "ontology-promotion-rules", uri: "bizbot://ontology/promotion-rules", title: "Ontology Promotion Rules", description: "Deterministic explicit-memory promotion rules used by ontology v1", mimeType: "application/json", ownerId: "developer", group: "ontology", read: async () => ({ generatedAt: new Date().toISOString(), promotion: ONTOLOGY_PROMOTION_RULE_SUMMARY }) },
    { name: "ontology-runtime-context-policy", uri: "bizbot://ontology/runtime-context-policy", title: "Ontology Runtime Context Policy", description: "Prompt-budget and separation rules for runtime ontology context versus developer inspection", mimeType: "application/json", ownerId: "developer", group: "ontology", read: async () => ({ generatedAt: new Date().toISOString(), runtimeContextPolicy: ONTOLOGY_RUNTIME_CONTEXT_POLICY }) },
    { name: "builder-projects", uri: "bizbot://builder/projects", title: "Builder Projects", description: "Persisted Builder projects and their durable identity", mimeType: "application/json", ownerId: "builder", group: "builder", read: buildBuilderProjectsResource },
    { name: "builder-current-project", uri: "bizbot://builder/current-project", title: "Current Builder Project", description: "Current Builder project chosen from the newest open task or latest updated project", mimeType: "application/json", ownerId: "builder", group: "builder", read: buildCurrentBuilderProjectResource },
    { name: "builder-current-plan", uri: "bizbot://builder/current-plan", title: "Current Builder Plan", description: "Current Builder plan projection for the active Builder project", mimeType: "application/json", ownerId: "builder", group: "builder", read: buildCurrentBuilderPlanResource },
    { name: "builder-current-tasks", uri: "bizbot://builder/current-tasks", title: "Current Builder Tasks", description: "Current and recent Builder tasks for the active Builder project", mimeType: "application/json", ownerId: "builder", group: "builder", read: buildCurrentBuilderTasksResource },
    { name: "builder-current-runs", uri: "bizbot://builder/current-runs", title: "Current Builder Runs", description: "Recent Builder runs for the active Builder project", mimeType: "application/json", ownerId: "builder", group: "builder", read: buildCurrentBuilderRunsResource },
    { name: "builder-current-review", uri: "bizbot://builder/current-review", title: "Current Builder Review", description: "Latest structured Builder review for the active Builder project", mimeType: "application/json", ownerId: "builder", group: "builder", read: buildCurrentBuilderReviewResource },
    { name: "crm-pipeline-summary", uri: "bizbot://crm/pipeline-summary", title: "CRM Pipeline Summary", description: "Inbox-backed CRM pipeline state, provider readiness, and recent contacts", mimeType: "application/json", ownerId: "crm", group: "crm", read: buildCrmPipelineSummary },
    { name: "debug-system-status", uri: "bizbot://debug/system-status", title: "Debug System Status", description: "Runtime, LLM, worker, knowledge, inbox, and MCP state for debugging BizBot", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildDebugSystemStatus },
    { name: "debug-database-summary", uri: "bizbot://debug/database-summary", title: "Debug Database Summary", description: "High-level row counts for core BizBot tables", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildDebugDatabaseSummary },
    { name: "debug-recent-heartbeat", uri: "bizbot://debug/recent-heartbeat", title: "Debug Recent Heartbeat", description: "Recent heartbeat and worker timestamps plus the last summary payload", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildDebugRecentHeartbeat },
    { name: "debug-recent-inbox", uri: "bizbot://debug/recent-inbox", title: "Debug Recent Inbox", description: "Recent inbox items with status, sender, and lead metadata for triage", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildDebugRecentInbox },
    { name: "debug-recent-log", uri: "bizbot://debug/recent-log", title: "Debug Recent Log", description: "Recent Next.js development log entries and warning/error lines for runtime debugging", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildDebugRecentLog },
    { name: "debug-recent-failures", uri: "bizbot://debug/recent-failures", title: "Debug Recent Failures", description: "Failed inbox items, failed posts, recent heartbeat failure summary, and recent runtime log issues", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildDebugRecentFailures },
    { name: "debug-worker-jobs", uri: "bizbot://debug/worker-jobs", title: "Debug Worker Jobs", description: "Recent BullMQ heartbeat jobs and worker state for queue inspection", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildDebugWorkerJobs },
    { name: "debug-memory-summary", uri: "bizbot://debug/memory-summary", title: "Debug Memory Summary", description: "Recent memories and conversations for operator inspection", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildDebugMemorySummary },
    { name: "debug-agent-runs", uri: "bizbot://debug/agent-runs", title: "Debug Agent Runs", description: "Recent BizBot agent runs with specialist lane metadata, tool policy, and tool trace summaries", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildDebugAgentRuns },
  ];
}

export function getBizBotPromptDefinition(name: string): BizBotPromptDefinition | undefined {
  return listBizBotPromptDefinitions().find((prompt) => prompt.name === name);
}

export function getBizBotResourceDefinition(identifier: string): BizBotResourceDefinition | undefined {
  return listBizBotResourceDefinitions().find((resource) => resource.name === identifier || resource.uri === identifier);
}

export function previewPrompt(name: string, args: Record<string, string | undefined>): { prompt: Omit<BizBotPromptDefinition, "render">; rendered: ReturnType<BizBotPromptDefinition["render"]> } {
  const prompt = getBizBotPromptDefinition(name);
  if (!prompt) {
    throw new Error(`Unknown prompt: ${name}`);
  }
  for (const argument of prompt.arguments) {
    if (argument.required && !args[argument.name]) {
      throw new Error(`Missing required prompt argument: ${argument.name}`);
    }
  }
  const { render, ...metadata } = prompt;
  return { prompt: metadata, rendered: render(args) };
}

export async function previewResource(identifier: string): Promise<{ resource: Omit<BizBotResourceDefinition, "read">; sample: unknown }> {
  const resource = getBizBotResourceDefinition(identifier);
  if (!resource) {
    throw new Error(`Unknown resource: ${identifier}`);
  }
  const { read, ...metadata } = resource;
  return { resource: metadata, sample: await read() };
}
