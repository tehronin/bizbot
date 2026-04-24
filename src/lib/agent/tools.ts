import type {
  ClientCapabilities,
  CreateMessageRequest,
  CreateMessageResult,
  CreateMessageResultWithTools,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpTransportKind } from "@/lib/mcp/policy";

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
  | ToolSchemaProperties;

export interface ToolSchemaProperties {
  [key: string]: ToolPropertySchema | undefined;
}

export interface ToolPropertySchema {
  [key: string]: ToolSchemaValue | undefined;
  type: "string" | "number" | "boolean" | "object" | "array" | "json";
  description?: string;
  enum?: string[];
  items?: ToolPropertySchema;
  properties?: ToolSchemaProperties;
  additionalProperties?: boolean;
  default?: JsonPrimitive;
}

export interface ToolParametersSchema {
  [key: string]: ToolSchemaValue | undefined;
  type: "object";
  properties: ToolSchemaProperties;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolExecutionContext {
  conversationId?: string;
  runId?: string;
  userId?: string;
  agentProfile?: string;
  provider?: string;
  signal?: AbortSignal;
  mcpSamplingSession?: McpSamplingSession;
}

export interface McpSamplingSession {
  transportKind: McpTransportKind;
  sessionId?: string;
  traceId?: string;
  requestId?: string;
  toolInvocationId?: string;
  samplingIntent?: string;
  idempotencyKey?: string;
  requestStartedAt?: string;
  toolBudgetAllowed?: boolean;
  createMessage: (params: CreateMessageRequest["params"]) => Promise<CreateMessageResult | CreateMessageResultWithTools>;
  getClientCapabilities: () => ClientCapabilities | undefined;
}

export interface ToolDefinition<TArgs extends object, TResult extends ToolExecutionResult> {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
  execute: (args: TArgs, context: ToolExecutionContext) => Promise<TResult>;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
}

export interface RegisteredToolDefinition extends ToolDescriptor {
  execute: (args: JsonObject, context: ToolExecutionContext) => Promise<ToolExecutionResult>;
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
  providerState?: JsonObject;
}

export type ChatMessage = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

export function isJsonValue(value: JsonValue | object | null | undefined): value is JsonValue {
  if (value === null) {
    return true;
  }

  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return true;
    case "object":
      if (Array.isArray(value)) {
        return value.every((item) => isJsonValue(item));
      }

      return Object.values(value).every((item) => isJsonValue(item as JsonValue | object | null | undefined));
    default:
      return false;
  }
}

export function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnProperty(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function applyDefault(schema: ToolPropertySchema, value: JsonValue | undefined): JsonValue | undefined {
  if (value !== undefined || schema.default === undefined) {
    return value;
  }

  return schema.default;
}

function coerceJsonString(value: JsonValue): JsonValue {
  if (typeof value !== "string") {
    return value;
  }

  try {
    const parsed = JSON.parse(value) as JsonValue;
    return isJsonValue(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

function validateToolValue(
  path: string,
  schema: ToolPropertySchema,
  value: JsonValue | undefined,
): JsonValue {
  const resolvedValue = applyDefault(schema, value);

  if (resolvedValue === undefined) {
    throw new Error(`Missing required tool argument: ${path}`);
  }

  switch (schema.type) {
    case "string": {
      if (typeof resolvedValue !== "string") {
        throw new Error(`Tool argument ${path} must be a string.`);
      }
      if (schema.enum && !schema.enum.includes(resolvedValue)) {
        throw new Error(`Tool argument ${path} must be one of: ${schema.enum.join(", ")}.`);
      }
      return resolvedValue;
    }
    case "number": {
      if (typeof resolvedValue !== "number" || !Number.isFinite(resolvedValue)) {
        throw new Error(`Tool argument ${path} must be a finite number.`);
      }
      return resolvedValue;
    }
    case "boolean": {
      if (typeof resolvedValue !== "boolean") {
        throw new Error(`Tool argument ${path} must be a boolean.`);
      }
      return resolvedValue;
    }
    case "array": {
      if (!Array.isArray(resolvedValue)) {
        throw new Error(`Tool argument ${path} must be an array.`);
      }
      if (!schema.items) {
        return resolvedValue;
      }

      return resolvedValue.map((item, index) => validateToolValue(`${path}[${index}]`, schema.items!, item));
    }
    case "object": {
      if (!isJsonObject(resolvedValue)) {
        throw new Error(`Tool argument ${path} must be an object.`);
      }
      if (!schema.properties) {
        return resolvedValue;
      }

      const nested: JsonObject = {};
      const requiredKeys = Array.isArray(schema.required) ? schema.required : [];
      const required = new Set(requiredKeys);

      for (const [key, propertySchema] of Object.entries(schema.properties)) {
        if (!propertySchema) {
          continue;
        }
        const nestedValue = hasOwnProperty(resolvedValue, key) ? resolvedValue[key] : undefined;
        if (nestedValue === undefined && !required.has(key) && propertySchema.default === undefined) {
          continue;
        }
        nested[key] = validateToolValue(`${path}.${key}`, propertySchema, nestedValue);
      }

      const allowAdditionalProperties = schema.additionalProperties ?? true;
      if (allowAdditionalProperties) {
        for (const [key, nestedValue] of Object.entries(resolvedValue)) {
          if (!hasOwnProperty(nested, key)) {
            nested[key] = nestedValue;
          }
        }
      } else {
        for (const key of Object.keys(resolvedValue)) {
          if (!hasOwnProperty(schema.properties, key)) {
            throw new Error(`Unexpected tool argument ${path}.${key}.`);
          }
        }
      }

      return nested;
    }
    case "json": {
      const normalizedValue = coerceJsonString(resolvedValue);
      if (!isJsonValue(normalizedValue)) {
        throw new Error(`Tool argument ${path} must be valid JSON.`);
      }

      return normalizedValue;
    }
  }
}

export function validateToolArguments(schema: ToolParametersSchema, args: JsonObject): JsonObject {
  const requiredKeys = Array.isArray(schema.required) ? schema.required : [];
  const required = new Set(requiredKeys);
  const validated: JsonObject = {};

  for (const [key, propertySchema] of Object.entries(schema.properties)) {
    if (!propertySchema) {
      continue;
    }
    const value = hasOwnProperty(args, key) ? args[key] : undefined;
    if (value === undefined && !required.has(key) && propertySchema.default === undefined) {
      continue;
    }
    validated[key] = validateToolValue(key, propertySchema, value);
  }

  const allowAdditionalProperties = schema.additionalProperties ?? true;
  if (allowAdditionalProperties) {
    for (const [key, value] of Object.entries(args)) {
      if (!hasOwnProperty(validated, key)) {
        validated[key] = value;
      }
    }
  } else {
    for (const key of Object.keys(args)) {
      if (!hasOwnProperty(schema.properties, key)) {
        throw new Error(`Unexpected tool argument ${key}.`);
      }
    }
  }

  for (const key of required) {
    if (!hasOwnProperty(validated, key)) {
      throw new Error(`Missing required tool argument: ${key}`);
    }
  }

  return validated;
}

export function registerTool<TArgs extends object, TResult extends ToolExecutionResult>(
  tool: ToolDefinition<TArgs, TResult>,
): RegisteredToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: async (args: JsonObject, context: ToolExecutionContext) => {
      const validatedArgs = validateToolArguments(tool.parameters, args);
      return tool.execute(validatedArgs as TArgs, context);
    },
  };
}

export function defineTool<TArgs extends object, TResult extends ToolExecutionResult>(
  tool: ToolDefinition<TArgs, TResult>,
): ToolDefinition<TArgs, TResult> {
  return tool;
}

export function parseToolArguments(input: string): JsonObject {
  const parsed = JSON.parse(input) as JsonValue;
  if (!isJsonObject(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }
  return parsed;
}
