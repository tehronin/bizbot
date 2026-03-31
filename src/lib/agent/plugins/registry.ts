import type { RegisteredToolDefinition } from "@/lib/agent/tools";
import type { BizBotPlugin } from "@/lib/agent/plugins/contracts";
import { wrapBuiltinPlugin } from "@/lib/agent/plugins/contracts";
import { approvalPlugin } from "./ApprovalPlugin";
import { builderPlugin } from "./BuilderPlugin";
import { browserPlugin } from "./BrowserPlugin";
import { competitorPlugin } from "./CompetitorPlugin";
import { commercePlugin } from "./CommercePlugin";
import { contentPlugin } from "./ContentPlugin";
import { crmPlugin } from "./CrmPlugin";
import { delegationPlugin } from "./DelegationPlugin";
import { developerPlugin } from "./DeveloperPlugin";
import { filePlugin } from "./FilePlugin";
import { graphPlugin } from "./GraphPlugin";
import { localBusinessPlugin } from "./LocalBusinessPlugin";
import { memoryPlugin } from "./MemoryPlugin";
import { schedulePlugin } from "./SchedulePlugin";
import { socialPlugin } from "./SocialPlugin";

const builtinPlugins: BizBotPlugin[] = [
  wrapBuiltinPlugin({ id: "social", displayName: "Social", description: "Social publishing, replies, mentions, and analytics.", tags: ["social", "publishing"] }, socialPlugin),
  wrapBuiltinPlugin({ id: "commerce", displayName: "Commerce", description: "Local-first products and orders for sales workflows.", tags: ["commerce", "sales"] }, commercePlugin),
  wrapBuiltinPlugin({ id: "content", displayName: "Content", description: "Content drafting, refinement, and policy checks.", tags: ["content", "drafting"] }, contentPlugin),
  wrapBuiltinPlugin({ id: "crm", displayName: "CRM", description: "CRM contacts, activities, and provider synchronization.", tags: ["crm", "sales"] }, crmPlugin),
  wrapBuiltinPlugin({ id: "builder", displayName: "Builder", description: "Sandboxed workspace scaffolding, file generation, and allowlisted command execution.", tags: ["builder", "workspace"] }, builderPlugin),
  wrapBuiltinPlugin({ id: "delegation", displayName: "Delegation", description: "Delegated sub-runs across specialist operator lanes.", tags: ["agent", "delegation"] }, delegationPlugin),
  wrapBuiltinPlugin({ id: "developer", displayName: "Developer", description: "Runtime inspection tools for workers, memories, and agent runs.", tags: ["developer", "debugging"] }, developerPlugin),
  wrapBuiltinPlugin({ id: "memory", displayName: "Memory", description: "Semantic recall plus explicit relational user memory tools.", tags: ["memory", "knowledge"] }, memoryPlugin),
  wrapBuiltinPlugin({ id: "files", displayName: "Files", description: "Workspace file operations.", tags: ["files", "workspace"] }, filePlugin),
  wrapBuiltinPlugin({ id: "graph", displayName: "Graph", description: "Knowledge graph search and context tools.", tags: ["graph", "knowledge"] }, graphPlugin),
  wrapBuiltinPlugin({ id: "local-business", displayName: "Local Business", description: "Google Business Profile reviews, posts, and hours.", tags: ["local-business", "reputation"] }, localBusinessPlugin),
  wrapBuiltinPlugin({ id: "schedule", displayName: "Schedule", description: "Publishing schedule management.", tags: ["schedule", "publishing"] }, schedulePlugin),
  wrapBuiltinPlugin({ id: "approval", displayName: "Approval", description: "Approval queue workflows and decisions.", tags: ["approval", "governance"] }, approvalPlugin),
  wrapBuiltinPlugin({ id: "browser", displayName: "Browser", description: "Playwright-backed web browsing and extraction.", tags: ["browser", "research"] }, browserPlugin),
  wrapBuiltinPlugin({ id: "competitor", displayName: "Competitor", description: "Competitor watch configuration and checks.", tags: ["competitor", "research"] }, competitorPlugin),
];

export interface BizBotPluginRegistry {
  plugins: BizBotPlugin[];
  tools: RegisteredToolDefinition[];
  toolToPluginId: Map<string, string>;
}

export function getBuiltinPlugins(): BizBotPlugin[] {
  return [...builtinPlugins];
}

export function createPluginRegistry(
  plugins: BizBotPlugin[],
  extraTools: RegisteredToolDefinition[] = [],
): BizBotPluginRegistry {
  const pluginIds = new Set<string>();
  const toolNames = new Set<string>();
  const toolToPluginId = new Map<string, string>();
  const tools: RegisteredToolDefinition[] = [];

  for (const plugin of plugins) {
    if (pluginIds.has(plugin.metadata.id)) {
      throw new Error(`Duplicate plugin id: ${plugin.metadata.id}`);
    }
    pluginIds.add(plugin.metadata.id);

    for (const tool of plugin.tools) {
      if (toolNames.has(tool.name)) {
        throw new Error(`Duplicate tool name: ${tool.name}`);
      }
      toolNames.add(tool.name);
      toolToPluginId.set(tool.name, plugin.metadata.id);
      tools.push(tool);
    }
  }

  for (const tool of extraTools) {
    if (toolNames.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    toolNames.add(tool.name);
    toolToPluginId.set(tool.name, "external-mcp");
    tools.push(tool);
  }

  return {
    plugins: [...plugins],
    tools,
    toolToPluginId,
  };
}