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
  userId?: string;
  provider?: string;
  signal?: AbortSignal;
}

function getToolAccessDenialReason(name: string, config: AgentRuntimeConfig, access?: ToolAccessContext): string | null {
  if (config.autonomyPreset === "manual_only") {
    if (name === "social_post" || name === "social_reply") {
      return `autonomy preset '${config.autonomyPreset}' blocks tool '${name}'`;
    }
  }

  if (config.autonomyPreset === "reply_only") {
    if (name === "social_post") {
      return `autonomy preset '${config.autonomyPreset}' blocks tool '${name}'`;
    }
  }

  if (access?.agentProfile && !canProfileUseTool(access.agentProfile, name)) {
    return `tool '${name}' is not allowed for profile '${access.agentProfile}'`;
  }

  return null;
}

function canExposeTool(name: string, config: AgentRuntimeConfig, access?: ToolAccessContext): boolean {
  return getToolAccessDenialReason(name, config, access) === null;
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
  const denialReason = getToolAccessDenialReason(name, config, options?.access);
  if (denialReason) {
    console.warn(`[tool blocked] profile=${options?.access?.agentProfile ?? "unknown"} tool=${name} reason=${denialReason}`);
    throw new Error(denialReason);
  }

  const tool = getFullToolRegistry().find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`Unsupported tool: ${name}`);
  }

  return tool.execute(args, {
    conversationId: options?.access?.conversationId,
    runId: options?.access?.runId,
    userId: options?.access?.userId,
    agentProfile: options?.access?.agentProfile,
    provider: options?.access?.provider,
    signal: options?.access?.signal,
  });
}
