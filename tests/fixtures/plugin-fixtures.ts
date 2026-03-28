import { createBizBotPlugin } from "@/lib/agent/plugins";
import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";

interface ExternalProviderFetchArgs {
  resourceId: string;
  includeHistory?: boolean;
}

export function createFixturePlugin(id = "fixture-plugin") {
  return createBizBotPlugin({
    metadata: {
      id,
      displayName: "Fixture Plugin",
      description: "Minimal fixture plugin for contract and registry tests.",
      tags: ["test"],
    },
    tools: [
      registerTool(defineTool({
        name: `${id}_ping`,
        description: "Fixture ping tool.",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ ok: true, id }),
      } satisfies ToolDefinition<Record<string, never>, { ok: boolean; id: string }>)),
    ],
  });
}

export function createExternalProviderFixturePlugin() {
  const calls: Array<{ resourceId: string; includeHistory: boolean }> = [];
  const responses: Record<string, { id: string; name: string; status: string }> = {
    "lead-42": { id: "lead-42", name: "Acme Holdings", status: "active" },
    "deal-7": { id: "deal-7", name: "Expansion Deal", status: "quoted" },
  };

  const plugin = createBizBotPlugin({
    metadata: {
      id: "fixture-provider",
      displayName: "Fixture Provider",
      description: "Provider-style fixture plugin for integration tests.",
      tags: ["test", "provider"],
    },
    tools: [
      registerTool(defineTool({
        name: "fixture_provider_fetch",
        description: "Fetch a provider resource from deterministic fixture data.",
        parameters: {
          type: "object",
          properties: {
            resourceId: { type: "string" },
            includeHistory: { type: "boolean", default: false },
          },
          required: ["resourceId"],
          additionalProperties: false,
        },
        execute: async ({ resourceId, includeHistory }: ExternalProviderFetchArgs) => {
          calls.push({ resourceId, includeHistory: includeHistory ?? false });
          return {
            provider: "fixture-provider",
            record: responses[resourceId] ?? { id: resourceId, name: "Unknown", status: "missing" },
            historyIncluded: includeHistory ?? false,
          };
        },
      } satisfies ToolDefinition<ExternalProviderFetchArgs, {
        provider: string;
        record: { id: string; name: string; status: string };
        historyIncluded: boolean;
      }>)),
    ],
  });

  return { plugin, calls, responses };
}