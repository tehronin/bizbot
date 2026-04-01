/** DeveloperPlugin — Inspect BizBot runtime queues, jobs, memories, and conversations. */

import type { JsonObject, ToolParametersSchema } from "@/lib/agent/tools";
import {
  enqueueAgentHeartbeat,
  getAgentWorkerStatus,
  listAgentHeartbeatJobs,
  retryAgentHeartbeatJob,
  type AgentHeartbeatJobStatus,
} from "@/lib/agent/heartbeat-queue";
import {
  inspectConversationMessages,
  inspectMemories,
  listRecentConversations,
} from "@/lib/agent/memory";
import { getMcpClientToolCatalog } from "@/lib/mcp/client";
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

type WorkerStatusArgs = Record<string, never>;

interface WorkerJobsArgs {
  statuses?: AgentHeartbeatJobStatus[];
  limit?: number;
}

interface RetryWorkerJobArgs {
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
        return {
          plugin: plugin.metadata,
          exposure: inspection.exposure,
          currentCatalog: {
            tools: previewCatalog.listCurrentMcpToolDescriptors().map((tool) => ({ name: tool.name, ownerId: tool.ownerId })),
            prompts: previewCatalog.listBizBotPromptDefinitions().map((prompt) => ({ name: prompt.name, ownerId: prompt.ownerId })),
            resources: previewCatalog.listBizBotResourceDefinitions().map((resource) => ({ uri: resource.uri, ownerId: resource.ownerId })),
          },
          notes: [
            "Plugin tools flow directly into tools/list when registered and permitted for the MCP lane.",
            "Prompt and resource catalogs are currently server-owned; plugin work changes them only when the MCP server itself is updated.",
          ],
        };
      },
    } satisfies ToolDefinition<PluginLocatorArgs, { plugin: InspectablePluginShape["metadata"]; exposure: ReturnType<typeof inspectPluginDefinition>["exposure"]; currentCatalog: { tools: Array<{ name: string; ownerId: string }>; prompts: Array<{ name: string; ownerId: string }>; resources: Array<{ uri: string; ownerId: string }> }; notes: string[] }>)),
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
        return {
          plugin: plugin.metadata,
          impact: {
            addedTools: inspection.exposure.tools,
            promptsChanged: inspection.exposure.notes.some((note) => note.includes("Prompt and resource catalogs are currently server-owned")),
            resourcesChanged: inspection.exposure.notes.some((note) => note.includes("Prompt and resource catalogs are currently server-owned")),
            notes: inspection.exposure.notes,
          },
          currentCatalog: {
            tools: previewCatalog.listCurrentMcpToolDescriptors().map((tool) => tool.name),
            prompts: previewCatalog.listBizBotPromptDefinitions().map((prompt) => prompt.name),
            resources: previewCatalog.listBizBotResourceDefinitions().map((resource) => resource.uri),
          },
          testsToReview: [
            "tests/plugins/registry.test.ts",
            "tests/mcp/contracts.test.ts",
            "tests/mcp/http-route.test.ts",
          ],
        };
      },
    } satisfies ToolDefinition<PluginLocatorArgs, { plugin: InspectablePluginShape["metadata"]; impact: { addedTools: string[]; promptsChanged: boolean; resourcesChanged: boolean; notes: string[] }; currentCatalog: { tools: string[]; prompts: string[]; resources: string[] }; testsToReview: string[] }>)),
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