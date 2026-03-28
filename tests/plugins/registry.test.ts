import { describe, expect, it } from "vitest";
import { createBizBotPlugin, createPluginRegistry, getBuiltinPlugins } from "@/lib/agent/plugins";
import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";
import { createFixturePlugin } from "../fixtures/plugin-fixtures";

describe("plugin registry", () => {
  it("exposes builtin plugins with metadata", () => {
    const plugins = getBuiltinPlugins();

    expect(plugins.length).toBeGreaterThan(5);
    expect(plugins.every((plugin) => plugin.metadata.id.length > 0)).toBe(true);
    expect(plugins.every((plugin) => plugin.tools.length > 0)).toBe(true);
  });

  it("rejects duplicate plugin ids", () => {
    const first = createFixturePlugin("duplicate-plugin");
    const second = createFixturePlugin("duplicate-plugin");

    expect(() => createPluginRegistry([first, second])).toThrow("Duplicate plugin id: duplicate-plugin");
  });

  it("rejects duplicate tool names across plugins", () => {
    const sharedTool = registerTool(defineTool({
      name: "shared_tool",
      description: "Shared fixture tool.",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ ok: true }),
    } satisfies ToolDefinition<Record<string, never>, { ok: boolean }>));

    const first = createBizBotPlugin({
      metadata: { id: "first", displayName: "First", description: "First fixture plugin." },
      tools: [sharedTool],
    });
    const second = createBizBotPlugin({
      metadata: { id: "second", displayName: "Second", description: "Second fixture plugin." },
      tools: [sharedTool],
    });

    expect(() => createPluginRegistry([first, second])).toThrow("Duplicate tool name: shared_tool");
  });
});