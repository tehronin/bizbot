import type { JsonObject } from "@/lib/agent/tools";
import type { MemoryFactRecord } from "@/lib/agent/memory/service";
import { ONTOLOGY_PROMOTION_ALLOWLIST } from "@/lib/ontology/constants";
import {
  createOntologyEvidence,
  ensureOntologyAlias,
  ensureOntologyEntity,
  ensureOntologyRelation,
  ensureUserOntologyEntity,
} from "@/lib/ontology/service";
import type { OntologyPromotionResult } from "@/lib/ontology/types";
import {
  getUsableStructuredValue,
  isCompactOntologyValue,
  isDurableOntologyValue,
  isSecretLikeValue,
  normalizeOntologyToken,
} from "@/lib/ontology/validation";

function isAllowlistedCategory(category: string): boolean {
  return ONTOLOGY_PROMOTION_ALLOWLIST.includes(category as (typeof ONTOLOGY_PROMOTION_ALLOWLIST)[number]);
}

function buildEntityDetails(category: string, key: string, label: string) {
  const normalizedKey = normalizeOntologyToken(key);
  const normalizedLabel = normalizeOntologyToken(label);

  switch (category) {
    case "identity":
      return {
        entityType: "identity",
        relationType: "has_identity",
        canonicalKey: `${category}_${normalizedKey}_${normalizedLabel}`,
        displayName: label,
      };
    case "preference":
      return {
        entityType: "preference",
        relationType: "has_preference",
        canonicalKey: `${category}_${normalizedKey}_${normalizedLabel}`,
        displayName: label,
      };
    case "workflow":
      return {
        entityType: "workflow",
        relationType: "uses_workflow",
        canonicalKey: `${category}_${normalizedKey}_${normalizedLabel}`,
        displayName: label,
      };
    case "constraint":
      return {
        entityType: "constraint",
        relationType: "has_constraint",
        canonicalKey: `${category}_${normalizedKey}_${normalizedLabel}`,
        displayName: label,
      };
    case "operator_setting":
      return {
        entityType: "operator_setting",
        relationType: "configured_with",
        canonicalKey: `${category}_${normalizedKey}_${normalizedLabel}`,
        displayName: label,
      };
    case "goal":
      return {
        entityType: "goal",
        relationType: "pursues_goal",
        canonicalKey: `${category}_${normalizedKey}_${normalizedLabel}`,
        displayName: label,
      };
    default:
      return null;
  }
}

export async function promoteUserMemoryFactToOntology(fact: MemoryFactRecord): Promise<OntologyPromotionResult> {
  if (!fact.isActive) {
    return {
      status: "skipped",
      factId: fact.id,
      category: fact.category,
      reason: "inactive_fact",
      detail: "Inactive facts do not promote into ontology.",
    };
  }

  if (!isAllowlistedCategory(fact.category)) {
    return {
      status: "skipped",
      factId: fact.id,
      category: fact.category,
      reason: "category_not_allowlisted",
      detail: `Category ${fact.category} is outside the ontology v1 allowlist.`,
    };
  }

  if (isSecretLikeValue(fact.key, fact.value)) {
    return {
      status: "skipped",
      factId: fact.id,
      category: fact.category,
      reason: "secret_like",
      detail: "Secret-like values do not promote into ontology.",
    };
  }

  if (!isCompactOntologyValue(fact.value)) {
    return {
      status: "skipped",
      factId: fact.id,
      category: fact.category,
      reason: "value_too_large",
      detail: "The fact payload is too large for deterministic ontology promotion.",
    };
  }

  if (!isDurableOntologyValue(fact.value)) {
    return {
      status: "skipped",
      factId: fact.id,
      category: fact.category,
      reason: "structurally_unclear",
      detail: "Temporary or speculative values are not promoted.",
    };
  }

  const shapedValue = getUsableStructuredValue(fact.value);
  if (!shapedValue) {
    return {
      status: "skipped",
      factId: fact.id,
      category: fact.category,
      reason: "unsupported_shape",
      detail: "Only scalars or small labeled objects promote in ontology v1.",
    };
  }

  const entityDetails = buildEntityDetails(fact.category, fact.key, shapedValue.label);
  if (!entityDetails) {
    return {
      status: "skipped",
      factId: fact.id,
      category: fact.category,
      reason: "category_not_allowlisted",
      detail: `No ontology mapper exists for ${fact.category}.`,
    };
  }

  const userEntity = await ensureUserOntologyEntity(fact.userId, fact.category === "identity" && fact.key.includes("name") && typeof fact.value === "string" ? fact.value : undefined);
  const targetEntity = await ensureOntologyEntity({
    userId: fact.userId,
    scope: "user",
    type: entityDetails.entityType,
    canonicalKey: entityDetails.canonicalKey,
    displayName: entityDetails.displayName,
    attributes: {
      memoryCategory: fact.category,
      memoryKey: fact.key,
      ...(shapedValue.attributes as JsonObject),
    },
    source: "user_memory",
    confidence: 1,
  });

  const relation = await ensureOntologyRelation({
    userId: fact.userId,
    scope: "user",
    type: entityDetails.relationType,
    subjectEntityId: userEntity.id,
    objectEntityId: targetEntity.id,
    attributes: {
      memoryCategory: fact.category,
      memoryKey: fact.key,
    },
    source: "user_memory",
    confidence: 1,
    isActive: true,
  });

  const aliases = await Promise.all([
    ensureOntologyAlias({ entityId: targetEntity.id, scope: "user", value: targetEntity.displayName, kind: "display_name" }),
    ensureOntologyAlias({ entityId: targetEntity.id, scope: "user", value: fact.key, kind: "memory_key" }),
    ensureOntologyAlias({ entityId: targetEntity.id, scope: "user", value: targetEntity.canonicalKey, kind: "canonical" }),
  ]);

  const entityEvidence = await createOntologyEvidence({
    entityId: targetEntity.id,
    sourceKind: "user_memory_fact",
    sourceRef: fact.id,
    approvalMarker: fact.source,
    note: `Promoted from UserMemoryFact ${fact.key}.`,
  });

  const relationEvidence = await createOntologyEvidence({
    relationId: relation.id,
    sourceKind: "user_memory_fact",
    sourceRef: fact.id,
    approvalMarker: fact.source,
    note: `Promoted relation from UserMemoryFact ${fact.key}.`,
  });

  return {
    status: "promoted",
    factId: fact.id,
    category: fact.category,
    entityIds: [userEntity.id, targetEntity.id],
    relationIds: [relation.id],
    evidenceIds: [entityEvidence.id, relationEvidence.id, ...aliases.filter(Boolean).map((entry) => entry!.id)],
  };
}