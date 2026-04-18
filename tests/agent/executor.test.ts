import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  recordAgentRunSwarm: vi.fn(),
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

vi.mock("@/lib/agent/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent/kernel")>();
  return {
    ...actual,
    chatComplete: kernelMocks.chatComplete,
    getModelForProvider: kernelMocks.getModelForProvider,
  };
});

vi.mock("@/lib/agent/plugins", () => ({
  executeTool: pluginMocks.executeTool,
  getAllToolDefinitions: pluginMocks.getAllToolDefinitions,
}));

vi.mock("@/lib/mcp/client", () => ({
  ensureMcpClientsInitialized: runtimeMocks.ensureMcpClientsInitialized,
  getMcpClientTools: vi.fn().mockReturnValue([]),
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
  recordAgentRunSwarm: runJournalMocks.recordAgentRunSwarm,
  recordAgentRunToolCall: runJournalMocks.recordAgentRunToolCall,
  recordAgentRunToolResult: runJournalMocks.recordAgentRunToolResult,
  countDelegationDepth: runJournalMocks.countDelegationDepth,
  getDelegationChain: runJournalMocks.getDelegationChain,
}));

import { executeAgentConversation } from "@/lib/agent/executor";

describe("agent executor explicit memory", () => {
  beforeEach(() => {
    process.env.BIZBOT_PLUGIN_ORACLE_ENABLED = "true";
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
    runJournalMocks.recordAgentRunSwarm.mockReturnValue({ runId: "run-1", swarm: { activated: true } });
    runJournalMocks.recordAgentRunRoundUsage.mockImplementation((_runId, params) => ({
      usage: {
        promptTokens: params.promptTokens,
        completionTokens: params.completionTokens,
        totalTokens: params.totalTokens,
        cachedPromptTokens: params.cachedPromptTokens,
        rounds: Array.from({ length: params.round }, (_, index) => ({ round: index + 1 })),
      },
    }));
    runJournalMocks.countDelegationDepth.mockReturnValue(0);
    runJournalMocks.getDelegationChain.mockReturnValue(["content_operator"]);
  });

  afterEach(() => {
    delete process.env.BIZBOT_PLUGIN_ORACLE_ENABLED;
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

  it("injects a canonical BizBot capabilities block for self-description prompts", async () => {
    await executeAgentConversation({
      message: "What are your core features, especially Builder?",
      forcedProfile: "general_operator",
    });

    const systemPrompt = kernelMocks.chatComplete.mock.calls[0][0][0].content as string;
    expect(systemPrompt).toContain("[BizBot Capabilities]");
    expect(systemPrompt).toContain("Builder Mode for dedicated external-workspace project creation");
    expect(systemPrompt).toContain("present Builder as a first-class product surface");
    expect(runJournalMocks.recordAgentRunPromptAssembly).toHaveBeenCalledWith("run-1", expect.objectContaining({
      promptAssembly: expect.objectContaining({
        capabilitySummaryChars: expect.any(Number),
      }),
    }));
  });

  it("does not inject the BizBot capabilities block for ordinary task prompts", async () => {
    await executeAgentConversation({
      message: "Draft a reply",
      forcedProfile: "general_operator",
    });

    const systemPrompt = kernelMocks.chatComplete.mock.calls[0][0][0].content as string;
    expect(systemPrompt).not.toContain("[BizBot Capabilities]");
  });

  it("activates the internal swarm path for multi-source synthesis requests", async () => {
    memoryMocks.buildContextForPrompt.mockResolvedValue({
      text: [
        "Earlier conversation summary:\n- User shared launch notes.",
        "Recent conversation:\nUSER: summarize these materials.",
        "Semantic recall:\n- Audience prefers concise launch announcements.",
        "Knowledge documents:\n- Product launch happens next Tuesday.",
      ].join("\n\n"),
      blocks: {
        conversationSummary: "Earlier conversation summary:\n- User shared launch notes.",
        recentConversation: "USER: summarize these materials.",
        semanticRecall: "- Audience prefers concise launch announcements.",
        graph: "",
        knowledgeDocs: "- Product launch happens next Tuesday.",
      },
      retrieval: {
        conversationSummary: { included: true, reason: "continuation", resultCount: 1, chars: 55 },
        recentConversation: { included: true, reason: "recent", resultCount: 1, chars: 31 },
        semanticRecall: { included: true, reason: "relevant", resultCount: 1, chars: 48 },
        graph: { included: false, reason: "not needed", resultCount: 0, chars: 0 },
        knowledgeDocs: { included: true, reason: "relevant", resultCount: 1, chars: 39 },
      },
    });

    const events: Array<{ type: string }> = [];

    await executeAgentConversation({
      message: "Summarize these sources into one grounded launch brief.",
      forcedProfile: "content_operator",
      onEvent: async (event) => {
        events.push({ type: event.type });
      },
    });

    expect(runJournalMocks.recordAgentRunSwarm).toHaveBeenCalledWith("run-1", expect.objectContaining({
      activated: true,
      mode: "core_chat_swarm",
    }));
    expect(pluginMocks.executeTool).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "swarm_plan")).toBe(true);
    expect(events.some((event) => event.type === "swarm_validation")).toBe(true);
    expect(kernelMocks.chatComplete).toHaveBeenCalledTimes(1);
  });

  it("injects a runtime tool visibility block for plugin inspection prompts", async () => {
    pluginMocks.getAllToolDefinitions.mockReturnValue([
      { name: "crm_list_contacts", description: "", parameters: { type: "object", properties: {} } },
      { name: "memory_get_facts", description: "", parameters: { type: "object", properties: {} } },
      { name: "social_create_post", description: "", parameters: { type: "object", properties: {} } },
    ]);

    await executeAgentConversation({
      message: "What tools do you have available right now?",
      forcedProfile: "general_operator",
    });

    const systemPrompt = kernelMocks.chatComplete.mock.calls[0][0][0].content as string;
    expect(systemPrompt).toContain("[Runtime Tool Visibility]");
    expect(systemPrompt).toContain("Current lane: general_operator");
    expect(systemPrompt).toContain("crm: 1 visible tool");
    expect(systemPrompt).toContain("memory: 1 visible tool");
    expect(systemPrompt).toContain("social: 1 visible tool");
    expect(systemPrompt).toContain("builder workspace: not directly visible in this lane; reachable through delegation to builder_operator");
    expect(runJournalMocks.recordAgentRunPromptAssembly).toHaveBeenCalledWith("run-1", expect.objectContaining({
      promptAssembly: expect.objectContaining({
        runtimeToolVisibilityChars: expect.any(Number),
      }),
    }));
  });

  it("does not inject the runtime tool visibility block for ordinary prompts", async () => {
    pluginMocks.getAllToolDefinitions.mockReturnValue([
      { name: "crm_list_contacts", description: "", parameters: { type: "object", properties: {} } },
    ]);

    await executeAgentConversation({
      message: "Draft a reply",
      forcedProfile: "general_operator",
    });

    const systemPrompt = kernelMocks.chatComplete.mock.calls[0][0][0].content as string;
    expect(systemPrompt).not.toContain("[Runtime Tool Visibility]");
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

  it("emits preflight status checkpoints before model execution starts", async () => {
    const events: Array<{ type: string; [key: string]: unknown }> = [];

    await executeAgentConversation({
      message: "Draft a reply",
      forcedProfile: "content_operator",
      onEvent: async (event) => {
        events.push(event as { type: string; [key: string]: unknown });
      },
    });

    const statusMessages = events
      .filter((event) => event.type === "status")
      .map((event) => String(event.message));

    expect(statusMessages).toContain("Preparing agent conversation state.");
    expect(statusMessages).toContain("Initializing MCP clients.");
    expect(statusMessages).toContain("Loading explicit memory facts.");
    expect(statusMessages).toContain("Building prompt context.");
    expect(statusMessages).toContain("Loading ontology context.");
    expect(statusMessages).toContain("Creating agent run journal with 0 available tools.");
    expect(statusMessages).toContain("Agent run run-1 created.");
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

  it("runs a deterministic Oracle verdict flow when explicitly requested", async () => {
    pluginMocks.executeTool.mockResolvedValueOnce({
      target: { canonicalQuestion: "Will BTC trade over 150k by 2026-12-31?" },
      personality: "balanced",
      personalityLabel: "Balanced",
      evidenceMode: "adjacent_inference",
      impliedProbability: 0.34,
      confidence: "medium",
      sentiment: "bearish",
      exactMatch: null,
      adjacentMatches: [{ question: "Will Bitcoin hit 150k by Dec 31 2026?" }],
      summaryPacket: "Oracle personality: Balanced\nCanonical target: Will BTC trade over 150k by 2026-12-31?\nEvidence mode: adjacent_inference\nImplied probability: 34.0%",
      fallbackReply: "Oracle is inferring from adjacent Polymarket markets for this target.",
      webResearch: [],
      trendSignals: [],
      swarmTrace: { planId: "plan-1", durationMs: 500, workerCount: 3, completedCount: 3, failedCount: 0 },
    });
    kernelMocks.chatComplete.mockResolvedValueOnce({
      content: "Oracle sees BTC over 150k this year as a low-probability upside case based on adjacent Polymarket odds. Implied probability is about 34%, with medium confidence.",
      toolCalls: [],
      provider: "ollama",
      model: "model-1",
      metadata: undefined,
      usage: {
        promptTokens: 90,
        completionTokens: 28,
        totalTokens: 118,
        cachedPromptTokens: 0,
      },
    });

    const events: Array<{ type: string; [key: string]: unknown }> = [];
    const result = await executeAgentConversation({
      message: "oracle predict btc 150k",
      oraclePrediction: true,
      onEvent: async (event) => {
        events.push(event as { type: string; [key: string]: unknown });
      },
    });

    expect(pluginMocks.executeTool).toHaveBeenNthCalledWith(1, "oracle_analyze_prediction", {
      prompt: "oracle predict btc 150k",
      limit: 12,
    }, expect.any(Object));
    expect(kernelMocks.chatComplete).toHaveBeenCalledTimes(1);
    expect(result.profile).toBe("research_operator");
    expect(result.reply).toContain("low-probability upside case");
    expect(events.some((event) => event.type === "tool_call" && event.name === "oracle_analyze_prediction")).toBe(true);
    expect(events.some((event) => event.type === "usage" && event.totalTokens === 118)).toBe(true);
  });

  it("still produces a themed Oracle prediction when no active market match exists", async () => {
    pluginMocks.executeTool.mockResolvedValueOnce({
      target: { canonicalQuestion: "Will BTC trade over 150k by 2026-12-31?" },
      personality: "balanced",
      personalityLabel: "Balanced",
      evidenceMode: "no_useful_match",
      impliedProbability: 0.18,
      confidence: "low",
      sentiment: "bearish",
      exactMatch: null,
      adjacentMatches: [],
      summaryPacket: "Oracle personality: Balanced\nCanonical target: Will BTC trade over 150k by 2026-12-31?\nEvidence mode: no_useful_match\nImplied probability: 18.0%\nMarket sentiment: bearish",
      fallbackReply: "Oracle sees no active Polymarket support for Will BTC trade over 150k by 2026-12-31?. Balanced mode treats that absence as a weak negative signal against the target. Implied probability: 18.0%. Confidence: low.",
      webResearch: [{ query: "BTC 150k prediction", title: "BTC Analysis", url: "https://example.com", snippet: "Analysts remain cautious" }],
      trendSignals: [{ query: "BTC 150k", trendDirection: "declining", interestLevel: "low", excerpt: "Search interest declining" }],
      swarmTrace: { planId: "plan-2", durationMs: 800, workerCount: 4, completedCount: 3, failedCount: 1 },
    });
    kernelMocks.chatComplete.mockResolvedValueOnce({
      content: "Oracle sees BTC over 150k this year as unlikely on current market support. There is no active Polymarket backing for that target, which Oracle treats as a weak negative signal. Implied probability is about 18%, with low confidence.",
      toolCalls: [],
      provider: "ollama",
      model: "model-1",
      metadata: undefined,
      usage: {
        promptTokens: 82,
        completionTokens: 31,
        totalTokens: 113,
        cachedPromptTokens: 0,
      },
    });

    const events: Array<{ type: string; [key: string]: unknown }> = [];
    const result = await executeAgentConversation({
      message: "oracle predict btc over 150k this year",
      oraclePrediction: true,
      onEvent: async (event) => {
        events.push(event as { type: string; [key: string]: unknown });
      },
    });

    expect(kernelMocks.chatComplete).toHaveBeenCalledTimes(1);
    expect(result.reply).toContain("weak negative signal");
    expect(events.some((event) => event.type === "status" && String(event.message).includes("no active matching market support"))).toBe(true);
  });

  it("skips the forced Oracle verdict path for conversational follow-ups but keeps Oracle tools available", async () => {
    const events: Array<{ type: string; [key: string]: unknown }> = [];

    await executeAgentConversation({
      message: "are you sure?",
      mode: "agent",
      pluginId: "oracle",
      onEvent: async (event) => {
        events.push(event as { type: string; [key: string]: unknown });
      },
    });

    // The forced deterministic Oracle verdict should NOT have run — executeTool
    // is only called inside the forced path, so it should not have been invoked
    // directly by the executor.  The model may still choose to call Oracle tools
    // via the normal agent loop, but the executor itself must not force them.
    const forcedOracleStatus = events.find(
      (event) => event.type === "status" && String(event.message).includes("Oracle is resolving a market target"),
    );
    expect(forcedOracleStatus).toBeUndefined();

    // Oracle tools should still be available (plugin controls tool visibility)
    expect(pluginMocks.getAllToolDefinitions).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      chatMode: "agent",
      chatPluginId: "oracle",
    }));
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

  it("emits a structured sidecar event alongside the regular tool result", async () => {
    pluginMocks.getAllToolDefinitions.mockReturnValue([
      {
        name: "sidecar_open",
        description: "Open the sidecar.",
        parameters: { type: "object", properties: {} },
      },
    ]);
    kernelMocks.chatComplete
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [
          {
            id: "tool-1",
            name: "sidecar_open",
            arguments: {
              title: "Launch brief",
              content: { type: "markdown", markdown: "# Launch" },
            },
          },
        ],
        provider: "ollama",
        model: "model-1",
        metadata: undefined,
        usage: undefined,
      })
      .mockResolvedValueOnce({
        content: "reply",
        toolCalls: [],
        provider: "ollama",
        model: "model-1",
        metadata: undefined,
        usage: undefined,
      });
    pluginMocks.executeTool.mockResolvedValue({
      ok: true,
      action: "open",
      panel: {
        panelId: "launch-brief",
        title: "Launch brief",
        content: { type: "markdown", markdown: "# Launch" },
      },
    });

    const events: Array<{ type: string; [key: string]: unknown }> = [];

    await executeAgentConversation({
      message: "Open sidecar",
      forcedProfile: "content_operator",
      onEvent: (event) => {
        events.push(event as { type: string; [key: string]: unknown });
      },
    });

    const sidecarEvent = events.find((event) => event.type === "sidecar");
    const toolResultEvent = events.find((event) => event.type === "tool_result");

    expect(sidecarEvent).toEqual(expect.objectContaining({
      type: "sidecar",
      action: "open",
      runId: "run-1",
      conversationId: "conversation-1",
      round: 1,
      toolCallId: "tool-1",
      name: "sidecar_open",
      panel: {
        panelId: "launch-brief",
        title: "Launch brief",
        content: { type: "markdown", markdown: "# Launch" },
      },
    }));
    expect(toolResultEvent).toEqual(expect.objectContaining({
      type: "tool_result",
      round: 1,
      toolCallId: "tool-1",
      name: "sidecar_open",
      result: expect.any(String),
    }));
    expect(toolResultEvent).not.toHaveProperty("action");
    expect(toolResultEvent).not.toHaveProperty("panel");
  });
});