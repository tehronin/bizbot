import type { JsonValue } from "@/lib/agent/tools";
import {
  MEMORY_FACT_CATEGORIES,
  MEMORY_FACT_SOURCES,
  type MemoryFactCategory,
  type MemoryFactSource,
} from "@/lib/agent/memory/facts";
import { db } from "@/lib/db";
const MAX_MEMORY_FACT_SERIALIZED_CHARS = 2_048;
const MAX_PROMPT_FACTS = 12;
const MAX_PROMPT_VALUE_CHARS = 240;

export interface MemoryFactRecord {
  id: string;
  userId: string;
  category: MemoryFactCategory;
  key: string;
  value: JsonValue;
  source: MemoryFactSource;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GetActiveMemoryFactsParams {
  userId: string;
  categories?: MemoryFactCategory[];
  keys?: string[];
}

export interface SetMemoryFactInput {
  userId: string;
  category: MemoryFactCategory;
  key: string;
  value: JsonValue;
  source?: MemoryFactSource;
}

export interface ForgetMemoryFactParams {
  userId: string;
  key: string;
}

function assertCategory(category: string): asserts category is MemoryFactCategory {
  if (!MEMORY_FACT_CATEGORIES.includes(category as MemoryFactCategory)) {
    throw new Error(`Unsupported memory fact category: ${category}`);
  }
}

function assertSource(source: string): asserts source is MemoryFactSource {
  if (!MEMORY_FACT_SOURCES.includes(source as MemoryFactSource)) {
    throw new Error(`Unsupported memory fact source: ${source}`);
  }
}

function normalizeKey(key: string): string {
  const normalized = key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized) {
    throw new Error("Memory fact key must contain at least one letter or number.");
  }

  return normalized;
}

function serializeJson(value: JsonValue): string {
  return JSON.stringify(value);
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}...`;
}

function assertSafeValue(key: string, value: JsonValue): void {
  const serialized = serializeJson(value);
  if (serialized.length > MAX_MEMORY_FACT_SERIALIZED_CHARS) {
    throw new Error(`Memory fact payload is too large; max ${MAX_MEMORY_FACT_SERIALIZED_CHARS} serialized characters.`);
  }

  const secretPattern = /(password|passcode|secret|token|api[_ -]?key|access[_ -]?key|credential|credit[_ -]?card|payment)/i;
  if (secretPattern.test(key) || secretPattern.test(serialized)) {
    throw new Error("Refusing to store secrets, credentials, tokens, or payment details in explicit memory.");
  }
}

function toMemoryFactRecord(fact: {
  id: string;
  userId: string;
  category: string;
  key: string;
  value: unknown;
  source: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): MemoryFactRecord {
  assertCategory(fact.category);
  assertSource(fact.source);

  return {
    id: fact.id,
    userId: fact.userId,
    category: fact.category,
    key: fact.key,
    value: fact.value as JsonValue,
    source: fact.source,
    isActive: fact.isActive,
    createdAt: fact.createdAt.toISOString(),
    updatedAt: fact.updatedAt.toISOString(),
  };
}

async function ensureUserExists(userId: string): Promise<void> {
  await db.user.upsert({
    where: { id: userId },
    create: { id: userId, name: "User" },
    update: {},
  });
}

export async function getActiveMemoryFacts(params: GetActiveMemoryFactsParams): Promise<MemoryFactRecord[]> {
  const normalizedKeys = params.keys?.map((key) => normalizeKey(key));
  const normalizedCategories = params.categories?.map((category) => {
    assertCategory(category);
    return category;
  });

  const facts = await db.userMemoryFact.findMany({
    where: {
      userId: params.userId,
      isActive: true,
      ...(normalizedCategories?.length ? { category: { in: normalizedCategories } } : {}),
      ...(normalizedKeys?.length ? { key: { in: normalizedKeys } } : {}),
    },
    orderBy: [{ category: "asc" }, { key: "asc" }, { createdAt: "asc" }],
  });

  return facts.map((fact) => toMemoryFactRecord(fact));
}

export async function setMemoryFact(input: SetMemoryFactInput): Promise<MemoryFactRecord> {
  assertCategory(input.category);
  const source = input.source ?? "user";
  assertSource(source);

  const normalizedKey = normalizeKey(input.key);
  assertSafeValue(normalizedKey, input.value);
  await ensureUserExists(input.userId);

  const fact = await db.userMemoryFact.upsert({
    where: {
      userId_key: {
        userId: input.userId,
        key: normalizedKey,
      },
    },
    create: {
      userId: input.userId,
      category: input.category,
      key: normalizedKey,
      value: input.value as never,
      source,
      isActive: true,
    },
    update: {
      category: input.category,
      value: input.value as never,
      source,
      isActive: true,
    },
  });

  return toMemoryFactRecord(fact);
}

export async function forgetMemoryFact(params: ForgetMemoryFactParams): Promise<{ count: number; key: string }> {
  const normalizedKey = normalizeKey(params.key);

  const result = await db.userMemoryFact.updateMany({
    where: {
      userId: params.userId,
      key: normalizedKey,
      isActive: true,
    },
    data: {
      isActive: false,
    },
  });

  return {
    count: result.count,
    key: normalizedKey,
  };
}

export function formatMemoryFactsForPrompt(
  facts: MemoryFactRecord[],
  options?: { includeSource?: boolean; maxFacts?: number },
): string {
  if (facts.length === 0) {
    return "";
  }

  const includeSource = options?.includeSource ?? false;
  const maxFacts = Math.max(1, Math.min(options?.maxFacts ?? MAX_PROMPT_FACTS, MAX_PROMPT_FACTS));
  const lines = facts.slice(0, maxFacts).map((fact) => {
    const valueText = truncate(serializeJson(fact.value), MAX_PROMPT_VALUE_CHARS);
    const sourceText = includeSource ? `, source: ${fact.source}` : "";
    return `- ${fact.key}: ${valueText} (category: ${fact.category}${sourceText})`;
  });

  return `[User Memory]\n${lines.join("\n")}\n[/User Memory]`;
}