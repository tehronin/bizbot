import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  aliasFindMany: vi.fn(),
  entityFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    ontologyAlias: {
      findMany: mocks.aliasFindMany,
    },
    ontologyEntity: {
      findMany: mocks.entityFindMany,
    },
  },
}));

import { lookupOntologyCanonicalKey, resolveOntologyAlias } from "@/lib/ontology/search";

describe("ontology search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses scope precedence when resolving aliases", async () => {
    mocks.aliasFindMany.mockResolvedValue([
      {
        entity: {
          id: "entity-global",
          userId: null,
          scope: "global",
          type: "workflow",
          canonicalKey: "workflow_review_reply",
          displayName: "Review reply",
          status: "active",
        },
      },
      {
        entity: {
          id: "entity-user",
          userId: "user-1",
          scope: "user",
          type: "workflow",
          canonicalKey: "workflow_review_reply_custom",
          displayName: "My review reply",
          status: "active",
        },
      },
    ]);

    const resolution = await resolveOntologyAlias({
      alias: "review reply",
      userId: "user-1",
    });

    expect(resolution).toEqual({
      status: "resolved",
      normalizedValue: "review reply",
      scope: "user",
      entity: expect.objectContaining({
        entityId: "entity-user",
      }),
    });
  });

  it("fails closed on alias ambiguity inside the same scope", async () => {
    mocks.aliasFindMany.mockResolvedValue([
      {
        entity: {
          id: "entity-1",
          userId: "user-1",
          scope: "user",
          type: "preference",
          canonicalKey: "preference_tone_calm",
          displayName: "Calm tone",
          status: "active",
        },
      },
      {
        entity: {
          id: "entity-2",
          userId: "user-1",
          scope: "user",
          type: "preference",
          canonicalKey: "preference_tone_friendly",
          displayName: "Friendly tone",
          status: "active",
        },
      },
    ]);

    const resolution = await resolveOntologyAlias({
      alias: "tone",
      userId: "user-1",
    });

    expect(resolution).toEqual({
      status: "ambiguous",
      normalizedValue: "tone",
      scope: "user",
      candidates: expect.arrayContaining([
        expect.objectContaining({ entityId: "entity-1" }),
        expect.objectContaining({ entityId: "entity-2" }),
      ]),
    });
  });

  it("excludes inactive entities from canonical lookup results", async () => {
    mocks.entityFindMany.mockResolvedValue([
      {
        id: "entity-runtime",
        userId: null,
        scope: "runtime",
        type: "constraint",
        canonicalKey: "constraint_weekend_posts",
        displayName: "Avoid weekend posts",
        status: "active",
      },
    ]);

    const resolution = await lookupOntologyCanonicalKey({
      canonicalKey: "constraint_weekend_posts",
      userId: "user-1",
    });

    expect(mocks.entityFindMany).toHaveBeenCalledWith({
      where: {
        canonicalKey: "constraint_weekend_posts",
        status: "active",
      },
      orderBy: [{ createdAt: "asc" }],
    });
    expect(resolution).toEqual({
      status: "resolved",
      normalizedValue: "constraint_weekend_posts",
      scope: "runtime",
      entity: expect.objectContaining({
        entityId: "entity-runtime",
      }),
    });
  });
});