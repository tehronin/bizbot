/** DeveloperPlugin — Inspect BizBot runtime queues, jobs, memories, and conversations. */

import type { JsonObject, ToolParametersSchema } from "@/lib/agent/tools";
import { executeAgentConversation } from "@/lib/agent/executor";
import {
  enqueueAgentHeartbeat,
  getAgentWorkerStatus,
  listAgentHeartbeatJobs,
  retryAgentHeartbeatJob,
  type AgentHeartbeatJobStatus,
} from "@/lib/agent/heartbeat-queue";
import { getMcpQueueStatus, listMcpJobs, retryMcpJob, type McpJobStatus } from "@/lib/mcp/job-status";
import {
  inspectConversationMessages,
  inspectMemories,
  listRecentConversations,
} from "@/lib/agent/memory";
import {
  getMcpClientPrompts,
  getMcpClientPrompt,
  getMcpClientResources,
  getMcpClientStatus,
  readMcpClientResource,
  getMcpClientToolCatalog,
  invokeMcpClientTool,
} from "@/lib/mcp/client";
import { acceptImportedMcpCatalogBaseline, buildImportedMcpServerSummaries, getImportedMcpCatalogDiff } from "@/lib/mcp/imported-catalog";
import { getBuilderProjectOverview, getCurrentBuilderProjectOverview } from "@/lib/builder/orchestrator";
import { listBuilderTasks } from "@/lib/builder/tasks";
import { normalizeBuilderTaskMetadata } from "@/lib/builder/types";
import { buildCurrentBuilderDevLoopContext } from "@/lib/mcp/devloop-context";
import { buildMcpHealthSnapshot } from "@/lib/mcp/health";
import { requestDevLoopSampling } from "@/lib/mcp/sampling";
import { listMcpTraceEvents, listMcpTraceServerSummaries, type McpTraceOperation } from "@/lib/mcp/trace";
import { buildOntologyPromptBlock } from "@/lib/ontology/prompt";
import { resolveOntologyAlias, searchOntologyEntities } from "@/lib/ontology/search";
import { getOntologySchemaSummary, validateOntologyRelationInput } from "@/lib/ontology/service";
import {
  buildSuggestedPluginTests,
  explainRegistryConflict,
  inspectPluginDefinition,
  inspectPluginRegistry,
  inspectPluginSourceFile,
  toInspectablePlugin,
  type InspectablePluginShape,
} from "@/lib/agent/plugins/inspection";
import { lintPlugin } from "@/lib/agent/plugins/lint";
import { getAgentRun, listRecentAgentRuns } from "@/lib/agent/run-journal";
import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";
import type { LLMProvider } from "@/lib/agent/kernel";
import type { BizBotContractCompatibilityClassification } from "@/lib/platform/contract";
import { getBizBotPlatformContract } from "@/lib/platform/contract";
import type { searchBuilderMcpSnapshotHistory } from "@/lib/builder/mcp-snapshots";

async function loadBuilderMcpSnapshots() {
  return import("@/lib/builder/mcp-snapshots");
}

type WorkerStatusArgs = Record<string, never>;

interface WorkerJobsArgs {
  statuses?: AgentHeartbeatJobStatus[];
  limit?: number;
}

interface RetryWorkerJobArgs {
  jobId: string;
}

interface McpJobsArgs {
  statuses?: McpJobStatus[];
  limit?: number;
}

interface RetryMcpJobArgs {
  queueName: string;
  jobId: string;
}

interface EnqueueHeartbeatArgs {
  trigger?: "manual" | "scheduler";
}

interface MemoryInspectArgs {
  query?: string;
  category?: string;
  limit?: number;
}

interface ConversationListArgs {
  limit?: number;
}

interface ConversationMessagesArgs {
  conversationId: string;
  limit?: number;
}

interface AgentRunsArgs {
  limit?: number;
}

interface AgentRunArgs {
  runId: string;
}

interface ResumeAgentRunArgs {
  runId: string;
  provider?: string;
}

type DeveloperLoopAssistArgs = Record<string, never>;
type McpHealthInspectArgs = Record<string, never>;

interface PluginLocatorArgs {
  pluginId?: string;
  pluginFilePath?: string;
}

interface ToolNamingArgs {
  names: string[];
  expectedPrefix?: string;
}

interface ConflictArgs {
  identifier: string;
}

interface PromptPreviewArgs {
  promptName: string;
  args?: JsonObject;
}

interface ResourcePreviewArgs {
  resource: string;
}

interface ToolDescriptorArgs {
  toolName: string;
}

interface PluginPlanArgs {
  pluginId: string;
  goal: string;
  capabilities?: string[];
}

interface ToolSchemaSuggestionArgs {
  toolNames: string[];
}

interface ToolSearchArgs {
  query?: string;
  prefix?: string;
  ownerId?: string;
  bundleId?: string;
  includeImported?: boolean;
  readOnlyOnly?: boolean;
  destructiveOnly?: boolean;
  limit?: number;
}

interface ResourceSearchArgs {
  query?: string;
  ownerId?: string;
  group?: string;
  bundleId?: string;
  includeImported?: boolean;
  limit?: number;
}

interface PromptSearchArgs {
  query?: string;
  ownerId?: string;
  group?: string;
  bundleId?: string;
  includeImported?: boolean;
  limit?: number;
}

interface ToolBundleArgs {
  bundleId: string;
}

interface ToolRecommendationArgs {
  goal: string;
}

interface ImportedMcpAuditArgs {
  serverName?: string;
}

interface ImportedMcpResourceReadArgs {
  serverName: string;
  uri: string;
}

interface ImportedMcpPromptGetArgs {
  serverName: string;
  name: string;
  args?: JsonObject;
}

interface ImportedMcpCatalogDiffArgs {
  serverName?: string;
}

type ImportedMcpCatalogAcceptArgs = Record<string, never>;

interface McpTraceArgs {
  serverName?: string;
  operation?: McpTraceOperation;
  limit?: number;
}

interface BuilderTaskEventsArgs {
  projectId?: string;
  taskId?: string;
  limit?: number;
}

interface ImportedMcpToolInvokeArgs {
  serverName: string;
  toolName: string;
  arguments?: JsonObject;
}

interface TaskRecipeArgs {
  recipeId: string;
}

interface OntologySearchArgs {
  query: string;
  userId?: string;
  scope?: "user" | "runtime" | "global";
  limit?: number;
}

interface OntologyAliasArgs {
  alias: string;
  userId?: string;
  type?: string;
}

interface OntologyContextArgs {
  userId: string;
}

interface OntologyRelationValidationArgs {
  userId?: string;
  scope: "user" | "runtime" | "global";
  type: string;
  subjectEntityId: string;
  objectEntityId: string;
}

interface PromptPreviewResult {
  prompt: {
    name: string;
    title: string;
    description: string;
    ownerId: string;
    group: string;
    arguments: Array<{ name: string; required?: boolean; description: string }>;
  };
  rendered: {
    messages: Array<{ role: "user"; text: string }>;
  };
}

interface McpSnapshotSearchArgs {
  projectId: string;
  query: string;
  limit?: number;
}

interface ResourcePreviewResult {
  resource: {
    name: string;
    uri: string;
    title: string;
    description: string;
    mimeType: string;
    ownerId: string;
    group: string;
  };
  sample: unknown;
}

interface ToolDescriptorPreviewResult {
  descriptor: {
    name: string;
    title: string;
    description: string;
    parameters: ToolParametersSchema;
    ownerId: string;
    ownerKind: string;
  };
}

interface BuilderRepairSummaryArgs {
  symptom?: string;
}

interface BuilderTaskLifecycleArgs {
  projectId?: string;
  limit?: number;
}

async function loadBuiltinPlugins() {
  const { getBuiltinPlugins } = await import("@/lib/agent/plugins/registry");
  return getBuiltinPlugins();
}

async function loadPreviewCatalog() {
  return import("@/lib/mcp/preview-catalog");
}

async function listPromptCatalog() {
  const catalog = await loadPreviewCatalog();
  return catalog.listBizBotPromptDefinitions().map((prompt) => ({ name: prompt.name, ownerId: prompt.ownerId }));
}

async function listResourceCatalog() {
  const catalog = await loadPreviewCatalog();
  return catalog.listBizBotResourceDefinitions().map((resource) => ({ uri: resource.uri, ownerId: resource.ownerId }));
}

async function resolveInspectablePlugin(args: PluginLocatorArgs): Promise<InspectablePluginShape> {
  if (args.pluginFilePath) {
    return inspectPluginSourceFile(args.pluginFilePath);
  }

  if (!args.pluginId) {
    throw new Error("pluginId or pluginFilePath is required.");
  }

  const plugin = (await loadBuiltinPlugins()).find((entry) => entry.metadata.id === args.pluginId);
  if (!plugin) {
    throw new Error(`Unknown builtin plugin: ${args.pluginId}`);
  }

  return toInspectablePlugin(plugin);
}

async function buildInspectionContext() {
  const builtinPlugins = await loadBuiltinPlugins();
  return {
    existingPlugins: builtinPlugins,
    importedTools: getMcpClientToolCatalog(),
    promptCatalog: await listPromptCatalog(),
    resourceCatalog: await listResourceCatalog(),
  };
}

function buildSchemaSuggestion(toolName: string): JsonObject {
  const lowered = toolName.toLowerCase();
  if (lowered.includes("list_")) {
    return {
      type: "object",
      properties: {
        limit: { type: "number", default: 20 },
        query: { type: "string" },
      },
      additionalProperties: false,
    };
  }
  if (lowered.includes("get_") || lowered.includes("inspect_") || lowered.includes("preview_")) {
    return {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
      additionalProperties: false,
    };
  }
  if (lowered.includes("create_") || lowered.includes("set_") || lowered.includes("update_")) {
    return {
      type: "object",
      properties: {
        id: { type: "string" },
        payload: { type: "json" },
      },
      required: ["payload"],
      additionalProperties: false,
    };
  }

  return {
    type: "object",
    properties: {
      input: { type: "json" },
    },
    additionalProperties: false,
  };
}

function normalizeSearchQuery(query: string | undefined): string {
  return (query ?? "").trim().toLowerCase();
}

function includesSearch(haystack: Array<string | null | undefined>, query: string): boolean {
  if (!query) {
    return true;
  }
  return haystack.some((value) => value?.toLowerCase().includes(query));
}

function deriveRecommendedBundleIds(goal: string): string[] {
  const normalized = goal.toLowerCase();
  const bundleIds = new Set<string>();

  if (["builder", "drift", "reconcile", "repair", "dev loop", "dev-loop", "preflight"].some((token) => normalized.includes(token))) {
    bundleIds.add("builder");
  }
  if (["plugin", "tool naming", "registry", "contract impact", "mcp exposure"].some((token) => normalized.includes(token))) {
    bundleIds.add("plugin-authoring");
  }
  if (["debug", "worker", "runtime", "queue", "heartbeat", "copilot", "vscode"].some((token) => normalized.includes(token))) {
    bundleIds.add("debug-ops");
  }
  if (["imported", "external mcp", "prompt catalog", "resource catalog", "collision"].some((token) => normalized.includes(token))) {
    bundleIds.add("imported-mcp");
  }
  if (["crm", "contact", "lead", "activity"].some((token) => normalized.includes(token))) {
    bundleIds.add("crm");
  }
  if (["commerce", "order", "product", "checkout"].some((token) => normalized.includes(token))) {
    bundleIds.add("commerce");
  }
  if (["local business", "review", "google business", "hours", "gbp"].some((token) => normalized.includes(token))) {
    bundleIds.add("local-business");
  }
  if (["oracle", "market", "prediction", "polymarket", "kalshi"].some((token) => normalized.includes(token))) {
    bundleIds.add("oracle");
  }

  if (bundleIds.size === 0) {
    bundleIds.add("debug-ops");
    bundleIds.add("plugin-authoring");
  }

  return [...bundleIds];
}

export const developerPlugin = {
  tools: [
    registerTool(defineTool({
      name: "developer_get_worker_status",
      description: "Inspect BullMQ heartbeat worker status, scheduler state, and queue counts.",
      parameters: { type: "object", properties: {} },
      execute: async () => ({
        worker: await getAgentWorkerStatus(),
      }),
    } satisfies ToolDefinition<WorkerStatusArgs, { worker: Awaited<ReturnType<typeof getAgentWorkerStatus>> }>)),
    registerTool(defineTool({
      name: "developer_list_worker_jobs",
      description: "List recent heartbeat worker jobs by status for inspection and debugging.",
      parameters: {
        type: "object",
        properties: {
          statuses: {
            type: "array",
            items: { type: "string", enum: ["waiting", "active", "delayed", "completed", "failed"] },
          },
          limit: { type: "number", default: 20 },
        },
      },
      execute: async ({ statuses, limit }: WorkerJobsArgs) => ({
        jobs: await listAgentHeartbeatJobs(statuses, limit ?? 20),
      }),
    } satisfies ToolDefinition<WorkerJobsArgs, { jobs: Awaited<ReturnType<typeof listAgentHeartbeatJobs>> }>)),
    registerTool(defineTool({
      name: "developer_retry_worker_job",
      description: "Retry a failed heartbeat worker job by job id.",
      parameters: {
        type: "object",
        properties: {
          jobId: { type: "string" },
        },
        required: ["jobId"],
      },
      execute: async ({ jobId }: RetryWorkerJobArgs) => retryAgentHeartbeatJob(jobId),
    } satisfies ToolDefinition<RetryWorkerJobArgs, Awaited<ReturnType<typeof retryAgentHeartbeatJob>>>)),
    registerTool(defineTool({
      name: "developer_get_mcp_queue_status",
      description: "Inspect MCP snapshot BullMQ queue counts and the shared MCP worker pulse state.",
      parameters: { type: "object", properties: {} },
      execute: async () => ({
        worker: await getMcpQueueStatus(),
      }),
    } satisfies ToolDefinition<Record<string, never>, { worker: Awaited<ReturnType<typeof getMcpQueueStatus>> }>)),
    registerTool(defineTool({
      name: "developer_inspect_mcp_health",
      description: "Inspect a one-shot MCP health snapshot spanning imported server connectivity, queue backlog, trace persistence, sampling, and Builder drift.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async (_args: McpHealthInspectArgs) => ({
        health: await buildMcpHealthSnapshot(),
      }),
    } satisfies ToolDefinition<McpHealthInspectArgs, { health: Awaited<ReturnType<typeof buildMcpHealthSnapshot>> }>)),
    registerTool(defineTool({
      name: "developer_list_mcp_jobs",
      description: "List recent MCP snapshot BullMQ jobs across embeddings, ontology enrichment, and cleanup queues.",
      parameters: {
        type: "object",
        properties: {
          statuses: {
            type: "array",
            items: { type: "string", enum: ["waiting", "active", "delayed", "completed", "failed"] },
          },
          limit: { type: "number", default: 20 },
        },
      },
      execute: async ({ statuses, limit }: McpJobsArgs) => ({
        jobs: await listMcpJobs(statuses, limit ?? 20),
      }),
    } satisfies ToolDefinition<McpJobsArgs, { jobs: Awaited<ReturnType<typeof listMcpJobs>> }>)),
    registerTool(defineTool({
      name: "developer_retry_mcp_job",
      description: "Retry a failed MCP snapshot BullMQ job by queue name and job id.",
      parameters: {
        type: "object",
        properties: {
          queueName: { type: "string" },
          jobId: { type: "string" },
        },
        required: ["queueName", "jobId"],
      },
      execute: async ({ queueName, jobId }: RetryMcpJobArgs) => retryMcpJob(queueName, jobId),
    } satisfies ToolDefinition<RetryMcpJobArgs, Awaited<ReturnType<typeof retryMcpJob>>>)),
    registerTool(defineTool({
      name: "developer_enqueue_heartbeat",
      description: "Enqueue a heartbeat job manually for immediate worker execution.",
      parameters: {
        type: "object",
        properties: {
          trigger: { type: "string", enum: ["manual", "scheduler"], default: "manual" },
        },
      },
      execute: async ({ trigger }: EnqueueHeartbeatArgs) => {
        const job = await enqueueAgentHeartbeat(trigger ?? "manual");
        return { queued: true, jobId: String(job.id) };
      },
    } satisfies ToolDefinition<EnqueueHeartbeatArgs, { queued: boolean; jobId: string }>)),
    registerTool(defineTool({
      name: "developer_inspect_memories",
      description: "Inspect stored BizBot memories by query or category without using semantic recall.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          category: { type: "string" },
          limit: { type: "number", default: 20 },
        },
      },
      execute: async ({ query, category, limit }: MemoryInspectArgs) => ({
        memories: await inspectMemories({ query, category, limit: limit ?? 20 }),
      }),
    } satisfies ToolDefinition<MemoryInspectArgs, { memories: Awaited<ReturnType<typeof inspectMemories>> }>)),
    registerTool(defineTool({
      name: "developer_list_conversations",
      description: "List recent BizBot conversations with message counts for debugging and inspection.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", default: 20 },
        },
      },
      execute: async ({ limit }: ConversationListArgs) => ({
        conversations: await listRecentConversations({ limit: limit ?? 20 }),
      }),
    } satisfies ToolDefinition<ConversationListArgs, { conversations: Awaited<ReturnType<typeof listRecentConversations>> }>)),
    registerTool(defineTool({
      name: "developer_get_conversation_messages",
      description: "Read recent messages from a specific BizBot conversation.",
      parameters: {
        type: "object",
        properties: {
          conversationId: { type: "string" },
          limit: { type: "number", default: 50 },
        },
        required: ["conversationId"],
      },
      execute: async ({ conversationId, limit }: ConversationMessagesArgs) => ({
        messages: await inspectConversationMessages(conversationId, limit ?? 50),
      }),
    } satisfies ToolDefinition<ConversationMessagesArgs, { messages: Awaited<ReturnType<typeof inspectConversationMessages>> }>)),
    registerTool(defineTool({
      name: "developer_list_agent_runs",
      description: "List recent BizBot agent runs with lane, status, tool counts, and reply/error summary.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", default: 20 },
        },
      },
      execute: async ({ limit }: AgentRunsArgs) => ({
        runs: listRecentAgentRuns(limit ?? 20),
      }),
    } satisfies ToolDefinition<AgentRunsArgs, { runs: ReturnType<typeof listRecentAgentRuns> }>)),
    registerTool(defineTool({
      name: "developer_vscode_loop_assist",
      description: "Sample the connected MCP client for a Builder dev-loop diagnosis using deterministic BizBot context.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async (_args: DeveloperLoopAssistArgs, context) => {
        const devLoopContext = await buildCurrentBuilderDevLoopContext();
        if (!devLoopContext) {
          return {
            sampling: {
              available: false,
              reason: "No current Builder project overview is available.",
              transportKind: context.mcpSamplingSession?.transportKind ?? "http",
            },
            result: {
              session: {
                sessionId: null,
                traceId: null,
                requestId: null,
                toolInvocationId: null,
                idempotencyKey: null,
                requestStartedAt: null,
                toolBudgetAllowed: false,
              },
              diagnosisSource: "deterministic_fallback",
              summary: "No current Builder project overview is available.",
              status: "unavailable",
              tripletHealth: {
                overall: "unknown",
                mcpSnapshot: "unknown",
                dependencyContract: "unknown",
                fileTopologyContract: "unknown",
              },
              latestFailure: null,
              likelyRootCause: null,
              suggestedFix: null,
              smallestNextFix: null,
              recommendedNextProbe: null,
              evidenceUsed: [],
              nextSteps: [],
              confidence: "low",
            },
          };
        }

        const result = await requestDevLoopSampling(context.mcpSamplingSession, devLoopContext);

        return {
          sampling: {
            available: result.availability.available,
            reason: result.availability.reason,
            transportKind: result.availability.transportKind,
            allowTools: result.availability.allowTools,
            clientSupportsSampling: result.availability.clientSupportsSampling,
            clientSupportsSamplingTools: result.availability.clientSupportsSamplingTools,
            nestedFlowBlocked: result.availability.nestedFlowBlocked,
          },
          context: devLoopContext,
          result: {
            session: result.session,
            diagnosisSource: result.diagnosisSource,
            summary: result.summary,
            status: result.status,
            tripletHealth: result.tripletHealth,
            latestFailure: result.latestFailure,
            likelyRootCause: result.likelyRootCause,
            suggestedFix: result.suggestedFix,
            smallestNextFix: result.smallestNextFix,
            recommendedNextProbe: result.recommendedNextProbe,
            evidenceUsed: result.evidenceUsed,
            nextSteps: result.nextSteps,
            confidence: result.confidence,
            model: result.model,
            stopReason: result.stopReason,
          },
        };
      },
    } satisfies ToolDefinition<DeveloperLoopAssistArgs, {
      sampling: {
        available: boolean;
        reason: string | null;
        transportKind: string;
        allowTools?: boolean;
        clientSupportsSampling?: boolean;
        clientSupportsSamplingTools?: boolean;
        nestedFlowBlocked?: boolean;
      };
      context?: Awaited<ReturnType<typeof buildCurrentBuilderDevLoopContext>>;
      result: {
        session: {
          sessionId: string | null;
          traceId: string | null;
          requestId: string | null;
          toolInvocationId: string | null;
          idempotencyKey: string | null;
          requestStartedAt: string | null;
          toolBudgetAllowed: boolean;
        };
        diagnosisSource: string;
        summary: string;
        status: string;
        tripletHealth: { overall: string; mcpSnapshot: string; dependencyContract: string; fileTopologyContract: string };
        latestFailure: string | null;
        likelyRootCause: string | null;
        suggestedFix: string | null;
        smallestNextFix: string | null;
        recommendedNextProbe: string | null;
        evidenceUsed: string[];
        nextSteps: string[];
        confidence: string;
        model?: string | null;
        stopReason?: string | null;
      };
    }>)),
    registerTool(defineTool({
      name: "developer_search_mcp_snapshot_history",
      description: "Search Builder MCP snapshot history semantically within a single project.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          query: { type: "string" },
          limit: { type: "number", default: 5 },
        },
        required: ["projectId", "query"],
      },
      execute: async ({ projectId, query, limit }: McpSnapshotSearchArgs) => {
        const { searchBuilderMcpSnapshotHistory } = await loadBuilderMcpSnapshots();
        return {
          matches: await searchBuilderMcpSnapshotHistory({ projectId, query, limit: limit ?? 5 }),
        };
      },
    } satisfies ToolDefinition<McpSnapshotSearchArgs, { matches: Awaited<ReturnType<typeof searchBuilderMcpSnapshotHistory>> }>)),
    registerTool(defineTool({
      name: "developer_get_agent_run",
      description: "Read the full journal for a specific BizBot agent run, including tool call/result traces.",
      parameters: {
        type: "object",
        properties: {
          runId: { type: "string" },
        },
        required: ["runId"],
      },
      execute: async ({ runId }: AgentRunArgs) => ({
        run: getAgentRun(runId),
      }),
    } satisfies ToolDefinition<AgentRunArgs, { run: ReturnType<typeof getAgentRun> }>)),
    registerTool(defineTool({
      name: "developer_resume_agent_run",
      description: "Resume a previously failed or interrupted BizBot agent run from the last stable checkpoint when the recorded state is resume-safe.",
      parameters: {
        type: "object",
        properties: {
          runId: { type: "string" },
          provider: { type: "string", description: "Optional provider override for the resumed run." },
        },
        required: ["runId"],
      },
      execute: async ({ runId, provider }: ResumeAgentRunArgs, context) => {
        const sourceRun = getAgentRun(runId);
        const result = await executeAgentConversation({
          message: `Resume agent run ${runId}`,
          conversationId: sourceRun.conversationId,
          userId: context.userId,
          provider: provider as LLMProvider | undefined,
          resumeRunId: runId,
        });

        return {
          resumed: true,
          sourceRunId: runId,
          result,
        };
      },
    } satisfies ToolDefinition<ResumeAgentRunArgs, {
      resumed: true;
      sourceRunId: string;
      result: Awaited<ReturnType<typeof executeAgentConversation>>;
    }>)),
    registerTool(defineTool({
      name: "developer_inspect_plugin_registry",
      description: "Inspect the builtin plugin registry, tool ownership map, imported MCP provenance, and conflict warnings.",
      parameters: { type: "object", properties: {} },
      execute: async () => ({
        registry: inspectPluginRegistry({
          plugins: await loadBuiltinPlugins(),
          importedTools: getMcpClientToolCatalog(),
        }),
      }),
    } satisfies ToolDefinition<Record<string, never>, { registry: ReturnType<typeof inspectPluginRegistry> }>)),
    registerTool(defineTool({
      name: "developer_inspect_plugin",
      description: "Inspect a builtin plugin or a plugin source file and return metadata, tools, warnings, conflicts, and MCP exposure notes.",
      parameters: {
        type: "object",
        properties: {
          pluginId: { type: "string" },
          pluginFilePath: { type: "string" },
        },
      },
      execute: async (args: PluginLocatorArgs) => ({
        inspection: inspectPluginDefinition(await resolveInspectablePlugin(args), await buildInspectionContext()),
      }),
    } satisfies ToolDefinition<PluginLocatorArgs, { inspection: ReturnType<typeof inspectPluginDefinition> }>)),
    registerTool(defineTool({
      name: "developer_validate_plugin_contract",
      description: "Lint and validate a builtin plugin or plugin source file for metadata, schema, naming, and registry compatibility issues.",
      parameters: {
        type: "object",
        properties: {
          pluginId: { type: "string" },
          pluginFilePath: { type: "string" },
        },
      },
      execute: async (args: PluginLocatorArgs) => {
        const plugin = await resolveInspectablePlugin(args);
        const inspection = inspectPluginDefinition(plugin, await buildInspectionContext());
        const lint = lintPlugin(plugin);
        return {
          ok: lint.errors.length === 0 && inspection.conflicts.every((issue) => issue.severity !== "error"),
          lint,
          conflicts: inspection.conflicts,
          inspectionSummary: {
            pluginId: plugin.metadata.id ?? null,
            toolCount: plugin.tools.length,
          },
        };
      },
    } satisfies ToolDefinition<PluginLocatorArgs, { ok: boolean; lint: ReturnType<typeof lintPlugin>; conflicts: ReturnType<typeof inspectPluginDefinition>["conflicts"]; inspectionSummary: { pluginId: string | null; toolCount: number } }>)),
    registerTool(defineTool({
      name: "developer_check_tool_naming",
      description: "Evaluate proposed tool names against BizBot namespace conventions and collision risks.",
      parameters: {
        type: "object",
        properties: {
          names: { type: "array", items: { type: "string" } },
          expectedPrefix: { type: "string" },
        },
        required: ["names"],
        additionalProperties: false,
      },
      execute: async ({ names, expectedPrefix }: ToolNamingArgs) => ({
        rules: (await loadPreviewCatalog()).NAMING_RULES,
        analyses: names.map((name) => ({
          name,
          analysis: inspectPluginDefinition({
            sourceType: "source-file",
            sourceLabel: name,
            metadata: { id: expectedPrefix },
            tools: [{ name }],
          }, {
            existingPlugins: [],
            importedTools: [],
            promptCatalog: [],
            resourceCatalog: [],
          }).tools[0]?.naming,
        })),
      }),
    } satisfies ToolDefinition<ToolNamingArgs, { rules: { prefixes: string[]; rules: string[]; examples: { good: string[]; bad: string[] } }; analyses: Array<{ name: string; analysis: ReturnType<typeof inspectPluginDefinition>["tools"][number]["naming"] | undefined }> }>)),
    registerTool(defineTool({
      name: "developer_preview_mcp_exposure",
      description: "Preview how a plugin affects the current MCP tools, prompts, and resources catalogs before relying on it.",
      parameters: {
        type: "object",
        properties: {
          pluginId: { type: "string" },
          pluginFilePath: { type: "string" },
        },
      },
      execute: async (args: PluginLocatorArgs) => {
        const previewCatalog = await loadPreviewCatalog();
        const plugin = await resolveInspectablePlugin(args);
        const inspection = inspectPluginDefinition(plugin, await buildInspectionContext());
        const platformContract = getBizBotPlatformContract();
        return {
          plugin: plugin.metadata,
          platformContract: {
            version: platformContract.version,
            mcpLane: platformContract.mcpExposureContract.mcpLane,
          },
          exposure: inspection.exposure,
          currentCatalog: {
            tools: previewCatalog.listCurrentMcpToolDescriptors().map((tool) => ({
              name: tool.name,
              ownerId: tool.ownerId,
              ownerLabel: tool.ownerLabel,
              ownerKind: tool.ownerKind,
              provenance: tool.provenance,
            })),
            prompts: previewCatalog.listBizBotPromptDefinitions().map((prompt) => ({ name: prompt.name, ownerId: prompt.ownerId })),
            resources: previewCatalog.listBizBotResourceDefinitions().map((resource) => ({ uri: resource.uri, ownerId: resource.ownerId })),
          },
          notes: [
            "Plugin tools flow directly into tools/list when registered and permitted for the MCP lane.",
            "Prompt and resource catalogs are currently server-owned; plugin work changes them only when the MCP server itself is updated.",
          ],
        };
      },
    } satisfies ToolDefinition<PluginLocatorArgs, { plugin: InspectablePluginShape["metadata"]; exposure: ReturnType<typeof inspectPluginDefinition>["exposure"]; currentCatalog: { tools: Array<{ name: string; ownerId: string; ownerLabel: string; ownerKind: string; provenance: unknown }>; prompts: Array<{ name: string; ownerId: string }>; resources: Array<{ uri: string; ownerId: string }> }; notes: string[] }>)),
    registerTool(defineTool({
      name: "developer_explain_registry_conflict",
      description: "Explain why a tool or plugin id conflicts, where current ownership lives, and what resolution paths make sense.",
      parameters: {
        type: "object",
        properties: {
          identifier: { type: "string" },
        },
        required: ["identifier"],
        additionalProperties: false,
      },
      execute: async ({ identifier }: ConflictArgs) => ({
        explanation: explainRegistryConflict(
          inspectPluginRegistry({
            plugins: await loadBuiltinPlugins(),
            importedTools: getMcpClientToolCatalog(),
          }),
          identifier,
        ),
      }),
    } satisfies ToolDefinition<ConflictArgs, { explanation: ReturnType<typeof explainRegistryConflict> }>)),
    registerTool(defineTool({
      name: "developer_preview_prompt",
      description: "Preview prompt metadata and rendered messages for a named MCP prompt with optional sample arguments.",
      parameters: {
        type: "object",
        properties: {
          promptName: { type: "string" },
          args: { type: "json" },
        },
        required: ["promptName"],
        additionalProperties: false,
      },
      execute: async ({ promptName, args }: PromptPreviewArgs) => {
        const previewCatalog = await loadPreviewCatalog();
        const promptArgs = Object.fromEntries(Object.entries((args ?? {}) as JsonObject).map(([key, value]) => [key, value === null ? undefined : String(value)]));
        return previewCatalog.previewPrompt(promptName, promptArgs);
      },
    } satisfies ToolDefinition<PromptPreviewArgs, PromptPreviewResult>)),
    registerTool(defineTool({
      name: "developer_preview_resource",
      description: "Preview resource metadata and a sample payload for a named BizBot MCP resource.",
      parameters: {
        type: "object",
        properties: {
          resource: { type: "string" },
        },
        required: ["resource"],
        additionalProperties: false,
      },
      execute: async ({ resource }: ResourcePreviewArgs) => (await loadPreviewCatalog()).previewResource(resource),
    } satisfies ToolDefinition<ResourcePreviewArgs, ResourcePreviewResult>)),
    registerTool(defineTool({
      name: "developer_preview_tool_descriptor",
      description: "Preview the exact MCP-facing descriptor for a tool, including title, description, annotations, and input schema.",
      parameters: {
        type: "object",
        properties: {
          toolName: { type: "string" },
        },
        required: ["toolName"],
        additionalProperties: false,
      },
      execute: async ({ toolName }: ToolDescriptorArgs) => {
        const descriptor = (await loadPreviewCatalog()).listCurrentMcpToolDescriptors().find((tool) => tool.name === toolName);
        if (!descriptor) {
          throw new Error(`Unknown MCP tool descriptor: ${toolName}`);
        }
        return { descriptor };
      },
    } satisfies ToolDefinition<ToolDescriptorArgs, ToolDescriptorPreviewResult>)),
    registerTool(defineTool({
      name: "developer_search_tools",
      description: "Search the current BizBot MCP tool catalog with support for bundles, safety hints, and imported-tool filtering.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          prefix: { type: "string" },
          ownerId: { type: "string" },
          bundleId: { type: "string" },
          includeImported: { type: "boolean", default: true },
          readOnlyOnly: { type: "boolean", default: false },
          destructiveOnly: { type: "boolean", default: false },
          limit: { type: "number", default: 20 },
        },
        additionalProperties: false,
      },
      execute: async ({ query, prefix, ownerId, bundleId, includeImported, readOnlyOnly, destructiveOnly, limit }: ToolSearchArgs) => {
        const previewCatalog = await loadPreviewCatalog();
        const normalizedQuery = normalizeSearchQuery(query);
        const selectedBundle = bundleId ? previewCatalog.getMcpDiscoveryBundle(bundleId) : undefined;
        if (bundleId && !selectedBundle) {
          throw new Error(`Unknown MCP discovery bundle: ${bundleId}`);
        }

        const sourceTools = selectedBundle?.tools ?? previewCatalog.listCurrentMcpToolDescriptors();
        const matches = sourceTools.filter((tool) => {
          if ((includeImported ?? true) === false && tool.ownerKind === "imported-mcp") {
            return false;
          }
          if (prefix && !tool.name.startsWith(prefix)) {
            return false;
          }
          if (ownerId && tool.ownerId !== ownerId) {
            return false;
          }
          if ((readOnlyOnly ?? false) && !tool.annotations.readOnlyHint) {
            return false;
          }
          if ((destructiveOnly ?? false) && !tool.annotations.destructiveHint) {
            return false;
          }
          return includesSearch([tool.name, tool.title, tool.description, tool.ownerId], normalizedQuery);
        }).slice(0, limit ?? 20);

        return {
          query: {
            query: query ?? null,
            prefix: prefix ?? null,
            ownerId: ownerId ?? null,
            bundleId: bundleId ?? null,
            includeImported: includeImported ?? true,
            readOnlyOnly: readOnlyOnly ?? false,
            destructiveOnly: destructiveOnly ?? false,
            limit: limit ?? 20,
          },
          totalMatches: matches.length,
          availableBundles: previewCatalog.listMcpDiscoveryBundles().map((bundle) => ({
            bundleId: bundle.bundleId,
            title: bundle.title,
            description: bundle.description,
          })),
          matches,
        };
      },
    } satisfies ToolDefinition<ToolSearchArgs, {
      query: { query: string | null; prefix: string | null; ownerId: string | null; bundleId: string | null; includeImported: boolean; readOnlyOnly: boolean; destructiveOnly: boolean; limit: number };
      totalMatches: number;
      availableBundles: Array<{ bundleId: string; title: string; description: string }>;
      matches: ReturnType<typeof import("@/lib/mcp/preview-catalog").listCurrentMcpToolDescriptors>;
    }>)),
    registerTool(defineTool({
      name: "developer_get_tool_bundle",
      description: "Return a curated MCP tool, prompt, and resource bundle for a major BizBot workflow family.",
      parameters: {
        type: "object",
        properties: {
          bundleId: { type: "string" },
        },
        required: ["bundleId"],
        additionalProperties: false,
      },
      execute: async ({ bundleId }: ToolBundleArgs) => {
        const previewCatalog = await loadPreviewCatalog();
        const bundle = previewCatalog.getMcpDiscoveryBundle(bundleId);
        if (!bundle) {
          throw new Error(`Unknown MCP discovery bundle: ${bundleId}`);
        }
        return { bundle };
      },
    } satisfies ToolDefinition<ToolBundleArgs, { bundle: Awaited<ReturnType<typeof loadPreviewCatalog>> extends infer Catalog ? Catalog extends { getMcpDiscoveryBundle: (...args: never[]) => infer Result } ? Exclude<Result, undefined> : never : never }>)),
    registerTool(defineTool({
      name: "developer_recommend_toolset_for_goal",
      description: "Recommend the smallest useful MCP bundle and starting surfaces for a stated goal.",
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string" },
        },
        required: ["goal"],
        additionalProperties: false,
      },
      execute: async ({ goal }: ToolRecommendationArgs) => {
        const previewCatalog = await loadPreviewCatalog();
        const bundleIds = deriveRecommendedBundleIds(goal);
        const bundles = bundleIds
          .map((bundleId) => previewCatalog.getMcpDiscoveryBundle(bundleId))
          .filter((bundle): bundle is NonNullable<typeof bundle> => Boolean(bundle));
        const primaryBundle = bundles[0] ?? null;
        const preferredToolOrder = primaryBundle?.bundleId === "builder"
          ? ["developer_summarize_builder_repair", "developer_vscode_loop_assist"]
          : primaryBundle?.bundleId === "plugin-authoring"
            ? ["developer_prepare_plugin_design_review", "developer_check_tool_naming", "developer_check_mcp_contract_impact"]
            : [];
        const recommendedFirstTools = primaryBundle
          ? [...primaryBundle.tools].sort((left, right) => {
              const leftIndex = preferredToolOrder.indexOf(left.name);
              const rightIndex = preferredToolOrder.indexOf(right.name);
              const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
              const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
              return normalizedLeft - normalizedRight;
            }).slice(0, 6)
          : [];
        return {
          goal,
          rationale: primaryBundle
            ? `Selected ${primaryBundle.title} as the primary bundle because its surfaces most directly match the stated goal.`
            : "Fell back to general developer-facing discovery bundles because the goal was broad.",
          primaryBundle,
          secondaryBundles: bundles.slice(1),
          recommendedFirstTools,
          recommendedFirstResources: primaryBundle?.resources.slice(0, 6) ?? [],
          recommendedFirstPrompts: primaryBundle?.prompts.slice(0, 4) ?? [],
        };
      },
    } satisfies ToolDefinition<ToolRecommendationArgs, {
      goal: string;
      rationale: string;
      primaryBundle: ReturnType<Awaited<ReturnType<typeof loadPreviewCatalog>>["getMcpDiscoveryBundle"]> | null;
      secondaryBundles: Array<NonNullable<ReturnType<Awaited<ReturnType<typeof loadPreviewCatalog>>["getMcpDiscoveryBundle"]>>>;
      recommendedFirstTools: ReturnType<typeof import("@/lib/mcp/preview-catalog").listCurrentMcpToolDescriptors>;
      recommendedFirstResources: Array<Awaited<ReturnType<typeof loadPreviewCatalog>> extends infer Catalog ? Catalog extends { listBizBotResourceDefinitions: (...args: never[]) => infer Result } ? Result extends Array<infer Entry> ? Omit<Entry, "read"> : never : never : never>;
      recommendedFirstPrompts: Array<Awaited<ReturnType<typeof loadPreviewCatalog>> extends infer Catalog ? Catalog extends { listBizBotPromptDefinitions: (...args: never[]) => infer Result } ? Result extends Array<infer Entry> ? Omit<Entry, "render"> : never : never : never>;
    }>)),
    registerTool(defineTool({
      name: "developer_search_prompts",
      description: "Search builtin and imported MCP prompt catalogs by query, group, owner, or bundle.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          ownerId: { type: "string" },
          group: { type: "string" },
          bundleId: { type: "string" },
          includeImported: { type: "boolean", default: true },
          limit: { type: "number", default: 20 },
        },
        additionalProperties: false,
      },
      execute: async ({ query, ownerId, group, bundleId, includeImported, limit }: PromptSearchArgs) => {
        const previewCatalog = await loadPreviewCatalog();
        const normalizedQuery = normalizeSearchQuery(query);
        const selectedBundle = bundleId ? previewCatalog.getMcpDiscoveryBundle(bundleId) : undefined;
        if (bundleId && !selectedBundle) {
          throw new Error(`Unknown MCP discovery bundle: ${bundleId}`);
        }

        const builtinPromptCatalog = (selectedBundle?.prompts ?? previewCatalog.listBizBotPromptDefinitions()).map((prompt) => ({
          name: prompt.name,
          title: prompt.title,
          description: prompt.description,
          ownerId: prompt.ownerId,
          group: prompt.group,
          arguments: prompt.arguments,
          sourceKind: "builtin" as const,
        }));
        const builtinPrompts = builtinPromptCatalog.filter((prompt) => {
          if (ownerId && prompt.ownerId !== ownerId) {
            return false;
          }
          if (group && prompt.group !== group) {
            return false;
          }
          return includesSearch([prompt.name, prompt.title, prompt.description, prompt.ownerId, prompt.group], normalizedQuery);
        });

        const importedPrompts = (includeImported ?? true)
          ? (selectedBundle?.importedPrompts ?? previewCatalog.listImportedMcpPromptCatalog()).filter((prompt) => includesSearch([
              prompt.name,
              prompt.title,
              prompt.description,
              prompt.serverName,
            ], normalizedQuery))
          : [];

        return {
          query: { query: query ?? null, ownerId: ownerId ?? null, group: group ?? null, bundleId: bundleId ?? null, includeImported: includeImported ?? true, limit: limit ?? 20 },
          builtinPrompts: builtinPrompts.slice(0, limit ?? 20),
          importedPrompts: importedPrompts.slice(0, limit ?? 20),
        };
      },
    } satisfies ToolDefinition<PromptSearchArgs, {
      query: { query: string | null; ownerId: string | null; group: string | null; bundleId: string | null; includeImported: boolean; limit: number };
      builtinPrompts: Array<{ name: string; title: string; description: string; ownerId: string; group: string; arguments: Array<{ name: string; required?: boolean; description: string }>; sourceKind: "builtin" }>;
      importedPrompts: Array<{ serverName: string; name: string; title: string | null; description: string | null; arguments: Array<{ name: string; required?: boolean; description?: string }>; sourceKind: "imported-mcp" }>;
    }>)),
    registerTool(defineTool({
      name: "developer_search_resources",
      description: "Search builtin and imported MCP resources by query, group, owner, or bundle.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          ownerId: { type: "string" },
          group: { type: "string" },
          bundleId: { type: "string" },
          includeImported: { type: "boolean", default: true },
          limit: { type: "number", default: 20 },
        },
        additionalProperties: false,
      },
      execute: async ({ query, ownerId, group, bundleId, includeImported, limit }: ResourceSearchArgs) => {
        const previewCatalog = await loadPreviewCatalog();
        const normalizedQuery = normalizeSearchQuery(query);
        const selectedBundle = bundleId ? previewCatalog.getMcpDiscoveryBundle(bundleId) : undefined;
        if (bundleId && !selectedBundle) {
          throw new Error(`Unknown MCP discovery bundle: ${bundleId}`);
        }

        const builtinResourceCatalog = (selectedBundle?.resources ?? previewCatalog.listBizBotResourceDefinitions()).map((resource) => ({
          name: resource.name,
          uri: resource.uri,
          title: resource.title,
          description: resource.description,
          mimeType: resource.mimeType,
          ownerId: resource.ownerId,
          group: resource.group,
          sourceKind: "builtin" as const,
        }));
        const builtinResources = builtinResourceCatalog.filter((resource) => {
          if (ownerId && resource.ownerId !== ownerId) {
            return false;
          }
          if (group && resource.group !== group) {
            return false;
          }
          return includesSearch([resource.name, resource.uri, resource.title, resource.description, resource.ownerId, resource.group], normalizedQuery);
        });

        const importedResources = (includeImported ?? true)
          ? (selectedBundle?.importedResources ?? previewCatalog.listImportedMcpResourceCatalog()).filter((resource) => includesSearch([
              resource.name,
              resource.uri,
              resource.title,
              resource.description,
              resource.serverName,
            ], normalizedQuery))
          : [];

        return {
          query: { query: query ?? null, ownerId: ownerId ?? null, group: group ?? null, bundleId: bundleId ?? null, includeImported: includeImported ?? true, limit: limit ?? 20 },
          builtinResources: builtinResources.slice(0, limit ?? 20),
          importedResources: importedResources.slice(0, limit ?? 20),
        };
      },
    } satisfies ToolDefinition<ResourceSearchArgs, {
      query: { query: string | null; ownerId: string | null; group: string | null; bundleId: string | null; includeImported: boolean; limit: number };
      builtinResources: Array<{ name: string; uri: string; title: string; description: string; mimeType: string; ownerId: string; group: string; sourceKind: "builtin" }>;
      importedResources: Array<{ serverName: string; name: string | null; uri: string; title: string | null; description: string | null; mimeType: string | null; sourceKind: "imported-mcp" }>;
    }>)),
    registerTool(defineTool({
      name: "developer_audit_imported_mcp_servers",
      description: "Summarize imported MCP server status, catalogs, collisions, and recommended next actions.",
      parameters: {
        type: "object",
        properties: {
          serverName: { type: "string" },
        },
        additionalProperties: false,
      },
      execute: async ({ serverName }: ImportedMcpAuditArgs) => {
        const previewCatalog = await loadPreviewCatalog();
        const statuses = getMcpClientStatus().filter((entry) => !serverName || entry.name === serverName);
        const toolCatalog = getMcpClientToolCatalog().filter((entry) => !serverName || entry.serverName === serverName);
        const promptCatalog = previewCatalog.listImportedMcpPromptCatalog().filter((entry) => !serverName || entry.serverName === serverName);
        const resourceCatalog = previewCatalog.listImportedMcpResourceCatalog().filter((entry) => !serverName || entry.serverName === serverName);
        const builtinToolNames = new Set(previewCatalog.listCurrentMcpToolDescriptors().filter((tool) => tool.ownerKind !== "imported-mcp").map((tool) => tool.name));
        const originalNameCollisions = toolCatalog.filter((tool) => builtinToolNames.has(tool.originalName));
        const duplicateImportedOriginals = Object.entries(toolCatalog.reduce<Record<string, string[]>>((accumulator, entry) => {
          accumulator[entry.originalName] ??= [];
          accumulator[entry.originalName].push(entry.serverName);
          return accumulator;
        }, {})).filter(([, servers]) => servers.length > 1).map(([originalName, servers]) => ({ originalName, servers }));

        return {
          scope: serverName ?? null,
          summary: {
            serverCount: statuses.length,
            connectedCount: statuses.filter((entry) => entry.connected).length,
            toolCount: toolCatalog.length,
            promptCount: promptCatalog.length,
            resourceCount: resourceCatalog.length,
            builtinNameCollisionCount: originalNameCollisions.length,
            duplicateImportedOriginalCount: duplicateImportedOriginals.length,
          },
          servers: statuses.map((status) => ({
            ...status,
            promptCount: promptCatalog.filter((entry) => entry.serverName === status.name).length,
            resourceCount: resourceCatalog.filter((entry) => entry.serverName === status.name).length,
          })),
          toolCatalog,
          promptCatalog,
          resourceCatalog,
          collisions: {
            builtinNameCollisions: originalNameCollisions,
            duplicateImportedOriginals,
          },
          recommendations: [
            originalNameCollisions.length > 0 ? "Review imported tool originals that shadow builtin BizBot names before broadening agent access." : "No builtin-name collisions detected for imported tools.",
            promptCatalog.length > 0 || resourceCatalog.length > 0 ? "Imported prompts and resources are available for discovery even when runtime execution is tool-first." : "No imported prompt/resource catalogs are currently connected.",
          ],
        };
      },
    } satisfies ToolDefinition<ImportedMcpAuditArgs, {
      scope: string | null;
      summary: { serverCount: number; connectedCount: number; toolCount: number; promptCount: number; resourceCount: number; builtinNameCollisionCount: number; duplicateImportedOriginalCount: number };
      servers: Array<{ name: string; url: string; connected: boolean; toolCount: number; promptCount: number; resourceCount: number }>;
      toolCatalog: ReturnType<typeof getMcpClientToolCatalog>;
      promptCatalog: ReturnType<Awaited<ReturnType<typeof loadPreviewCatalog>>["listImportedMcpPromptCatalog"]>;
      resourceCatalog: ReturnType<Awaited<ReturnType<typeof loadPreviewCatalog>>["listImportedMcpResourceCatalog"]>;
      collisions: {
        builtinNameCollisions: ReturnType<typeof getMcpClientToolCatalog>;
        duplicateImportedOriginals: Array<{ originalName: string; servers: string[] }>;
      };
      recommendations: string[];
    }>)),
    registerTool(defineTool({
      name: "developer_read_imported_mcp_resource",
      description: "Read a resource from a connected imported MCP server through BizBot's client layer.",
      parameters: {
        type: "object",
        properties: {
          serverName: { type: "string" },
          uri: { type: "string" },
        },
        required: ["serverName", "uri"],
        additionalProperties: false,
      },
      execute: async ({ serverName, uri }: ImportedMcpResourceReadArgs) => {
        const resourceCatalog = (await loadPreviewCatalog()).listImportedMcpResourceCatalog();
        const descriptor = resourceCatalog.find((entry) => entry.serverName === serverName && entry.uri === uri) ?? null;
        return {
          descriptor,
          contents: await readMcpClientResource(serverName, uri),
        };
      },
    } satisfies ToolDefinition<ImportedMcpResourceReadArgs, {
      descriptor: Awaited<ReturnType<typeof loadPreviewCatalog>> extends infer Catalog ? Catalog extends { listImportedMcpResourceCatalog: (...args: never[]) => infer Result } ? Result extends Array<infer Entry> ? Entry | null : null : null : null;
      contents: Awaited<ReturnType<typeof readMcpClientResource>>;
    }>)),
    registerTool(defineTool({
      name: "developer_get_imported_mcp_prompt",
      description: "Fetch prompt messages from a connected imported MCP server through BizBot's client layer.",
      parameters: {
        type: "object",
        properties: {
          serverName: { type: "string" },
          name: { type: "string" },
          args: { type: "json" },
        },
        required: ["serverName", "name"],
        additionalProperties: false,
      },
      execute: async ({ serverName, name, args }: ImportedMcpPromptGetArgs) => {
        const promptCatalog = (await loadPreviewCatalog()).listImportedMcpPromptCatalog();
        const descriptor = promptCatalog.find((entry) => entry.serverName === serverName && entry.name === name) ?? null;
        const promptArgs = Object.fromEntries(Object.entries((args ?? {}) as JsonObject).flatMap(([key, value]) => value === null ? [] : [[key, String(value)]]));
        return {
          descriptor,
          prompt: await getMcpClientPrompt(serverName, name, promptArgs),
        };
      },
    } satisfies ToolDefinition<ImportedMcpPromptGetArgs, {
      descriptor: Awaited<ReturnType<typeof loadPreviewCatalog>> extends infer Catalog ? Catalog extends { listImportedMcpPromptCatalog: (...args: never[]) => infer Result } ? Result extends Array<infer Entry> ? Entry | null : null : null : null;
      prompt: Awaited<ReturnType<typeof getMcpClientPrompt>>;
    }>)),
    registerTool(defineTool({
      name: "developer_inspect_ontology_schema",
      description: "Inspect ontology v1 schema, scopes, statuses, canonical types, and runtime budget policy.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => ({
        schema: await getOntologySchemaSummary(),
      }),
    } satisfies ToolDefinition<Record<string, never>, { schema: Awaited<ReturnType<typeof getOntologySchemaSummary>> }>)),
    registerTool(defineTool({
      name: "developer_search_ontology_entities",
      description: "Search ontology entities by canonical key, scoped name, or alias for developer inspection.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          userId: { type: "string" },
          scope: { type: "string", enum: ["user", "runtime", "global"] },
          limit: { type: "number", default: 20 },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async ({ query, userId, scope, limit }: OntologySearchArgs) => ({
        results: await searchOntologyEntities({ query, userId, scope, limit }),
      }),
    } satisfies ToolDefinition<OntologySearchArgs, { results: Awaited<ReturnType<typeof searchOntologyEntities>> }>)),
    registerTool(defineTool({
      name: "developer_preview_ontology_context",
      description: "Preview the bounded runtime ontology context block for a specific user without injecting it into a prompt.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" },
        },
        required: ["userId"],
        additionalProperties: false,
      },
      execute: async ({ userId }: OntologyContextArgs) => ({
        preview: await buildOntologyPromptBlock(userId),
      }),
    } satisfies ToolDefinition<OntologyContextArgs, { preview: Awaited<ReturnType<typeof buildOntologyPromptBlock>> }>)),
    registerTool(defineTool({
      name: "developer_explain_ontology_alias",
      description: "Explain how an ontology alias resolves under scope precedence or why it remains ambiguous.",
      parameters: {
        type: "object",
        properties: {
          alias: { type: "string" },
          userId: { type: "string" },
          type: { type: "string" },
        },
        required: ["alias"],
        additionalProperties: false,
      },
      execute: async ({ alias, userId, type }: OntologyAliasArgs) => ({
        resolution: await resolveOntologyAlias({ alias, userId, type }),
      }),
    } satisfies ToolDefinition<OntologyAliasArgs, { resolution: Awaited<ReturnType<typeof resolveOntologyAlias>> }>)),
    registerTool(defineTool({
      name: "developer_validate_ontology_relation",
      description: "Validate ontology relation shape, scope, and referenced entities without mutating ontology state.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" },
          scope: { type: "string", enum: ["user", "runtime", "global"] },
          type: { type: "string" },
          subjectEntityId: { type: "string" },
          objectEntityId: { type: "string" },
        },
        required: ["scope", "type", "subjectEntityId", "objectEntityId"],
        additionalProperties: false,
      },
      execute: async (args: OntologyRelationValidationArgs) => ({
        validation: await validateOntologyRelationInput(args),
      }),
    } satisfies ToolDefinition<OntologyRelationValidationArgs, { validation: Awaited<ReturnType<typeof validateOntologyRelationInput>> }>)),
    registerTool(defineTool({
      name: "developer_suggest_plugin_tests",
      description: "Suggest focused plugin, schema, failure-path, and MCP contract tests for a builtin plugin or source file.",
      parameters: {
        type: "object",
        properties: {
          pluginId: { type: "string" },
          pluginFilePath: { type: "string" },
        },
      },
      execute: async (args: PluginLocatorArgs) => {
        const plugin = await resolveInspectablePlugin(args);
        return {
          plugin: plugin.metadata,
          checklist: (await loadPreviewCatalog()).AUTHORING_CHECKLIST,
          suggestedTests: buildSuggestedPluginTests(plugin),
        };
      },
    } satisfies ToolDefinition<PluginLocatorArgs, { plugin: InspectablePluginShape["metadata"]; checklist: string[]; suggestedTests: string[] }>)),
    registerTool(defineTool({
      name: "developer_check_mcp_contract_impact",
      description: "Explain how a plugin affects the current MCP tool, prompt, and resource catalogs and which contract tests to review.",
      parameters: {
        type: "object",
        properties: {
          pluginId: { type: "string" },
          pluginFilePath: { type: "string" },
        },
      },
      execute: async (args: PluginLocatorArgs) => {
        const previewCatalog = await loadPreviewCatalog();
        const plugin = await resolveInspectablePlugin(args);
        const inspection = inspectPluginDefinition(plugin, await buildInspectionContext());
        const platformContract = getBizBotPlatformContract();
        const classification: BizBotContractCompatibilityClassification = inspection.conflicts.some((issue) => issue.severity === "error")
          ? "breaking"
          : inspection.exposure.tools.length > 0
            ? "non_breaking"
            : "internal_only";
        return {
          plugin: plugin.metadata,
          platformContract: {
            version: platformContract.version,
            compatibilityPolicy: platformContract.compatibilityPolicy,
          },
          impact: {
            addedTools: inspection.exposure.tools,
            promptsChanged: inspection.exposure.notes.some((note) => note.includes("Prompt and resource catalogs are currently server-owned")),
            resourcesChanged: inspection.exposure.notes.some((note) => note.includes("Prompt and resource catalogs are currently server-owned")),
            classification,
            requiresPlatformVersionBump: classification === "breaking",
            notes: inspection.exposure.notes,
          },
          currentCatalog: {
            tools: previewCatalog.listCurrentMcpToolDescriptors().map((tool) => tool.name),
            prompts: previewCatalog.listBizBotPromptDefinitions().map((prompt) => prompt.name),
            resources: previewCatalog.listBizBotResourceDefinitions().map((resource) => resource.uri),
          },
          testsToReview: [
            platformContract.docs.spec,
            platformContract.docs.changelog,
            "tests/plugins/registry.test.ts",
            "tests/mcp/contracts.test.ts",
            "tests/mcp/http-route.test.ts",
            "tests/builder/mcp-snapshots.test.ts",
          ],
        };
      },
    } satisfies ToolDefinition<PluginLocatorArgs, { plugin: InspectablePluginShape["metadata"]; platformContract: { version: string; compatibilityPolicy: ReturnType<typeof getBizBotPlatformContract>["compatibilityPolicy"] }; impact: { addedTools: string[]; promptsChanged: boolean; resourcesChanged: boolean; classification: BizBotContractCompatibilityClassification; requiresPlatformVersionBump: boolean; notes: string[] }; currentCatalog: { tools: string[]; prompts: string[]; resources: string[] }; testsToReview: string[] }>)),
    registerTool(defineTool({
      name: "developer_plan_plugin",
      description: "Turn a plugin goal into a suggested boundary, namespace, tool list, and next implementation steps.",
      parameters: {
        type: "object",
        properties: {
          pluginId: { type: "string" },
          goal: { type: "string" },
          capabilities: { type: "array", items: { type: "string" } },
        },
        required: ["pluginId", "goal"],
        additionalProperties: false,
      },
      execute: async ({ pluginId, goal, capabilities }: PluginPlanArgs) => {
        const prefix = pluginId.replace(/-/g, "_");
        const proposedTools = (capabilities ?? ["inspect", "list", "create"]).map((capability) => `${prefix}_${capability}`);
        return {
          plan: {
            pluginId,
            namespacePrefix: prefix,
            goal,
            proposedTools,
            nextSteps: [
              `Run npm run plugin:new -- ${pluginId} to scaffold the plugin shell.`,
              "Use developer_check_tool_naming before locking names.",
              "Add plugin registry and tool exposure tests before wiring the plugin into registry.ts.",
              "Run developer_check_mcp_contract_impact once names and schemas are stable.",
            ],
          },
        };
      },
    } satisfies ToolDefinition<PluginPlanArgs, { plan: { pluginId: string; namespacePrefix: string; goal: string; proposedTools: string[]; nextSteps: string[] } }>)),
    registerTool(defineTool({
      name: "developer_prepare_plugin_design_review",
      description: "Prepare a composite plugin design review covering naming, registry fit, MCP exposure, test suggestions, and contract impact.",
      parameters: {
        type: "object",
        properties: {
          pluginId: { type: "string" },
          pluginFilePath: { type: "string" },
        },
      },
      execute: async (args: PluginLocatorArgs) => {
        const plugin = await resolveInspectablePlugin(args);
        const inspectionContext = await buildInspectionContext();
        const inspection = inspectPluginDefinition(plugin, inspectionContext);
        const lint = lintPlugin(plugin);
        const suggestedTests = buildSuggestedPluginTests(plugin);
        const previewCatalog = await loadPreviewCatalog();
        const platformContract = getBizBotPlatformContract();
        const classification: BizBotContractCompatibilityClassification = inspection.conflicts.some((issue) => issue.severity === "error")
          ? "breaking"
          : inspection.exposure.tools.length > 0
            ? "non_breaking"
            : "internal_only";

        return {
          plugin: plugin.metadata,
          inspection: {
            sourceLabel: plugin.sourceLabel,
            toolCount: plugin.tools.length,
            warnings: inspection.conflicts,
            exposure: inspection.exposure,
          },
          lint,
          suggestedTests,
          contractImpact: {
            platformVersion: platformContract.version,
            classification,
            requiresPlatformVersionBump: classification === "breaking",
            testsToReview: [
              "tests/plugins/registry.test.ts",
              "tests/mcp/contracts.test.ts",
              "tests/mcp/http-route.test.ts",
            ],
          },
          nextActions: [
            "Confirm tool names and prefixes against BizBot naming rules.",
            "Fix any lint or registry warnings before exposing the plugin broadly.",
            `Review ${previewCatalog.listCurrentMcpToolDescriptors().length} currently exposed MCP tools before finalizing additions.`,
          ],
        };
      },
    } satisfies ToolDefinition<PluginLocatorArgs, {
      plugin: InspectablePluginShape["metadata"];
      inspection: { sourceLabel: string; toolCount: number; warnings: ReturnType<typeof inspectPluginDefinition>["conflicts"]; exposure: ReturnType<typeof inspectPluginDefinition>["exposure"] };
      lint: ReturnType<typeof lintPlugin>;
      suggestedTests: string[];
      contractImpact: { platformVersion: string; classification: BizBotContractCompatibilityClassification; requiresPlatformVersionBump: boolean; testsToReview: string[] };
      nextActions: string[];
    }>)),
    registerTool(defineTool({
      name: "developer_summarize_builder_repair",
      description: "Summarize the current Builder repair posture, likely root cause, and the smallest next fix.",
      parameters: {
        type: "object",
        properties: {
          symptom: { type: "string" },
        },
        additionalProperties: false,
      },
      execute: async ({ symptom }: BuilderRepairSummaryArgs) => {
        const context = await buildCurrentBuilderDevLoopContext();
        if (!context) {
          return {
            available: false,
            symptom: symptom ?? null,
            summary: "No current Builder project overview is available.",
            likelyRootCause: null,
            smallestNextFix: null,
            recommendedNextProbe: null,
          };
        }

        const { contracts, validation, reviewFocus, probeTargets } = context.diagnosticSummary;
        const likelyRootCause = contracts.mcpSnapshotState !== "accepted"
          ? `Builder MCP snapshot state is ${contracts.mcpSnapshotState}.`
          : contracts.dependencyContractState !== "accepted"
            ? `Dependency contract state is ${contracts.dependencyContractState}.`
            : contracts.fileTopologyContractState !== "accepted"
              ? `File topology contract state is ${contracts.fileTopologyContractState}.`
              : context.currentBlockerOrLastErrorSignal.activeRunBlockedReason
                ?? context.currentBlockerOrLastErrorSignal.latestFailedRun?.blockedReason
                ?? context.currentBlockerOrLastErrorSignal.latestFailedRun?.title
                ?? reviewFocus.summary
                ?? validation.summary
                ?? context.latestReview?.summary
                ?? "Builder state needs review.";
        const smallestNextFix = contracts.mcpSnapshotState !== "accepted"
          ? "Inspect the current Builder review and reconcile MCP policy only if the new baseline is intentional."
          : contracts.dependencyContractState !== "accepted"
            ? "Review dependency drift and reconcile only after confirming the intended manifest and lockfile state."
            : contracts.fileTopologyContractState !== "accepted"
              ? "Review file-topology drift before making further workspace mutations."
              : reviewFocus.nextSteps[0]
                ?? context.currentBlockerOrLastErrorSignal.activeRunBlockedReason
                ?? context.currentBlockerOrLastErrorSignal.latestFailedRun?.blockedReason
                ?? "Inspect the current Builder review for the smallest concrete remediation step.";

        return {
          available: true,
          symptom: symptom ?? null,
          project: context.project,
          currentTask: context.currentTask,
          contracts,
          validation,
          likelyRootCause,
          smallestNextFix,
          recommendedNextProbe: probeTargets[0] ?? null,
          recentRuns: context.recentRuns,
          reviewFocus,
        };
      },
    } satisfies ToolDefinition<BuilderRepairSummaryArgs, {
      available: boolean;
      symptom: string | null;
      summary?: string;
      likelyRootCause: string | null;
      smallestNextFix: string | null;
      recommendedNextProbe: string | null;
      project?: Awaited<ReturnType<typeof buildCurrentBuilderDevLoopContext>> extends infer Context ? Context extends { project: infer Project } ? Project : never : never;
      currentTask?: Awaited<ReturnType<typeof buildCurrentBuilderDevLoopContext>> extends infer Context ? Context extends { currentTask: infer Task } ? Task : never : never;
      contracts?: Awaited<ReturnType<typeof buildCurrentBuilderDevLoopContext>> extends infer Context ? Context extends { diagnosticSummary: { contracts: infer Contracts } } ? Contracts : never : never;
      validation?: Awaited<ReturnType<typeof buildCurrentBuilderDevLoopContext>> extends infer Context ? Context extends { diagnosticSummary: { validation: infer Validation } } ? Validation : never : never;
      recentRuns?: Awaited<ReturnType<typeof buildCurrentBuilderDevLoopContext>> extends infer Context ? Context extends { recentRuns: infer Runs } ? Runs : never : never;
      reviewFocus?: Awaited<ReturnType<typeof buildCurrentBuilderDevLoopContext>> extends infer Context ? Context extends { diagnosticSummary: { reviewFocus: infer ReviewFocus } } ? ReviewFocus : never : never;
    }>)),
    registerTool(defineTool({
      name: "developer_get_builder_task_lifecycle",
      description: "Inspect Builder task lifecycle state for the current or specified project, including recent tasks and run-linked summary state.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          limit: { type: "number", default: 10 },
        },
        additionalProperties: false,
      },
      execute: async ({ projectId, limit }: BuilderTaskLifecycleArgs) => {
        const overview = projectId
          ? await getBuilderProjectOverview(projectId)
          : await getCurrentBuilderProjectOverview();

        if (!overview) {
          return {
            available: false,
            projectId: projectId ?? null,
            summary: "No current Builder project overview is available.",
            currentTask: null,
            tasks: [],
            runs: [],
          };
        }

        const tasks = await listBuilderTasks(overview.project.id, limit ?? 10);
        return {
          available: true,
          project: {
            id: overview.project.id,
            name: overview.project.name,
            relativePath: overview.project.relativePath,
            lifecycle: overview.project.lifecycle,
          },
          currentTask: overview.currentTask,
          nextRecommendedStep: overview.nextRecommendedStep,
          latestReview: overview.latestReview,
          tasks,
          runs: overview.runs.slice(0, limit ?? 10),
          taskLifecycleSummary: tasks.map((task) => ({
            taskId: task.id,
            title: task.title,
            status: task.status,
            stage: task.stage,
            summary: task.summary,
            updatedAt: task.updatedAt,
          })),
        };
      },
    } satisfies ToolDefinition<BuilderTaskLifecycleArgs, {
      available: boolean;
      projectId?: string | null;
      summary?: string;
      project?: { id: string; name: string; relativePath: string; lifecycle: string };
      currentTask: unknown;
      nextRecommendedStep?: string | null;
      latestReview?: unknown;
      tasks: unknown[];
      runs: unknown[];
      taskLifecycleSummary?: Array<{ taskId: string; title: string; status: string; stage: string; summary: string | null; updatedAt: Date }>;
    }>)),
    registerTool(defineTool({
      name: "developer_get_builder_task_events",
      description: "Inspect recent Builder task lifecycle events for the current project, a specified project, or one task.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          taskId: { type: "string" },
          limit: { type: "number", default: 40 },
        },
        additionalProperties: false,
      },
      execute: async ({ projectId, taskId, limit }: BuilderTaskEventsArgs) => {
        const overview = projectId
          ? await getBuilderProjectOverview(projectId)
          : await getCurrentBuilderProjectOverview();

        if (!overview) {
          return {
            available: false,
            summary: "No current Builder project overview is available.",
            events: [],
          };
        }

        const events = overview.tasks
          .filter((task) => !taskId || task.id === taskId)
          .flatMap((task) => normalizeBuilderTaskMetadata(task.metadata).events.map((event) => ({
            ...event,
            taskId: task.id,
            taskTitle: task.title,
          })))
          .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
          .slice(0, limit ?? 40);

        return {
          available: true,
          project: {
            id: overview.project.id,
            name: overview.project.name,
            relativePath: overview.project.relativePath,
            lifecycle: overview.project.lifecycle,
          },
          currentTaskId: overview.currentTask?.id ?? null,
          events,
        };
      },
    } satisfies ToolDefinition<BuilderTaskEventsArgs, {
      available: boolean;
      summary?: string;
      project?: { id: string; name: string; relativePath: string; lifecycle: string };
      currentTaskId?: string | null;
      events: Array<Record<string, unknown>>;
    }>)),
    registerTool(defineTool({
      name: "developer_diff_imported_mcp_catalog",
      description: "Compare the current imported MCP tools, prompts, and resources against the accepted imported catalog baseline.",
      parameters: {
        type: "object",
        properties: {
          serverName: { type: "string" },
        },
        additionalProperties: false,
      },
      execute: async ({ serverName }: ImportedMcpCatalogDiffArgs) => getImportedMcpCatalogDiff(serverName),
    } satisfies ToolDefinition<ImportedMcpCatalogDiffArgs, Awaited<ReturnType<typeof getImportedMcpCatalogDiff>>>)),
    registerTool(defineTool({
      name: "developer_accept_imported_mcp_catalog_baseline",
      description: "Accept the current imported MCP inventory as the new baseline for future drift checks.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async (_args: ImportedMcpCatalogAcceptArgs) => {
        const baseline = await acceptImportedMcpCatalogBaseline();
        return {
          accepted: true,
          baseline,
          servers: buildImportedMcpServerSummaries(),
        };
      },
    } satisfies ToolDefinition<ImportedMcpCatalogAcceptArgs, { accepted: boolean; baseline: Awaited<ReturnType<typeof acceptImportedMcpCatalogBaseline>>; servers: ReturnType<typeof buildImportedMcpServerSummaries> }>)),
    registerTool(defineTool({
      name: "developer_list_mcp_trace_events",
      description: "Inspect recent MCP connect, inventory, tool, resource, and prompt events captured by BizBot.",
      parameters: {
        type: "object",
        properties: {
          serverName: { type: "string" },
          operation: { type: "string", enum: ["connect", "disconnect", "inventory_sync", "tool_call", "resource_read", "prompt_get"] },
          limit: { type: "number", default: 50 },
        },
        additionalProperties: false,
      },
      execute: async ({ serverName, operation, limit }: McpTraceArgs) => ({
        generatedAt: new Date().toISOString(),
        serverSummaries: listMcpTraceServerSummaries(),
        events: listMcpTraceEvents({ serverName, operation, limit }),
      }),
    } satisfies ToolDefinition<McpTraceArgs, { generatedAt: string; serverSummaries: ReturnType<typeof listMcpTraceServerSummaries>; events: ReturnType<typeof listMcpTraceEvents> }>)),
    registerTool(defineTool({
      name: "developer_invoke_imported_mcp_tool",
      description: "Invoke one imported MCP tool directly by server and original tool name so execution provenance stays explicit during diagnosis.",
      parameters: {
        type: "object",
        properties: {
          serverName: { type: "string" },
          toolName: { type: "string" },
          arguments: { type: "object" },
        },
        required: ["serverName", "toolName"],
        additionalProperties: false,
      },
      execute: async ({ serverName, toolName, arguments: providedArgs }: ImportedMcpToolInvokeArgs) => {
        const result = await invokeMcpClientTool(serverName, toolName, providedArgs ?? {});
        return {
          serverName,
          toolName,
          prefixedToolName: `mcp_${serverName}_${toolName}`,
          result,
        };
      },
    } satisfies ToolDefinition<ImportedMcpToolInvokeArgs, { serverName: string; toolName: string; prefixedToolName: string; result: unknown }>)),
    registerTool(defineTool({
      name: "developer_get_task_recipe",
      description: "Get one task-oriented MCP recipe that turns bundles and resources into a repeatable workflow.",
      parameters: {
        type: "object",
        properties: {
          recipeId: { type: "string" },
        },
        required: ["recipeId"],
        additionalProperties: false,
      },
      execute: async ({ recipeId }: TaskRecipeArgs) => {
        const recipe = (await loadPreviewCatalog()).getMcpTaskRecipe(recipeId);
        if (!recipe) {
          throw new Error(`Unknown MCP task recipe: ${recipeId}`);
        }
        return { recipe };
      },
    } satisfies ToolDefinition<TaskRecipeArgs, { recipe: unknown }>)),
    registerTool(defineTool({
      name: "developer_suggest_tool_schemas",
      description: "Suggest starter parameter schemas for proposed tool names based on BizBot naming patterns.",
      parameters: {
        type: "object",
        properties: {
          toolNames: { type: "array", items: { type: "string" } },
        },
        required: ["toolNames"],
        additionalProperties: false,
      },
      execute: async ({ toolNames }: ToolSchemaSuggestionArgs) => ({
        suggestions: toolNames.map((toolName) => ({ toolName, schema: buildSchemaSuggestion(toolName) })),
      }),
    } satisfies ToolDefinition<ToolSchemaSuggestionArgs, { suggestions: Array<{ toolName: string; schema: JsonObject }> }>)),
  ],
};