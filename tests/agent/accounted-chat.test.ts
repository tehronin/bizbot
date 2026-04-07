import { beforeEach, describe, expect, it, vi } from "vitest";

const kernelMocks = vi.hoisted(() => ({
  chatComplete: vi.fn(),
}));

const runJournalMocks = vi.hoisted(() => ({
  getAgentRun: vi.fn(),
  recordAgentRunRoundUsage: vi.fn(),
}));

vi.mock("@/lib/agent/kernel", () => ({
  chatComplete: kernelMocks.chatComplete,
}));

vi.mock("@/lib/agent/run-journal", () => ({
  getAgentRun: runJournalMocks.getAgentRun,
  recordAgentRunRoundUsage: runJournalMocks.recordAgentRunRoundUsage,
}));

import { chatCompleteWithRunAccounting } from "@/lib/agent/accounted-chat";

describe("accounted chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runJournalMocks.getAgentRun.mockReturnValue({
      usage: {
        rounds: [],
      },
    });
    kernelMocks.chatComplete.mockResolvedValue({
      content: "reply",
      provider: "ollama",
      model: "model-1",
      toolCalls: [],
      usage: {
        promptTokens: 48,
        completionTokens: 12,
        totalTokens: 60,
        cachedPromptTokens: 0,
      },
    });
  });

  it("records tool-owned usage against a synthetic negative round when a run is present", async () => {
    await chatCompleteWithRunAccounting([
      { role: "user", content: "draft this" },
    ], {
      runId: "run-1",
      provider: "ollama",
    });

    expect(runJournalMocks.recordAgentRunRoundUsage).toHaveBeenCalledWith("run-1", {
      round: -1,
      provider: "ollama",
      model: "model-1",
      promptTokens: 48,
      completionTokens: 12,
      totalTokens: 60,
      cachedPromptTokens: 0,
    });
  });

  it("allocates a new negative round without colliding with executor rounds", async () => {
    runJournalMocks.getAgentRun.mockReturnValue({
      usage: {
        rounds: [
          { round: 1 },
          { round: 2 },
          { round: -1 },
        ],
      },
    });

    await chatCompleteWithRunAccounting([
      { role: "user", content: "draft this" },
    ], {
      runId: "run-1",
      provider: "ollama",
    });

    expect(runJournalMocks.recordAgentRunRoundUsage).toHaveBeenCalledWith("run-1", expect.objectContaining({
      round: -2,
    }));
  });

  it("does not record usage when no run id is available", async () => {
    await chatCompleteWithRunAccounting([
      { role: "user", content: "draft this" },
    ], {
      provider: "ollama",
    });

    expect(runJournalMocks.recordAgentRunRoundUsage).not.toHaveBeenCalled();
  });

  it("returns the model response even when journal lookup fails for a provided run id", async () => {
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    runJournalMocks.getAgentRun.mockImplementation(() => {
      throw new Error("run not found");
    });

    const response = await chatCompleteWithRunAccounting([
      { role: "user", content: "draft this" },
    ], {
      runId: "missing-run",
      provider: "ollama",
    });

    expect(response).toEqual(expect.objectContaining({
      content: "reply",
      provider: "ollama",
      model: "model-1",
    }));
    expect(warningSpy).toHaveBeenCalledWith("[accounted chat] failed to record tool-owned usage:", expect.any(Error));
    expect(runJournalMocks.recordAgentRunRoundUsage).not.toHaveBeenCalled();
    warningSpy.mockRestore();
  });
});