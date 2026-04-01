import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  listActiveUserOntologyRelations: vi.fn(),
}));

vi.mock("@/lib/ontology/service", () => ({
  listActiveUserOntologyRelations: serviceMocks.listActiveUserOntologyRelations,
}));

import { buildOntologyPromptBlock } from "@/lib/ontology/prompt";

function makeRelation(overrides?: Partial<{
  scope: string;
  type: string;
  objectDisplayName: string;
  objectCanonicalKey: string;
  userDisplayName: string;
}>) {
  return {
    scope: overrides?.scope ?? "user",
    type: overrides?.type ?? "has_preference",
    subjectEntity: {
      displayName: overrides?.userDisplayName ?? "Sam",
    },
    objectEntity: {
      displayName: overrides?.objectDisplayName ?? "Concise replies",
      canonicalKey: overrides?.objectCanonicalKey ?? "preference_reply_style_concise",
    },
  };
}

describe("ontology prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("omits context when ontology is empty", async () => {
    serviceMocks.listActiveUserOntologyRelations.mockResolvedValue([]);

    const result = await buildOntologyPromptBlock("user-1");

    expect(result).toEqual({
      block: "",
      lines: [],
      omitted: true,
      reason: "no_relevant_ontology",
    });
  });

  it("respects the line and character budget", async () => {
    serviceMocks.listActiveUserOntologyRelations.mockResolvedValue([
      makeRelation({ type: "has_preference", objectCanonicalKey: "pref_1", objectDisplayName: "x".repeat(300), userDisplayName: "s".repeat(300) }),
      makeRelation({ type: "has_constraint", objectCanonicalKey: "constraint_1", objectDisplayName: "y".repeat(300), userDisplayName: "s".repeat(300) }),
      makeRelation({ type: "uses_workflow", objectCanonicalKey: "workflow_1", objectDisplayName: "z".repeat(300), userDisplayName: "s".repeat(300) }),
      makeRelation({ type: "configured_with", objectCanonicalKey: "setting_1", objectDisplayName: "a".repeat(300), userDisplayName: "s".repeat(300) }),
      makeRelation({ type: "pursues_goal", objectCanonicalKey: "goal_1", objectDisplayName: "b".repeat(300), userDisplayName: "s".repeat(300) }),
    ]);

    const result = await buildOntologyPromptBlock("user-1");

    expect(result.omitted).toBe(true);
    expect(result.reason).toBe("char_budget_exceeded");
  });

  it("applies scope precedence before summarizing relations", async () => {
    serviceMocks.listActiveUserOntologyRelations.mockResolvedValue([
      makeRelation({ scope: "global", objectDisplayName: "Global review workflow", objectCanonicalKey: "workflow_review" , type: "uses_workflow"}),
      makeRelation({ scope: "user", objectDisplayName: "My review workflow", objectCanonicalKey: "workflow_review", type: "uses_workflow" }),
    ]);

    const result = await buildOntologyPromptBlock("user-1");

    expect(result.omitted).toBe(false);
    expect(result.block).toContain("workflow: My review workflow");
    expect(result.block).not.toContain("workflow: Global review workflow");
  });
});