import { describe, expect, it } from "vitest";
import { createBizBotPlugin } from "@/lib/agent/plugins";
import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";
import {
  analyzeToolNaming,
  explainRegistryConflict,
  inspectPluginDefinition,
  inspectPluginRegistry,
  type ImportedToolOrigin,
} from "@/lib/agent/plugins/inspection";

const fixturePlugin = createBizBotPlugin({
  metadata: {
    id: "fixture-plugin",
    displayName: "Fixture Plugin",
    description: "Fixture plugin used to verify registry inspection behavior.",
  },
  tools: [
    registerTool(defineTool({
      name: "fixture_plugin_ping",
      description: "Fixture ping tool for registry inspection coverage.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => ({ ok: true }),
    } satisfies ToolDefinition<Record<string, never>, { ok: boolean }>)),
  ],
});

describe("plugin inspection", () => {
  it("builds a registry report with builtin and imported provenance", () => {
    const importedTools: ImportedToolOrigin[] = [{
      prefixedName: "mcp_remote_fixture_plugin_ping",
      originalName: "fixture_plugin_ping",
      serverName: "remote",
      description: "Remote fixture ping tool.",
    }];

    const report = inspectPluginRegistry({
      plugins: [fixturePlugin],
      importedTools,
    });

    expect(report.summary).toEqual({
      pluginCount: 1,
      builtinToolCount: 1,
      importedToolCount: 1,
    });
    expect(report.toolOwnership).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toolName: "fixture_plugin_ping",
        ownerKind: "builtin-plugin",
        ownerId: "fixture-plugin",
      }),
      expect.objectContaining({
        toolName: "mcp_remote_fixture_plugin_ping",
        ownerKind: "imported-mcp",
        ownerId: "remote",
        originalName: "fixture_plugin_ping",
      }),
    ]));
    expect(report.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "registry-imported-overlap" }),
    ]));
  });

  it("flags duplicate plugin ids before registration", () => {
    const inspected = inspectPluginDefinition(fixturePlugin, {
      existingPlugins: [fixturePlugin],
    });

    expect(inspected.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "plugin-id-duplicate" }),
    ]));
  });

  it("inspects plugin exposure, naming, and conflicts before registration", () => {
    const inspected = inspectPluginDefinition(fixturePlugin, {
      existingPlugins: [],
      importedTools: [{
        prefixedName: "mcp_remote_fixture_plugin_ping",
        originalName: "fixture_plugin_ping",
        serverName: "remote",
        description: "Remote fixture ping tool.",
      }],
      promptCatalog: [{ name: "debug-runtime", ownerId: "developer" }],
      resourceCatalog: [{ uri: "bizbot://plugins/registry-report", ownerId: "developer" }],
    });

    expect(inspected.plugin.metadata.id).toBe("fixture-plugin");
    expect(inspected.exposure.tools).toEqual(["fixture_plugin_ping"]);
    expect(inspected.exposure.prompts).toEqual([]);
    expect(inspected.exposure.resources).toEqual([]);
    expect(inspected.exposure.notes).toEqual(expect.arrayContaining([
      expect.stringContaining("tools/list"),
      expect.stringContaining("Prompts remain server-owned"),
      expect.stringContaining("Resources remain server-owned"),
    ]));
    expect(inspected.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "plugin-tool-imported-overlap" }),
    ]));
  });

  it("analyzes naming and explains conflicts", () => {
    const naming = analyzeToolNaming("get_data", "fixture-plugin");
    const report = inspectPluginRegistry({ plugins: [fixturePlugin] });
    const explanation = explainRegistryConflict(report, "fixture_plugin_ping");

    expect(naming.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "tool-name-verb-namespace" }),
      expect.objectContaining({ code: "tool-name-generic" }),
    ]));
    expect(explanation.owners).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: "fixture_plugin_ping", ownerId: "fixture-plugin" }),
    ]));
    expect(explanation.strategies).toEqual(expect.arrayContaining([
      expect.stringContaining("Rename the plugin or tool"),
    ]));
  });
});