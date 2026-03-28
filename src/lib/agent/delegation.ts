import type { LLMProvider } from "@/lib/agent/kernel";
import {
  buildAgentProfilePrompt,
  getAgentProfileDescriptor,
  type AgentProfile,
} from "@/lib/agent/profiles";
import type { ToolExecutionResult } from "@/lib/agent/tools";

export interface DelegationRequest {
  targetProfile: AgentProfile;
  task: string;
  conversationId: string;
  provider?: LLMProvider;
  parentRunId?: string;
  delegatedByProfile?: AgentProfile;
  signal?: AbortSignal;
}

export type DelegationResult = ToolExecutionResult & {
  ok: boolean;
  delegated: true;
  runId: string;
  conversationId: string;
  profile: AgentProfile;
  profileLabel: string;
  reply: string;
};

function buildDelegatedUserMessage(request: DelegationRequest): string {
  const descriptor = getAgentProfileDescriptor(request.targetProfile);
  const prompt = buildAgentProfilePrompt(request.targetProfile, request.task);
  const instructions = [
    `Delegated lane: ${descriptor.label}.`,
    `Mission: ${descriptor.mission}`,
    `Operating instruction: ${prompt.systemInstruction}`,
    `Complete this delegated task and return only the result needed by the caller: ${request.task}`,
  ];

  if (request.delegatedByProfile) {
    instructions.unshift(`Delegated by: ${request.delegatedByProfile}.`);
  }

  return instructions.join("\n");
}

export async function executeDelegatedRun(request: DelegationRequest): Promise<DelegationResult> {
  const { executeAgentConversation } = await import("@/lib/agent/executor");
  const result = await executeAgentConversation({
    message: buildDelegatedUserMessage(request),
    conversationId: request.conversationId,
    provider: request.provider,
    forcedProfile: request.targetProfile,
    parentRunId: request.parentRunId,
    delegationReason: request.task,
    delegatedByProfile: request.delegatedByProfile,
    signal: request.signal,
  });

  return {
    ok: true,
    delegated: true,
    runId: result.runId,
    conversationId: result.conversationId,
    profile: result.profile,
    profileLabel: getAgentProfileDescriptor(result.profile).label,
    reply: result.reply,
  };
}