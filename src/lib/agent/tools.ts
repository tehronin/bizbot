export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type ToolExecutionResult = JsonValue | object;

type ToolSchemaValue =
  | JsonPrimitive
  | string[]
  | ToolPropertySchema
  | Record<string, ToolPropertySchema>;

export interface ToolPropertySchema {
  [key: string]: ToolSchemaValue | undefined;
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  enum?: string[];
  items?: ToolPropertySchema;
  properties?: Record<string, ToolPropertySchema>;
  additionalProperties?: boolean;
  default?: JsonPrimitive;
}

export interface ToolParametersSchema {
  [key: string]: ToolSchemaValue | undefined;
  type: "object";
  properties: Record<string, ToolPropertySchema>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition<TArgs extends object, TResult extends ToolExecutionResult> {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
  execute: (args: TArgs) => Promise<TResult>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: JsonObject;
}

export interface ToolResultMessage {
  role: "tool";
  content: string;
  toolCallId: string;
  name: string;
}

export interface SystemMessage {
  role: "system";
  content: string;
}

export interface UserMessage {
  role: "user";
  content: string;
}

export interface AssistantMessage {
  role: "assistant";
  content: string;
  toolCalls?: ToolCall[];
}

export type ChatMessage = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

export function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseToolArguments(input: string): JsonObject {
  const parsed = JSON.parse(input) as JsonValue;
  if (!isJsonObject(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }
  return parsed;
}
