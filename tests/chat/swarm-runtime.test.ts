import { describe, expect, it } from "vitest";
import { executeSwarmPlan } from "@/lib/swarm/runtime";
import { validateSwarmResults } from "@/lib/swarm/validation";

describe("swarm runtime", () => {
  it("executes all work items and validates the result set", async () => {
    const plan = {
      id: "plan-1",
      mode: "core_chat_swarm" as const,
      reason: "test",
      taskSummary: "test",
      workItems: [
        {
          id: "item-1",
          type: "source_summary",
          sourceId: "source-1",
          sourceKind: "knowledge_docs",
          operation: "summarize_source",
          instructions: [],
          constraints: {},
          payload: {},
        },
        {
          id: "item-2",
          type: "source_claim_extraction",
          sourceId: "source-1",
          sourceKind: "knowledge_docs",
          operation: "extract_claims",
          instructions: [],
          constraints: {},
          payload: {},
        },
      ],
      aggregationStrategy: "chat_brain_synthesis" as const,
      validationRules: [],
      failurePolicy: "fallback_to_single_agent" as const,
      plannerConfidence: 0.8,
      createdAt: new Date().toISOString(),
    };

    const { results, trace } = await executeSwarmPlan(plan, async (workItem) => ({
      workItemId: workItem.id,
      ok: true,
    }));
    const validation = validateSwarmResults(plan, results);

    expect(results).toHaveLength(2);
    expect(trace.workerCount).toBe(2);
    expect(validation.valid).toBe(true);
  });
});