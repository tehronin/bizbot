import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  conversationFindUnique: vi.fn(),
  builderProjectFindMany: vi.fn(),
  builderProjectFindUnique: vi.fn(),
  postApprovalCount: vi.fn(),
  postApprovalFindMany: vi.fn(),
}));

const ontologyServiceMocks = vi.hoisted(() => ({
  getOntologyTypeVocabulary: vi.fn(),
  ensureUserOntologyEntity: vi.fn(),
  ensureOntologyEntity: vi.fn(),
  ensureOntologyRelation: vi.fn(),
  createOntologyEvidence: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    conversation: {
      findUnique: dbMocks.conversationFindUnique,
    },
    builderProject: {
      findMany: dbMocks.builderProjectFindMany,
      findUnique: dbMocks.builderProjectFindUnique,
    },
    postApproval: {
      count: dbMocks.postApprovalCount,
      findMany: dbMocks.postApprovalFindMany,
    },
  },
}));

vi.mock("@/lib/ontology/service", () => ({
  getOntologyTypeVocabulary: ontologyServiceMocks.getOntologyTypeVocabulary,
  ensureUserOntologyEntity: ontologyServiceMocks.ensureUserOntologyEntity,
  ensureOntologyEntity: ontologyServiceMocks.ensureOntologyEntity,
  ensureOntologyRelation: ontologyServiceMocks.ensureOntologyRelation,
  createOntologyEvidence: ontologyServiceMocks.createOntologyEvidence,
}));

import { conversationBridgePlugin } from "@/lib/agent/plugins/ConversationBridgePlugin";
import { isConversationBridgeEnabled } from "@/lib/agent/plugins/settings";

function requireTool(name: string) {
  const tool = conversationBridgePlugin.tools.find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

function makeConversation() {
  return {
    id: "conv-1",
    title: "Builder plugin review",
    userId: "user-1",
    promptSummary: "Earlier conversation summary: review the plugin and tie it to the builder project.",
    createdAt: new Date("2026-04-01T10:00:00.000Z"),
    updatedAt: new Date("2026-04-01T10:10:00.000Z"),
    lastMessageAt: new Date("2026-04-01T10:09:00.000Z"),
    user: {
      id: "user-1",
      name: "Sam",
    },
    messages: [
      {
        id: "msg-2",
        role: "ASSISTANT",
        content: "I can inspect the builder project and the pending approval queue.",
        createdAt: new Date("2026-04-01T10:08:00.000Z"),
      },
      {
        id: "msg-1",
        role: "USER",
        content: "Please review the plugin implementation and connect it to the builder project.",
        createdAt: new Date("2026-04-01T10:07:00.000Z"),
      },
    ],
  };
}

describe("ConversationBridgePlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BIZBOT_CONVERSATION_BRIDGE_ENABLED;

    dbMocks.conversationFindUnique.mockResolvedValue(makeConversation());
    dbMocks.builderProjectFindMany.mockResolvedValue([
      {
        id: "project-1",
        name: "Bridge Project",
        slug: "bridge-project",
        relativePath: "apps/bridge-project",
        template: "plugin-package",
        latestSessionSummary: "Conversation bridge plugin work.",
        updatedAt: new Date("2026-04-01T10:12:00.000Z"),
      },
    ]);
    dbMocks.builderProjectFindUnique.mockResolvedValue({
      id: "project-1",
      name: "Bridge Project",
      slug: "bridge-project",
      relativePath: "apps/bridge-project",
      template: "plugin-package",
    });
    dbMocks.postApprovalCount.mockResolvedValue(2);
    dbMocks.postApprovalFindMany.mockResolvedValue([
      {
        id: "approval-1",
        postId: "post-1",
        notes: "Needs final review before publish",
        createdAt: new Date("2026-04-01T10:11:00.000Z"),
        post: {
          status: "PENDING_APPROVAL",
          content: "Builder plugin launch post for review.",
          platform: { displayName: "twitter" },
        },
      },
      {
        id: "approval-2",
        postId: "post-2",
        notes: "Unrelated",
        createdAt: new Date("2026-04-01T10:12:00.000Z"),
        post: {
          status: "PENDING_APPROVAL",
          content: "Holiday announcement.",
          platform: { displayName: "facebook" },
        },
      },
    ]);

    ontologyServiceMocks.getOntologyTypeVocabulary.mockResolvedValue({
      generatedAt: "2026-04-01T10:15:00.000Z",
      entityTypes: ["conversation", "project"],
      relationTypes: ["participates_in_conversation", "references_project"],
      defaults: {
        conversationScope: "runtime",
        conversationProjectRelationships: ["references_project", "requests_builder_work"],
      },
    });
    ontologyServiceMocks.ensureUserOntologyEntity.mockResolvedValue({ id: "entity-user" });
    ontologyServiceMocks.ensureOntologyEntity.mockResolvedValue({ id: "entity-conversation" });
    ontologyServiceMocks.ensureOntologyRelation
      .mockResolvedValueOnce({ id: "relation-participant" })
      .mockResolvedValueOnce({ id: "relation-project" });
    ontologyServiceMocks.createOntologyEvidence
      .mockResolvedValueOnce({ id: "evidence-conversation" })
      .mockResolvedValueOnce({ id: "evidence-project" });
  });

  it("exposes metadata and namespaced tools", () => {
    expect(conversationBridgePlugin.metadata.id).toBe("conversation-bridge");
    expect(conversationBridgePlugin.metadata.displayName).toBe("Conversation Bridge");
    expect(conversationBridgePlugin.tools.map((tool) => tool.name)).toEqual([
      "conversation_bridge_inspect",
      "conversation_bridge_sync_ontology",
      "conversation_bridge_review_pending_approvals",
    ]);
  });

  it("declares a stable tool surface", () => {
    expect(conversationBridgePlugin.tools.every((tool) => tool.parameters.type === "object")).toBe(true);
    expect(conversationBridgePlugin.tools.every((tool) => tool.parameters.additionalProperties === false)).toBe(true);
  });

  it("inspects a conversation with vocabulary, project matches, and approvals", async () => {
    const tool = requireTool("conversation_bridge_inspect");
    const result = await tool.execute({ conversationId: "conv-1", includeMessages: true }, {});

    expect(result).toEqual(expect.objectContaining({
      keywords: expect.arrayContaining(["builder", "plugin", "project"]),
      intentSignals: expect.arrayContaining(["builder", "approval"]),
      ontologyVocabulary: expect.objectContaining({
        defaults: expect.objectContaining({ conversationScope: "runtime" }),
      }),
      builderProjects: expect.arrayContaining([
        expect.objectContaining({ id: "project-1", score: expect.any(Number) }),
      ]),
      approvals: expect.objectContaining({ pendingCount: 2 }),
    }));
    expect((result as { conversation: { messages: Array<{ id: string }> } }).conversation.messages).toHaveLength(2);
  });

  it("can omit raw messages from inspection output", async () => {
    const tool = requireTool("conversation_bridge_inspect");
    const result = await tool.execute({ conversationId: "conv-1", includeMessages: false }, {});

    expect((result as { conversation: { messages: unknown[] } }).conversation.messages).toEqual([]);
  });

  it("synchronizes runtime ontology for the conversation", async () => {
    const tool = requireTool("conversation_bridge_sync_ontology");
    const result = await tool.execute({ conversationId: "conv-1" }, {});

    expect(ontologyServiceMocks.ensureUserOntologyEntity).toHaveBeenCalledWith("user-1", "Sam");
    expect(ontologyServiceMocks.ensureOntologyEntity).toHaveBeenCalledWith(expect.objectContaining({
      scope: "runtime",
      type: "conversation",
      attributes: expect.objectContaining({ conversationId: "conv-1" }),
    }));
    expect(result).toEqual(expect.objectContaining({
      synchronized: true,
      relationIds: ["relation-participant"],
      evidenceIds: ["evidence-conversation"],
      projectLink: null,
    }));
  });

  it("links a builder project when asked", async () => {
    ontologyServiceMocks.ensureOntologyEntity
      .mockResolvedValueOnce({ id: "entity-conversation" })
      .mockResolvedValueOnce({ id: "entity-project" });

    const tool = requireTool("conversation_bridge_sync_ontology");
    const result = await tool.execute({ conversationId: "conv-1", projectId: "project-1", relationType: "requests_builder_work" }, {});

    expect(dbMocks.builderProjectFindUnique).toHaveBeenCalledWith({
      where: { id: "project-1" },
      select: {
        id: true,
        name: true,
        slug: true,
        relativePath: true,
        template: true,
      },
    });
    expect(result).toEqual(expect.objectContaining({
      projectLink: expect.objectContaining({
        projectId: "project-1",
        relationType: "requests_builder_work",
      }),
    }));
  });

  it("rejects unsupported project relation types", async () => {
    const tool = requireTool("conversation_bridge_sync_ontology");

    await expect(() => tool.execute({ conversationId: "conv-1", projectId: "project-1", relationType: "invalid_relation" }, {}))
      .rejects.toThrow("Tool argument relationType must be one of");
  });

  it("reviews pending approvals against the conversation", async () => {
    const tool = requireTool("conversation_bridge_review_pending_approvals");
    const result = await tool.execute({ conversationId: "conv-1", limit: 5 }, {});

    expect(result).toEqual(expect.objectContaining({
      pendingCount: 2,
      approvals: expect.arrayContaining([
        expect.objectContaining({ approvalId: "approval-1", platform: "twitter" }),
      ]),
    }));
    expect((result as { approvals: Array<{ approvalId: string }> }).approvals[0]?.approvalId).toBe("approval-1");
  });

  it("resolves the env-backed plugin toggle deterministically", () => {
    expect(isConversationBridgeEnabled()).toBe(false);

    process.env.BIZBOT_CONVERSATION_BRIDGE_ENABLED = "true";

    expect(isConversationBridgeEnabled()).toBe(true);
  });
});
