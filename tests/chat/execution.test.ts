import { beforeEach, describe, expect, it, vi } from "vitest";

const registryMocks = vi.hoisted(() => ({
  getEnabledBuiltinPlugins: vi.fn(),
  createPluginRegistry: vi.fn(),
}));

const mcpMocks = vi.hoisted(() => ({
  getMcpClientTools: vi.fn(),
}));

vi.mock("@/lib/agent/plugins/registry", () => ({
  getEnabledBuiltinPlugins: registryMocks.getEnabledBuiltinPlugins,
  createPluginRegistry: registryMocks.createPluginRegistry,
}));

vi.mock("@/lib/mcp/client", () => ({
  getMcpClientTools: mcpMocks.getMcpClientTools,
}));

import {
  buildChatExecutionCatalog,
  getChatExecutionProfile,
  normalizeChatMessageAttachments,
  resolveChatExecutionSelection,
  resolveChatExecutionToolNames,
} from "@/lib/chat/execution";

describe("chat execution policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    registryMocks.getEnabledBuiltinPlugins.mockReturnValue([
      { metadata: { id: "content" } },
      { metadata: { id: "social" } },
      { metadata: { id: "oracle" } },
    ]);

    mcpMocks.getMcpClientTools.mockReturnValue([]);

    registryMocks.createPluginRegistry.mockReturnValue({
      tools: [
        { name: "content_create_post" },
        { name: "social_create_post" },
        { name: "oracle_analyze_prediction" },
        { name: "memory_get_facts" },
      ],
      toolToPluginId: new Map([
        ["content_create_post", "content"],
        ["social_create_post", "social"],
        ["oracle_analyze_prediction", "oracle"],
        ["memory_get_facts", "memory"],
      ]),
    });
  });

  it("builds a catalog from enabled plugin policies only", () => {
    const catalog = buildChatExecutionCatalog();

    expect(catalog.defaults).toEqual({ mode: "ask", pluginId: "just-chatting" });
    expect(catalog.plugins.map((plugin) => plugin.id)).toEqual([
      "just-chatting",
      "content",
      "social",
      "oracle",
    ]);
  });

  it("falls back to the default selection when the requested plugin is unavailable", () => {
    expect(resolveChatExecutionSelection({ mode: "agent", pluginId: "content" })).toEqual({
      mode: "agent",
      pluginId: "content",
    });

    expect(resolveChatExecutionSelection({ mode: "agent", pluginId: "builder" })).toEqual({
      mode: "agent",
      pluginId: "just-chatting",
    });
  });

  it("maps chat plugins to the intended operator profiles", () => {
    expect(getChatExecutionProfile({ mode: "ask", pluginId: "just-chatting" })).toBe("general_operator");
    expect(getChatExecutionProfile({ mode: "agent", pluginId: "content" })).toBe("content_operator");
    expect(getChatExecutionProfile({ mode: "agent", pluginId: "oracle" })).toBe("research_operator");
  });

  it("limits visible tools to the selected plugin when agent mode allows tool use", () => {
    expect(resolveChatExecutionToolNames({ mode: "ask", pluginId: "content" })).toEqual([]);
    expect(resolveChatExecutionToolNames({ mode: "agent", pluginId: "just-chatting" })).toEqual([]);
    expect(resolveChatExecutionToolNames({ mode: "agent", pluginId: "content" })).toEqual(["content_create_post"]);
    expect(resolveChatExecutionToolNames({ mode: "agent", pluginId: "oracle" })).toEqual(["oracle_analyze_prediction"]);
  });

  it("normalizes only valid knowledge-doc attachments", () => {
    expect(normalizeChatMessageAttachments([
      { type: "knowledge-doc", path: "knowledge/brief.md", label: "brief.md" },
      { type: "knowledge-doc", path: "", label: "missing.md" },
      { type: "other", path: "knowledge/ignored.md", label: "ignored.md" },
      null,
      "bad",
    ])).toEqual([
      { type: "knowledge-doc", path: "knowledge/brief.md", label: "brief.md" },
    ]);
  });
});