import { describe, expect, it, vi } from "vitest";

const executorMocks = vi.hoisted(() => ({
  executeAgentConversation: vi.fn(),
}));

const runJournalMocks = vi.hoisted(() => ({
  getAgentRun: vi.fn(),
  listRecentAgentRuns: vi.fn().mockReturnValue([]),
}));

vi.mock("@/lib/agent/executor", () => ({
  executeAgentConversation: executorMocks.executeAgentConversation,
}));

vi.mock("@/lib/agent/run-journal", async () => {
  const actual = await vi.importActual<object>("@/lib/agent/run-journal");
  return {
    ...actual,
    getAgentRun: runJournalMocks.getAgentRun,
    listRecentAgentRuns: runJournalMocks.listRecentAgentRuns,
  };
});

import { developerPlugin } from "@/lib/agent/plugins/DeveloperPlugin";

describe("developer resume tool", () => {
  it("resumes a stored agent run through the executor", async () => {
    const tool = developerPlugin.tools.find((entry) => entry.name === "developer_resume_agent_run");
    expect(tool).toBeDefined();

    runJournalMocks.getAgentRun.mockReturnValue({
      runId: "run-old",
      conversationId: "conversation-1",
      profile: "general_operator",
      provider: "ollama",
      userMessage: "Investigate the failure",
    });
    executorMocks.executeAgentConversation.mockResolvedValue({
      reply: "resumed reply",
      runId: "run-new",
      conversationId: "conversation-1",
      profile: "general_operator",
      provider: "ollama",
      model: "model-1",
    });

    const result = await tool!.execute({ runId: "run-old" }, { userId: "user-1" });

    expect(executorMocks.executeAgentConversation).toHaveBeenCalledWith(expect.objectContaining({
      message: "Resume agent run run-old",
      conversationId: "conversation-1",
      userId: "user-1",
      resumeRunId: "run-old",
    }));
    expect(result).toEqual(expect.objectContaining({
      resumed: true,
      sourceRunId: "run-old",
      result: expect.objectContaining({ runId: "run-new" }),
    }));
  });
});