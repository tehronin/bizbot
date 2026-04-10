import { describe, expect, it } from "vitest";
import { buildChatSwarmPlan, classifyChatSwarmRequest, collectChatSwarmSources } from "@/lib/agent/swarm-chat";

describe("chat swarm classifier", () => {
  const context = {
    text: "",
    blocks: {
      conversationSummary: "Conversation summary block",
      recentConversation: "Recent conversation block",
      semanticRecall: "Semantic recall block",
      graph: "",
      knowledgeDocs: "Knowledge docs block",
    },
    retrieval: {
      conversationSummary: { included: true, reason: "x", resultCount: 1, chars: 1 },
      recentConversation: { included: true, reason: "x", resultCount: 1, chars: 1 },
      semanticRecall: { included: true, reason: "x", resultCount: 1, chars: 1 },
      graph: { included: false, reason: "x", resultCount: 0, chars: 0 },
      knowledgeDocs: { included: true, reason: "x", resultCount: 1, chars: 1 },
    },
  };

  it("activates for multi-source synthesis requests", () => {
    const classification = classifyChatSwarmRequest({
      message: "Summarize these documents and sources into one answer.",
      profile: "content_operator",
      context,
    });
    const sources = collectChatSwarmSources({ message: "Summarize these documents and sources into one answer.", context });
    const plan = buildChatSwarmPlan({
      message: "Summarize these documents and sources into one answer.",
      classification,
      sources,
    });

    expect(classification.activate).toBe(true);
    expect(plan.mode).toBe("core_chat_swarm");
    expect(plan.workItems).toHaveLength(sources.length * 2);
  });

  it("stays on the single-agent path for small prompts", () => {
    const classification = classifyChatSwarmRequest({
      message: "Draft a short reply.",
      profile: "content_operator",
      context: {
        ...context,
        blocks: {
          conversationSummary: "",
          recentConversation: "Recent conversation block",
          semanticRecall: "",
          graph: "",
          knowledgeDocs: "",
        },
      },
    });

    expect(classification.activate).toBe(false);
  });
});