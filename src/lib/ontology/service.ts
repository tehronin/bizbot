import type { JsonValue } from "@/lib/agent/tools";
import { db } from "@/lib/db";
import {
  CONVERSATION_PROJECT_RELATIONSHIPS,
  CONVERSATION_SCOPE,
  ONTOLOGY_ALIAS_KINDS,
  ONTOLOGY_BOOTSTRAP_VOCABULARY,
  ONTOLOGY_EVIDENCE_SOURCE_KINDS,
  ONTOLOGY_ENTITY_TYPES,
  ONTOLOGY_PROMOTION_RULE_SUMMARY,
  ONTOLOGY_RELATION_TYPES,
  ONTOLOGY_RUNTIME_CONTEXT_POLICY,
  ONTOLOGY_SCOPES,
  ONTOLOGY_SCOPE_PRECEDENCE,
  ONTOLOGY_SOURCES,
  ONTOLOGY_STATUSES,
} from "@/lib/ontology/constants";
import type {
  OntologyAliasKind,
  OntologyAliasRecord,
  OntologyCandidateSummary,
  OntologyEntityRecord,
  OntologyEvidenceRecord,
  OntologyEvidenceSourceKind,
  OntologyRelationRecord,
  OntologyScope,
  OntologySource,
  OntologyStatus,
} from "@/lib/ontology/types";
import {
  assertEvidenceTarget,
  isOntologyAliasKind,
  isOntologyEvidenceSourceKind,
  isOntologyScope,
  isOntologySource,
  isOntologyStatus,
  normalizeAliasValue,
  normalizeOntologyToken,
} from "@/lib/ontology/validation";

function toEntityRecord(entity: {
  id: string;
  userId: string | null;
  scope: string;
  type: string;
  canonicalKey: string;
  displayName: string;
  description: string | null;
  attributes: unknown;
  status: string;
  source: string;
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
}): OntologyEntityRecord {
  if (!isOntologyScope(entity.scope) || !isOntologyStatus(entity.status) || !isOntologySource(entity.source)) {
    throw new Error(`Invalid ontology entity row: ${entity.id}`);
  }

  return {
    ...entity,
    attributes: entity.attributes as JsonValue,
    scope: entity.scope,
    status: entity.status,
    source: entity.source,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function toRelationRecord(relation: {
  id: string;
  userId: string | null;
  scope: string;
  type: string;
  subjectEntityId: string;
  objectEntityId: string;
  attributes: unknown;
  source: string;
  confidence: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): OntologyRelationRecord {
  if (!isOntologyScope(relation.scope) || !isOntologySource(relation.source)) {
    throw new Error(`Invalid ontology relation row: ${relation.id}`);
  }

  return {
    ...relation,
    attributes: relation.attributes as JsonValue,
    scope: relation.scope,
    source: relation.source,
    createdAt: relation.createdAt.toISOString(),
    updatedAt: relation.updatedAt.toISOString(),
  };
}

function toAliasRecord(alias: {
  id: string;
  entityId: string;
  scope: string;
  value: string;
  normalizedValue: string;
  kind: string;
  createdAt: Date;
  updatedAt: Date;
}): OntologyAliasRecord {
  if (!isOntologyScope(alias.scope) || !isOntologyAliasKind(alias.kind)) {
    throw new Error(`Invalid ontology alias row: ${alias.id}`);
  }

  return {
    ...alias,
    scope: alias.scope,
    kind: alias.kind,
    createdAt: alias.createdAt.toISOString(),
    updatedAt: alias.updatedAt.toISOString(),
  };
}

function toEvidenceRecord(evidence: {
  id: string;
  entityId: string | null;
  relationId: string | null;
  sourceKind: string;
  sourceRef: string;
  approvalMarker: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}): OntologyEvidenceRecord {
  if (!isOntologyEvidenceSourceKind(evidence.sourceKind)) {
    throw new Error(`Invalid ontology evidence row: ${evidence.id}`);
  }

  return {
    ...evidence,
    sourceKind: evidence.sourceKind,
    createdAt: evidence.createdAt.toISOString(),
    updatedAt: evidence.updatedAt.toISOString(),
  };
}

async function ensureUserExists(userId: string): Promise<void> {
  await db.user.upsert({
    where: { id: userId },
    create: { id: userId, name: "User" },
    update: {},
  });
}

function buildScopedWhere(scope: OntologyScope, userId?: string | null) {
  return scope === "user"
    ? { scope, userId: userId ?? null }
    : { scope, userId: null };
}

export interface EnsureOntologyEntityInput {
  userId?: string | null;
  scope: OntologyScope;
  type: string;
  canonicalKey: string;
  displayName: string;
  description?: string | null;
  attributes?: JsonValue;
  status?: OntologyStatus;
  source: OntologySource;
  confidence?: number;
}

export interface EnsureOntologyRelationInput {
  userId?: string | null;
  scope: OntologyScope;
  type: string;
  subjectEntityId: string;
  objectEntityId: string;
  attributes?: JsonValue;
  source: OntologySource;
  confidence?: number;
  isActive?: boolean;
}

export async function ensureOntologyEntity(input: EnsureOntologyEntityInput): Promise<OntologyEntityRecord> {
  if (input.scope === "user" && input.userId) {
    await ensureUserExists(input.userId);
  }

  const canonicalKey = normalizeOntologyToken(input.canonicalKey);
  const existing = await db.ontologyEntity.findFirst({
    where: {
      ...buildScopedWhere(input.scope, input.userId),
      type: input.type,
      canonicalKey,
    },
    orderBy: { createdAt: "asc" },
  });

  const entity = existing
    ? await db.ontologyEntity.update({
        where: { id: existing.id },
        data: {
          displayName: input.displayName,
          description: input.description ?? null,
          attributes: (input.attributes ?? {}) as never,
          status: input.status ?? "active",
          source: input.source,
          confidence: input.confidence ?? 1,
        },
      })
    : await db.ontologyEntity.create({
        data: {
          userId: input.scope === "user" ? input.userId ?? null : null,
          scope: input.scope,
          type: input.type,
          canonicalKey,
          displayName: input.displayName,
          description: input.description ?? null,
          attributes: (input.attributes ?? {}) as never,
          status: input.status ?? "active",
          source: input.source,
          confidence: input.confidence ?? 1,
        },
      });

  return toEntityRecord(entity);
}

export async function ensureOntologyRelation(input: EnsureOntologyRelationInput): Promise<OntologyRelationRecord> {
  if (input.scope === "user" && input.userId) {
    await ensureUserExists(input.userId);
  }

  const existing = await db.ontologyRelation.findFirst({
    where: {
      ...buildScopedWhere(input.scope, input.userId),
      type: input.type,
      subjectEntityId: input.subjectEntityId,
      objectEntityId: input.objectEntityId,
    },
    orderBy: { createdAt: "asc" },
  });

  const relation = existing
    ? await db.ontologyRelation.update({
        where: { id: existing.id },
        data: {
          attributes: (input.attributes ?? {}) as never,
          source: input.source,
          confidence: input.confidence ?? 1,
          isActive: input.isActive ?? true,
        },
      })
    : await db.ontologyRelation.create({
        data: {
          userId: input.scope === "user" ? input.userId ?? null : null,
          scope: input.scope,
          type: input.type,
          subjectEntityId: input.subjectEntityId,
          objectEntityId: input.objectEntityId,
          attributes: (input.attributes ?? {}) as never,
          source: input.source,
          confidence: input.confidence ?? 1,
          isActive: input.isActive ?? true,
        },
      });

  return toRelationRecord(relation);
}

export async function ensureOntologyAlias(input: {
  entityId: string;
  scope: OntologyScope;
  value: string;
  kind: OntologyAliasKind;
}): Promise<OntologyAliasRecord | null> {
  const normalizedValue = normalizeAliasValue(input.value);
  if (!normalizedValue) {
    return null;
  }

  const existing = await db.ontologyAlias.findFirst({
    where: {
      entityId: input.entityId,
      scope: input.scope,
      normalizedValue,
      kind: input.kind,
    },
    orderBy: { createdAt: "asc" },
  });

  const alias = existing
    ? await db.ontologyAlias.update({
        where: { id: existing.id },
        data: { value: input.value },
      })
    : await db.ontologyAlias.create({
        data: {
          entityId: input.entityId,
          scope: input.scope,
          value: input.value,
          normalizedValue,
          kind: input.kind,
        },
      });

  return toAliasRecord(alias);
}

export async function createOntologyEvidence(input: {
  entityId?: string | null;
  relationId?: string | null;
  sourceKind: OntologyEvidenceSourceKind;
  sourceRef: string;
  approvalMarker?: string | null;
  note?: string | null;
}): Promise<OntologyEvidenceRecord> {
  assertEvidenceTarget(input.entityId, input.relationId);

  const evidence = await db.ontologyEvidence.create({
    data: {
      entityId: input.entityId ?? null,
      relationId: input.relationId ?? null,
      sourceKind: input.sourceKind,
      sourceRef: input.sourceRef,
      approvalMarker: input.approvalMarker ?? null,
      note: input.note ?? null,
    },
  });

  return toEvidenceRecord(evidence);
}

export async function getUserOntologyEntity(userId: string): Promise<OntologyEntityRecord | null> {
  const entity = await db.ontologyEntity.findFirst({
    where: {
      userId,
      scope: "user",
      type: "user_profile",
      status: "active",
    },
    orderBy: { createdAt: "asc" },
  });

  return entity ? toEntityRecord(entity) : null;
}

export async function ensureUserOntologyEntity(userId: string, displayName?: string): Promise<OntologyEntityRecord> {
  const user = await db.user.findUnique({ where: { id: userId } });
  return ensureOntologyEntity({
    userId,
    scope: "user",
    type: "user_profile",
    canonicalKey: `user_${normalizeOntologyToken(userId)}`,
    displayName: displayName ?? user?.name ?? userId,
    attributes: {
      userId,
    },
    source: "system",
    confidence: 1,
  });
}

export async function setOntologyEntityStatus(id: string, status: OntologyStatus): Promise<OntologyEntityRecord> {
  const entity = await db.ontologyEntity.update({
    where: { id },
    data: { status },
  });
  return toEntityRecord(entity);
}

export async function listOntologyEvidenceForSource(sourceRef: string): Promise<OntologyEvidenceRecord[]> {
  const evidence = await db.ontologyEvidence.findMany({
    where: { sourceRef },
    orderBy: { createdAt: "asc" },
  });
  return evidence.map((entry) => toEvidenceRecord(entry));
}

export async function getOntologySummary(): Promise<{
  generatedAt: string;
  counts: {
    entities: number;
    relations: number;
    aliases: number;
    evidence: number;
  };
  byScope: Record<string, number>;
  byStatus: Record<string, number>;
}> {
  const [entities, relations, aliases, evidence, scopeCounts, statusCounts] = await Promise.all([
    db.ontologyEntity.count(),
    db.ontologyRelation.count(),
    db.ontologyAlias.count(),
    db.ontologyEvidence.count(),
    db.ontologyEntity.groupBy({ by: ["scope"], _count: { _all: true } }),
    db.ontologyEntity.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    counts: { entities, relations, aliases, evidence },
    byScope: Object.fromEntries(scopeCounts.map((row) => [row.scope, row._count._all])),
    byStatus: Object.fromEntries(statusCounts.map((row) => [row.status, row._count._all])),
  };
}

export async function getOntologyTypeVocabulary() {
  const [entityRows, relationRows] = await Promise.all([
    db.ontologyEntity.findMany({
      select: { type: true },
      distinct: ["type"],
    }),
    db.ontologyRelation.findMany({
      select: { type: true },
      distinct: ["type"],
    }),
  ]);

  const entityTypes = Array.from(new Set([
    ...ONTOLOGY_ENTITY_TYPES,
    ...entityRows.map((row) => row.type),
  ])).sort((left, right) => left.localeCompare(right));
  const relationTypes = Array.from(new Set([
    ...ONTOLOGY_RELATION_TYPES,
    ...relationRows.map((row) => row.type),
  ])).sort((left, right) => left.localeCompare(right));

  return {
    generatedAt: new Date().toISOString(),
    entityTypes,
    relationTypes,
    defaults: {
      conversationScope: CONVERSATION_SCOPE,
      conversationProjectRelationships: [...CONVERSATION_PROJECT_RELATIONSHIPS],
    },
  };
}

export async function getOntologySchemaSummary() {
  return {
    generatedAt: new Date().toISOString(),
    scopes: [...ONTOLOGY_SCOPES],
    scopePrecedence: [...ONTOLOGY_SCOPE_PRECEDENCE],
    statuses: [...ONTOLOGY_STATUSES],
    aliasKinds: [...ONTOLOGY_ALIAS_KINDS],
    sources: [...ONTOLOGY_SOURCES],
    evidenceSourceKinds: [...ONTOLOGY_EVIDENCE_SOURCE_KINDS],
    entityTypes: [...ONTOLOGY_ENTITY_TYPES],
    relationTypes: [...ONTOLOGY_RELATION_TYPES],
    promptPolicy: ONTOLOGY_RUNTIME_CONTEXT_POLICY,
    promotion: ONTOLOGY_PROMOTION_RULE_SUMMARY,
    bootstrap: ONTOLOGY_BOOTSTRAP_VOCABULARY,
    defaults: {
      conversationScope: CONVERSATION_SCOPE,
      conversationProjectRelationships: [...CONVERSATION_PROJECT_RELATIONSHIPS],
    },
  };
}

export function toOntologyCandidateSummary(entity: {
  id: string;
  userId: string | null;
  scope: string;
  type: string;
  canonicalKey: string;
  displayName: string;
  status: string;
}): OntologyCandidateSummary {
  if (!isOntologyScope(entity.scope) || !isOntologyStatus(entity.status)) {
    throw new Error(`Invalid ontology candidate row: ${entity.id}`);
  }

  return {
    entityId: entity.id,
    userId: entity.userId,
    scope: entity.scope,
    type: entity.type,
    canonicalKey: entity.canonicalKey,
    displayName: entity.displayName,
    status: entity.status,
  };
}

export async function validateOntologyRelationInput(input: {
  userId?: string;
  scope: OntologyScope;
  type: string;
  subjectEntityId: string;
  objectEntityId: string;
}) {
  const [subject, object] = await Promise.all([
    db.ontologyEntity.findUnique({ where: { id: input.subjectEntityId } }),
    db.ontologyEntity.findUnique({ where: { id: input.objectEntityId } }),
  ]);

  const issues: Array<{ severity: "error" | "warning"; code: string; message: string }> = [];

  if (!subject) {
    issues.push({ severity: "error", code: "subject-missing", message: `Missing subject entity ${input.subjectEntityId}.` });
  }
  if (!object) {
    issues.push({ severity: "error", code: "object-missing", message: `Missing object entity ${input.objectEntityId}.` });
  }
  if (subject && subject.status !== "active") {
    issues.push({ severity: "warning", code: "subject-inactive", message: `Subject entity ${input.subjectEntityId} is ${subject.status}.` });
  }
  if (object && object.status !== "active") {
    issues.push({ severity: "warning", code: "object-inactive", message: `Object entity ${input.objectEntityId} is ${object.status}.` });
  }
  if (subject && object && subject.id === object.id) {
    issues.push({ severity: "warning", code: "self-relation", message: "Relation points to the same entity on both sides." });
  }
  if (input.scope === "user" && !input.userId) {
    issues.push({ severity: "error", code: "user-scope-missing-user", message: "User-scoped relations require userId." });
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues,
    subject: subject ? toOntologyCandidateSummary(subject) : null,
    object: object ? toOntologyCandidateSummary(object) : null,
  };
}

export async function listActiveUserOntologyRelations(userId: string) {
  const userEntity = await getUserOntologyEntity(userId);
  if (!userEntity) {
    return [];
  }

  return db.ontologyRelation.findMany({
    where: {
      subjectEntityId: userEntity.id,
      isActive: true,
      OR: [
        { scope: "user", userId },
        { scope: "runtime", userId: null },
        { scope: "global", userId: null },
      ],
      objectEntity: {
        status: "active",
      },
    },
    include: {
      subjectEntity: true,
      objectEntity: true,
    },
    orderBy: [{ createdAt: "asc" }],
  });
}