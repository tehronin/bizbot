/**
 * agent/kernel.ts — Semantic Kernel initialization with multi-LLM provider support.
 *
 * Supported providers: OpenAI, Anthropic, Ollama, Google, MiniMax
 * Active provider is set via ACTIVE_LLM_PROVIDER env variable.
 *
 * Note: @semantic-kernel/core is used where available. For providers without
 * native SK connectors (Anthropic, MiniMax), we use a thin OpenAI-compatible
 * wrapper via their respective APIs.
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type {
  ChatMessage,
  JsonObject,
  ToolCall,
  ToolDefinition,
  ToolExecutionResult,
} from "@/lib/agent/tools";
import type { FunctionParameters } from "openai/resources/shared";
import type { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/messages/messages";

export type LLMProvider = "openai" | "anthropic" | "ollama" | "google" | "minimax";

export interface LLMResponse {
  content: string;
  provider: LLMProvider;
  model: string;
  toolCalls: ToolCall[];
}

// ─── Provider-specific clients ───────────────────────────────────────────────

function getOpenAIClient(baseURL?: string, apiKey?: string): OpenAI {
  return new OpenAI({
    apiKey: apiKey ?? process.env.OPENAI_API_KEY ?? "",
    ...(baseURL ? { baseURL } : {}),
  });
}

function getAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
}

function toOpenAITools(tools: ToolDefinition<object, ToolExecutionResult>[] | undefined) {
  return tools?.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as FunctionParameters,
    },
  }));
}

function toOpenAIMessages(messages: ChatMessage[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((message) => {
    switch (message.role) {
      case "system":
        return { role: "system", content: message.content };
      case "user":
        return { role: "user", content: message.content };
      case "assistant":
        return {
          role: "assistant",
          content: message.content,
          ...(message.toolCalls
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: "function" as const,
                  function: {
                    name: call.name,
                    arguments: JSON.stringify(call.arguments),
                  },
                })),
              }
            : {}),
        };
      case "tool":
        return {
          role: "tool",
          content: message.content,
          tool_call_id: message.toolCallId,
        };
    }
  });
}

function parseOpenAIToolCalls(
  message: OpenAI.Chat.Completions.ChatCompletionMessage,
): ToolCall[] {
  return (message.tool_calls ?? []).flatMap((toolCall) => {
    if (toolCall.type !== "function") {
      return [];
    }

    return [{
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: JSON.parse(toolCall.function.arguments) as JsonObject,
    }];
  });
}

function parseAnthropicResponse(response: Anthropic.Messages.Message): {
  content: string;
  toolCalls: ToolCall[];
} {
  const contentParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const block of response.content) {
    if (block.type === "text") {
      contentParts.push(block.text);
      continue;
    }

    if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: block.input as JsonObject,
      });
    }
  }

  return { content: contentParts.join("\n").trim(), toolCalls };
}

function toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  const anthropicMessages: Anthropic.MessageParam[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }

    if (message.role === "assistant") {
      if (message.toolCalls && message.toolCalls.length > 0) {
        anthropicMessages.push({
          role: "assistant",
          content: message.toolCalls.map((call) => ({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: call.arguments,
          })),
        });
      } else {
        anthropicMessages.push({ role: "assistant", content: message.content });
      }
      continue;
    }

    if (message.role === "tool") {
      anthropicMessages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.toolCallId,
            content: message.content,
          },
        ],
      });
      continue;
    }

    anthropicMessages.push({ role: "user", content: message.content });
  }

  return anthropicMessages;
}

// ─── Unified chat completion ──────────────────────────────────────────────────

export async function chatComplete(
  messages: ChatMessage[],
  provider?: LLMProvider,
  tools?: ToolDefinition<object, ToolExecutionResult>[],
): Promise<LLMResponse> {
  const activeProvider: LLMProvider =
    provider ?? (process.env.ACTIVE_LLM_PROVIDER as LLMProvider) ?? "openai";

  switch (activeProvider) {
    case "openai": {
      const client = getOpenAIClient();
      const model = process.env.OPENAI_MODEL ?? "gpt-4o";
      const response = await client.chat.completions.create({
        model,
        messages: toOpenAIMessages(messages),
        ...(tools ? { tools: toOpenAITools(tools) } : {}),
      });
      const responseMessage = response.choices[0].message;
      return {
        content: responseMessage.content ?? "",
        provider: "openai",
        model,
        toolCalls: parseOpenAIToolCalls(responseMessage),
      };
    }

    case "anthropic": {
      const client = getAnthropicClient();
      const model = process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-20241022";
      const systemMsg = messages.find((m) => m.role === "system")?.content;
      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        ...(systemMsg ? { system: systemMsg } : {}),
        messages: toAnthropicMessages(messages),
        ...(tools
          ? {
              tools: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters as AnthropicTool.InputSchema,
              })),
            }
          : {}),
      });
      const parsed = parseAnthropicResponse(response);
      return { content: parsed.content, provider: "anthropic", model, toolCalls: parsed.toolCalls };
    }

    case "ollama": {
      // Ollama exposes an OpenAI-compatible API
      const client = getOpenAIClient(
        process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
        "ollama",
      );
      const model = process.env.OLLAMA_MODEL ?? "llama3.2";
      const response = await client.chat.completions.create({
        model,
        messages: toOpenAIMessages(messages),
        ...(tools ? { tools: toOpenAITools(tools) } : {}),
      });
      const responseMessage = response.choices[0].message;
      return {
        content: responseMessage.content ?? "",
        provider: "ollama",
        model,
        toolCalls: parseOpenAIToolCalls(responseMessage),
      };
    }

    case "google": {
      // Google AI exposes an OpenAI-compatible endpoint
      const client = getOpenAIClient(
        "https://generativelanguage.googleapis.com/v1beta/openai/",
        process.env.GOOGLE_AI_API_KEY,
      );
      const model = process.env.GOOGLE_MODEL ?? "gemini-2.0-flash";
      const response = await client.chat.completions.create({
        model,
        messages: toOpenAIMessages(messages),
        ...(tools ? { tools: toOpenAITools(tools) } : {}),
      });
      const responseMessage = response.choices[0].message;
      return {
        content: responseMessage.content ?? "",
        provider: "google",
        model,
        toolCalls: parseOpenAIToolCalls(responseMessage),
      };
    }

    case "minimax": {
      // MiniMax exposes an OpenAI-compatible endpoint
      const client = getOpenAIClient(
        process.env.MINIMAX_BASE_URL ?? "https://api.minimax.chat/v1",
        process.env.MINIMAX_API_KEY,
      );
      const model = process.env.MINIMAX_MODEL ?? "abab6.5s-chat";
      const response = await client.chat.completions.create({
        model,
        messages: toOpenAIMessages(messages),
        ...(tools ? { tools: toOpenAITools(tools) } : {}),
      });
      const responseMessage = response.choices[0].message;
      return {
        content: responseMessage.content ?? "",
        provider: "minimax",
        model,
        toolCalls: parseOpenAIToolCalls(responseMessage),
      };
    }

    default:
      throw new Error(`Unknown LLM provider: ${activeProvider}`);
  }
}

/** Test connectivity to the active LLM provider. */
export async function testProvider(provider?: LLMProvider): Promise<boolean> {
  try {
    await chatComplete([{ role: "user", content: "Hi" }], provider);
    return true;
  } catch {
    return false;
  }
}

/** Get a list of available/configured providers. */
export function getConfiguredProviders(): Record<LLMProvider, boolean> {
  return {
    openai: !!process.env.OPENAI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    ollama: true, // always try Ollama (local, no key needed)
    google: !!process.env.GOOGLE_AI_API_KEY,
    minimax: !!process.env.MINIMAX_API_KEY,
  };
}
