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

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, FunctionCallingConfigMode, createPartFromFunctionResponse, type Content, type FunctionDeclaration } from "@google/genai";
import OpenAI from "openai";
import {
  ChatMessage,
  JsonObject,
  JsonValue,
  ToolDescriptor,
  ToolParametersSchema,
  ToolPropertySchema,
  ToolCall,
  isJsonObject,
  isJsonValue,
  parseToolArguments,
} from "@/lib/agent/tools";
import type { FunctionParameters } from "openai/resources/shared";
import type { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/messages/messages";
import { getSecretValue, hasSecretValueSync } from "@/lib/runtime-secrets";

export type LLMProvider = "openai" | "anthropic" | "ollama" | "google" | "minimax";

export interface GenerationConfig {
  maxTokens: number;
  temperature: number;
}

export interface LLMUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedPromptTokens?: number;
}

export interface ProviderUsageReliability {
  supported: boolean;
  reliability: "verified" | "compatible" | "unverified";
  notes: string;
}

export interface ProviderCapabilityFlags {
  usageReliability: ProviderUsageReliability;
  supportsToolCalling: boolean;
  supportsParallelToolCalls: boolean;
  supportsStreaming: boolean;
  nativeExtras: string[];
}

export interface LLMResponse {
  content: string;
  provider: LLMProvider;
  model: string;
  toolCalls: ToolCall[];
  usage?: LLMUsage;
  metadata?: JsonObject;
  providerState?: JsonObject;
}

export interface ChatRequestOptions {
  enableGoogleSearch?: boolean;
  enableGoogleCodeExecution?: boolean;
  forceFunctionCall?: boolean;
  includeServerSideToolInvocations?: boolean;
  agentProfile?: string;
  signal?: AbortSignal;
}

function abortPromise(signal: AbortSignal | undefined): Promise<never> {
  if (!signal) {
    return new Promise<never>(() => {});
  }

  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error("Request aborted"));
  }

  return new Promise<never>((_, reject) => {
    signal.addEventListener(
      "abort",
      () => reject(signal.reason ?? new Error("Request aborted")),
      { once: true },
    );
  });
}

// ─── Provider-specific clients ───────────────────────────────────────────────

function getOpenAIClient(baseURL?: string, apiKey?: string): OpenAI {
  return new OpenAI({
    apiKey: apiKey ?? "",
    ...(baseURL ? { baseURL } : {}),
  });
}

function parseNumericEnv(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getActiveProvider(provider?: LLMProvider): LLMProvider {
  return provider ?? (process.env.ACTIVE_LLM_PROVIDER as LLMProvider) ?? "ollama";
}

export function getModelForProvider(provider: LLMProvider): string {
  switch (provider) {
    case "openai":
      return process.env.OPENAI_MODEL ?? "gpt-4o";
    case "anthropic":
      return process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-20241022";
    case "ollama":
      return process.env.OLLAMA_MODEL ?? "gemma3";
    case "google":
      return process.env.GOOGLE_MODEL ?? "gemini-3-flash-preview";
    case "minimax":
      return process.env.MINIMAX_MODEL ?? "MiniMax-M2.7";
  }
}

export function getGenerationConfig(): GenerationConfig {
  return {
    maxTokens: Math.max(64, Math.trunc(parseNumericEnv(process.env.LLM_MAX_TOKENS, 4096))),
    temperature: Math.min(2, Math.max(0, parseNumericEnv(process.env.LLM_TEMPERATURE, 0.2))),
  };
}

export function getProviderCapabilityFlags(provider: LLMProvider): ProviderCapabilityFlags {
  switch (provider) {
    case "openai":
      return {
        usageReliability: {
          supported: true,
          reliability: "compatible",
          notes: "Usage counters come from the OpenAI chat completion payload.",
        },
        supportsToolCalling: true,
        supportsParallelToolCalls: true,
        supportsStreaming: true,
        nativeExtras: [],
      };
    case "anthropic":
      return {
        usageReliability: {
          supported: true,
          reliability: "compatible",
          notes: "Anthropic usage counters are mapped from native message usage fields.",
        },
        supportsToolCalling: true,
        supportsParallelToolCalls: false,
        supportsStreaming: true,
        nativeExtras: [],
      };
    case "ollama":
      return {
        usageReliability: {
          supported: false,
          reliability: "unverified",
          notes: "Local Ollama usage counters vary by model and OpenAI-compatibility layer.",
        },
        supportsToolCalling: true,
        supportsParallelToolCalls: true,
        supportsStreaming: true,
        nativeExtras: [],
      };
    case "google":
      return {
        usageReliability: {
          supported: true,
          reliability: "verified",
          notes: "Gemini usageMetadata is captured and recorded per round, including cached prompt tokens when provided.",
        },
        supportsToolCalling: true,
        supportsParallelToolCalls: false,
        supportsStreaming: true,
        nativeExtras: ["search-grounding", "code-execution"],
      };
    case "minimax":
      return {
        usageReliability: {
          supported: true,
          reliability: "unverified",
          notes: "MiniMax uses the OpenAI-compatible path but its usage reporting still needs focused validation before cost tracking depends on it.",
        },
        supportsToolCalling: true,
        supportsParallelToolCalls: true,
        supportsStreaming: true,
        nativeExtras: [],
      };
  }
}

function toOpenAITools(tools: ToolDescriptor[] | undefined) {
  return tools?.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as FunctionParameters,
    },
  }));
}

function tryParseToolResponse(content: string): JsonObject {
  try {
    return parseToolArguments(content);
  } catch {
    // fall through
  }

  return { output: content };
}

function isGoogleContent(value: JsonValue): value is JsonObject & Content {
  if (!isJsonObject(value)) {
    return false;
  }

  if (!("parts" in value) || !Array.isArray(value.parts)) {
    return false;
  }

  if ("role" in value && typeof value.role !== "string") {
    return false;
  }

  return true;
}

function getStoredGoogleContent(message: ChatMessage): Content | undefined {
  const candidate = message.role === "assistant" ? message.providerState?.googleContent : undefined;
  return candidate && isGoogleContent(candidate) ? candidate : undefined;
}

function serializeGoogleContent(content: Content | undefined): JsonObject | undefined {
  if (!content) {
    return undefined;
  }

  return isJsonValue(content) && isGoogleContent(content) ? content : undefined;
}

function toToolArguments(value: JsonValue | object | null | undefined): JsonObject {
  return value && isJsonValue(value) && isJsonObject(value) ? value : {};
}

function toToolArgumentsFromProvider(value: object | JsonValue | null | undefined): JsonObject {
  return toToolArguments(value);
}

function toGoogleFunctionDeclarations(
  tools: ToolDescriptor[] | undefined,
): FunctionDeclaration[] | undefined {
  return tools?.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: toGoogleToolSchema(tool.parameters),
  }));
}

function toGoogleToolPropertySchema(schema: ToolPropertySchema): ToolPropertySchema {
  if (schema.type === "json") {
    return {
      type: "string",
      description: schema.description
        ? `${schema.description} Pass arbitrary structured values as a JSON-encoded string.`
        : "Pass arbitrary structured values as a JSON-encoded string.",
      ...(schema.default !== undefined ? { default: typeof schema.default === "string" ? schema.default : JSON.stringify(schema.default) } : {}),
    };
  }

  if (schema.type === "array") {
    return {
      ...schema,
      ...(schema.items ? { items: toGoogleToolPropertySchema(schema.items) } : {}),
    };
  }

  if (schema.type === "object") {
    return {
      ...schema,
      ...(schema.properties
        ? {
            properties: Object.fromEntries(
              Object.entries(schema.properties).map(([key, value]) => [
                key,
                value ? toGoogleToolPropertySchema(value) : value,
              ]),
            ),
          }
        : {}),
    };
  }

  return schema;
}

function toGoogleToolSchema(schema: ToolParametersSchema): ToolParametersSchema {
  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [
        key,
        value ? toGoogleToolPropertySchema(value) : value,
      ]),
    ),
  };
}

function toGoogleContents(messages: ChatMessage[]): Content[] {
  const contents: Content[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }

    if (message.role === "user") {
      contents.push({ role: "user", parts: [{ text: message.content }] });
      continue;
    }

    if (message.role === "assistant") {
      const storedContent = getStoredGoogleContent(message);
      if (storedContent) {
        contents.push(storedContent);
        continue;
      }

      const parts: NonNullable<Content["parts"]> = [];
      if (message.content) {
        parts.push({ text: message.content });
      }
      for (const toolCall of message.toolCalls ?? []) {
        parts.push({
          functionCall: {
            id: toolCall.id,
            name: toolCall.name,
            args: toolCall.arguments,
          },
        });
      }
      contents.push({ role: "model", parts });
      continue;
    }

    contents.push({
      role: "user",
      parts: [
        createPartFromFunctionResponse(
          message.toolCallId,
          message.name,
          tryParseToolResponse(message.content),
        ),
      ],
    });
  }

  return contents;
}

function extractGoogleMetadata(response: {
  executableCode?: string;
  codeExecutionResult?: string;
  candidates?: Array<{
    groundingMetadata?: {
      webSearchQueries?: string[];
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
  }>;
}): JsonObject | undefined {
  const metadata: JsonObject = {};
  const grounding = response.candidates?.[0]?.groundingMetadata;

  if (grounding?.webSearchQueries?.length) {
    metadata.googleSearchQueries = grounding.webSearchQueries.join(", ");
  }

  const sources = grounding?.groundingChunks
    ?.map((chunk) => chunk.web?.uri)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (sources?.length) {
    metadata.groundedSourceUrls = sources;
  }

  if (response.executableCode) {
    metadata.executableCode = response.executableCode;
  }

  if (response.codeExecutionResult) {
    metadata.codeExecutionResult = response.codeExecutionResult;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
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
      arguments: parseToolArguments(toolCall.function.arguments),
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
        arguments: toToolArgumentsFromProvider(block.input as object | JsonValue | null | undefined),
      });
    }
  }

  return { content: contentParts.join("\n").trim(), toolCalls };
}

function extractOpenAIUsage(response: OpenAI.Chat.Completions.ChatCompletion): LLMUsage | undefined {
  if (!response.usage) {
    return undefined;
  }

  return {
    promptTokens: response.usage.prompt_tokens,
    completionTokens: response.usage.completion_tokens,
    totalTokens: response.usage.total_tokens,
  };
}

function extractAnthropicUsage(response: Anthropic.Messages.Message): LLMUsage | undefined {
  if (!response.usage) {
    return undefined;
  }

  const promptTokens = response.usage.input_tokens;
  const completionTokens = response.usage.output_tokens;
  const cachedPromptTokens = (response.usage as {
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  }).cache_read_input_tokens;

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    cachedPromptTokens,
  };
}

function extractGoogleUsage(response: unknown): LLMUsage | undefined {
  const usageMetadata = (response as {
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
      cachedContentTokenCount?: number;
    };
  }).usageMetadata;

  if (!usageMetadata) {
    return undefined;
  }

  return {
    promptTokens: usageMetadata.promptTokenCount,
    completionTokens: usageMetadata.candidatesTokenCount,
    totalTokens: usageMetadata.totalTokenCount,
    cachedPromptTokens: usageMetadata.cachedContentTokenCount,
  };
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
  tools?: ToolDescriptor[],
  options?: ChatRequestOptions,
): Promise<LLMResponse> {
  const activeProvider = getActiveProvider(provider);
  const generation = getGenerationConfig();

  switch (activeProvider) {
    case "openai": {
      const client = getOpenAIClient(undefined, await getSecretValue("OPENAI_API_KEY"));
      const model = getModelForProvider("openai");
      const response = await client.chat.completions.create({
        model,
        messages: toOpenAIMessages(messages),
        temperature: generation.temperature,
        max_tokens: generation.maxTokens,
        ...(tools ? { parallel_tool_calls: true } : {}),
        ...(tools ? { tools: toOpenAITools(tools) } : {}),
        ...(options?.forceFunctionCall && tools ? { tool_choice: "required" as const } : {}),
      }, {
        signal: options?.signal,
      });
      const responseMessage = response.choices[0].message;
      return {
        content: responseMessage.content ?? "",
        provider: "openai",
        model,
        toolCalls: parseOpenAIToolCalls(responseMessage),
        usage: extractOpenAIUsage(response),
      };
    }

    case "anthropic": {
      const client = new Anthropic({ apiKey: (await getSecretValue("ANTHROPIC_API_KEY")) ?? "" });
      const model = getModelForProvider("anthropic");
      const systemMsg = messages.find((m) => m.role === "system")?.content;
      const response = await client.messages.create({
        model,
        max_tokens: generation.maxTokens,
        temperature: generation.temperature,
        ...(systemMsg ? { system: systemMsg } : {}),
        messages: toAnthropicMessages(messages),
        ...(options?.forceFunctionCall && tools ? { tool_choice: { type: "any" as const } } : {}),
        ...(tools
          ? {
              tools: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters as AnthropicTool.InputSchema,
              })),
            }
          : {}),
      }, {
        signal: options?.signal,
      });
      const parsed = parseAnthropicResponse(response);
      return {
        content: parsed.content,
        provider: "anthropic",
        model,
        toolCalls: parsed.toolCalls,
        usage: extractAnthropicUsage(response),
      };
    }

    case "ollama": {
      // Ollama exposes an OpenAI-compatible API
      const client = getOpenAIClient(
        process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
        "ollama",
      );
      const model = getModelForProvider("ollama");
      const response = await client.chat.completions.create({
        model,
        messages: toOpenAIMessages(messages),
        temperature: generation.temperature,
        max_tokens: generation.maxTokens,
        ...(tools ? { parallel_tool_calls: true } : {}),
        ...(tools ? { tools: toOpenAITools(tools) } : {}),
        ...(options?.forceFunctionCall && tools ? { tool_choice: "required" as const } : {}),
      }, {
        signal: options?.signal,
      });
      const responseMessage = response.choices[0].message;
      return {
        content: responseMessage.content ?? "",
        provider: "ollama",
        model,
        toolCalls: parseOpenAIToolCalls(responseMessage),
        usage: extractOpenAIUsage(response),
      };
    }

    case "google": {
      const client = new GoogleGenAI({
        apiKey: (await getSecretValue("GOOGLE_AI_API_KEY")) ?? process.env.GEMINI_API_KEY ?? "",
      });
      const model = getModelForProvider("google");
      const functionDeclarations = toGoogleFunctionDeclarations(tools);
      const response = await Promise.race([
        client.models.generateContent({
          model,
          contents: toGoogleContents(messages),
          config: {
            systemInstruction: messages.find((message) => message.role === "system")?.content,
            temperature: generation.temperature,
            maxOutputTokens: generation.maxTokens,
            tools: [
              ...(functionDeclarations?.length
                ? [{ functionDeclarations }]
                : []),
              ...(options?.enableGoogleSearch ? [{ googleSearch: {} }] : []),
              ...(options?.enableGoogleCodeExecution ? [{ codeExecution: {} }] : []),
            ],
            ...(functionDeclarations?.length
              ? {
                  toolConfig: {
                    functionCallingConfig: {
                      mode: options?.forceFunctionCall
                        ? FunctionCallingConfigMode.ANY
                        : FunctionCallingConfigMode.AUTO,
                    },
                    includeServerSideToolInvocations:
                      options?.includeServerSideToolInvocations ?? true,
                  },
                }
              : {}),
          },
        }),
        abortPromise(options?.signal),
      ]);
      return {
        content: response.text ?? "",
        provider: "google",
        model,
        toolCalls: (response.functionCalls ?? []).map((toolCall) => ({
          id: toolCall.id ?? `${toolCall.name ?? "tool"}-${crypto.randomUUID()}`,
          name: toolCall.name ?? "unknown_tool",
          arguments: toToolArguments(toolCall.args ?? {}),
        })),
        usage: extractGoogleUsage(response),
        metadata: extractGoogleMetadata(response),
        providerState: response.candidates?.[0]?.content
          ? { googleContent: serializeGoogleContent(response.candidates[0].content) ?? {} }
          : undefined,
      };
    }

    case "minimax": {
      // MiniMax exposes an OpenAI-compatible endpoint
      const client = getOpenAIClient(
        process.env.MINIMAX_BASE_URL ?? "https://api.minimax.chat/v1",
        await getSecretValue("MINIMAX_API_KEY"),
      );
      const model = getModelForProvider("minimax");
      const response = await client.chat.completions.create({
        model,
        messages: toOpenAIMessages(messages),
        temperature: generation.temperature,
        max_tokens: generation.maxTokens,
        ...(tools ? { parallel_tool_calls: true } : {}),
        ...(tools ? { tools: toOpenAITools(tools) } : {}),
        ...(options?.forceFunctionCall && tools ? { tool_choice: "required" as const } : {}),
      }, {
        signal: options?.signal,
      });
      const responseMessage = response.choices[0].message;
      return {
        content: responseMessage.content ?? "",
        provider: "minimax",
        model,
        toolCalls: parseOpenAIToolCalls(responseMessage),
        usage: extractOpenAIUsage(response),
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
    openai: hasSecretValueSync("OPENAI_API_KEY"),
    anthropic: hasSecretValueSync("ANTHROPIC_API_KEY"),
    ollama: true, // always try Ollama (local, no key needed)
    google: hasSecretValueSync("GOOGLE_AI_API_KEY"),
    minimax: hasSecretValueSync("MINIMAX_API_KEY"),
  };
}
