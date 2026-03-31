import { describe, expect, it, vi } from "vitest";

const executorMocks = vi.hoisted(() => ({
  executeAgentConversation: vi.fn(),
}));

vi.mock("@/lib/agent/executor", () => ({
  executeAgentConversation: executorMocks.executeAgentConversation,
}));

import { executeDelegatedRun } from "@/lib/agent/delegation";

describe("agent delegation", () => {
  it("preserves userId across delegated runs", async () => {
    executorMocks.executeAgentConversation.mockResolvedValue({
      reply: "delegated result",
      runId: "run-2",
      conversationId: "conversation-1",
      profile: "research_operator",
      provider: "ollama",
      model: "model-1",
    });

    const result = await executeDelegatedRun({
      targetProfile: "research_operator",
      task: "Find competitor pricing",
      conversationId: "conversation-1",
      userId: "user-1",
      parentRunId: "run-1",
      delegatedByProfile: "general_operator",
    });

    expect(executorMocks.executeAgentConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "conversation-1",
      userId: "user-1",
      parentRunId: "run-1",
      delegatedByProfile: "general_operator",
      forcedProfile: "research_operator",
    }));
    expect(result).toEqual({
      ok: true,
      delegated: true,
      runId: "run-2",
      conversationId: "conversation-1",
      profile: "research_operator",
      profileLabel: "Research Operator",
      reply: "delegated result",
    });
  });
});