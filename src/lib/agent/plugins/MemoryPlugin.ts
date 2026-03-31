/** MemoryPlugin — Store and recall agent memories. */

import { recall, remember } from "@/lib/agent/memory";
import {
  MEMORY_FACT_CATEGORIES,
  MEMORY_FACT_SOURCES,
  type MemoryFactCategory,
  type MemoryFactSource,
} from "@/lib/agent/memory/facts";
import type { MemoryEntry } from "@/lib/agent/memory";
import {
  forgetMemoryFact,
  getActiveMemoryFacts,
  setMemoryFact,
} from "@/lib/agent/memory/service";
import type { JsonValue } from "@/lib/agent/tools";
import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";
import { resolveAgentUserId } from "@/lib/agent/user-context";

interface RememberArgs {
  key: string;
  value: string;
  category?: string;
}

interface RecallArgs {
  query: string;
  limit?: number;
}

interface GetFactsArgs {
  categories?: MemoryFactCategory[];
  keys?: string[];
}

interface SetFactArgs {
  category: MemoryFactCategory;
  key: string;
  value: JsonValue;
  source?: MemoryFactSource;
}

interface ForgetFactArgs {
  key: string;
}

export const memoryPlugin = {
  tools: [
    registerTool(defineTool({
      name: "memory_remember",
      description: "Store a key-value fact in semantic long-term memory for later recall/search.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string" },
          value: { type: "string" },
          category: { type: "string", description: "e.g. preference, fact, topic, brand" },
        },
        required: ["key", "value"],
      },
      execute: async ({ key, value, category }: RememberArgs, context) => {
        await remember(key, value, category ?? "general", resolveAgentUserId(context.userId));
        return { stored: true, key, value };
      },
    } satisfies ToolDefinition<RememberArgs, { stored: boolean; key: string; value: string }>)),
    registerTool(defineTool({
      name: "memory_recall",
      description: "Recall semantic memories similar to a query.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", default: 5 },
        },
        required: ["query"],
      },
      execute: async ({ query, limit }: RecallArgs, context) => {
        const results = await recall(query, limit ?? 5, resolveAgentUserId(context.userId));
        return { memories: results };
      },
    } satisfies ToolDefinition<RecallArgs, { memories: MemoryEntry[] }>)),
    registerTool(defineTool({
      name: "memory_get_facts",
      description: "Fetch explicit stored user memory facts such as identity, preferences, workflows, constraints, or operator settings for the current user.",
      parameters: {
        type: "object",
        properties: {
          categories: {
            type: "array",
            items: {
              type: "string",
              enum: [...MEMORY_FACT_CATEGORIES],
            },
          },
          keys: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
      execute: async ({ categories, keys }: GetFactsArgs, context) => ({
        facts: await getActiveMemoryFacts({
          userId: resolveAgentUserId(context.userId),
          categories,
          keys,
        }),
      }),
    } satisfies ToolDefinition<GetFactsArgs, { facts: Awaited<ReturnType<typeof getActiveMemoryFacts>> }>)),
    registerTool(defineTool({
      name: "memory_set_fact",
      description: "Store or update an explicit stable user-approved memory fact. Use only when the user clearly asks BizBot to remember a stable fact, or an approved onboarding/system flow requires it.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: [...MEMORY_FACT_CATEGORIES],
          },
          key: { type: "string" },
          value: { type: "json" },
          source: {
            type: "string",
            enum: [...MEMORY_FACT_SOURCES],
            default: "user",
          },
        },
        required: ["category", "key", "value"],
      },
      execute: async ({ category, key, value, source }: SetFactArgs, context) => ({
        fact: await setMemoryFact({
          userId: resolveAgentUserId(context.userId),
          category,
          key,
          value,
          source,
        }),
      }),
    } satisfies ToolDefinition<SetFactArgs, { fact: Awaited<ReturnType<typeof setMemoryFact>> }>)),
    registerTool(defineTool({
      name: "memory_forget_fact",
      description: "Forget a specific explicit user memory fact. Use only when the user explicitly asks BizBot to forget a stored fact.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string" },
        },
        required: ["key"],
      },
      execute: async ({ key }: ForgetFactArgs, context) => ({
        forgotten: await forgetMemoryFact({
          userId: resolveAgentUserId(context.userId),
          key,
        }),
      }),
    } satisfies ToolDefinition<ForgetFactArgs, { forgotten: Awaited<ReturnType<typeof forgetMemoryFact>> }>)),
  ],
};