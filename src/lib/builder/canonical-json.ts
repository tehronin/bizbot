import { createHash } from "node:crypto";

export function normalizeBuilderJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeBuilderJsonValue(entry));
  }
  if (!value || typeof value !== "object") {
    return value ?? null;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizeBuilderJsonValue(entry)]),
  );
}

export function canonicalizeBuilderJsonValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizeBuilderJsonValue(entry)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeBuilderJsonValue(entry)}`).join(",")}}`;
}

export function hashCanonicalBuilderJsonValue(value: unknown): string {
  return createHash("sha256")
    .update(canonicalizeBuilderJsonValue(normalizeBuilderJsonValue(value)), "utf8")
    .digest("hex");
}