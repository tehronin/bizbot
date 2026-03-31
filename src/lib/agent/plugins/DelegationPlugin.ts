/** DelegationPlugin — Safe lane-to-lane delegation for specialist sub-runs. */

import { executeDelegatedRun } from "@/lib/agent/delegation";
import { getAgentProfileDescriptor, type AgentProfile } from "@/lib/agent/profiles";
import {
  defineTool,
  registerTool,
  type ToolDefinition,
  type ToolExecutionContext,
} from "@/lib/agent/tools";

interface DelegateRunArgs {
  targetProfile: AgentProfile;
  task: string;
}

function assertDelegationContext(context: ToolExecutionContext): asserts context is ToolExecutionContext & {
  conversationId: string;
  runId: string;
  agentProfile: string;
} {
  if (!context.conversationId || !context.runId || !context.agentProfile) {
    throw new Error("Delegation requires an active conversation, run, and agent profile context.");
  }
}

export const delegationPlugin = {
  tools: [
    registerTool(defineTool({
      name: "agent_delegate_run",
      description: "Delegate a bounded sub-task to another BizBot specialist lane and return the sub-run result.",
      parameters: {
        type: "object",
        properties: {
          targetProfile: {
            type: "string",
            enum: [
              "general_operator",
              "sales_operator",
              "content_operator",
              "reputation_operator",
              "analyst_operator",
              "research_operator",
              "platform_operator",
              "builder_operator",
            ],
          },
          task: { type: "string" },
        },
        required: ["targetProfile", "task"],
      },
      execute: async ({ targetProfile, task }: DelegateRunArgs, context: ToolExecutionContext) => {
        assertDelegationContext(context);
        const callerProfile = context.agentProfile as AgentProfile;
        const callerDescriptor = getAgentProfileDescriptor(callerProfile);

        if (!callerDescriptor.delegationTargets.includes(targetProfile)) {
          throw new Error(`Profile ${callerProfile} cannot delegate to ${targetProfile}.`);
        }

        return executeDelegatedRun({
          targetProfile,
          task,
          conversationId: context.conversationId,
          userId: context.userId,
          parentRunId: context.runId,
          delegatedByProfile: callerProfile,
          provider: context.provider as never,
          signal: context.signal,
        });
      },
    } satisfies ToolDefinition<DelegateRunArgs, Awaited<ReturnType<typeof executeDelegatedRun>>>)),
  ],
};