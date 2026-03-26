/**
 * agent/plugins/index.ts — Registry of all available SK-style plugins.
 * Each plugin is a set of named functions the agent can call via tool use.
 */

import type { JsonObject, ToolDefinition, ToolExecutionResult } from "@/lib/agent/tools";
import type { AgentRuntimeConfig } from "@/lib/agent/runtime";
import { getAgentRuntimeConfig } from "@/lib/agent/runtime";
import { approvalPlugin } from "./ApprovalPlugin";
import { browserPlugin } from "./BrowserPlugin";
import { contentPlugin } from "./ContentPlugin";
import { filePlugin } from "./FilePlugin";
import { graphPlugin } from "./GraphPlugin";
import { memoryPlugin } from "./MemoryPlugin";
import { schedulePlugin } from "./SchedulePlugin";
import { socialPlugin } from "./SocialPlugin";

export {
  approvalPlugin,
  browserPlugin,
  contentPlugin,
  filePlugin,
  graphPlugin,
  memoryPlugin,
  schedulePlugin,
  socialPlugin,
};

const toolRegistry: ToolDefinition<object, ToolExecutionResult>[] = [
  ...socialPlugin.tools,
  ...contentPlugin.tools,
  ...memoryPlugin.tools,
  ...filePlugin.tools,
  ...graphPlugin.tools,
  ...schedulePlugin.tools,
  ...approvalPlugin.tools,
  ...browserPlugin.tools,
].map((tool) => tool as ToolDefinition<object, ToolExecutionResult>);

function canExposeTool(name: string, config: AgentRuntimeConfig): boolean {
  if (config.autonomyPreset === "manual_only") {
    return name !== "social_post" && name !== "social_reply";
  }

  if (config.autonomyPreset === "reply_only") {
    return name !== "social_post";
  }

  return true;
}

export function getAllToolDefinitions(
  config: AgentRuntimeConfig = getAgentRuntimeConfig(),
): ToolDefinition<object, ToolExecutionResult>[] {
  return toolRegistry.filter((tool) => canExposeTool(tool.name, config));
}

export async function executeTool(
  name: string,
  args: JsonObject,
): Promise<ToolExecutionResult> {
  const tool = toolRegistry.find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`Unsupported tool: ${name}`);
  }

  return tool.execute(args);
}
