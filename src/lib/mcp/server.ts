/**
 * MCP Server — Exposes BizBot's agent tools, resources, and prompts
 * over the Model Context Protocol so external agents (Claude Desktop,
 * VS Code Copilot, Cursor, etc.) can interact with the app.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DEFAULT_AGENT_USER_ID } from "@/lib/agent/user-context";
import { getAllToolDefinitions, executeTool } from "@/lib/agent/plugins";
import { getActiveProvider } from "@/lib/agent/kernel";
import { getAgentRuntimeConfig, getAutonomyDescription } from "@/lib/agent/runtime";
import type { JsonObject, ToolParametersSchema, ToolPropertySchema } from "@/lib/agent/tools";
import { buildBizBotMcpCapabilities, resolveBizBotMcpServerOptions, type BizBotMcpServerOptions } from "@/lib/mcp/policy";
import { listBizBotPromptDefinitions, listBizBotResourceDefinitions } from "@/lib/mcp/preview-catalog";
import { BIZBOT_PLATFORM_CONTRACT_VERSION } from "@/lib/platform/contract";
import { getToolAnnotations, getToolDescription, getToolTitle, MCP_AGENT_PROFILE, MCP_BLOCKED_TOOLS } from "@/lib/mcp/tool-presentation";
import { z } from "zod/v4";

const MAX_MCP_RESULT_CHARS = 8_000;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n…[truncated ${text.length - max} chars]`;
}

function propertySchemaToZod(schema: ToolPropertySchema): z.ZodTypeAny {
  switch (schema.type) {
    case "string": {
      if (schema.enum?.length) {
        return z.enum(schema.enum as [string, ...string[]]);
      }
      return z.string();
    }
    case "number":
      return z.number().finite();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(schema.items ? propertySchemaToZod(schema.items) : z.unknown());
    case "json":
      return z.unknown();
    case "object": {
      const shape: Record<string, z.ZodTypeAny> = {};
      const properties = schema.properties ?? {};
      const required = new Set(Array.isArray(schema.required) ? schema.required : []);

      for (const [key, nestedSchema] of Object.entries(properties)) {
        if (!nestedSchema) {
          continue;
        }

        let nested = propertySchemaToZod(nestedSchema);
        if (nestedSchema.default !== undefined) {
          nested = nested.default(nestedSchema.default);
        }
        if (!required.has(key) && nestedSchema.default === undefined) {
          nested = nested.optional();
        }
        shape[key] = nested;
      }

      const objectSchema = z.object(shape);
      return schema.additionalProperties === false ? objectSchema.strict() : objectSchema.passthrough();
    }
  }
}

function parametersSchemaToZod(schema: ToolParametersSchema): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);

  for (const [key, propertySchema] of Object.entries(schema.properties)) {
    if (!propertySchema) {
      continue;
    }

    let property = propertySchemaToZod(propertySchema);
    if (propertySchema.default !== undefined) {
      property = property.default(propertySchema.default);
    }
    if (!required.has(key) && propertySchema.default === undefined) {
      property = property.optional();
    }
    shape[key] = property;
  }

  const objectSchema = z.object(shape);
  return schema.additionalProperties === false ? objectSchema.strict() : objectSchema.passthrough();
}

function buildToolResponse(result: unknown) {
  const text = truncate(
    typeof result === "string" ? result : JSON.stringify(result),
    MAX_MCP_RESULT_CHARS,
  );

  if (typeof result === "object" && result !== null && !Array.isArray(result)) {
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: result as JsonObject,
    };
  }

  return {
    content: [{ type: "text" as const, text }],
    structuredContent: { result: text },
  };
}

/**
 * Creates a fresh McpServer with all BizBot tools, resources, and prompts
 * registered. Returns a new instance each time (needed for stateless HTTP).
 */
export function createBizBotMcpServer(options?: BizBotMcpServerOptions): McpServer {
  const resolvedOptions = resolveBizBotMcpServerOptions(options);
  const config = getAgentRuntimeConfig();

  const server = new McpServer(
    { name: "bizbot", version: "0.1.0" },
    {
      capabilities: buildBizBotMcpCapabilities(resolvedOptions),
      instructions: [
        "BizBot is a local-first social media agent.",
        `Platform contract: ${BIZBOT_PLATFORM_CONTRACT_VERSION}.`,
        `Autonomy: ${config.autonomyPreset}. ${getAutonomyDescription(config)}`,
        `MCP tool execution is bounded to the ${MCP_AGENT_PROFILE} lane for control-plane safety.`,
        "When debugging, inspect BizBot debug resources before mutating tools.",
        "Tools prefixed with social_ interact with live social platforms.",
        "Tools prefixed with approval_ manage the human review queue.",
        "Tools prefixed with memory_ store and recall long-term knowledge.",
        "Tools prefixed with builder_ operate only inside a dedicated external builder workspace and require explicit command allowlisting.",
        "Tools prefixed with creeper_ manage company profiles, bounded data-source inspection, ingestion planning, and retrieval-grounding setup.",
        "Tools prefixed with browser_ navigate the web via Playwright.",
        "Tools prefixed with sidecar_ inspect and drive BizBot's transient Sidecar panel and stack. They are UI-only and do not write database, memory, or filesystem state.",
      ].join(" "),
    },
  );

  const tools = getAllToolDefinitions(config, { agentProfile: MCP_AGENT_PROFILE })
    .filter((tool) => !MCP_BLOCKED_TOOLS.has(tool.name));

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: getToolTitle(tool.name),
        description: getToolDescription(tool.name, tool.description),
        inputSchema: parametersSchemaToZod(tool.parameters),
        annotations: getToolAnnotations(tool.name),
      },
      async (args) => {
        try {
          const result = await executeTool(tool.name, args as JsonObject, {
            config,
            access: {
              agentProfile: MCP_AGENT_PROFILE,
              userId: DEFAULT_AGENT_USER_ID,
              provider: getActiveProvider(),
              mcpSamplingSession: {
                transportKind: resolvedOptions.transportKind,
                createMessage: server.server.createMessage.bind(server.server),
                getClientCapabilities: server.server.getClientCapabilities.bind(server.server),
              },
            },
          });
          return buildToolResponse(result);
        } catch (error) {
          return {
            content: [{ type: "text" as const, text: String(error) }],
            isError: true,
          };
        }
      },
    );
  }

  // ── Resources ────────────────────────────────────────────────────
  for (const resource of listBizBotResourceDefinitions()) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        title: resource.title,
        description: resource.description,
        mimeType: resource.mimeType,
      },
      async () => ({
        contents: [
          {
            uri: resource.uri,
            text: JSON.stringify(await resource.read(), null, 2),
            mimeType: resource.mimeType,
          },
        ],
      }),
    );
  }

  // ── Prompts ──────────────────────────────────────────────────────
  for (const prompt of listBizBotPromptDefinitions()) {
    const argsSchema = Object.fromEntries(prompt.arguments.map((argument) => [argument.name, argument.required ? z.string() : z.string().optional()]));

    server.registerPrompt(
      prompt.name,
      {
        title: prompt.title,
        description: prompt.description,
        argsSchema,
      },
      (args: Record<string, string | undefined>) => ({
        messages: prompt.render(args).messages.map((message) => ({
          role: message.role,
          content: {
            type: "text" as const,
            text: message.text,
          },
        })),
      }),
    );
  }

  return server;
}
