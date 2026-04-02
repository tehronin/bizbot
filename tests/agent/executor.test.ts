import { beforeEach, describe, expect, it, vi } from "vitest";

const memoryMocks = vi.hoisted(() => ({
  buildContextForPrompt: vi.fn(),
  getOrCreateConversation: vi.fn(),
  saveMessage: vi.fn(),
}));

const memoryServiceMocks = vi.hoisted(() => ({
  getRelevantMemoryFacts: vi.fn(),
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
  recordAgentRunPromptAssembly: vi.fn(),
  recordAgentRunRoundUsage: vi.fn(),
  recordAgentRunToolCall: vi.fn(),
  recordAgentRunToolResult: vi.fn(),
  countDelegationDepth: vi.fn(),
  getDelegationChain: vi.fn(),
}));

vi.mock("@/lib/agent/memory", () => ({
  buildContextForPrompt: memoryMocks.buildContextForPrompt,
  getOrCreateConversation: memoryMocks.getOrCreateConversation,
  saveMessage: memoryMocks.saveMessage,
}));

vi.mock("@/lib/agent/memory/service", () => ({
  getRelevantMemoryFacts: memoryServiceMocks.getRelevantMemoryFacts,
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
  recordAgentRunPromptAssembly: runJournalMocks.recordAgentRunPromptAssembly,
  recordAgentRunRoundUsage: runJournalMocks.recordAgentRunRoundUsage,
  recordAgentRunToolCall: runJournalMocks.recordAgentRunToolCall,
  recordAgentRunToolResult: runJournalMocks.recordAgentRunToolResult,
  countDelegationDepth: runJournalMocks.countDelegationDepth,
  getDelegationChain: runJournalMocks.getDelegationChain,
}));

import { executeAgentConversation } from "@/lib/agent/executor";

describe("agent executor explicit memory", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    memoryMocks.getOrCreateConversation.mockResolvedValue("conversation-1");
    memoryMocks.buildContextForPrompt.mockResolvedValue({
      text: "Earlier conversation summary:\n- User: asked for a launch post.\n\nRecent conversation:\nUSER: hi",
      blocks: {
        conversationSummary: "Earlier conversation summary:\n- User: asked for a launch post.",
        recentConversation: "USER: hi",
        semanticRecall: "",
        graph: "",
        knowledgeDocs: "",
      },
      retrieval: {
        conversationSummary: {
          included: true,
          reason: "message looks like a continuation of the current thread",
          resultCount: 1,
          chars: 59,
        },
        recentConversation: {
          included: true,
          reason: "conversation is recent and the message looks continuous",
          resultCount: 1,
          chars: 8,
        },
        semanticRecall: {
          included: false,
          reason: "message does not target long-term user memory",
          resultCount: 0,
          chars: 0,
        },
        graph: {
          included: false,
          reason: "message does not appear to require graph traversal",
          resultCount: 0,
          chars: 0,
        },
        knowledgeDocs: {
          included: false,
          reason: "message does not appear to need knowledge-document retrieval",
          resultCount: 0,
          chars: 0,
        },
      },
    });
    memoryMocks.saveMessage.mockResolvedValue(undefined);
    memoryServiceMocks.getRelevantMemoryFacts.mockResolvedValue([]);
    memoryServiceMocks.formatMemoryFactsForPrompt.mockReturnValue("");
    kernelMocks.getModelForProvider.mockReturnValue("model-1");
    kernelMocks.chatComplete.mockResolvedValue({
      content: "reply",
      toolCalls: [],
      provider: "ollama",
      model: "model-1",
      metadata: undefined,
      usage: undefined,
    });
    pluginMocks.getAllToolDefinitions.mockReturnValue([]);
    runtimeMocks.ensureMcpClientsInitialized.mockResolvedValue(undefined);
    runtimeMocks.buildAutonomySystemPrompt.mockReturnValue("Autonomy enabled.");
    runtimeMocks.getAgentRuntimeConfig.mockReturnValue({
      autonomyPreset: "approval_all_posts",
      heartbeatSeconds: 300,
      knowledgePath: "knowledge",
      knowledgeEnabled: true,
      toolMaxRounds: 8,
      toolResultMaxChars: 8_000,
    });
    ontologyMocks.buildOntologyPromptBlock.mockResolvedValue({ block: "", lines: [], omitted: true, reason: "empty" });
    runJournalMocks.startAgentRun.mockReturnValue({ runId: "run-1" });
    runJournalMocks.countDelegationDepth.mockReturnValue(0);
    runJournalMocks.getDelegationChain.mockReturnValue(["content_operator"]);
  });

  it("injects a separate user memory block before Context when facts exist", async () => {
    memoryServiceMocks.getRelevantMemoryFacts.mockResolvedValue([{ key: "preferred_name" }]);
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
  expect(memoryServiceMocks.getRelevantMemoryFacts).toHaveBeenCalledWith({ userId: "user-1", query: "Draft a reply" });
    expect(memoryMocks.buildContextForPrompt).toHaveBeenCalledWith("Draft a reply", "conversation-1", "user-1");

    const systemPrompt = kernelMocks.chatComplete.mock.calls[0][0][0].content as string;
    expect(systemPrompt).toContain("[User Memory]");
    expect(systemPrompt).toContain('preferred_name: "Sam"');
    expect(systemPrompt).toContain("Context:\nEarlier conversation summary:\n- User: asked for a launch post.\n\nRecent conversation:\nUSER: hi");
    expect(systemPrompt.indexOf("[User Memory]")).toBeLessThan(systemPrompt.indexOf("Context:"));
    expect(runJournalMocks.recordAgentRunPromptAssembly).toHaveBeenCalledWith("run-1", expect.objectContaining({
      promptAssembly: expect.objectContaining({
        explicitMemoryChars: expect.any(Number),
        conversationSummaryChars: expect.any(Number),
        recentConversationChars: 8,
      }),
    }));
  });

  it("omits the memory block when there are no active facts", async () => {
    await executeAgentConversation({
      message: "Draft a reply",
      forcedProfile: "content_operator",
    });

    const systemPrompt = kernelMocks.chatComplete.mock.calls[0][0][0].content as string;
    expect(systemPrompt).not.toContain("[User Memory]");
    expect(systemPrompt).toContain("Context:\nEarlier conversation summary:\n- User: asked for a launch post.\n\nRecent conversation:\nUSER: hi");
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
    expect(systemPrompt).toContain("Context:\nEarlier conversation summary:\n- User: asked for a launch post.\n\nRecent conversation:\nUSER: hi");
  });

  it("logs delegation context for routed runs", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await executeAgentConversation({
      message: "Draft a reply",
      forcedProfile: "content_operator",
      parentRunId: "parent-run-1",
      delegatedByProfile: "general_operator",
    });

    expect(runJournalMocks.countDelegationDepth).toHaveBeenCalledWith("parent-run-1");
    expect(runJournalMocks.getDelegationChain).toHaveBeenCalledWith("parent-run-1");
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("profile=content_operator"));
    infoSpy.mockRestore();
  });

  it("records token usage for each model round when usage metadata is available", async () => {
    kernelMocks.chatComplete.mockResolvedValue({
      content: "reply",
      toolCalls: [],
      provider: "ollama",
      model: "model-1",
      metadata: undefined,
      usage: {
        promptTokens: 120,
        completionTokens: 30,
        totalTokens: 150,
        cachedPromptTokens: 20,
      },
    });

    await executeAgentConversation({
      message: "Draft a reply",
      forcedProfile: "content_operator",
    });

    expect(runJournalMocks.recordAgentRunRoundUsage).toHaveBeenCalledWith("run-1", {
      round: 1,
      provider: "ollama",
      model: "model-1",
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      cachedPromptTokens: 20,
    });
  });

  it("records Google usage metadata including cached prompt tokens", async () => {
    kernelMocks.chatComplete.mockResolvedValue({
      content: "reply",
      toolCalls: [],
      provider: "google",
      model: "gemini-3-flash-preview",
      metadata: {
        googleSearchQueries: "bizbot google flash 3",
      },
      usage: {
        promptTokens: 310,
        completionTokens: 44,
        totalTokens: 354,
        cachedPromptTokens: 128,
      },
    });

    await executeAgentConversation({
      message: "Summarize the current Google Flash 3 runtime status",
      forcedProfile: "content_operator",
    });

    expect(runJournalMocks.recordAgentRunRoundUsage).toHaveBeenCalledWith("run-1", {
      round: 1,
      provider: "google",
      model: "gemini-3-flash-preview",
      promptTokens: 310,
      completionTokens: 44,
      totalTokens: 354,
      cachedPromptTokens: 128,
    });
  });
});