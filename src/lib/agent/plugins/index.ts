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
import { approvalPlugin } from "./ApprovalPlugin";
import { browserPlugin } from "./BrowserPlugin";
import { competitorPlugin } from "./CompetitorPlugin";
import { commercePlugin } from "./CommercePlugin";
import { contentPlugin } from "./ContentPlugin";
import { crmPlugin } from "./CrmPlugin";
import { delegationPlugin } from "./DelegationPlugin";
import { developerPlugin } from "./DeveloperPlugin";
import { filePlugin } from "./FilePlugin";
import { graphPlugin } from "./GraphPlugin";
import { memoryPlugin } from "./MemoryPlugin";
import { localBusinessPlugin } from "./LocalBusinessPlugin";
import { schedulePlugin } from "./SchedulePlugin";
import { socialPlugin } from "./SocialPlugin";
import { getMcpClientTools } from "@/lib/mcp/client";

export {
  approvalPlugin,
  browserPlugin,
  competitorPlugin,
  commercePlugin,
  contentPlugin,
  crmPlugin,
  delegationPlugin,
  developerPlugin,
  filePlugin,
  graphPlugin,
  localBusinessPlugin,
  memoryPlugin,
  schedulePlugin,
  socialPlugin,
};

const toolRegistry: RegisteredToolDefinition[] = [
  ...socialPlugin.tools,
  ...commercePlugin.tools,
  ...contentPlugin.tools,
  ...crmPlugin.tools,
  ...delegationPlugin.tools,
  ...developerPlugin.tools,
  ...memoryPlugin.tools,
  ...filePlugin.tools,
  ...graphPlugin.tools,
  ...localBusinessPlugin.tools,
  ...schedulePlugin.tools,
  ...approvalPlugin.tools,
  ...browserPlugin.tools,
  ...competitorPlugin.tools,
];

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
  return [...toolRegistry, ...getMcpClientTools()];
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
