// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatWorkspaceContent } from "@/components/chat/ChatWorkspace";
import type { ChatConversationDetail, ChatConversationSummary } from "@/lib/chat/types";
import type { UseChatResult } from "@/hooks/useChat";

vi.mock("@/components/chat/AgenticSetupDrawer", () => ({
  AgenticSetupDrawer: () => null,
}));

afterEach(() => {
  cleanup();
});

function createSummary(overrides?: Partial<ChatConversationSummary>): ChatConversationSummary {
  return {
    id: "active-1",
    title: "Ops triage",
    label: "Ops triage",
    preview: "Latest assistant reply",
    createdAt: "2026-04-01T10:00:00.000Z",
    updatedAt: "2026-04-01T12:00:00.000Z",
    lastMessageAt: "2026-04-01T12:00:00.000Z",
    archivedAt: null,
    messageCount: 2,
    ...overrides,
  };
}

function createDetail(overrides?: Partial<ChatConversationDetail>): ChatConversationDetail {
  return {
    ...createSummary({ id: "archived-1", title: null, label: "Archived ops thread", archivedAt: "2026-04-01T13:00:00.000Z" }),
    messages: [
      { id: "m-1", role: "USER", content: "Please archive this thread.", createdAt: "2026-04-01T11:00:00.000Z" },
      { id: "m-2", role: "ASSISTANT", content: "Thread archived for review.", createdAt: "2026-04-01T11:05:00.000Z" },
    ],
    ...overrides,
  };
}

function Harness() {
  const [conversationId, setConversationId] = useState<string | null>("active-1");
  const [recentConversations, setRecentConversations] = useState<ChatConversationSummary[]>([
    createSummary(),
  ]);
  const [archivedConversations, setArchivedConversations] = useState<ChatConversationSummary[]>([
    createSummary({
      id: "archived-1",
      title: null,
      label: "Archived ops thread",
      preview: "Please archive this thread.",
      archivedAt: "2026-04-01T13:00:00.000Z",
      lastMessageAt: "2026-04-01T11:05:00.000Z",
    }),
  ]);
  const [historyConversation, setHistoryConversation] = useState<ChatConversationDetail | null>(null);

  const chat: UseChatResult = {
    messages: [{ id: "entry-1", role: "assistant", content: "Here is the live chat." }],
    conversationId,
    recentConversations,
    archivedConversations,
    historyConversation,
    isPending: false,
    isBootstrapping: false,
    isLoadingHistoryConversation: false,
    activeRun: { conversationId, runId: null, profile: null, profileLabel: null, provider: null, model: null },
    sendMessage: vi.fn(async () => undefined),
    startNewChat: vi.fn(() => setConversationId(null)),
    loadConversation: vi.fn(async (nextConversationId: string) => {
      setConversationId(nextConversationId);
      setHistoryConversation(null);
    }),
    archiveCurrentConversation: vi.fn(async () => {
      setArchivedConversations((current) => [
        createSummary({ id: "active-1", title: "Ops triage", archivedAt: "2026-04-01T14:00:00.000Z", preview: "Latest assistant reply" }),
        ...current,
      ]);
      setRecentConversations([]);
      setConversationId(null);
    }),
    openHistoryConversation: vi.fn(async () => {
      setHistoryConversation(createDetail());
    }),
    restoreConversation: vi.fn(async () => {
      setConversationId("archived-1");
      setHistoryConversation(null);
      setArchivedConversations([]);
      setRecentConversations([createSummary({ id: "archived-1", title: null, label: "Archived ops thread", preview: "Thread archived for review." })]);
    }),
    deleteConversation: vi.fn(async () => {
      setArchivedConversations([]);
      setHistoryConversation(null);
    }),
  };

  return <ChatWorkspaceContent chat={chat} setupOpen={false} closeSetupHref="/chat" />;
}

describe("chat workspace history panel", () => {
  it("toggles between chat and history panels", async () => {
    render(<Harness />);

    expect(screen.getByText("active conversation")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open history" }));
    expect(screen.getByText("conversation history")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open history" }));
    expect(screen.getByText("active conversation")).toBeTruthy();
  });

  it("renders archived chats and opens them for viewing without restoring", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Open history" }));
    expect(screen.getByText("Archived ops thread")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Open" })[0]);

    await waitFor(() => {
      expect(screen.getByText("History preview")).toBeTruthy();
      expect(screen.getByText("Thread archived for review.")).toBeTruthy();
    });

    expect(screen.getAllByText("Archived ops thread").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("No archived chats yet.")).toBeNull();
  });

  it("shows archive in the live panel and delete only in archived history", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Harness />);

    expect(screen.getByRole("button", { name: "Archive Chat" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open history" }));
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByText("No archived chats yet.")).toBeTruthy());
    expect(confirmSpy).toHaveBeenCalled();
  });

  it("restores an archived conversation back into the active chat view", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Open history" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(screen.getByText("active conversation")).toBeTruthy();
      expect(screen.getByText("Archived ops thread")).toBeTruthy();
    });
  });
});