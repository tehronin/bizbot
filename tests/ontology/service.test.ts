import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userUpsert: vi.fn(),
  userFindUnique: vi.fn(),
  entityFindFirst: vi.fn(),
  entityFindMany: vi.fn(),
  entityCreate: vi.fn(),
  entityUpdate: vi.fn(),
  relationFindFirst: vi.fn(),
  relationFindMany: vi.fn(),
  relationCreate: vi.fn(),
  relationUpdate: vi.fn(),
  aliasFindFirst: vi.fn(),
  aliasCreate: vi.fn(),
  aliasUpdate: vi.fn(),
  evidenceCreate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      upsert: mocks.userUpsert,
      findUnique: mocks.userFindUnique,
    },
    ontologyEntity: {
      findFirst: mocks.entityFindFirst,
      findMany: mocks.entityFindMany,
      create: mocks.entityCreate,
      update: mocks.entityUpdate,
    },
    ontologyRelation: {
      findFirst: mocks.relationFindFirst,
      findMany: mocks.relationFindMany,
      create: mocks.relationCreate,
      update: mocks.relationUpdate,
    },
    ontologyAlias: {
      findFirst: mocks.aliasFindFirst,
      create: mocks.aliasCreate,
      update: mocks.aliasUpdate,
    },
    ontologyEvidence: {
      create: mocks.evidenceCreate,
    },
  },
}));

import {
  createOntologyEvidence,
  ensureOntologyAlias,
  ensureOntologyEntity,
  ensureOntologyRelation,
  getOntologyTypeVocabulary,
} from "@/lib/ontology/service";

describe("ontology service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindUnique.mockResolvedValue(null);
  });

  it("creates a canonical ontology entity with normalized key", async () => {
    mocks.entityFindFirst.mockResolvedValue(null);
    mocks.entityCreate.mockResolvedValue({
      id: "entity-1",
      userId: "user-1",
      scope: "user",
      type: "preference",
      canonicalKey: "preference_tone_concise",
      displayName: "Concise tone",
      description: null,
      attributes: { memoryKey: "tone" },
      status: "active",
      source: "user_memory",
      confidence: 1,
      createdAt: new Date("2026-04-01T10:00:00.000Z"),
      updatedAt: new Date("2026-04-01T10:00:00.000Z"),
    });

    const entity = await ensureOntologyEntity({
      userId: "user-1",
      scope: "user",
      type: "preference",
      canonicalKey: "Preference Tone Concise",
      displayName: "Concise tone",
      attributes: { memoryKey: "tone" },
      source: "user_memory",
    });

    expect(mocks.userUpsert).toHaveBeenCalledWith({
      where: { id: "user-1" },
      create: { id: "user-1", name: "User" },
      update: {},
    });
    expect(mocks.entityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        scope: "user",
        type: "preference",
        canonicalKey: "preference_tone_concise",
      }),
    });
    expect(entity.canonicalKey).toBe("preference_tone_concise");
  });

  it("creates a relation without blocking on writes elsewhere", async () => {
    mocks.relationFindFirst.mockResolvedValue(null);
    mocks.relationCreate.mockResolvedValue({
      id: "relation-1",
      userId: "user-1",
      scope: "user",
      type: "has_preference",
      subjectEntityId: "entity-user",
      objectEntityId: "entity-pref",
      attributes: {},
      source: "user_memory",
      confidence: 1,
      isActive: true,
      createdAt: new Date("2026-04-01T10:00:00.000Z"),
      updatedAt: new Date("2026-04-01T10:00:00.000Z"),
    });

    const relation = await ensureOntologyRelation({
      userId: "user-1",
      scope: "user",
      type: "has_preference",
      subjectEntityId: "entity-user",
      objectEntityId: "entity-pref",
      source: "user_memory",
    });

    expect(mocks.relationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "has_preference",
        subjectEntityId: "entity-user",
        objectEntityId: "entity-pref",
        isActive: true,
      }),
    });
    expect(relation.type).toBe("has_preference");
  });

  it("normalizes aliases before storage", async () => {
    mocks.aliasFindFirst.mockResolvedValue(null);
    mocks.aliasCreate.mockResolvedValue({
      id: "alias-1",
      entityId: "entity-1",
      scope: "user",
      value: "Preferred Name",
      normalizedValue: "preferred name",
      kind: "display_name",
      createdAt: new Date("2026-04-01T10:00:00.000Z"),
      updatedAt: new Date("2026-04-01T10:00:00.000Z"),
    });

    const alias = await ensureOntologyAlias({
      entityId: "entity-1",
      scope: "user",
      value: " Preferred Name ",
      kind: "display_name",
    });

    expect(mocks.aliasCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        normalizedValue: "preferred name",
      }),
    });
    expect(alias?.normalizedValue).toBe("preferred name");
  });

  it("enforces the evidence invariant that exactly one target is set", async () => {
    await expect(() => createOntologyEvidence({
      entityId: "entity-1",
      relationId: "relation-1",
      sourceKind: "user_memory_fact",
      sourceRef: "fact-1",
    })).rejects.toThrow("exactly one target");
  });

  it("merges builtin and persisted ontology vocabulary", async () => {
    mocks.entityFindMany.mockResolvedValue([{ type: "project" }, { type: "custom_entity" }]);
    mocks.relationFindMany.mockResolvedValue([{ type: "references_project" }, { type: "custom_relation" }]);

    const vocabulary = await getOntologyTypeVocabulary();

    expect(vocabulary.entityTypes).toEqual(expect.arrayContaining(["conversation", "project", "custom_entity"]));
    expect(vocabulary.relationTypes).toEqual(expect.arrayContaining(["participates_in_conversation", "references_project", "custom_relation"]));
    expect(vocabulary.defaults).toEqual({
      conversationScope: "runtime",
      conversationProjectRelationships: ["references_project", "requests_builder_work"],
    });
  });
});