/** GraphPlugin — Query and update the Memgraph knowledge graph. */

import { upsertTopic, upsertEntity, linkEntityToTopic, searchGraph, getContextForPost } from "@/lib/graph/queries";
import { defineTool, registerTool, type JsonObject, type ToolDefinition } from "@/lib/agent/tools";

interface TopicArgs {
  name: string;
  description?: string;
}

interface EntityArgs {
  id: string;
  type: string;
  name: string;
  properties?: JsonObject;
}

interface GraphSearchArgs {
  query: string;
  limit?: number;
}

interface ContextArgs {
  topics: string[];
}

export const graphPlugin = {
  tools: [
    registerTool(defineTool({
      name: "graph_upsert_topic",
      description: "Add or update a topic node in the knowledge graph.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
        },
        required: ["name"],
      },
      execute: async ({ name, description }: TopicArgs) => {
        await upsertTopic(name, description);
        return { upserted: true, name };
      },
    } satisfies ToolDefinition<TopicArgs, JsonObject>)),
    registerTool(defineTool({
      name: "graph_upsert_entity",
      description: "Add or update an entity node (person, company, product, etc.).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string", description: "e.g. person, company, product, event" },
          name: { type: "string" },
          properties: { type: "object" },
        },
        required: ["id", "type", "name"],
      },
      execute: async ({ id, type, name, properties }: EntityArgs) => {
        await upsertEntity(id, type, name, properties ?? {});
        return { upserted: true, id };
      },
    } satisfies ToolDefinition<EntityArgs, JsonObject>)),
    registerTool(defineTool({
      name: "graph_search",
      description: "Search the knowledge graph by name or description.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", default: 10 },
        },
        required: ["query"],
      },
      execute: async ({ query, limit }: GraphSearchArgs) => {
        const results = await searchGraph(query, limit ?? 10);
        return { results };
      },
    } satisfies ToolDefinition<GraphSearchArgs, JsonObject>)),
    registerTool(defineTool({
      name: "graph_get_context",
      description: "Get knowledge graph context for a list of topics (for enriching content).",
      parameters: {
        type: "object",
        properties: {
          topics: { type: "array", items: { type: "string" } },
        },
        required: ["topics"],
      },
      execute: async ({ topics }: ContextArgs) => {
        const context = await getContextForPost(topics);
        return { context };
      },
    } satisfies ToolDefinition<ContextArgs, JsonObject>)),
  ],
};
