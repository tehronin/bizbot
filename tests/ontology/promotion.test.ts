import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  ensureUserOntologyEntity: vi.fn(),
  ensureOntologyEntity: vi.fn(),
  ensureOntologyRelation: vi.fn(),
  ensureOntologyAlias: vi.fn(),
  createOntologyEvidence: vi.fn(),
}));

vi.mock("@/lib/ontology/service", () => ({
  ensureUserOntologyEntity: serviceMocks.ensureUserOntologyEntity,
  ensureOntologyEntity: serviceMocks.ensureOntologyEntity,
  ensureOntologyRelation: serviceMocks.ensureOntologyRelation,
  ensureOntologyAlias: serviceMocks.ensureOntologyAlias,
  createOntologyEvidence: serviceMocks.createOntologyEvidence,
}));

import { promoteUserMemoryFactToOntology } from "@/lib/ontology/promotion";

describe("ontology promotion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.ensureUserOntologyEntity.mockResolvedValue({ id: "entity-user" });
    serviceMocks.ensureOntologyEntity.mockResolvedValue({ id: "entity-target" });
    serviceMocks.ensureOntologyRelation.mockResolvedValue({ id: "relation-1" });
    serviceMocks.ensureOntologyAlias.mockResolvedValue({ id: "alias-1" });
    serviceMocks.createOntologyEvidence.mockResolvedValueOnce({ id: "evidence-entity" }).mockResolvedValueOnce({ id: "evidence-relation" });
  });

  it("promotes allowlisted stable facts and records provenance", async () => {
    const result = await promoteUserMemoryFactToOntology({
      id: "fact-1",
      userId: "user-1",
      category: "preference",
      key: "reply_tone",
      value: "Concise replies",
      source: "user",
      isActive: true,
      createdAt: "2026-04-01T10:00:00.000Z",
      updatedAt: "2026-04-01T10:00:00.000Z",
    });

    expect(serviceMocks.ensureOntologyRelation).toHaveBeenCalledWith(expect.objectContaining({
      type: "has_preference",
      source: "user_memory",
    }));
    expect(serviceMocks.createOntologyEvidence).toHaveBeenNthCalledWith(1, expect.objectContaining({
      entityId: "entity-target",
      sourceRef: "fact-1",
    }));
    expect(serviceMocks.createOntologyEvidence).toHaveBeenNthCalledWith(2, expect.objectContaining({
      relationId: "relation-1",
      sourceRef: "fact-1",
    }));
    expect(result).toEqual(expect.objectContaining({
      status: "promoted",
      factId: "fact-1",
    }));
  });

  it("does not promote non-allowlisted categories", async () => {
    const result = await promoteUserMemoryFactToOntology({
      id: "fact-2",
      userId: "user-1",
      category: "other",
      key: "misc",
      value: "something",
      source: "user",
      isActive: true,
      createdAt: "2026-04-01T10:00:00.000Z",
      updatedAt: "2026-04-01T10:00:00.000Z",
    });

    expect(result).toEqual(expect.objectContaining({
      status: "skipped",
      reason: "category_not_allowlisted",
    }));
    expect(serviceMocks.ensureOntologyEntity).not.toHaveBeenCalled();
  });

  it("does not promote inactive facts", async () => {
    const result = await promoteUserMemoryFactToOntology({
      id: "fact-3",
      userId: "user-1",
      category: "workflow",
      key: "review_flow",
      value: "Review reply",
      source: "user",
      isActive: false,
      createdAt: "2026-04-01T10:00:00.000Z",
      updatedAt: "2026-04-01T10:00:00.000Z",
    });

    expect(result).toEqual(expect.objectContaining({
      status: "skipped",
      reason: "inactive_fact",
    }));
  });

  it("skips oversized or unclear values", async () => {
    const oversized = await promoteUserMemoryFactToOntology({
      id: "fact-4",
      userId: "user-1",
      category: "constraint",
      key: "posting_window",
      value: "x".repeat(700),
      source: "user",
      isActive: true,
      createdAt: "2026-04-01T10:00:00.000Z",
      updatedAt: "2026-04-01T10:00:00.000Z",
    });
    const unclear = await promoteUserMemoryFactToOntology({
      id: "fact-5",
      userId: "user-1",
      category: "constraint",
      key: "posting_window",
      value: ["weekdays", "mornings"],
      source: "user",
      isActive: true,
      createdAt: "2026-04-01T10:00:00.000Z",
      updatedAt: "2026-04-01T10:00:00.000Z",
    });

    expect(oversized).toEqual(expect.objectContaining({
      status: "skipped",
      reason: "value_too_large",
    }));
    expect(unclear).toEqual(expect.objectContaining({
      status: "skipped",
      reason: "unsupported_shape",
    }));
  });
});