import { beforeEach, describe, expect, it, vi } from "vitest";

const memoryMocks = vi.hoisted(() => ({
  buildContext: vi.fn(),
  getOrCreateConversation: vi.fn(),
  saveMessage: vi.fn(),
}));

const memoryServiceMocks = vi.hoisted(() => ({
  getActiveMemoryFacts: vi.fn(),
  formatMemoryFactsForPrompt: vi.fn(),
}));

const kernelMocks = vi.hoisted(() => ({
  chatComplete: vi.fn(),
  getModelForProvider: vi.fn(),
}));

const pluginMocks = vi.hoisted(() => ({
  executeTool: vi.fn(),
  getAllToolDefinitions: vi.fn(),
}));

const runtimeMocks = vi.hoisted(() => ({
  ensureMcpClientsInitialized: vi.fn(),
  buildAutonomySystemPrompt: vi.fn(),
  getAgentRuntimeConfig: vi.fn(),
}));

const ontologyMocks = vi.hoisted(() => ({
  buildOntologyPromptBlock: vi.fn(),
}));

const runJournalMocks = vi.hoisted(() => ({
  startAgentRun: vi.fn(),
  completeAgentRun: vi.fn(),
  recordAgentRunToolCall: vi.fn(),
  recordAgentRunToolResult: vi.fn(),
}));

vi.mock("@/lib/agent/memory", () => ({
  buildContext: memoryMocks.buildContext,
  getOrCreateConversation: memoryMocks.getOrCreateConversation,
  saveMessage: memoryMocks.saveMessage,
}));

vi.mock("@/lib/agent/memory/service", () => ({
  getActiveMemoryFacts: memoryServiceMocks.getActiveMemoryFacts,
  formatMemoryFactsForPrompt: memoryServiceMocks.formatMemoryFactsForPrompt,
}));

vi.mock("@/lib/agent/kernel", () => ({
  chatComplete: kernelMocks.chatComplete,
  getModelForProvider: kernelMocks.getModelForProvider,
}));

vi.mock("@/lib/agent/plugins", () => ({
  executeTool: pluginMocks.executeTool,
  getAllToolDefinitions: pluginMocks.getAllToolDefinitions,
}));

vi.mock("@/lib/mcp/client", () => ({
  ensureMcpClientsInitialized: runtimeMocks.ensureMcpClientsInitialized,
}));

vi.mock("@/lib/agent/runtime", () => ({
  buildAutonomySystemPrompt: runtimeMocks.buildAutonomySystemPrompt,
  getAgentRuntimeConfig: runtimeMocks.getAgentRuntimeConfig,
}));

vi.mock("@/lib/ontology/prompt", () => ({
  buildOntologyPromptBlock: ontologyMocks.buildOntologyPromptBlock,
}));

vi.mock("@/lib/agent/run-journal", () => ({
  startAgentRun: runJournalMocks.startAgentRun,
  completeAgentRun: runJournalMocks.completeAgentRun,
  recordAgentRunToolCall: runJournalMocks.recordAgentRunToolCall,
  recordAgentRunToolResult: runJournalMocks.recordAgentRunToolResult,
}));

import { executeAgentConversation } from "@/lib/agent/executor";

describe("agent executor explicit memory", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    memoryMocks.getOrCreateConversation.mockResolvedValue("conversation-1");
    memoryMocks.buildContext.mockResolvedValue("Recent conversation:\nUSER: hi");
    memoryMocks.saveMessage.mockResolvedValue(undefined);
    memoryServiceMocks.getActiveMemoryFacts.mockResolvedValue([]);
    memoryServiceMocks.formatMemoryFactsForPrompt.mockReturnValue("");
    kernelMocks.getModelForProvider.mockReturnValue("model-1");
    kernelMocks.chatComplete.mockResolvedValue({
      content: "reply",
      toolCalls: [],
      provider: "ollama",
      model: "model-1",
      metadata: undefined,
    });
    pluginMocks.getAllToolDefinitions.mockReturnValue([]);
    runtimeMocks.ensureMcpClientsInitialized.mockResolvedValue(undefined);
    runtimeMocks.buildAutonomySystemPrompt.mockReturnValue("Autonomy enabled.");
    runtimeMocks.getAgentRuntimeConfig.mockReturnValue({ autonomyPreset: "approval_all_posts" });
    ontologyMocks.buildOntologyPromptBlock.mockResolvedValue({ block: "", lines: [], omitted: true, reason: "empty" });
    runJournalMocks.startAgentRun.mockReturnValue({ runId: "run-1" });
  });

  it("injects a separate user memory block before Context when facts exist", async () => {
    memoryServiceMocks.getActiveMemoryFacts.mockResolvedValue([{ key: "preferred_name" }]);
    memoryServiceMocks.formatMemoryFactsForPrompt.mockReturnValue([
      "[User Memory]",
      '- preferred_name: "Sam" (category: identity)',
      "[/User Memory]",
    ].join("\n"));

    await executeAgentConversation({
      message: "Draft a reply",
      userId: "user-1",
      forcedProfile: "content_operator",
    });

    expect(memoryMocks.getOrCreateConversation).toHaveBeenCalledWith(undefined, "user-1");
    expect(memoryServiceMocks.getActiveMemoryFacts).toHaveBeenCalledWith({ userId: "user-1" });

    const systemPrompt = kernelMocks.chatComplete.mock.calls[0][0][0].content as string;
    expect(systemPrompt).toContain("[User Memory]");
    expect(systemPrompt).toContain('preferred_name: "Sam"');
    expect(systemPrompt).toContain("\n\nContext:\nRecent conversation:\nUSER: hi");
    expect(systemPrompt.indexOf("[User Memory]")).toBeLessThan(systemPrompt.indexOf("Context:"));
  });

  it("omits the memory block when there are no active facts", async () => {
    await executeAgentConversation({
      message: "Draft a reply",
      forcedProfile: "content_operator",
    });

    const systemPrompt = kernelMocks.chatComplete.mock.calls[0][0][0].content as string;
    expect(systemPrompt).not.toContain("[User Memory]");
    expect(systemPrompt).toContain("Context:\nRecent conversation:\nUSER: hi");
  });

  it("injects a bounded ontology block separately from explicit user memory", async () => {
    ontologyMocks.buildOntologyPromptBlock.mockResolvedValue({
      block: [
        "[Ontology Context]",
        "- user: Sam",
        "- preference: concise replies",
        "[/Ontology Context]",
      ].join("\n"),
      lines: [],
      omitted: false,
    });

    await executeAgentConversation({
      message: "Draft a reply",
      userId: "user-1",
      forcedProfile: "content_operator",
    });

    const systemPrompt = kernelMocks.chatComplete.mock.calls[0][0][0].content as string;
    expect(systemPrompt).toContain("[Ontology Context]");
    expect(systemPrompt).toContain("preference: concise replies");
    expect(systemPrompt.indexOf("[Ontology Context]")).toBeLessThan(systemPrompt.indexOf("Context:"));
  });

  it("survives ontology read failure and omits the block", async () => {
    ontologyMocks.buildOntologyPromptBlock.mockRejectedValue(new Error("db unavailable"));

    await executeAgentConversation({
      message: "Draft a reply",
      userId: "user-1",
      forcedProfile: "content_operator",
    });

    const systemPrompt = kernelMocks.chatComplete.mock.calls[0][0][0].content as string;
    expect(systemPrompt).not.toContain("[Ontology Context]");
    expect(systemPrompt).toContain("Context:\nRecent conversation:\nUSER: hi");
  });
});