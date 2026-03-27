/** MemoryPlugin — Store and recall agent memories. */

import { remember, recall } from "@/lib/agent/memory";
import type { MemoryEntry } from "@/lib/agent/memory";
import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";

interface RememberArgs {
  key: string;
  value: string;
  category?: string;
}

interface RecallArgs {
  query: string;
  limit?: number;
}

export const memoryPlugin = {
  tools: [
    registerTool(defineTool({
      name: "memory_remember",
      description: "Store a key-value fact in long-term memory.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string" },
          value: { type: "string" },
          category: { type: "string", description: "e.g. preference, fact, topic, brand" },
        },
        required: ["key", "value"],
      },
      execute: async ({ key, value, category }: RememberArgs) => {
        await remember(key, value, category ?? "general");
        return { stored: true, key, value };
      },
    } satisfies ToolDefinition<RememberArgs, { stored: boolean; key: string; value: string }>)),
    registerTool(defineTool({
      name: "memory_recall",
      description: "Recall memories semantically similar to a query.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", default: 5 },
        },
        required: ["query"],
      },
      execute: async ({ query, limit }: RecallArgs) => {
        const results = await recall(query, limit ?? 5);
        return { memories: results };
      },
    } satisfies ToolDefinition<RecallArgs, { memories: MemoryEntry[] }>)),
  ],
};
