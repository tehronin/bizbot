import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const conversationMocks = vi.hoisted(() => ({
  resolveChatBootstrap: vi.fn(),
  getConversationDetail: vi.fn(),
  archiveConversation: vi.fn(),
  restoreConversation: vi.fn(),
  deleteArchivedConversation: vi.fn(),
}));

vi.mock("@/lib/chat/conversations", () => ({
  resolveChatBootstrap: conversationMocks.resolveChatBootstrap,
  getConversationDetail: conversationMocks.getConversationDetail,
  archiveConversation: conversationMocks.archiveConversation,
  restoreConversation: conversationMocks.restoreConversation,
  deleteArchivedConversation: conversationMocks.deleteArchivedConversation,
}));

import { GET as getConversations } from "@/app/api/chat/conversations/route";
import { DELETE as deleteConversation, GET as getConversation } from "@/app/api/chat/conversations/[id]/route";
import { POST as archiveConversation } from "@/app/api/chat/conversations/[id]/archive/route";
import { POST as restoreConversation } from "@/app/api/chat/conversations/[id]/restore/route";

describe("chat conversation routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the chat bootstrap payload", async () => {
    conversationMocks.resolveChatBootstrap.mockResolvedValue({ currentConversationId: "active-1", currentConversation: null, recentConversations: [], archivedConversations: [] });

    const response = await getConversations(new NextRequest("http://localhost/api/chat/conversations?selectedId=active-1"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(conversationMocks.resolveChatBootstrap).toHaveBeenCalledWith({ userId: undefined, selectedConversationId: "active-1" });
    expect(payload.currentConversationId).toBe("active-1");
  });

  it("returns a conversation detail payload", async () => {
    conversationMocks.getConversationDetail.mockResolvedValue({ id: "archived-1" });

    const response = await getConversation(new NextRequest("http://localhost/api/chat/conversations/archived-1"), {
      params: Promise.resolve({ id: "archived-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.conversation.id).toBe("archived-1");
  });

  it("archives, restores, and deletes through dedicated lifecycle routes", async () => {
    conversationMocks.archiveConversation.mockResolvedValue({ id: "archived-1" });
    conversationMocks.restoreConversation.mockResolvedValue({ id: "active-1" });
    conversationMocks.deleteArchivedConversation.mockResolvedValue(undefined);

    const archiveResponse = await archiveConversation(new NextRequest("http://localhost/api/chat/conversations/active-1/archive", { method: "POST" }), {
      params: Promise.resolve({ id: "active-1" }),
    });
    const restoreResponse = await restoreConversation(new NextRequest("http://localhost/api/chat/conversations/archived-1/restore", { method: "POST" }), {
      params: Promise.resolve({ id: "archived-1" }),
    });
    const deleteResponse = await deleteConversation(new NextRequest("http://localhost/api/chat/conversations/archived-1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "archived-1" }),
    });

    expect(archiveResponse.status).toBe(200);
    expect(restoreResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(conversationMocks.archiveConversation).toHaveBeenCalledWith("active-1", undefined);
    expect(conversationMocks.restoreConversation).toHaveBeenCalledWith("archived-1", undefined);
    expect(conversationMocks.deleteArchivedConversation).toHaveBeenCalledWith("archived-1", undefined);
  });
});