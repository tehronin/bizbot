import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { developerPlugin } from "@/lib/agent/plugins/DeveloperPlugin";

function createTempBuilderWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-developer-devloop-"));
}

function asObjectResult<T extends object>(value: unknown): T {
  return value as T;
}

function requireTool(name: string) {
  const tool = developerPlugin.tools.find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

afterEach(() => {
  delete process.env.BIZBOT_BUILDER_WORKSPACE_PATH;
});

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

  it("supports MCP discovery bundles, search, imported audit, and composite workflow tools", async () => {
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = createTempBuilderWorkspace();

    const searchTools = requireTool("developer_search_tools");
    const searchResources = requireTool("developer_search_resources");
    const searchPrompts = requireTool("developer_search_prompts");
    const getBundle = requireTool("developer_get_tool_bundle");
    const recommend = requireTool("developer_recommend_toolset_for_goal");
    const auditImported = requireTool("developer_audit_imported_mcp_servers");
    const pluginReview = requireTool("developer_prepare_plugin_design_review");
    const builderRepair = requireTool("developer_summarize_builder_repair");
    const importedResourceReader = requireTool("developer_read_imported_mcp_resource");
    const importedPromptGetter = requireTool("developer_get_imported_mcp_prompt");
    const builderLifecycle = requireTool("developer_get_builder_task_lifecycle");
    const builderTaskEvents = requireTool("developer_get_builder_task_events");
    const importedDiff = requireTool("developer_diff_imported_mcp_catalog");
    const traceEvents = requireTool("developer_list_mcp_trace_events");
    const healthInspect = requireTool("developer_inspect_mcp_health");
    const resumeAgentRun = requireTool("developer_resume_agent_run");
    const taskRecipe = requireTool("developer_get_task_recipe");
    const importedToolInvoker = requireTool("developer_invoke_imported_mcp_tool");
    const importedBaselineAccepter = requireTool("developer_accept_imported_mcp_catalog_baseline");

    const toolSearchResult = asObjectResult<{
      matches: Array<{ name: string }>;
    }>(await searchTools.execute({ bundleId: "plugin-authoring", query: "contract" }, {}));
    const resourceSearchResult = asObjectResult<{
      builtinResources: Array<{ uri: string }>;
    }>(await searchResources.execute({ bundleId: "plugin-authoring", query: "naming" }, {}));
    const promptSearchResult = asObjectResult<{
      builtinPrompts: Array<{ name: string }>;
    }>(await searchPrompts.execute({ bundleId: "debug-ops", query: "debug" }, {}));
    const bundleResult = asObjectResult<{
      bundle: { bundleId: string; tools: Array<{ name: string }>; resources: Array<{ uri: string }> };
    }>(await getBundle.execute({ bundleId: "plugin-authoring" }, {}));
    const recommendResult = asObjectResult<{
      primaryBundle: { bundleId: string } | null;
      recommendedFirstTools: Array<{ name: string }>;
    }>(await recommend.execute({ goal: "repair builder drift and identify the next probe" }, {}));
    const auditResult = asObjectResult<{
      summary: { serverCount: number; toolCount: number; promptCount: number; resourceCount: number };
      recommendations: string[];
    }>(await auditImported.execute({}, {}));
    const pluginReviewResult = asObjectResult<{
      plugin: { id: string };
      contractImpact: { testsToReview: string[] };
      nextActions: string[];
    }>(await pluginReview.execute({ pluginId: "memory" }, {}));
    const builderRepairResult = asObjectResult<{
      available: boolean;
      likelyRootCause: string | null;
    }>(await builderRepair.execute({}, {}));
    const builderLifecycleResult = asObjectResult<{
      available: boolean;
      currentTask: unknown;
      tasks: unknown[];
      runs: unknown[];
    }>(await builderLifecycle.execute({}, {}));
    const builderTaskEventsResult = asObjectResult<{
      available: boolean;
      events: unknown[];
    }>(await builderTaskEvents.execute({}, {}));
    const importedDiffResult = asObjectResult<{
      auditState: string;
      summary: { toolChanges: number };
    }>(await importedDiff.execute({}, {}));
    const traceEventsResult = asObjectResult<{
      serverSummaries: unknown[];
      events: unknown[];
    }>(await traceEvents.execute({}, {}));
    const healthInspectResult = asObjectResult<{
      health: { status: string; trace: { persistence: { path: string; version: number } } };
    }>(await healthInspect.execute({}, {}));
    const taskRecipeResult = asObjectResult<{
      recipe: { recipeId: string; recommendedTools: string[] };
    }>(await taskRecipe.execute({ recipeId: "debug-imported-mcp-server" }, {}));

    expect(toolSearchResult.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "developer_check_mcp_contract_impact" }),
    ]));
    expect(resourceSearchResult.builtinResources).toEqual(expect.arrayContaining([
      expect.objectContaining({ uri: "bizbot://plugins/naming-rules" }),
    ]));
    expect(promptSearchResult.builtinPrompts).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "debug-runtime" }),
    ]));
    expect(bundleResult.bundle).toEqual(expect.objectContaining({
      bundleId: "plugin-authoring",
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "developer_prepare_plugin_design_review" }),
      ]),
      resources: expect.arrayContaining([
        expect.objectContaining({ uri: "bizbot://plugins/mcp-surface-preview" }),
      ]),
    }));
    expect(recommendResult.primaryBundle).toEqual(expect.objectContaining({ bundleId: "builder" }));
    expect(recommendResult.recommendedFirstTools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "developer_summarize_builder_repair" }),
    ]));
    expect(auditResult.summary).toEqual(expect.objectContaining({
      serverCount: expect.any(Number),
      toolCount: expect.any(Number),
      promptCount: expect.any(Number),
      resourceCount: expect.any(Number),
    }));
    expect(auditResult.recommendations).toEqual(expect.any(Array));
    expect(pluginReviewResult).toEqual(expect.objectContaining({
      plugin: expect.objectContaining({ id: "memory" }),
      contractImpact: expect.objectContaining({ testsToReview: expect.arrayContaining(["tests/mcp/contracts.test.ts"]) }),
      nextActions: expect.any(Array),
    }));
    expect(builderRepairResult.available).toEqual(expect.any(Boolean));
    expect(builderRepairResult).toHaveProperty("smallestNextFix");
    expect(importedResourceReader.name).toBe("developer_read_imported_mcp_resource");
    expect(importedPromptGetter.name).toBe("developer_get_imported_mcp_prompt");
    expect(importedToolInvoker.name).toBe("developer_invoke_imported_mcp_tool");
    expect(importedBaselineAccepter.name).toBe("developer_accept_imported_mcp_catalog_baseline");
    expect(resumeAgentRun.name).toBe("developer_resume_agent_run");
    expect(builderLifecycleResult).toEqual(expect.objectContaining({
      available: expect.any(Boolean),
      tasks: expect.any(Array),
      runs: expect.any(Array),
    }));
    expect(builderTaskEventsResult).toEqual(expect.objectContaining({
      available: expect.any(Boolean),
      events: expect.any(Array),
    }));
    expect(importedDiffResult).toEqual(expect.objectContaining({
      auditState: expect.any(String),
      summary: expect.objectContaining({ toolChanges: expect.any(Number) }),
    }));
    expect(traceEventsResult).toEqual(expect.objectContaining({
      serverSummaries: expect.any(Array),
      events: expect.any(Array),
    }));
    expect(healthInspectResult).toEqual(expect.objectContaining({
      health: expect.objectContaining({
        status: expect.any(String),
        trace: expect.objectContaining({
          persistence: expect.objectContaining({
            path: expect.any(String),
            version: 1,
          }),
        }),
      }),
    }));
    expect(taskRecipeResult.recipe).toEqual(expect.objectContaining({
      recipeId: "debug-imported-mcp-server",
      recommendedTools: expect.arrayContaining(["developer_diff_imported_mcp_catalog"]),
    }));
    expect("currentTask" in builderLifecycleResult).toBe(true);
  });
});