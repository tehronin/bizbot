import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_USER_ID } from "@/lib/agent/user-context";

const semanticMocks = vi.hoisted(() => ({
  remember: vi.fn(),
  recall: vi.fn(),
}));

const serviceMocks = vi.hoisted(() => ({
  getActiveMemoryFacts: vi.fn(),
  setMemoryFact: vi.fn(),
  forgetMemoryFact: vi.fn(),
}));

vi.mock("@/lib/agent/memory", () => ({
  remember: semanticMocks.remember,
  recall: semanticMocks.recall,
}));

vi.mock("@/lib/agent/memory/service", () => ({
  getActiveMemoryFacts: serviceMocks.getActiveMemoryFacts,
  setMemoryFact: serviceMocks.setMemoryFact,
  forgetMemoryFact: serviceMocks.forgetMemoryFact,
}));

import { memoryPlugin } from "@/lib/agent/plugins/MemoryPlugin";

function requireTool(name: string) {
  const tool = memoryPlugin.tools.find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

describe("memory plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves semantic remember and recall behavior with user-aware context", async () => {
    semanticMocks.recall.mockResolvedValue([{ key: "timezone", value: "America/Chicago", category: "preference" }]);

    const rememberTool = requireTool("memory_remember");
    const recallTool = requireTool("memory_recall");

    await expect(rememberTool.execute({ key: "timezone", value: "America/Chicago" }, { userId: "user-1" }))
      .resolves.toEqual({ stored: true, key: "timezone", value: "America/Chicago" });
    await expect(recallTool.execute({ query: "timezone" }, { userId: "user-1" }))
      .resolves.toEqual({ memories: [{ key: "timezone", value: "America/Chicago", category: "preference" }] });

    expect(semanticMocks.remember).toHaveBeenCalledWith("timezone", "America/Chicago", "general", "user-1");
    expect(semanticMocks.recall).toHaveBeenCalledWith("timezone", 5, "user-1");
  });

  it("reads explicit facts for the current context user", async () => {
    serviceMocks.getActiveMemoryFacts.mockResolvedValue([{ key: "preferred_name", value: "Sam", category: "identity" }]);

    const tool = requireTool("memory_get_facts");
    const result = await tool.execute({ categories: ["identity"] }, { userId: "user-1" });

    expect(serviceMocks.getActiveMemoryFacts).toHaveBeenCalledWith({
      userId: "user-1",
      categories: ["identity"],
      keys: undefined,
    });
    expect(result).toEqual({ facts: [{ key: "preferred_name", value: "Sam", category: "identity" }] });
  });

  it("stores structured explicit facts", async () => {
    serviceMocks.setMemoryFact.mockResolvedValue({
      key: "review_reply_workflow",
      value: { tone: "calm", length: "short" },
      category: "workflow",
    });

    const tool = requireTool("memory_set_fact");
    const result = await tool.execute({
      category: "workflow",
      key: "review_reply_workflow",
      value: { tone: "calm", length: "short" },
    }, { userId: "user-1" });

    expect(serviceMocks.setMemoryFact).toHaveBeenCalledWith({
      userId: "user-1",
      category: "workflow",
      key: "review_reply_workflow",
      value: { tone: "calm", length: "short" },
      source: "user",
    });
    expect(result).toEqual({
      fact: {
        key: "review_reply_workflow",
        value: { tone: "calm", length: "short" },
        category: "workflow",
      },
    });
  });

  it("forgets explicit facts and falls back safely when userId is missing", async () => {
    serviceMocks.getActiveMemoryFacts.mockResolvedValue([]);
    serviceMocks.forgetMemoryFact.mockResolvedValue({ count: 1, key: "timezone" });

    const getTool = requireTool("memory_get_facts");
    const forgetTool = requireTool("memory_forget_fact");

    await getTool.execute({}, {});
    const result = await forgetTool.execute({ key: "timezone" }, {});

    expect(serviceMocks.getActiveMemoryFacts).toHaveBeenCalledWith({
      userId: DEFAULT_AGENT_USER_ID,
      categories: undefined,
      keys: undefined,
    });
    expect(serviceMocks.forgetMemoryFact).toHaveBeenCalledWith({
      userId: DEFAULT_AGENT_USER_ID,
      key: "timezone",
    });
    expect(result).toEqual({ forgotten: { count: 1, key: "timezone" } });
  });
});