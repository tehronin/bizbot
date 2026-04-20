import crypto from "node:crypto";
import type { JsonObject } from "@/lib/agent/tools";
import type { FailureEnvelope } from "@/lib/failures";
import { getToolAnnotations } from "@/lib/mcp/tool-presentation";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableStringify(nestedValue)}`);
  return `{${entries.join(",")}}`;
}

export function createToolCallResumeSignature(name: string, args: JsonObject): string {
  return crypto
    .createHash("sha1")
    .update(`${name}:${stableStringify(args)}`)
    .digest("hex")
    .slice(0, 20);
}

export function isToolExecutionResumeSafe(name: string, failure?: FailureEnvelope | null): boolean {
  const annotations = getToolAnnotations(name);

  if (name.startsWith("sidecar_")) {
    return false;
  }

  if (annotations.destructiveHint === true || annotations.openWorldHint === true) {
    return false;
  }

  if (failure) {
    return failure.resumeSafe;
  }

  return annotations.readOnlyHint === true || annotations.idempotentHint === true;
}