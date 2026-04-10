import type { RegisteredToolDefinition } from "@/lib/agent/tools";
import type { BizBotPlugin, BizBotPluginModule } from "@/lib/agent/plugins/contracts";
import { wrapBuiltinPlugin } from "@/lib/agent/plugins/contracts";
import { approvalPlugin } from "./ApprovalPlugin";
import { builderPlugin } from "./BuilderPlugin";
import { browserPlugin } from "./BrowserPlugin";
import { competitorPlugin } from "./CompetitorPlugin";
import { conversationBridgePlugin } from "./ConversationBridgePlugin";
import { commercePlugin } from "./CommercePlugin";
import { contentPlugin } from "./ContentPlugin";
import { crmPlugin } from "./CrmPlugin";
import { delegationPlugin } from "./DelegationPlugin";
import { developerPlugin } from "./DeveloperPlugin";
import { filePlugin } from "./FilePlugin";
import { graphPlugin } from "./GraphPlugin";
import { localBusinessPlugin } from "./LocalBusinessPlugin";
import { memoryPlugin } from "./MemoryPlugin";
import { oraclePlugin } from "./OraclePlugin";
import { schedulePlugin } from "./SchedulePlugin";
import { BUILTIN_PLUGIN_TOGGLES, getBuiltinPluginToggle, isBuiltinPluginEnabled } from "./settings";
import { socialPlugin } from "./SocialPlugin";
import { sidecarTools } from "@/lib/sidecar/tools";

function resolveBuiltinPluginModule(id: string): BizBotPluginModule | null {
  switch (id) {
    case "social":
      return socialPlugin;
    case "commerce":
      return commercePlugin;
    case "content":
      return contentPlugin;
    case "crm":
      return crmPlugin;
    case "builder":
      return builderPlugin;
    case "delegation":
      return delegationPlugin;
    case "developer":
      return developerPlugin;
    case "memory":
      return memoryPlugin;
    case "files":
      return filePlugin;
    case "graph":
      return graphPlugin;
    case "local-business":
      return localBusinessPlugin;
    case "schedule":
      return schedulePlugin;
    case "approval":
      return approvalPlugin;
    case "browser":
      return browserPlugin;
    case "competitor":
      return competitorPlugin;
    case "oracle":
      return oraclePlugin;
    case "conversation-bridge":
      return conversationBridgePlugin;
    default:
      return null;
  }
}

function listBuiltinPlugins(): BizBotPlugin[] {
  return BUILTIN_PLUGIN_TOGGLES.map((plugin) => {
    const pluginModule = resolveBuiltinPluginModule(plugin.id);
    if (!pluginModule) {
      throw new Error(`Missing builtin plugin module: ${plugin.id}`);
    }

    return wrapBuiltinPlugin({
      id: plugin.id,
      displayName: plugin.displayName,
      description: plugin.description,
      tags: plugin.tags,
    }, pluginModule);
  });
}

const coreToolSets = [
  {
    ownerId: "core-sidecar",
    tools: sidecarTools,
  },
] as const;

export interface BizBotPluginRegistry {
  plugins: BizBotPlugin[];
  tools: RegisteredToolDefinition[];
  toolToPluginId: Map<string, string>;
}

export function getBuiltinPlugins(options?: { includeDisabled?: boolean }): BizBotPlugin[] {
  const includeDisabled = options?.includeDisabled ?? true;
  return listBuiltinPlugins().filter((plugin) => includeDisabled || isBuiltinPluginEnabled(plugin.metadata.id));
}

export function getEnabledBuiltinPlugins(): BizBotPlugin[] {
  return getBuiltinPlugins({ includeDisabled: false });
}

export function getBuiltinPluginTooling(id: string): { envKey: string; defaultEnabled: boolean } | null {
  const plugin = getBuiltinPluginToggle(id);
  if (!plugin) {
    return null;
  }

  return {
    envKey: plugin.envKey,
    defaultEnabled: plugin.defaultEnabled,
  };
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

  for (const toolSet of coreToolSets) {
    for (const tool of toolSet.tools) {
      if (toolNames.has(tool.name)) {
        throw new Error(`Duplicate tool name: ${tool.name}`);
      }
      toolNames.add(tool.name);
      toolToPluginId.set(tool.name, toolSet.ownerId);
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