import { describe, expect, it } from "vitest";
import { developerPlugin } from "@/lib/agent/plugins/DeveloperPlugin";

function asObjectResult<T extends object>(value: unknown): T {
  return value as T;
}

function requireTool(name: string) {
  const tool = developerPlugin.tools.find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

describe("developer plugin dev loop", () => {
  it("inspects the registry and previews MCP-facing descriptors", async () => {
    const registryTool = requireTool("developer_inspect_plugin_registry");
    const previewTool = requireTool("developer_preview_tool_descriptor");

    const registryResult = await registryTool.execute({}, {});
    const descriptorResult = await previewTool.execute({ toolName: "developer_inspect_plugin_registry" }, {});

    expect(registryResult).toEqual({
      registry: expect.objectContaining({
        generatedAt: expect.any(String),
        plugins: expect.arrayContaining([
          expect.objectContaining({ id: "developer" }),
          expect.objectContaining({ id: "memory" }),
        ]),
        toolOwnership: expect.arrayContaining([
          expect.objectContaining({ toolName: "developer_inspect_plugin_registry", ownerId: "developer" }),
        ]),
      }),
    });
    expect(descriptorResult).toEqual({
      descriptor: expect.objectContaining({
        name: "developer_inspect_plugin_registry",
        ownerId: "developer",
        title: expect.any(String),
        description: expect.stringContaining("Inspect the builtin plugin registry"),
      }),
    });
  });

  it("previews prompts and resources for plugin authors", async () => {
    const promptTool = requireTool("developer_preview_prompt");
    const resourceTool = requireTool("developer_preview_resource");

    const promptResult = asObjectResult<{
      prompt: { name: string; ownerId: string };
      rendered: { messages: Array<{ text: string }> };
    }>(await promptTool.execute({ promptName: "inspect-agent-run", args: { runId: "run-123" } }, {}));
    const resourceResult = asObjectResult<{
      resource: { uri: string; ownerId: string };
      sample: { generatedAt: string; prefixes: string[] };
    }>(await resourceTool.execute({ resource: "bizbot://plugins/naming-rules" }, {}));

    expect(promptResult.prompt).toEqual(expect.objectContaining({
      name: "inspect-agent-run",
      ownerId: "developer",
    }));
    expect(promptResult.rendered.messages[0]?.text).toContain("run-123");
    expect(resourceResult).toEqual({
      resource: expect.objectContaining({
        uri: "bizbot://plugins/naming-rules",
        ownerId: "developer",
      }),
      sample: expect.objectContaining({
        generatedAt: expect.any(String),
        prefixes: expect.arrayContaining(["developer_", "memory_", "builder_"]),
      }),
    });
  });

  it("explains contract impact, naming guidance, plans, and schema suggestions", async () => {
    const contractTool = requireTool("developer_check_mcp_contract_impact");
    const namingTool = requireTool("developer_check_tool_naming");
    const planTool = requireTool("developer_plan_plugin");
    const schemaTool = requireTool("developer_suggest_tool_schemas");

    const contractResult = asObjectResult<{
      plugin: { id: string };
      impact: { addedTools: string[]; promptsChanged: boolean; resourcesChanged: boolean };
      testsToReview: string[];
    }>(await contractTool.execute({ pluginId: "memory" }, {}));
    const namingResult = asObjectResult<{
      analyses: Array<{ analysis?: { issues: Array<{ code: string }> } }>;
    }>(await namingTool.execute({ names: ["get_data", "memory_set_fact"], expectedPrefix: "memory" }, {}));
    const planResult = asObjectResult<{
      plan: { namespacePrefix: string; proposedTools: string[] };
    }>(await planTool.execute({ pluginId: "review-helper", goal: "assist with review moderation", capabilities: ["inspect", "suggest"] }, {}));
    const schemaResult = asObjectResult<{
      suggestions: Array<{ toolName: string; schema: { type: string } }>;
    }>(await schemaTool.execute({ toolNames: ["review_helper_list_items", "review_helper_update_item"] }, {}));

    expect(contractResult).toEqual(expect.objectContaining({
      plugin: expect.objectContaining({ id: "memory" }),
      impact: expect.objectContaining({
        addedTools: expect.arrayContaining(["memory_recall", "memory_get_facts"]),
        promptsChanged: false,
        resourcesChanged: false,
      }),
      testsToReview: expect.arrayContaining(["tests/mcp/contracts.test.ts"]),
    }));
    expect(namingResult.analyses[0]?.analysis?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "tool-name-verb-namespace" }),
    ]));
    expect(planResult.plan).toEqual(expect.objectContaining({
      namespacePrefix: "review_helper",
      proposedTools: ["review_helper_inspect", "review_helper_suggest"],
    }));
    expect(schemaResult.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: "review_helper_list_items", schema: expect.objectContaining({ type: "object" }) }),
      expect.objectContaining({ toolName: "review_helper_update_item", schema: expect.objectContaining({ type: "object" }) }),
    ]));
  });
});