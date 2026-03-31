import fs from "node:fs";
import path from "node:path";
import type { JsonObject, RegisteredToolDefinition, ToolParametersSchema } from "@/lib/agent/tools";
import type { BizBotPlugin, BizBotPluginMetadata } from "@/lib/agent/plugins/contracts";

export type InspectionSeverity = "error" | "warning" | "suggestion";
export type OwnershipKind = "builtin-plugin" | "imported-mcp" | "mcp-core" | "source-file";

export interface InspectionIssue {
  severity: InspectionSeverity;
  code: string;
  message: string;
  related?: string[];
  suggestion?: string;
  details?: JsonObject;
}

export interface ToolSchemaSummary {
  propertyCount: number;
  requiredCount: number;
  additionalProperties: boolean;
  hasJsonFields: boolean;
  propertyTypes: Record<string, string>;
}

export interface ToolNameAnalysis {
  name: string;
  namespace: string | null;
  action: string | null;
  remainder: string | null;
  expectedPrefix: string | null;
  normalized: string;
  issues: InspectionIssue[];
}

export interface InspectableToolShape {
  name: string;
  description?: string;
  parameters?: ToolParametersSchema;
}

export interface InspectablePluginShape {
  sourceType: "registered-plugin" | "source-file";
  sourceLabel: string;
  metadata: Partial<BizBotPluginMetadata> & { id?: string };
  tools: InspectableToolShape[];
  rawSourceAvailable?: boolean;
}

export interface ToolOwnershipEntry {
  toolName: string;
  ownerKind: OwnershipKind;
  ownerId: string;
  ownerLabel: string;
  originalName?: string;
  serverName?: string;
  description: string;
}

export interface ToolInspectionSummary {
  name: string;
  description: string | null;
  schemaSummary: ToolSchemaSummary | null;
  naming: ToolNameAnalysis;
  issues: InspectionIssue[];
}

export interface PluginInspectionResult {
  plugin: InspectablePluginShape;
  tools: ToolInspectionSummary[];
  issues: InspectionIssue[];
  conflicts: InspectionIssue[];
  exposure: {
    tools: string[];
    prompts: string[];
    resources: string[];
    notes: string[];
  };
}

export interface RegistryInspectionResult {
  generatedAt: string;
  plugins: Array<{
    id: string;
    displayName: string;
    description: string;
    internal: boolean;
    version: string | null;
    tags: string[];
    toolCount: number;
  }>;
  toolOwnership: ToolOwnershipEntry[];
  conflicts: InspectionIssue[];
  warnings: InspectionIssue[];
  importedServers: Array<{ serverName: string; toolCount: number }>;
  summary: {
    pluginCount: number;
    builtinToolCount: number;
    importedToolCount: number;
  };
}

export interface ImportedToolOrigin {
  prefixedName: string;
  originalName: string;
  serverName: string;
  description: string;
}

function normalizePluginPrefix(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, "_");
}

export function summarizeToolSchema(parameters?: ToolParametersSchema): ToolSchemaSummary | null {
  if (!parameters) {
    return null;
  }

  const entries = Object.entries(parameters.properties ?? {}).filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[1]));
  return {
    propertyCount: entries.length,
    requiredCount: Array.isArray(parameters.required) ? parameters.required.length : 0,
    additionalProperties: parameters.additionalProperties ?? true,
    hasJsonFields: entries.some(([, property]) => property.type === "json"),
    propertyTypes: Object.fromEntries(entries.map(([key, property]) => [key, property.type])),
  };
}

export function analyzeToolNaming(toolName: string, expectedPrefix?: string): ToolNameAnalysis {
  const normalized = toolName.trim().toLowerCase();
  const parts = normalized.split("_").filter(Boolean);
  const namespace = parts.length > 1 ? parts[0] : null;
  const action = parts.length > 1 ? parts[1] : null;
  const remainder = parts.length > 2 ? parts.slice(2).join("_") : null;
  const issues: InspectionIssue[] = [];
  const resolvedExpectedPrefix = expectedPrefix ? normalizePluginPrefix(expectedPrefix) : null;

  if (!/^[a-z0-9_]+$/.test(normalized)) {
    issues.push({ severity: "error", code: "tool-name-invalid-characters", message: `Tool name ${toolName} should be lowercase snake_case.` });
  }
  if (normalized !== toolName) {
    issues.push({ severity: "warning", code: "tool-name-normalization", message: `Tool name ${toolName} should be normalized to ${normalized}.`, suggestion: `Rename to ${normalized}.` });
  }
  if (parts.length < 2) {
    issues.push({ severity: "error", code: "tool-name-missing-namespace", message: `Tool name ${toolName} should include a namespace prefix such as crm_, memory_, or builder_.` });
  }
  if (resolvedExpectedPrefix && namespace && namespace !== resolvedExpectedPrefix && !normalized.startsWith(`${resolvedExpectedPrefix}_`)) {
    issues.push({ severity: "warning", code: "tool-name-prefix-mismatch", message: `Tool name ${toolName} does not align with expected plugin prefix ${resolvedExpectedPrefix}_.`, suggestion: `Prefer ${resolvedExpectedPrefix}_... for tools owned by this plugin.` });
  }
  if (["get", "run", "list", "create", "update", "check", "inspect", "preview", "suggest"].includes(namespace ?? "")) {
    issues.push({ severity: "warning", code: "tool-name-verb-namespace", message: `Tool name ${toolName} starts with a verb instead of a namespace prefix.` });
  }
  if (["get_data", "run_task", "do_thing", "handle_request"].includes(normalized)) {
    issues.push({ severity: "warning", code: "tool-name-generic", message: `Tool name ${toolName} is too generic for BizBot's plugin surface.` });
  }
  if (normalized.includes("__")) {
    issues.push({ severity: "warning", code: "tool-name-double-underscore", message: `Tool name ${toolName} contains repeated underscores.` });
  }

  return {
    name: toolName,
    namespace,
    action,
    remainder,
    expectedPrefix: resolvedExpectedPrefix,
    normalized,
    issues,
  };
}

function buildToolInspection(tool: InspectableToolShape, expectedPrefix?: string): ToolInspectionSummary {
  const naming = analyzeToolNaming(tool.name, expectedPrefix);
  const issues = [...naming.issues];
  const description = tool.description?.trim() || null;
  const schemaSummary = summarizeToolSchema(tool.parameters);

  if (!description) {
    issues.push({ severity: "error", code: "tool-description-missing", message: `Tool ${tool.name} is missing a description.` });
  } else if (description.length < 24) {
    issues.push({ severity: "warning", code: "tool-description-short", message: `Tool ${tool.name} has a very short description and may be hard to use from MCP catalogs.` });
  }

  if (!schemaSummary) {
    issues.push({ severity: "warning", code: "tool-schema-missing", message: `Tool ${tool.name} could not be inspected for schema quality.` });
  }

  return {
    name: tool.name,
    description,
    schemaSummary,
    naming,
    issues,
  };
}

function importedBaseName(prefixedName: string): string {
  if (!prefixedName.startsWith("mcp_")) {
    return prefixedName;
  }
  const match = prefixedName.match(/^mcp_[^_]+_(.+)$/);
  return match?.[1] ?? prefixedName;
}

export function findPluginConflicts(
  plugin: InspectablePluginShape,
  existingPlugins: BizBotPlugin[],
  importedTools: ImportedToolOrigin[] = [],
): InspectionIssue[] {
  const conflicts: InspectionIssue[] = [];
  const pluginId = plugin.metadata.id?.trim();

  if (pluginId && existingPlugins.some((entry) => entry.metadata.id === pluginId)) {
    conflicts.push({ severity: "error", code: "plugin-id-duplicate", message: `Plugin id ${pluginId} already exists in the registry.` });
  }

  const builtinTools = new Map<string, string>();
  for (const existingPlugin of existingPlugins) {
    for (const tool of existingPlugin.tools) {
      builtinTools.set(tool.name, existingPlugin.metadata.id);
    }
  }

  const seenNames = new Set<string>();
  for (const tool of plugin.tools) {
    if (seenNames.has(tool.name)) {
      conflicts.push({ severity: "error", code: "plugin-tool-duplicate-internal", message: `Plugin declares duplicate tool name ${tool.name}.` });
      continue;
    }
    seenNames.add(tool.name);

    const builtinOwner = builtinTools.get(tool.name);
    if (builtinOwner && builtinOwner !== pluginId) {
      conflicts.push({ severity: "error", code: "plugin-tool-conflict", message: `Tool ${tool.name} already belongs to builtin plugin ${builtinOwner}.`, related: [builtinOwner, tool.name], suggestion: "Rename the tool or merge the behavior into the existing namespace." });
    }

    const importedOverlap = importedTools.find((entry) => importedBaseName(entry.prefixedName) === tool.name || entry.prefixedName === tool.name);
    if (importedOverlap) {
      conflicts.push({ severity: "warning", code: "plugin-tool-imported-overlap", message: `Tool ${tool.name} overlaps conceptually with imported MCP tool ${importedOverlap.prefixedName} from ${importedOverlap.serverName}.`, related: [tool.name, importedOverlap.prefixedName], suggestion: "Consider clearer namespace wording so builtin and imported tools are easy to distinguish." });
    }
  }

  return conflicts;
}

export function summarizePluginExposure(
  plugin: InspectablePluginShape,
  promptCatalog: Array<{ name: string; ownerId: string }> = [],
  resourceCatalog: Array<{ uri: string; ownerId: string }> = [],
): PluginInspectionResult["exposure"] {
  const notes = [
    "BizBot plugins currently contribute tools directly to the MCP tools/list catalog.",
  ];
  if (promptCatalog.length > 0) {
    notes.push("Prompts remain server-owned today; plugin inspection reports them for preview and contract-impact context.");
  }
  if (resourceCatalog.length > 0) {
    notes.push("Resources remain server-owned today; plugin changes do not add resources unless the MCP server is updated separately.");
  }

  return {
    tools: plugin.tools.map((tool) => tool.name),
    prompts: [],
    resources: [],
    notes,
  };
}

export function inspectPluginDefinition(
  plugin: InspectablePluginShape | BizBotPlugin,
  options?: {
    existingPlugins?: BizBotPlugin[];
    importedTools?: ImportedToolOrigin[];
    promptCatalog?: Array<{ name: string; ownerId: string }>;
    resourceCatalog?: Array<{ uri: string; ownerId: string }>;
  },
): PluginInspectionResult {
  const normalizedPlugin = isRegisteredPlugin(plugin)
    ? toInspectablePlugin(plugin)
    : plugin;
  const expectedPrefix = normalizedPlugin.metadata.id ? normalizePluginPrefix(normalizedPlugin.metadata.id) : undefined;
  const tools = normalizedPlugin.tools.map((tool) => buildToolInspection(tool, expectedPrefix));
  const issues: InspectionIssue[] = [];

  if (!normalizedPlugin.metadata.id) {
    issues.push({ severity: "error", code: "plugin-id-missing", message: "Plugin metadata is missing an id." });
  }
  if (!normalizedPlugin.metadata.displayName) {
    issues.push({ severity: "warning", code: "plugin-display-name-missing", message: "Plugin metadata is missing a displayName." });
  }
  if (!normalizedPlugin.metadata.description) {
    issues.push({ severity: "error", code: "plugin-description-missing", message: "Plugin metadata is missing a description." });
  }
  if (normalizedPlugin.tools.length === 0) {
    issues.push({ severity: "error", code: "plugin-tools-empty", message: "Plugin does not expose any tools." });
  }
  if (normalizedPlugin.sourceType === "source-file" && normalizedPlugin.rawSourceAvailable) {
    issues.push({ severity: "suggestion", code: "source-inspection-heuristic", message: "Source-file inspection is heuristic and does not execute the TypeScript module.", suggestion: "Register the plugin or import it in a fixture test for full validation." });
  }

  const conflicts = findPluginConflicts(normalizedPlugin, options?.existingPlugins ?? [], options?.importedTools ?? []);
  return {
    plugin: normalizedPlugin,
    tools,
    issues,
    conflicts,
    exposure: summarizePluginExposure(normalizedPlugin, options?.promptCatalog, options?.resourceCatalog),
  };
}

export function inspectPluginRegistry(input: {
  plugins: BizBotPlugin[];
  importedTools?: ImportedToolOrigin[];
}): RegistryInspectionResult {
  const toolOwnership: ToolOwnershipEntry[] = [];
  const conflicts: InspectionIssue[] = [];
  const warnings: InspectionIssue[] = [];
  const pluginIds = new Set<string>();
  const toolNames = new Map<string, string>();

  for (const plugin of input.plugins) {
    if (pluginIds.has(plugin.metadata.id)) {
      conflicts.push({ severity: "error", code: "registry-plugin-id-duplicate", message: `Duplicate plugin id ${plugin.metadata.id}.` });
    }
    pluginIds.add(plugin.metadata.id);

    for (const tool of plugin.tools) {
      if (toolNames.has(tool.name)) {
        conflicts.push({ severity: "error", code: "registry-tool-duplicate", message: `Duplicate tool name ${tool.name} between ${toolNames.get(tool.name)} and ${plugin.metadata.id}.`, related: [String(toolNames.get(tool.name)), plugin.metadata.id, tool.name] });
      } else {
        toolNames.set(tool.name, plugin.metadata.id);
      }

      toolOwnership.push({
        toolName: tool.name,
        ownerKind: "builtin-plugin",
        ownerId: plugin.metadata.id,
        ownerLabel: plugin.metadata.displayName,
        description: tool.description,
      });

      warnings.push(...analyzeToolNaming(tool.name, normalizePluginPrefix(plugin.metadata.id)).issues);
      if (!tool.description?.trim()) {
        warnings.push({ severity: "warning", code: "registry-tool-description-missing", message: `Tool ${tool.name} in plugin ${plugin.metadata.id} is missing a description.` });
      }
    }
  }

  const importedServerCounts = new Map<string, number>();
  for (const importedTool of input.importedTools ?? []) {
    importedServerCounts.set(importedTool.serverName, (importedServerCounts.get(importedTool.serverName) ?? 0) + 1);
    toolOwnership.push({
      toolName: importedTool.prefixedName,
      ownerKind: "imported-mcp",
      ownerId: importedTool.serverName,
      ownerLabel: importedTool.serverName,
      originalName: importedTool.originalName,
      serverName: importedTool.serverName,
      description: importedTool.description,
    });

    const conceptualOverlap = input.plugins.flatMap((plugin) => plugin.tools.map((tool) => ({ pluginId: plugin.metadata.id, name: tool.name }))).find((tool) => tool.name === importedTool.originalName);
    if (conceptualOverlap) {
      warnings.push({ severity: "warning", code: "registry-imported-overlap", message: `Imported MCP tool ${importedTool.prefixedName} overlaps with builtin tool ${conceptualOverlap.name} from ${conceptualOverlap.pluginId}.`, related: [importedTool.prefixedName, conceptualOverlap.name, conceptualOverlap.pluginId] });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    plugins: input.plugins.map((plugin) => ({
      id: plugin.metadata.id,
      displayName: plugin.metadata.displayName,
      description: plugin.metadata.description,
      internal: plugin.metadata.internal ?? false,
      version: plugin.metadata.version ?? null,
      tags: plugin.metadata.tags ?? [],
      toolCount: plugin.tools.length,
    })),
    toolOwnership: toolOwnership.sort((left, right) => left.toolName.localeCompare(right.toolName)),
    conflicts,
    warnings,
    importedServers: Array.from(importedServerCounts.entries()).map(([serverName, toolCount]) => ({ serverName, toolCount })),
    summary: {
      pluginCount: input.plugins.length,
      builtinToolCount: input.plugins.reduce((sum, plugin) => sum + plugin.tools.length, 0),
      importedToolCount: (input.importedTools ?? []).length,
    },
  };
}

function isRegisteredPlugin(value: InspectablePluginShape | BizBotPlugin): value is BizBotPlugin {
  return "tools" in value && Array.isArray(value.tools) && "metadata" in value && typeof value.metadata?.description === "string";
}

export function toInspectablePlugin(plugin: BizBotPlugin): InspectablePluginShape {
  return {
    sourceType: "registered-plugin",
    sourceLabel: plugin.metadata.id,
    metadata: plugin.metadata,
    tools: plugin.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
  };
}

function findQuotedValue(block: string, field: string): string | undefined {
  const match = block.match(new RegExp(`${field}\\s*:\\s*"([^"]+)"`));
  return match?.[1];
}

export function inspectPluginSourceFile(filePath: string): InspectablePluginShape {
  const absolutePath = path.resolve(filePath);
  const source = fs.readFileSync(absolutePath, "utf8");
  const metadataBlock = source.match(/metadata\s*:\s*\{([\s\S]*?)\}\s*,\s*tools\s*:/)?.[1] ?? "";
  const toolBlocks = source.split("registerTool(defineTool({").slice(1);
  const tools = toolBlocks.map((block, index) => ({
    name: findQuotedValue(block, "name") ?? `unknown_tool_${index + 1}`,
    description: findQuotedValue(block, "description"),
  }));

  return {
    sourceType: "source-file",
    sourceLabel: absolutePath,
    rawSourceAvailable: true,
    metadata: {
      id: findQuotedValue(metadataBlock, "id"),
      displayName: findQuotedValue(metadataBlock, "displayName"),
      description: findQuotedValue(metadataBlock, "description"),
    },
    tools,
  };
}

export function explainRegistryConflict(
  registry: RegistryInspectionResult,
  identifier: string,
): { identifier: string; conflicts: InspectionIssue[]; owners: ToolOwnershipEntry[]; strategies: string[] } {
  const conflicts = registry.conflicts.concat(registry.warnings).filter((issue) => issue.message.includes(identifier) || issue.related?.includes(identifier));
  const owners = registry.toolOwnership.filter((entry) => entry.toolName === identifier || entry.ownerId === identifier || entry.originalName === identifier);
  const strategies = [
    "Rename the plugin or tool so its namespace is unique and intention-revealing.",
    "If the behavior truly belongs to an existing namespace, merge it into that plugin instead of adding a parallel surface.",
    "For imported MCP overlap, keep the mcp_<server>_ prefix distinct and avoid reusing the imported base name for builtin tools.",
  ];

  return { identifier, conflicts, owners, strategies };
}

export function buildSuggestedPluginTests(plugin: InspectablePluginShape): string[] {
  const tests = [
    "assert plugin metadata id, displayName, and description",
    "assert the plugin exposes at least one registered tool",
    "verify the plugin can be added to createPluginRegistry without collisions",
  ];

  for (const tool of plugin.tools) {
    tests.push(`verify ${tool.name} is exposed with the expected description and schema`);
    if (tool.parameters && Object.keys(tool.parameters.properties).length > 0) {
      tests.push(`cover invalid arguments and missing required fields for ${tool.name}`);
    }
    tests.push(`assert ${tool.name} returns a stable structured result for the happy path`);
  }

  tests.push("review tests/mcp/contracts.test.ts if the plugin changes the MCP tool catalog");
  return tests;
}