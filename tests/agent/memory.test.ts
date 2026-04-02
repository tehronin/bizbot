import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  messageFindMany: vi.fn(),
  memoryFindMany: vi.fn(),
  conversationFindUnique: vi.fn(),
}));

const knowledgeMocks = vi.hoisted(() => ({
  searchKnowledgeDocuments: vi.fn(),
}));

const embeddingsMocks = vi.hoisted(() => ({
  searchMemories: vi.fn(),
  storeMemoryEmbedding: vi.fn(),
}));

const graphMocks = vi.hoisted(() => ({
  searchGraph: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    message: {
      findMany: dbMocks.messageFindMany,
    },
    conversation: {
      findUnique: dbMocks.conversationFindUnique,
    },
    memory: {
      findMany: dbMocks.memoryFindMany,
    },
  },
}));

vi.mock("@/lib/agent/knowledge", () => ({
  searchKnowledgeDocuments: knowledgeMocks.searchKnowledgeDocuments,
}));

vi.mock("@/lib/embeddings/search", () => ({
  searchMemories: embeddingsMocks.searchMemories,
  storeMemoryEmbedding: embeddingsMocks.storeMemoryEmbedding,
}));

vi.mock("@/lib/graph/queries", () => ({
  searchGraph: graphMocks.searchGraph,
}));

import { buildContextForPrompt } from "@/lib/agent/memory";

describe("agent memory retrieval gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.messageFindMany.mockResolvedValue([]);
    dbMocks.memoryFindMany.mockResolvedValue([]);
    dbMocks.conversationFindUnique.mockResolvedValue(null);
    embeddingsMocks.searchMemories.mockResolvedValue([]);
    knowledgeMocks.searchKnowledgeDocuments.mockResolvedValue([]);
    graphMocks.searchGraph.mockResolvedValue([]);
  });

  it("includes recent conversation for a short follow-up in a fresh thread", async () => {
    dbMocks.messageFindMany.mockResolvedValue([
      {
        role: "ASSISTANT",
        content: "I drafted the post.",
        createdAt: new Date(),
      },
      {
        role: "USER",
        content: "Please draft a post about the launch.",
        createdAt: new Date(Date.now() - 60_000),
      },
    ]);

    const result = await buildContextForPrompt("What about LinkedIn?", "conversation-1", "user-1");

    expect(result.blocks.recentConversation).toContain("USER: Please draft a post about the launch.");
    expect(result.blocks.conversationSummary).toBe("");
    expect(result.retrieval.recentConversation).toEqual(expect.objectContaining({
      included: true,
      resultCount: 2,
    }));
    expect(result.retrieval.semanticRecall.included).toBe(false);
    expect(result.retrieval.graph.included).toBe(false);
    expect(result.retrieval.knowledgeDocs.included).toBe(false);
  });

  it("includes semantic recall when the user asks about durable preferences", async () => {
    embeddingsMocks.searchMemories.mockResolvedValue([
      {
        key: "preferred_tone",
        value: "concise and direct",
        category: "preference",
        similarity: 0.92,
      },
    ]);

    const result = await buildContextForPrompt("Remember what tone I prefer", undefined, "user-1");

    expect(result.blocks.semanticRecall).toContain("preferred_tone: concise and direct");
    expect(result.retrieval.semanticRecall).toEqual(expect.objectContaining({
      included: true,
      resultCount: 1,
    }));
  });

  it("selectively enables graph and docs retrieval for factual workspace questions", async () => {
    graphMocks.searchGraph.mockResolvedValue([
      { type: "company", name: "Acme" },
    ]);
    knowledgeMocks.searchKnowledgeDocuments.mockResolvedValue([
      { path: "docs/plugin-development.md", snippet: "Developer plugins can preview tools and prompts." },
    ]);

    const result = await buildContextForPrompt("How do I configure the ontology graph for a company entity?", undefined, "user-1");

    expect(result.blocks.graph).toContain("company: Acme");
    expect(result.blocks.knowledgeDocs).toContain("docs/plugin-development.md");
    expect(result.retrieval.graph.included).toBe(true);
    expect(result.retrieval.knowledgeDocs.included).toBe(true);
  });

  it("uses the rolling conversation summary when the thread continues but raw turns are stale", async () => {
    dbMocks.messageFindMany.mockResolvedValue([
      {
        role: "ASSISTANT",
        content: "The last draft is ready.",
        createdAt: new Date(Date.now() - (31 * 60 * 1000)),
      },
    ]);
    dbMocks.conversationFindUnique.mockResolvedValue({
      promptSummary: "Earlier conversation summary:\n- User: asked for a product launch draft.",
      promptSummaryUpdatedAt: new Date(),
    });

    const result = await buildContextForPrompt("What about LinkedIn?", "conversation-1", "user-1");

    expect(result.blocks.conversationSummary).toContain("Earlier conversation summary:");
    expect(result.retrieval.conversationSummary.included).toBe(true);
    expect(result.retrieval.recentConversation.included).toBe(false);
  });
});