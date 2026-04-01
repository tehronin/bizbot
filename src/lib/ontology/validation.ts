import type { JsonObject, JsonValue } from "@/lib/agent/tools";
import {
  ONTOLOGY_ALIAS_KINDS,
  ONTOLOGY_EVIDENCE_SOURCE_KINDS,
  ONTOLOGY_PROMOTION_MAX_OBJECT_KEYS,
  ONTOLOGY_PROMOTION_MAX_SERIALIZED_CHARS,
  ONTOLOGY_SCOPES,
  ONTOLOGY_SOURCES,
  ONTOLOGY_STATUSES,
} from "@/lib/ontology/constants";
import type {
  OntologyAliasKind,
  OntologyEvidenceSourceKind,
  OntologyScope,
  OntologySource,
  OntologyStatus,
} from "@/lib/ontology/types";

const SECRET_PATTERN = /(password|passcode|secret|token|api[_ -]?key|access[_ -]?key|credential|credit[_ -]?card|payment)/i;
const TEMPORARY_PATTERN = /(today|tomorrow|this week|next week|later|temporary|temp|maybe|probably|guess|draft)/i;

export function normalizeOntologyToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeAliasValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isOntologyScope(value: string): value is OntologyScope {
  return ONTOLOGY_SCOPES.includes(value as OntologyScope);
}

export function isOntologyStatus(value: string): value is OntologyStatus {
  return ONTOLOGY_STATUSES.includes(value as OntologyStatus);
}

export function isOntologyAliasKind(value: string): value is OntologyAliasKind {
  return ONTOLOGY_ALIAS_KINDS.includes(value as OntologyAliasKind);
}

export function isOntologySource(value: string): value is OntologySource {
  return ONTOLOGY_SOURCES.includes(value as OntologySource);
}

export function isOntologyEvidenceSourceKind(value: string): value is OntologyEvidenceSourceKind {
  return ONTOLOGY_EVIDENCE_SOURCE_KINDS.includes(value as OntologyEvidenceSourceKind);
}

export function assertEvidenceTarget(entityId?: string | null, relationId?: string | null): void {
  const count = Number(Boolean(entityId)) + Number(Boolean(relationId));
  if (count !== 1) {
    throw new Error("OntologyEvidence requires exactly one target: entityId or relationId.");
  }
}

export function serializeOntologyValue(value: JsonValue): string {
  return JSON.stringify(value);
}

export function isSecretLikeValue(key: string, value: JsonValue): boolean {
  const serialized = serializeOntologyValue(value);
  return SECRET_PATTERN.test(key) || SECRET_PATTERN.test(serialized);
}

export function isDurableOntologyValue(value: JsonValue): boolean {
  if (typeof value === "string") {
    return !TEMPORARY_PATTERN.test(value);
  }
  return !TEMPORARY_PATTERN.test(serializeOntologyValue(value));
}

export function isCompactOntologyValue(value: JsonValue): boolean {
  return serializeOntologyValue(value).length <= ONTOLOGY_PROMOTION_MAX_SERIALIZED_CHARS;
}

export function getUsableStructuredValue(value: JsonValue):
  | { kind: "scalar"; label: string; attributes: JsonObject }
  | { kind: "object"; label: string; attributes: JsonObject }
  | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const label = String(value).trim();
    return label ? { kind: "scalar", label, attributes: { value } } : null;
  }

  if (!value || Array.isArray(value) || typeof value !== "object") {
    return null;
  }

  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > ONTOLOGY_PROMOTION_MAX_OBJECT_KEYS) {
    return null;
  }

  const labelCandidate = ["label", "name", "value", "title"].find((key) => typeof value[key] === "string" && value[key]?.trim());
  if (!labelCandidate) {
    return null;
  }

  return {
    kind: "object",
    label: String(value[labelCandidate]).trim(),
    attributes: Object.fromEntries(entries.filter(([, entryValue]) => typeof entryValue !== "object" || entryValue === null || Array.isArray(entryValue) === false)) as JsonObject,
  };
}

export function truncateOntologyText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 3)}...`;
}