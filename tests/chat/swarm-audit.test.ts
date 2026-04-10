import { describe, expect, it } from "vitest";
import { auditChatSwarmDraft } from "@/lib/agent/swarm-workers";

describe("swarm audit", () => {
  it("flags unsupported draft sentences", () => {
    const audit = auditChatSwarmDraft({
      draft: "The launch is on Tuesday. Revenue will double next month.",
      findings: [
        {
          sourceId: "source-a",
          sourceKind: "knowledge_docs",
          summary: "The launch is on Tuesday.",
          claims: [{ text: "The launch is on Tuesday.", evidenceRef: "source-a#claim_1" }],
          evidenceRefs: ["source-a#claim_1"],
          gaps: [],
        },
      ],
      contradictions: [],
    });

    expect(audit.passed).toBe(false);
    expect(audit.unsupportedSentences).toHaveLength(1);
  });
});