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
import { normalizeBuilderTaskMetadata } from "@/lib/builder/types";
import { getCurrentBuilderProjectOverview } from "@/lib/builder/orchestrator";
import { listBuilderProjects } from "@/lib/builder/projects";
import {
  getMcpClientPrompts,
  getMcpClientResources,
  getMcpClientStatus,
  getMcpClientToolCatalog,
  getMcpClientTools,
} from "@/lib/mcp/client";
import {
  buildImportedMcpServerSummaries,
  getImportedMcpCatalogDiff,
  listImportedMcpPromptCatalog as listImportedMcpPromptCatalogEntries,
  listImportedMcpResourceCatalog as listImportedMcpResourceCatalogEntries,
  type ImportedMcpPromptCatalogEntry,
  type ImportedMcpResourceCatalogEntry,
} from "@/lib/mcp/imported-catalog";
import { inspectPluginRegistry } from "@/lib/agent/plugins/inspection";
import { getMcpSamplingPolicy, listMcpSamplingIntents, listSamplingEnabledTransports } from "@/lib/mcp/policy";
import { buildMcpHealthSnapshot } from "@/lib/mcp/health";
import { getDevLoopSamplingTelemetrySnapshot, getDevLoopSamplingToolDescriptors } from "@/lib/mcp/sampling";
import { getMcpTracePersistenceInfo, listMcpTraceEvents, listMcpTraceServerSummaries } from "@/lib/mcp/trace";
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

export interface BizBotPromptMetadata {
  name: string;
  title: string;
  description: string;
  ownerId: string;
  group: string;
  arguments: BizBotPromptArgDefinition[];
}

export interface BizBotResourceMetadata {
  name: string;
  uri: string;
  title: string;
  description: string;
  mimeType: string;
  ownerId: string;
  group: string;
}

export type ImportedMcpResourceMetadata = ImportedMcpResourceCatalogEntry;
export type ImportedMcpPromptMetadata = ImportedMcpPromptCatalogEntry;

export interface McpTaskRecipe {
  recipeId: string;
  title: string;
  description: string;
  goal: string;
  bundleIds: string[];
  recommendedTools: string[];
  recommendedResources: string[];
  suggestedPrompts: string[];
  steps: string[];
  stopConditions: string[];
}

export interface McpDiscoveryBundle {
  bundleId: string;
  title: string;
  description: string;
  rationale: string;
  tools: Array<ToolDescriptor & { title: string; annotations: ReturnType<typeof getToolAnnotations>; ownerId: string; ownerKind: string }>;
  prompts: BizBotPromptMetadata[];
  resources: BizBotResourceMetadata[];
  importedPrompts: ImportedMcpPromptMetadata[];
  importedResources: ImportedMcpResourceMetadata[];
}

type McpDiscoveryBundleSpec = {
  bundleId: string;
  title: string;
  description: string;
  rationale: string;
  toolPrefixes?: string[];
  toolNames?: string[];
  ownerIds?: string[];
  resourceGroups?: string[];
  resourceUris?: string[];
  promptGroups?: string[];
  promptNames?: string[];
  includeImported?: boolean;
};

const MCP_DISCOVERY_BUNDLE_SPECS: McpDiscoveryBundleSpec[] = [
  {
    bundleId: "builder",
    title: "Builder",
    description: "Builder execution, inspection, and repair surfaces for external project work.",
    rationale: "Use when working inside Builder Mode, triaging Builder drift, or inspecting Builder task state.",
    toolPrefixes: ["builder_"],
    toolNames: ["developer_vscode_loop_assist", "developer_summarize_builder_repair"],
    resourceGroups: ["builder"],
    promptNames: ["repair-builder-devloop"],
  },
  {
    bundleId: "plugin-authoring",
    title: "Plugin Authoring",
    description: "Plugin inspection, naming, contract, and design-review surfaces.",
    rationale: "Use when designing, validating, or exposing builtin plugins over the BizBot MCP surface.",
    toolNames: [
      "developer_inspect_plugin_registry",
      "developer_inspect_plugin",
      "developer_validate_plugin_contract",
      "developer_check_tool_naming",
      "developer_preview_mcp_exposure",
      "developer_preview_prompt",
      "developer_preview_resource",
      "developer_preview_tool_descriptor",
      "developer_suggest_plugin_tests",
      "developer_check_mcp_contract_impact",
      "developer_plan_plugin",
      "developer_suggest_tool_schemas",
      "developer_prepare_plugin_design_review",
      "developer_search_tools",
      "developer_search_resources",
      "developer_search_prompts",
      "developer_get_tool_bundle",
      "developer_get_task_recipe",
    ],
    resourceGroups: ["plugins", "skills"],
  },
  {
    bundleId: "debug-ops",
    title: "Debug and Ops",
    description: "Runtime inspection, queue triage, worker status, and MCP debug surfaces.",
    rationale: "Use when diagnosing BizBot runtime failures, queue stalls, or MCP connectivity issues.",
    toolNames: [
      "developer_get_worker_status",
      "developer_list_worker_jobs",
      "developer_get_mcp_queue_status",
      "developer_list_mcp_jobs",
      "developer_list_agent_runs",
      "developer_get_agent_run",
      "developer_vscode_loop_assist",
      "developer_audit_imported_mcp_servers",
      "developer_list_mcp_trace_events",
      "developer_search_tools",
      "developer_search_resources",
      "developer_search_prompts",
    ],
    resourceGroups: ["debug", "skills"],
    promptNames: ["debug-runtime", "debug-inbox-flow", "debug-vscode-mcp-loop"],
  },
  {
    bundleId: "crm",
    title: "CRM",
    description: "CRM contact, activity, and pipeline surfaces.",
    rationale: "Use when inspecting or mutating CRM contacts, activities, and inbox-backed lead workflows.",
    toolPrefixes: ["crm_"],
    resourceGroups: ["crm"],
  },
  {
    bundleId: "commerce",
    title: "Commerce",
    description: "Product, order, and commerce pipeline surfaces.",
    rationale: "Use when managing BizBot's local product and order workflows.",
    toolPrefixes: ["commerce_"],
  },
  {
    bundleId: "local-business",
    title: "Local Business",
    description: "Google Business Profile inspection and action surfaces.",
    rationale: "Use when inspecting reviews, posts, business status, or Google Business actions.",
    toolPrefixes: ["local_business_"],
  },
  {
    bundleId: "oracle",
    title: "Oracle",
    description: "Prediction-market and oracle-analysis surfaces.",
    rationale: "Use for prediction-market research, verdict generation, and Oracle-specific UI flows.",
    toolPrefixes: ["oracle_"],
  },
  {
    bundleId: "imported-mcp",
    title: "Imported MCP",
    description: "Imported external MCP tool, prompt, and resource inventory.",
    rationale: "Use when auditing imported MCP servers or selecting capabilities sourced from external MCP providers.",
    toolNames: [
      "developer_audit_imported_mcp_servers",
      "developer_diff_imported_mcp_catalog",
      "developer_invoke_imported_mcp_tool",
      "developer_search_tools",
      "developer_search_resources",
      "developer_search_prompts",
    ],
    resourceUris: [
      "bizbot://plugins/imported-mcp-prompts",
      "bizbot://plugins/imported-mcp-resources",
      "bizbot://plugins/imported-mcp-drift",
      "bizbot://plugins/mcp-discovery-bundles",
    ],
    includeImported: true,
  },
];

const MCP_SKILL_RESOURCES = [
  {
    name: "skills-builder-reconcile-drift",
    uri: "bizbot://skills/builder-reconcile-drift",
    title: "Skill: Builder Reconcile Drift",
    description: "Agent guidance for reconciling Builder MCP, dependency, or file-topology drift.",
    mimeType: "application/json",
    ownerId: "developer",
    group: "skills",
    read: async () => ({
      generatedAt: new Date().toISOString(),
      skillId: "builder-reconcile-drift",
      whenToUse: [
        "Use when Builder execution is blocked by MCP snapshot, dependency contract, or file-topology drift.",
        "Use when the latest Builder review points to governance drift instead of an implementation defect.",
      ],
      inspectFirst: [
        "bizbot://builder/current-project",
        "bizbot://builder/current-review",
        "bizbot://builder/current-runs",
      ],
      recommendedTools: [
        "developer_summarize_builder_repair",
        "developer_vscode_loop_assist",
        "builder_reconcile_mcp_policy",
        "builder_resolve_dependency_contract_drift",
        "builder_resolve_file_topology_contract_drift",
      ],
      workflow: [
        "Read the active Builder review and identify which contract is blocking progress.",
        "Confirm whether the drift is legitimate project evolution or accidental workspace mutation.",
        "Use the explicit Builder reconciliation command only after confirming the desired new baseline.",
      ],
      failureModes: [
        "Approving drift without confirming the current project state can bless accidental workspace damage.",
        "Using generic file mutations before reconciling Builder-managed baselines can create repeated preflight failures.",
      ],
      avoidFirst: [
        "Do not start by editing Builder-managed policy artifacts directly.",
        "Do not widen Builder authority before confirming the exact blocking contract.",
      ],
    }),
  },
  {
    name: "skills-plugin-authoring",
    uri: "bizbot://skills/plugin-authoring",
    title: "Skill: Plugin Authoring",
    description: "Agent guidance for builtin plugin design, validation, and MCP exposure review.",
    mimeType: "application/json",
    ownerId: "developer",
    group: "skills",
    read: async () => ({
      generatedAt: new Date().toISOString(),
      skillId: "plugin-authoring",
      whenToUse: [
        "Use when designing a new builtin plugin or extending an existing plugin with MCP-visible tools.",
      ],
      inspectFirst: [
        "bizbot://plugins/naming-rules",
        "bizbot://plugins/authoring-checklist",
        "bizbot://plugins/mcp-surface-preview",
      ],
      recommendedTools: [
        "developer_prepare_plugin_design_review",
        "developer_check_tool_naming",
        "developer_validate_plugin_contract",
        "developer_check_mcp_contract_impact",
      ],
      workflow: [
        "Confirm namespace and ownership before adding tool names.",
        "Validate contract and registry compatibility before wiring the plugin into the registry.",
        "Review MCP contract impact and suggested tests before shipping.",
      ],
      failureModes: [
        "Name collisions or prefix drift can create ambiguous MCP ownership.",
        "Changing catalog-facing names without updating contract tests will break MCP stability guarantees.",
      ],
      avoidFirst: [
        "Do not start by exposing new tools before naming and contract validation are complete.",
      ],
    }),
  },
  {
    name: "skills-debug-mcp-loop",
    uri: "bizbot://skills/debug-mcp-loop",
    title: "Skill: Debug MCP Loop",
    description: "Agent guidance for diagnosing BizBot MCP connectivity and runtime discovery issues.",
    mimeType: "application/json",
    ownerId: "developer",
    group: "skills",
    read: async () => ({
      generatedAt: new Date().toISOString(),
      skillId: "debug-mcp-loop",
      whenToUse: [
        "Use when a client cannot discover BizBot MCP tools, prompts, or resources.",
        "Use when HTTP vs stdio transport behavior is unclear.",
      ],
      inspectFirst: [
        "bizbot://debug/system-status",
        "bizbot://debug/mcp-sampling-policy",
        "bizbot://plugins/mcp-surface-preview",
      ],
      recommendedTools: [
        "developer_audit_imported_mcp_servers",
        "developer_search_tools",
        "developer_search_resources",
        "developer_search_prompts",
        "developer_vscode_loop_assist",
      ],
      workflow: [
        "Confirm transport, auth, and client capability assumptions first.",
        "Verify the exposed catalog before assuming runtime execution is broken.",
        "Inspect imported MCP server state separately from builtin BizBot exposure.",
      ],
      failureModes: [
        "Confusing imported MCP inventory with builtin BizBot MCP inventory leads to false-negative diagnosis.",
        "Stateless HTTP transport does not support standalone SSE session expectations.",
      ],
      avoidFirst: [
        "Do not start with mutating tools when discovery resources can answer the question.",
      ],
    }),
  },
  {
    name: "skills-imported-mcp-audit",
    uri: "bizbot://skills/imported-mcp-audit",
    title: "Skill: Imported MCP Audit",
    description: "Agent guidance for auditing imported MCP servers, provenance, and collision risk.",
    mimeType: "application/json",
    ownerId: "developer",
    group: "skills",
    read: async () => ({
      generatedAt: new Date().toISOString(),
      skillId: "imported-mcp-audit",
      whenToUse: [
        "Use when deciding whether an imported MCP server should remain enabled or be narrowed.",
      ],
      inspectFirst: [
        "bizbot://plugins/imported-mcp-prompts",
        "bizbot://plugins/imported-mcp-resources",
        "bizbot://plugins/mcp-discovery-bundles",
      ],
      recommendedTools: [
        "developer_audit_imported_mcp_servers",
        "developer_search_tools",
        "developer_search_resources",
        "developer_search_prompts",
      ],
      workflow: [
        "Check server connectivity and inventory counts first.",
        "Look for naming collisions between imported tool originals and builtin tool names.",
        "Review imported prompt/resource catalogs before treating the imported server as tool-only.",
      ],
      failureModes: [
        "Imported prompts/resources may exist even when only tools are surfaced in the runtime today.",
      ],
      avoidFirst: [
        "Do not assume an imported server is safe just because its tools are prefixed.",
      ],
    }),
  },
  {
    name: "skills-sidecar-usage",
    uri: "bizbot://skills/sidecar-usage",
    title: "Skill: Sidecar Usage",
    description: "Agent guidance for when to open, update, or avoid the BizBot Sidecar surface.",
    mimeType: "application/json",
    ownerId: "developer",
    group: "skills",
    read: async () => ({
      generatedAt: new Date().toISOString(),
      skillId: "sidecar-usage",
      whenToUse: [
        "Use when a structured selection, review panel, or rich transient output will reduce transcript noise.",
      ],
      inspectFirst: [
        "bizbot://plugins/mcp-surface-preview",
      ],
      recommendedTools: [
        "sidecar_open",
        "sidecar_update",
        "sidecar_close",
      ],
      workflow: [
        "Open the Sidecar only when the information benefits from a structured transient panel.",
        "Keep the transcript concise and use the Sidecar for denser review state or selections.",
      ],
      failureModes: [
        "Using the Sidecar for content that should remain durable in the transcript can hide important context.",
      ],
      avoidFirst: [
        "Do not open the Sidecar for simple one-line answers.",
      ],
    }),
  },
] as const;

const MCP_TASK_RECIPES: McpTaskRecipe[] = [
  {
    recipeId: "debug-imported-mcp-server",
    title: "Debug Imported MCP Server",
    description: "Trace imported MCP connectivity, inventory drift, and live execution failures in a fixed order.",
    goal: "Determine whether an imported MCP server is healthy, drifted, or blocked on runtime execution.",
    bundleIds: ["imported-mcp", "debug-ops"],
    recommendedTools: [
      "developer_audit_imported_mcp_servers",
      "developer_diff_imported_mcp_catalog",
      "developer_list_mcp_trace_events",
      "developer_invoke_imported_mcp_tool",
    ],
    recommendedResources: [
      "bizbot://plugins/imported-mcp-drift",
      "bizbot://debug/mcp-trace",
      "bizbot://plugins/imported-mcp-prompts",
      "bizbot://plugins/imported-mcp-resources",
    ],
    suggestedPrompts: ["debug-vscode-mcp-loop"],
    steps: [
      "Inspect imported server status and inventory counts first.",
      "Compare the current catalog against the accepted imported baseline.",
      "Read the recent MCP trace before retrying a live imported tool call.",
      "If execution still fails, invoke the exact imported tool with a small controlled argument payload.",
    ],
    stopConditions: [
      "Stop when the failure is isolated to connection, drift, or tool execution.",
      "Stop when the smallest remediation is clear enough to apply without further probing.",
    ],
  },
  {
    recipeId: "inspect-builder-drift",
    title: "Inspect Builder Drift",
    description: "Follow a task-shaped path through Builder lifecycle, review state, and recent event history.",
    goal: "Determine which Builder contract or lifecycle transition is blocking progress.",
    bundleIds: ["builder", "debug-ops"],
    recommendedTools: [
      "developer_get_builder_task_lifecycle",
      "developer_get_builder_task_events",
      "developer_summarize_builder_repair",
    ],
    recommendedResources: [
      "bizbot://builder/task-lifecycle",
      "bizbot://builder/task-events",
      "bizbot://builder/current-review",
    ],
    suggestedPrompts: ["repair-builder-devloop"],
    steps: [
      "Inspect the current task lifecycle summary and latest review first.",
      "Read recent task events to confirm the exact transition that blocked or resumed work.",
      "Use the repair summary only after the event history confirms the blocking surface.",
    ],
    stopConditions: [
      "Stop when the current blocker is reduced to one contract or one review action.",
    ],
  },
  {
    recipeId: "review-plugin-contract-impact",
    title: "Review Plugin Contract Impact",
    description: "Move from bundle discovery into a repeatable plugin-review workflow.",
    goal: "Determine whether a plugin change is safe to expose over the MCP contract.",
    bundleIds: ["plugin-authoring"],
    recommendedTools: [
      "developer_prepare_plugin_design_review",
      "developer_check_mcp_contract_impact",
      "developer_get_task_recipe",
    ],
    recommendedResources: [
      "bizbot://plugins/task-recipes",
      "bizbot://plugins/mcp-surface-preview",
      "bizbot://plugins/contracts-status",
    ],
    suggestedPrompts: [],
    steps: [
      "Start with the MCP surface preview and current contract status.",
      "Generate the composite plugin design review before making naming or schema exceptions.",
      "Check explicit MCP contract impact last so the review uses final proposed names.",
    ],
    stopConditions: [
      "Stop when the plugin has a clear compatibility classification and a concrete test list.",
    ],
  },
  {
    recipeId: "trace-mcp-execution",
    title: "Trace MCP Execution",
    description: "Use runtime trace data to separate inventory issues from execution issues.",
    goal: "Explain what BizBot actually did over MCP, not just what is exposed in the catalog.",
    bundleIds: ["debug-ops", "imported-mcp"],
    recommendedTools: [
      "developer_list_mcp_trace_events",
      "developer_audit_imported_mcp_servers",
    ],
    recommendedResources: [
      "bizbot://debug/mcp-trace",
      "bizbot://debug/vscode-mcp-devloop",
    ],
    suggestedPrompts: ["optimize-vscode-mcp-devloop"],
    steps: [
      "Read the recent MCP trace and group failures by server and operation.",
      "Compare trace evidence with the advertised inventory before changing config.",
      "Only optimize the VS Code loop after you know whether the problem is startup, discovery, or execution.",
    ],
    stopConditions: [
      "Stop when the failure is localized to startup, discovery, latency, or one imported tool call.",
    ],
  },
];

export function listMcpTaskRecipes(): McpTaskRecipe[] {
  return MCP_TASK_RECIPES;
}

export function getMcpTaskRecipe(recipeId: string): McpTaskRecipe | undefined {
  return MCP_TASK_RECIPES.find((recipe) => recipe.recipeId === recipeId);
}

function toPromptMetadata(prompt: BizBotPromptDefinition): BizBotPromptMetadata {
  return {
    name: prompt.name,
    title: prompt.title,
    description: prompt.description,
    ownerId: prompt.ownerId,
    group: prompt.group,
    arguments: prompt.arguments,
  };
}

function toResourceMetadata(resource: BizBotResourceDefinition): BizBotResourceMetadata {
  return {
    name: resource.name,
    uri: resource.uri,
    title: resource.title,
    description: resource.description,
    mimeType: resource.mimeType,
    ownerId: resource.ownerId,
    group: resource.group,
  };
}

export function listImportedMcpResourceCatalog(): ImportedMcpResourceMetadata[] {
  return listImportedMcpResourceCatalogEntries();
}

export function listImportedMcpPromptCatalog(): ImportedMcpPromptMetadata[] {
  return listImportedMcpPromptCatalogEntries();
}

function specMatchesTool(
  spec: McpDiscoveryBundleSpec,
  tool: ReturnType<typeof listCurrentMcpToolDescriptors>[number],
): boolean {
  return Boolean(
    spec.toolPrefixes?.some((prefix) => tool.name.startsWith(prefix))
    || spec.toolNames?.includes(tool.name)
    || spec.ownerIds?.includes(tool.ownerId),
  );
}

function specMatchesPrompt(spec: McpDiscoveryBundleSpec, prompt: BizBotPromptMetadata): boolean {
  return Boolean(
    spec.promptGroups?.includes(prompt.group)
    || spec.promptNames?.includes(prompt.name)
    || spec.ownerIds?.includes(prompt.ownerId),
  );
}

function specMatchesResource(spec: McpDiscoveryBundleSpec, resource: BizBotResourceMetadata): boolean {
  return Boolean(
    spec.resourceGroups?.includes(resource.group)
    || spec.resourceUris?.includes(resource.uri)
    || spec.ownerIds?.includes(resource.ownerId),
  );
}

export function listMcpDiscoveryBundles(): McpDiscoveryBundle[] {
  const tools = listCurrentMcpToolDescriptors();
  const prompts = listBizBotPromptDefinitions().map(toPromptMetadata);
  const resources = listBizBotResourceDefinitions().map(toResourceMetadata);
  const importedPrompts = listImportedMcpPromptCatalog();
  const importedResources = listImportedMcpResourceCatalog();

  return MCP_DISCOVERY_BUNDLE_SPECS.map((spec) => ({
    bundleId: spec.bundleId,
    title: spec.title,
    description: spec.description,
    rationale: spec.rationale,
    tools: tools.filter((tool) => specMatchesTool(spec, tool)),
    prompts: prompts.filter((prompt) => specMatchesPrompt(spec, prompt)),
    resources: resources.filter((resource) => specMatchesResource(spec, resource)),
    importedPrompts: spec.includeImported ? importedPrompts : [],
    importedResources: spec.includeImported ? importedResources : [],
  }));
}

export function getMcpDiscoveryBundle(bundleId: string): McpDiscoveryBundle | undefined {
  return listMcpDiscoveryBundles().find((bundle) => bundle.bundleId === bundleId);
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

async function buildBuilderTaskLifecycleResource() {
  const overview = await getCurrentBuilderProjectOverview();
  if (!overview) {
    return {
      generatedAt: new Date().toISOString(),
      available: false,
      summary: "No current Builder project overview is available.",
      currentTask: null,
      recentTasks: [],
      recentRuns: [],
    };
  }

  return {
    generatedAt: new Date().toISOString(),
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
    recentTasks: overview.tasks.slice(0, 10).map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      stage: task.stage,
      summary: task.summary,
      updatedAt: task.updatedAt,
    })),
    recentRuns: overview.runs.slice(0, 10).map((run) => ({
      id: run.id,
      taskId: run.taskId,
      status: run.status,
      summary: run.summary,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    })),
  };
}

async function buildBuilderTaskEventsResource() {
  const overview = await getCurrentBuilderProjectOverview();
  if (!overview) {
    return {
      generatedAt: new Date().toISOString(),
      available: false,
      summary: "No current Builder project overview is available.",
      events: [],
    };
  }

  const events = overview.tasks
    .flatMap((task) => normalizeBuilderTaskMetadata(task.metadata).events.map((event) => ({
      ...event,
      taskId: task.id,
      taskTitle: task.title,
    })))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, 80);

  return {
    generatedAt: new Date().toISOString(),
    available: true,
    project: {
      id: overview.project.id,
      name: overview.project.name,
      relativePath: overview.project.relativePath,
    },
    currentTaskId: overview.currentTask?.id ?? null,
    events,
  };
}

async function buildVsCodeMcpDevLoopResource() {
  const workspaceConfigPath = path.join(process.cwd(), ".vscode", "mcp.json");
  const workspaceConfigExists = fs.existsSync(workspaceConfigPath);
  let workspaceConfig: unknown = null;
  if (workspaceConfigExists) {
    try {
      workspaceConfig = JSON.parse(fs.readFileSync(workspaceConfigPath, "utf8"));
    } catch {
      workspaceConfig = { error: "Workspace MCP config is not valid JSON." };
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    workspaceConfigPath: ".vscode/mcp.json",
    workspaceConfigExists,
    workspaceConfig,
    recommendedDevLoop: {
      preferredAppCommand: "npm run dev:vscode",
      preferredMcpCommand: "npm run mcp:stdio",
      preferredTransport: "stdio",
      samplingExpected: true,
      notes: [
        "VS Code should use the checked-in stdio config for the fastest local dev loop.",
        "Use npm-run entrypoints instead of deep tsx paths where practical so the workspace config matches the documented runtime contract.",
        "The HTTP MCP route remains useful for protocol tests, but stdio is the preferred interactive VS Code dev loop path.",
      ],
    },
    runtime: {
      mcpClientStatus: getMcpClientStatus(),
      importedPromptCount: listImportedMcpPromptCatalog().length,
      importedResourceCount: listImportedMcpResourceCatalog().length,
    },
  };
}

async function buildDebugMcpTraceResource() {
  return {
    generatedAt: new Date().toISOString(),
    persistence: getMcpTracePersistenceInfo(),
    servers: listMcpTraceServerSummaries(),
    recentEvents: listMcpTraceEvents({ limit: 80 }),
  };
}

async function buildDebugMcpHealthResource() {
  return buildMcpHealthSnapshot();
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

async function buildDebugMcpSamplingPolicy() {
  const samplingIntent = "developer_devloop_status" as const;
  const httpPolicy = getMcpSamplingPolicy(samplingIntent, "http", false);
  const stdioPolicy = getMcpSamplingPolicy(samplingIntent, "stdio", true);
  const telemetry = getDevLoopSamplingTelemetrySnapshot();

  return {
    generatedAt: new Date().toISOString(),
    intentCatalog: listMcpSamplingIntents(),
    samplingEnabledTransports: listSamplingEnabledTransports(),
    samplingToolCount: getDevLoopSamplingToolDescriptors().length,
    samplingToolNames: getDevLoopSamplingToolDescriptors().map((tool) => tool.name),
    policies: {
      http: {
        transportKind: "http",
        advertiseSampling: httpPolicy.advertiseSampling,
        allowTools: httpPolicy.allowTools,
        maxDepth: httpPolicy.maxDepth,
        maxContextChars: httpPolicy.maxContextChars,
        blockNestedSampling: httpPolicy.blockNestedSampling,
      },
      stdio: {
        transportKind: "stdio",
        advertiseSampling: stdioPolicy.advertiseSampling,
        allowTools: stdioPolicy.allowTools,
        maxDepth: stdioPolicy.maxDepth,
        maxContextChars: stdioPolicy.maxContextChars,
        blockNestedSampling: stdioPolicy.blockNestedSampling,
      },
    },
    runtime: {
      env: {
        BIZBOT_MCP_STDIO: process.env.BIZBOT_MCP_STDIO ?? null,
        BIZBOT_MCP_TRANSPORT: process.env.BIZBOT_MCP_TRANSPORT ?? null,
        BIZBOT_MCP_SAMPLING_ENABLED: process.env.BIZBOT_MCP_SAMPLING_ENABLED ?? null,
      },
      notes: [
        "Sampling is stdio-only in v1.",
        "Sampling requests use a bounded read-only BizBot tool subset when the connected stdio client advertises sampling.tools.",
        "Nested sampling is blocked by policy.",
      ],
    },
    telemetry,
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
        messages: [{ role: "user", text: ["Diagnose the VS Code to BizBot MCP dev loop.", symptom ? `Symptom: ${symptom}.` : "", "First inspect bizbot://debug/system-status and confirm the workspace MCP config at .vscode/mcp.json.", "If the connected client supports MCP sampling, call developer_vscode_loop_assist first and use its structured output as the primary diagnosis input.", "Then check whether the stdio server starts, whether tools/resources/prompts are exposed, and whether authorization or trust configuration could block discovery.", "Return findings ordered by severity with the smallest fix first."].filter(Boolean).join(" ") }],
      }),
    },
    {
      name: "repair-builder-devloop",
      title: "Repair Builder Dev Loop",
      description: "Use the Builder dev-loop diagnosis flow to identify the smallest next fix and next probe target",
      ownerId: "developer",
      group: "developer",
      arguments: [{ name: "symptom", required: false, description: "Optional Builder or MCP symptom summary." }],
      render: ({ symptom }) => ({
        messages: [{ role: "user", text: ["Repair the current Builder development loop.", symptom ? `Symptom: ${symptom}.` : "", "First call developer_vscode_loop_assist if MCP sampling is available and treat its structured output as the primary diagnosis packet.", "Then inspect only the smallest missing artifact needed to confirm the diagnosis.", "Return: likely root cause, smallest next fix, recommended next probe, and the exact evidence used."].filter(Boolean).join(" ") }],
      }),
    },
    {
      name: "optimize-vscode-mcp-devloop",
      title: "Optimize VS Code MCP Dev Loop",
      description: "Review the checked-in VS Code MCP connection and recommend the smallest changes that improve local agent iteration speed and reliability.",
      ownerId: "developer",
      group: "developer",
      arguments: [{ name: "symptom", required: false, description: "Optional dev-loop symptom summary." }],
      render: ({ symptom }) => ({
        messages: [{ role: "user", text: ["Optimize the VS Code to BizBot MCP development loop.", symptom ? `Symptom: ${symptom}.` : "", "First read bizbot://debug/vscode-mcp-devloop and bizbot://debug/system-status.", "Then inspect the checked-in workspace config at .vscode/mcp.json and compare it against the documented recommended commands.", "Return the smallest config, runtime, or workflow changes that improve reliability, startup speed, or capability discovery."].filter(Boolean).join(" ") }],
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
    { name: "plugins-mcp-surface-preview", uri: "bizbot://plugins/mcp-surface-preview", title: "Plugin MCP Surface Preview", description: "Current MCP tool, prompt, and resource catalogs with ownership and grouping details", mimeType: "application/json", ownerId: "developer", group: "plugins", read: async () => ({ generatedAt: new Date().toISOString(), tools: listCurrentMcpToolDescriptors(), prompts: listBizBotPromptDefinitions().map(toPromptMetadata), resources: listBizBotResourceDefinitions().map(toResourceMetadata), importedPrompts: listImportedMcpPromptCatalog(), importedResources: listImportedMcpResourceCatalog(), bundles: listMcpDiscoveryBundles().map((bundle) => ({ bundleId: bundle.bundleId, title: bundle.title, description: bundle.description, rationale: bundle.rationale, toolCount: bundle.tools.length, promptCount: bundle.prompts.length + bundle.importedPrompts.length, resourceCount: bundle.resources.length + bundle.importedResources.length })), taskRecipes: listMcpTaskRecipes() }) },
    { name: "plugins-mcp-discovery-bundles", uri: "bizbot://plugins/mcp-discovery-bundles", title: "MCP Discovery Bundles", description: "Curated BizBot MCP tool, prompt, and resource bundles for major workflow families", mimeType: "application/json", ownerId: "developer", group: "plugins", read: async () => ({ generatedAt: new Date().toISOString(), bundles: listMcpDiscoveryBundles() }) },
    { name: "plugins-task-recipes", uri: "bizbot://plugins/task-recipes", title: "MCP Task Recipes", description: "Workflow-shaped MCP recipes that turn bundles into repeatable debugging and authoring paths", mimeType: "application/json", ownerId: "developer", group: "plugins", read: async () => ({ generatedAt: new Date().toISOString(), recipes: listMcpTaskRecipes() }) },
    { name: "plugins-imported-mcp-prompts", uri: "bizbot://plugins/imported-mcp-prompts", title: "Imported MCP Prompts", description: "Prompt inventory imported from connected external MCP servers", mimeType: "application/json", ownerId: "developer", group: "plugins", read: async () => ({ generatedAt: new Date().toISOString(), servers: buildImportedMcpServerSummaries(), prompts: listImportedMcpPromptCatalog() }) },
    { name: "plugins-imported-mcp-resources", uri: "bizbot://plugins/imported-mcp-resources", title: "Imported MCP Resources", description: "Resource inventory imported from connected external MCP servers", mimeType: "application/json", ownerId: "developer", group: "plugins", read: async () => ({ generatedAt: new Date().toISOString(), servers: buildImportedMcpServerSummaries(), resources: listImportedMcpResourceCatalog() }) },
    { name: "plugins-imported-mcp-drift", uri: "bizbot://plugins/imported-mcp-drift", title: "Imported MCP Drift", description: "Accepted imported MCP catalog baseline and the current diff against that baseline", mimeType: "application/json", ownerId: "developer", group: "plugins", read: async () => getImportedMcpCatalogDiff() },
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
    { name: "builder-task-lifecycle", uri: "bizbot://builder/task-lifecycle", title: "Builder Task Lifecycle", description: "Current Builder task lifecycle state, recent task transitions, and run-linked execution summaries", mimeType: "application/json", ownerId: "builder", group: "builder", read: buildBuilderTaskLifecycleResource },
    { name: "builder-task-events", uri: "bizbot://builder/task-events", title: "Builder Task Events", description: "Recent Builder task lifecycle events and resume/state transitions for the active project", mimeType: "application/json", ownerId: "builder", group: "builder", read: buildBuilderTaskEventsResource },
    { name: "crm-pipeline-summary", uri: "bizbot://crm/pipeline-summary", title: "CRM Pipeline Summary", description: "Inbox-backed CRM pipeline state, provider readiness, and recent contacts", mimeType: "application/json", ownerId: "crm", group: "crm", read: buildCrmPipelineSummary },
    { name: "debug-system-status", uri: "bizbot://debug/system-status", title: "Debug System Status", description: "Runtime, LLM, worker, knowledge, inbox, and MCP state for debugging BizBot", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildDebugSystemStatus },
    { name: "debug-vscode-mcp-devloop", uri: "bizbot://debug/vscode-mcp-devloop", title: "Debug VS Code MCP Dev Loop", description: "Checked-in VS Code MCP config, recommended local workflow, and current MCP runtime posture", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildVsCodeMcpDevLoopResource },
    { name: "debug-mcp-trace", uri: "bizbot://debug/mcp-trace", title: "Debug MCP Trace", description: "Recent MCP connect, inventory, tool, prompt, and resource events captured by BizBot", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildDebugMcpTraceResource },
    { name: "debug-mcp-health", uri: "bizbot://debug/mcp-health", title: "Debug MCP Health", description: "One-shot MCP health snapshot covering imported servers, queue state, trace persistence, sampling, and Builder drift", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildDebugMcpHealthResource },
    { name: "debug-mcp-sampling-policy", uri: "bizbot://debug/mcp-sampling-policy", title: "Debug MCP Sampling Policy", description: "Transport-aware MCP sampling policy, guardrails, and current runtime flags", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildDebugMcpSamplingPolicy },
    { name: "debug-database-summary", uri: "bizbot://debug/database-summary", title: "Debug Database Summary", description: "High-level row counts for core BizBot tables", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildDebugDatabaseSummary },
    { name: "debug-recent-heartbeat", uri: "bizbot://debug/recent-heartbeat", title: "Debug Recent Heartbeat", description: "Recent heartbeat and worker timestamps plus the last summary payload", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildDebugRecentHeartbeat },
    { name: "debug-recent-inbox", uri: "bizbot://debug/recent-inbox", title: "Debug Recent Inbox", description: "Recent inbox items with status, sender, and lead metadata for triage", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildDebugRecentInbox },
    { name: "debug-recent-log", uri: "bizbot://debug/recent-log", title: "Debug Recent Log", description: "Recent Next.js development log entries and warning/error lines for runtime debugging", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildDebugRecentLog },
    { name: "debug-recent-failures", uri: "bizbot://debug/recent-failures", title: "Debug Recent Failures", description: "Failed inbox items, failed posts, recent heartbeat failure summary, and recent runtime log issues", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildDebugRecentFailures },
    { name: "debug-worker-jobs", uri: "bizbot://debug/worker-jobs", title: "Debug Worker Jobs", description: "Recent BullMQ heartbeat jobs and worker state for queue inspection", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildDebugWorkerJobs },
    { name: "debug-memory-summary", uri: "bizbot://debug/memory-summary", title: "Debug Memory Summary", description: "Recent memories and conversations for operator inspection", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildDebugMemorySummary },
    { name: "debug-agent-runs", uri: "bizbot://debug/agent-runs", title: "Debug Agent Runs", description: "Recent BizBot agent runs with specialist lane metadata, tool policy, and tool trace summaries", mimeType: "application/json", ownerId: "developer", group: "debug", read: buildDebugAgentRuns },
    ...MCP_SKILL_RESOURCES,
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
