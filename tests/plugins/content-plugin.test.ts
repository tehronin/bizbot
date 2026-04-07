import { beforeEach, describe, expect, it, vi } from "vitest";

const accountedChatMocks = vi.hoisted(() => ({
  chatCompleteWithRunAccounting: vi.fn(),
}));

const policyMocks = vi.hoisted(() => ({
  evaluateContent: vi.fn(),
}));

vi.mock("@/lib/agent/accounted-chat", () => ({
  chatCompleteWithRunAccounting: accountedChatMocks.chatCompleteWithRunAccounting,
}));

vi.mock("@/lib/policies/engine", () => ({
  evaluateContent: policyMocks.evaluateContent,
}));

import { executeTool } from "@/lib/agent/plugins";

describe("content plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountedChatMocks.chatCompleteWithRunAccounting.mockResolvedValue({
      content: "A concise post",
      provider: "ollama",
      model: "model-1",
      toolCalls: [],
      usage: {
        promptTokens: 50,
        completionTokens: 10,
        totalTokens: 60,
        cachedPromptTokens: 0,
      },
    });
    policyMocks.evaluateContent.mockResolvedValue({ ok: true, violations: [] });
  });

  it("routes content drafting through the accounting-aware chat wrapper", async () => {
    const result = await executeTool("content_draft", {
      topic: "our launch",
      platform: "twitter",
      tone: "witty",
    }, {
      access: {
        agentProfile: "content_operator",
        runId: "run-1",
        provider: "ollama",
      },
    });

    expect(accountedChatMocks.chatCompleteWithRunAccounting).toHaveBeenCalledWith([
      expect.objectContaining({ role: "system" }),
      expect.objectContaining({ role: "user" }),
    ], expect.objectContaining({
      runId: "run-1",
      provider: "ollama",
    }));
    expect(result).toEqual({ draft: "A concise post", characterCount: 14 });
  });

  it("routes content refinement through the accounting-aware chat wrapper", async () => {
    const result = await executeTool("content_refine", {
      content: "draft",
      instruction: "make it sharper",
    }, {
      access: {
        agentProfile: "content_operator",
        runId: "run-1",
        provider: "ollama",
      },
    });

    expect(accountedChatMocks.chatCompleteWithRunAccounting).toHaveBeenCalledWith([
      expect.objectContaining({ role: "system" }),
      expect.objectContaining({ role: "user" }),
    ], expect.objectContaining({
      runId: "run-1",
      provider: "ollama",
    }));
    expect(result).toEqual({ refined: "A concise post" });
  });
});