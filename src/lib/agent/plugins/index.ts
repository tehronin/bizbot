/**
 * agent/plugins/index.ts — Registry of all available SK-style plugins.
 * Each plugin is a set of named functions the agent can call via tool use.
 * External MCP server tools are merged in when MCP clients are connected.
 */

import type { JsonObject, RegisteredToolDefinition, ToolDescriptor, ToolExecutionResult } from "@/lib/agent/tools";
import type { AgentRuntimeConfig } from "@/lib/agent/runtime";
import type { AgentProfile } from "@/lib/agent/profiles";
import { getAgentRuntimeConfig } from "@/lib/agent/runtime";
import { canProfileUseTool } from "@/lib/agent/profiles";
import { getMcpClientTools } from "@/lib/mcp/client";
import { createBizBotPlugin, wrapBuiltinPlugin } from "./contracts";
import { getBuiltinPlugins, createPluginRegistry } from "./registry";

export { createBizBotPlugin, wrapBuiltinPlugin, getBuiltinPlugins, createPluginRegistry };
export type { BizBotPlugin, BizBotPluginMetadata } from "./contracts";

export interface ToolAccessContext {
  agentProfile?: AgentProfile;
  conversationId?: string;
  runId?: string;
  provider?: string;
  signal?: AbortSignal;
}

function canExposeTool(name: string, config: AgentRuntimeConfig, access?: ToolAccessContext): boolean {
  if (config.autonomyPreset === "manual_only") {
    if (name === "social_post" || name === "social_reply") {
      return false;
    }
  }

  if (config.autonomyPreset === "reply_only") {
    if (name === "social_post") {
      return false;
    }
  }

  if (access?.agentProfile && !canProfileUseTool(access.agentProfile, name)) {
    return false;
  }

  return true;
}

function getFullToolRegistry(): RegisteredToolDefinition[] {
  return createPluginRegistry(getBuiltinPlugins(), getMcpClientTools()).tools;
}

export function getAllToolDefinitions(
  config: AgentRuntimeConfig = getAgentRuntimeConfig(),
  access?: ToolAccessContext,
): ToolDescriptor[] {
  return getFullToolRegistry()
    .filter((tool) => canExposeTool(tool.name, config, access))
    .map(({ name, description, parameters }) => ({ name, description, parameters }));
}

export async function executeTool(
  name: string,
  args: JsonObject,
  options?: {
    config?: AgentRuntimeConfig;
    access?: ToolAccessContext;
  },
): Promise<ToolExecutionResult> {
  const config = options?.config ?? getAgentRuntimeConfig();
  if (!canExposeTool(name, config, options?.access)) {
    throw new Error(`Tool not allowed for this execution lane: ${name}`);
  }

  const tool = getFullToolRegistry().find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`Unsupported tool: ${name}`);
  }

  return tool.execute(args, {
    conversationId: options?.access?.conversationId,
    runId: options?.access?.runId,
    agentProfile: options?.access?.agentProfile,
    provider: options?.access?.provider,
    signal: options?.access?.signal,
  });
}
