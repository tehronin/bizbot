import { describe, expect, it } from "vitest";
import { lintPlugin, lintSchema, lintToolDefinition, lintToolName } from "@/lib/agent/plugins/lint";
import type { InspectablePluginShape } from "@/lib/agent/plugins/inspection";

describe("plugin lint", () => {
  it("reports missing plugin metadata and empty tool lists", () => {
    const plugin: InspectablePluginShape = {
      sourceType: "source-file",
      sourceLabel: "fixture.ts",
      metadata: {},
      tools: [],
    };

    const result = lintPlugin(plugin);

    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "plugin-id-missing" }),
      expect.objectContaining({ code: "plugin-description-missing" }),
      expect.objectContaining({ code: "plugin-tools-empty" }),
    ]));
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "plugin-display-name-missing" }),
    ]));
  });

  it("warns on weak schemas and vague tool naming", () => {
    const tool = {
      name: "get_data",
      description: "Do it.",
      parameters: {
        type: "object" as const,
        properties: {
          id: { type: "string" as const },
        },
      },
    };

    const toolLint = lintToolDefinition(tool, "fixture-plugin");
    const schemaLint = lintSchema(tool.parameters);
    const namingLint = lintToolName(tool.name, "fixture-plugin");

    expect(toolLint.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "tool-name-prefix-mismatch" }),
      expect.objectContaining({ code: "tool-description-weak" }),
      expect.objectContaining({ code: "schema-open-shape" }),
    ]));
    expect(schemaLint).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "schema-open-shape" }),
    ]));
    expect(namingLint).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "tool-name-verb-namespace" }),
    ]));
  });
});