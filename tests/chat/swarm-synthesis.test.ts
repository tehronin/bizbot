import { describe, expect, it } from "vitest";
import { buildChatSwarmSynthesisPacket } from "@/lib/agent/swarm-workers";

describe("swarm synthesis packet", () => {
  it("detects contradictions across source findings", () => {
    const packet = buildChatSwarmSynthesisPacket([
      {
        sourceId: "source-a",
        sourceKind: "knowledge_docs",
        summary: "Launch is scheduled for Tuesday.",
        claims: [{ text: "The launch is on Tuesday.", evidenceRef: "source-a#claim_1" }],
        evidenceRefs: ["source-a#claim_1"],
        gaps: [],
      },
      {
        sourceId: "source-b",
        sourceKind: "semantic_recall",
        summary: "Launch is not scheduled for Tuesday.",
        claims: [{ text: "The launch is not on Tuesday.", evidenceRef: "source-b#claim_1" }],
        evidenceRefs: ["source-b#claim_1"],
        gaps: [],
      },
    ], false);

    expect(packet.contradictions).toHaveLength(1);
    expect(packet.auditNeeded).toBe(true);
  });
});