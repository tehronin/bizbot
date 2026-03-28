import type { RegisteredToolDefinition } from "@/lib/agent/tools";

export interface BizBotPluginMetadata {
  id: string;
  displayName: string;
  description: string;
  version?: string;
  tags?: string[];
  internal?: boolean;
}

export interface BizBotPlugin {
  metadata: BizBotPluginMetadata;
  tools: RegisteredToolDefinition[];
}

export interface BizBotPluginModule {
  tools: RegisteredToolDefinition[];
}

export function createBizBotPlugin(plugin: BizBotPlugin): BizBotPlugin {
  return plugin;
}

export function wrapBuiltinPlugin(metadata: BizBotPluginMetadata, plugin: BizBotPluginModule): BizBotPlugin {
  return createBizBotPlugin({
    metadata: {
      ...metadata,
      internal: metadata.internal ?? true,
      version: metadata.version ?? "1.0.0",
      tags: metadata.tags ?? [],
    },
    tools: plugin.tools,
  });
}