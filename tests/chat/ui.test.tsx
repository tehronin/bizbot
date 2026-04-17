// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatWorkspaceContent } from "@/components/chat/ChatWorkspace";
import type { BuilderChatCard, ChatConversationDetail, ChatConversationHistoryFilters, ChatConversationPagination, ChatConversationSummary } from "@/lib/chat/types";
import type { UseChatResult } from "@/hooks/useChat";

const PAGE_SIZE = 6;
const sendMessageSpy = vi.fn(async () => undefined);
const sendOraclePredictionSpy = vi.fn(async () => undefined);
const resolveBuilderInteractionSpy = vi.fn(async () => undefined);
const launchBuilderTaskFromChatSpy = vi.fn(async () => undefined);
const setSelectedBuilderProjectIdSpy = vi.fn();
const setExecutionPluginIdSpy = vi.fn();
const setExecutionModeSpy = vi.fn();
const startBuilderOnboardingSpy = vi.fn();
const updateBuilderOnboardingSpecSpy = vi.fn();
const setBuilderOnboardingStepSpy = vi.fn();
const cancelBuilderOnboardingSpy = vi.fn();
const confirmBuilderOnboardingSpy = vi.fn(async () => undefined);

vi.mock("@/components/chat/AgenticSetupDrawer", () => ({
  AgenticSetupDrawer: () => null,
}));

afterEach(() => {
  sendMessageSpy.mockClear();
  sendOraclePredictionSpy.mockClear();
  resolveBuilderInteractionSpy.mockClear();
  launchBuilderTaskFromChatSpy.mockClear();
  setSelectedBuilderProjectIdSpy.mockClear();
  setExecutionPluginIdSpy.mockClear();
  setExecutionModeSpy.mockClear();
  startBuilderOnboardingSpy.mockClear();
  updateBuilderOnboardingSpecSpy.mockClear();
  setBuilderOnboardingStepSpy.mockClear();
  cancelBuilderOnboardingSpy.mockClear();
  confirmBuilderOnboardingSpy.mockClear();
  cleanup();
});

function createBuilderCard(overrides?: Partial<BuilderChatCard>): BuilderChatCard {
  return {
    id: "interaction-1",
    interactionId: "interaction-1",
    kind: "mcp_contract_drift",
    status: "pending",
    projectId: "project-1",
    projectName: "Alpha",
    projectRelativePath: "workspace/alpha",
    runId: "run-1",
    title: "Approve Builder contract rollover",
    summary: "Builder contract drift needs a decision.",
    state: "drifted",
    progress: undefined,
    details: undefined,
    badges: undefined,
    recommendations: ["Review API changes"],
    actions: [{ id: "approve", label: "approve", variant: "primary" }],
    updatedAt: "2026-04-16T17:00:00.000Z",
    resolvedAt: null,
    resolutionReason: null,
    ...overrides,
  };
}

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
    defaultMode: "ask",
    defaultPluginId: "just-chatting",
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
  const [currentConversation, setCurrentConversation] = useState<ChatConversationDetail | null>(createDetail({ id: "active-1", label: "Ops triage", title: "Ops triage", archivedAt: null }));
  const [allRecentConversations, setAllRecentConversations] = useState<ChatConversationSummary[]>([
    createSummary(),
    createSummary({
      id: "active-2",
      title: "Roadmap follow-up",
      label: "Roadmap follow-up",
      preview: "Need a sharper archive flow.",
      updatedAt: "2026-04-01T12:30:00.000Z",
      lastMessageAt: "2026-04-01T12:30:00.000Z",
      messageCount: 4,
    }),
    ...Array.from({ length: 5 }, (_, index) => createSummary({
      id: `active-extra-${index + 1}`,
      title: `Extra active ${index + 1}`,
      label: `Extra active ${index + 1}`,
      preview: `Extra active preview ${index + 1}`,
      updatedAt: `2026-04-0${index + 1}T09:00:00.000Z`,
      lastMessageAt: `2026-04-0${index + 1}T09:30:00.000Z`,
      messageCount: index + 1,
    })),
  ]);
  const [allArchivedConversations, setAllArchivedConversations] = useState<ChatConversationSummary[]>([
    createSummary({
      id: "archived-1",
      title: null,
      label: "Archived ops thread",
      preview: "Please archive this thread.",
      archivedAt: "2026-04-01T13:00:00.000Z",
      lastMessageAt: "2026-04-01T11:05:00.000Z",
    }),
    ...Array.from({ length: 6 }, (_, index) => createSummary({
      id: `archived-extra-${index + 1}`,
      title: `Archived extra ${index + 1}`,
      label: `Archived extra ${index + 1}`,
      preview: `Archived preview ${index + 1}`,
      archivedAt: `2026-03-0${index + 1}T13:00:00.000Z`,
      lastMessageAt: `2026-03-0${index + 1}T11:05:00.000Z`,
    })),
  ]);
  const [historyFilters, setHistoryFilters] = useState<ChatConversationHistoryFilters>({ search: "", from: null, to: null });
  const [recentPage, setRecentPage] = useState(1);
  const [archivedPage, setArchivedPage] = useState(1);
  const [historyConversation, setHistoryConversation] = useState<ChatConversationDetail | null>(null);

  function applyFilters(items: ChatConversationSummary[]) {
    return items.filter((entry) => {
      const matchesSearch = historyFilters.search
        ? `${entry.label} ${entry.preview ?? ""}`.toLowerCase().includes(historyFilters.search.toLowerCase())
        : true;
      const updatedDate = entry.updatedAt.slice(0, 10);
      const matchesFrom = historyFilters.from ? updatedDate >= historyFilters.from : true;
      const matchesTo = historyFilters.to ? updatedDate <= historyFilters.to : true;
      return matchesSearch && matchesFrom && matchesTo;
    });
  }

  function buildPagination(items: ChatConversationSummary[], currentPage: number): ChatConversationPagination {
    const totalItems = items.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    return {
      currentPage: Math.min(currentPage, totalPages),
      pageSize: PAGE_SIZE,
      totalItems,
      totalPages,
    };
  }

  function slicePage(items: ChatConversationSummary[], pagination: ChatConversationPagination) {
    const start = (pagination.currentPage - 1) * pagination.pageSize;
    return items.slice(start, start + pagination.pageSize);
  }

  const filteredRecent = applyFilters(allRecentConversations);
  const filteredArchived = applyFilters(allArchivedConversations);
  const recentPagination = buildPagination(filteredRecent, recentPage);
  const archivedPagination = buildPagination(filteredArchived, archivedPage);
  const recentConversations = slicePage(filteredRecent, recentPagination);
  const archivedConversations = slicePage(filteredArchived, archivedPagination);

  function buildDetail(nextConversationId: string): ChatConversationDetail {
    const summary = allRecentConversations.find((entry) => entry.id === nextConversationId)
      ?? allArchivedConversations.find((entry) => entry.id === nextConversationId)
      ?? createSummary({ id: nextConversationId, label: nextConversationId, title: nextConversationId });

    return createDetail({
      ...summary,
      title: summary.title,
      label: summary.label,
      preview: summary.preview,
      archivedAt: summary.archivedAt,
      lastMessageAt: summary.lastMessageAt,
      messageCount: summary.messageCount,
      messages: [
        { id: `m-${nextConversationId}-1`, role: "USER", content: `Opened ${summary.label}.`, createdAt: summary.createdAt },
        { id: `m-${nextConversationId}-2`, role: "ASSISTANT", content: `Previewing ${summary.label}.`, createdAt: summary.updatedAt },
      ],
    });
  }

  const chat: UseChatResult = {
    messages: [{
      id: "entry-1",
      role: "assistant",
      content: "Here is the live chat.",
      chatMode: "agent",
      chatPluginId: "content",
      attachments: [{ type: "knowledge-doc", path: "knowledge/brief.md", label: "brief.md" }],
    }],
    builderInbox: [],
    builderProjects: [
      { id: "project-1", name: "Alpha", relativePath: "workspace/alpha" },
    ],
    builderStackPresets: [],
    builderTemplates: [],
    builderOnboarding: null,
    selectedBuilderProjectId: "project-1",
    activeBuilderProgress: null,
    conversationId,
    currentConversation,
    recentConversations,
    archivedConversations,
    recentPagination,
    archivedPagination,
    historyFilters,
    historyConversation,
    isPending: false,
    isBootstrapping: false,
    isLoadingHistoryConversation: false,
    isLoadingHistoryLists: false,
    modelPricing: {
      "gpt-4o": {
        promptUsdPerMillion: 10,
        completionUsdPerMillion: 20,
      },
    },
    executionCatalog: {
      defaults: {
        mode: "ask",
        pluginId: "just-chatting",
      },
      plugins: [
        {
          id: "just-chatting",
          displayName: "Just Chatting",
          description: "Full-context chat and planning without tool execution.",
          accentColor: "#38bdf8",
          accentSurface: "rgba(56,189,248,0.12)",
          accentBorder: "rgba(56,189,248,0.36)",
          toollessInAsk: true,
          toollessInAgent: true,
        },
        {
          id: "oracle",
          displayName: "Oracle",
          description: "Market-focused prediction and evidence gathering.",
          accentColor: "#facc15",
          accentSurface: "rgba(250,204,21,0.14)",
          accentBorder: "rgba(250,204,21,0.36)",
          toollessInAsk: true,
          toollessInAgent: false,
        },
      ],
    },
    executionMode: "ask",
    executionPluginId: "just-chatting",
    setExecutionMode: setExecutionModeSpy,
    setExecutionPluginId: setExecutionPluginIdSpy,
    setSelectedBuilderProjectId: setSelectedBuilderProjectIdSpy,
    startBuilderOnboarding: startBuilderOnboardingSpy,
    updateBuilderOnboardingSpec: updateBuilderOnboardingSpecSpy,
    setBuilderOnboardingStep: setBuilderOnboardingStepSpy,
    cancelBuilderOnboarding: cancelBuilderOnboardingSpy,
    confirmBuilderOnboarding: confirmBuilderOnboardingSpy,
    resolveBuilderInteraction: resolveBuilderInteractionSpy,
    launchBuilderTaskFromChat: launchBuilderTaskFromChatSpy,
    activeRun: {
      conversationId,
      runId: "run-live-1",
      profile: null,
      profileLabel: null,
      provider: "openai",
      model: "gpt-4o",
      startedAt: "2026-04-01T12:00:00.000Z",
      requestCount: 3,
      promptTokens: 120,
      completionTokens: 45,
      totalTokens: 165,
      cachedPromptTokens: 12,
    },
    sendMessage: sendMessageSpy,
    sendOraclePrediction: sendOraclePredictionSpy,
    startNewChat: vi.fn(() => {
      setConversationId(null);
      setCurrentConversation(null);
    }),
    loadConversation: vi.fn(async (nextConversationId: string) => {
      setConversationId(nextConversationId);
      setCurrentConversation(buildDetail(nextConversationId));
      setHistoryConversation(null);
    }),
    archiveConversation: vi.fn(async (nextConversationId: string) => {
      const archivedSummary = allRecentConversations.find((entry) => entry.id === nextConversationId);
      if (!archivedSummary) {
        return;
      }

      setAllRecentConversations((current) => current.filter((entry) => entry.id !== nextConversationId));
      setAllArchivedConversations((current) => [
        {
          ...archivedSummary,
          archivedAt: "2026-04-01T14:00:00.000Z",
        },
        ...current,
      ]);

      if (conversationId === nextConversationId) {
        setConversationId(null);
        setCurrentConversation(null);
      }

      if (historyConversation?.id === nextConversationId) {
        setHistoryConversation(null);
      }
    }),
    archiveCurrentConversation: vi.fn(async () => {
      setAllArchivedConversations((current) => [
        createSummary({ id: "active-1", title: "Ops triage", archivedAt: "2026-04-01T14:00:00.000Z", preview: "Latest assistant reply" }),
        ...current,
      ]);
      setAllRecentConversations((current) => current.filter((entry) => entry.id !== "active-1"));
      setConversationId(null);
      setCurrentConversation(null);
    }),
    openHistoryConversation: vi.fn(async (nextConversationId: string) => {
      setHistoryConversation(buildDetail(nextConversationId));
    }),
    restoreConversation: vi.fn(async (nextConversationId: string) => {
      const restoredSummary = allArchivedConversations.find((entry) => entry.id === nextConversationId);
      setConversationId(nextConversationId);
      setCurrentConversation(buildDetail(nextConversationId));
      setHistoryConversation(null);
      setAllArchivedConversations((current) => current.filter((entry) => entry.id !== nextConversationId));
      if (restoredSummary) {
        setAllRecentConversations((current) => [
          {
            ...restoredSummary,
            archivedAt: null,
            preview: "Thread archived for review.",
          },
          ...current,
        ]);
      }
    }),
    deleteConversation: vi.fn(async (nextConversationId: string) => {
      setAllArchivedConversations((current) => current.filter((entry) => entry.id !== nextConversationId));
      setAllRecentConversations((current) => current.filter((entry) => entry.id !== nextConversationId));
      setHistoryConversation((current) => current?.id === nextConversationId ? null : current);
      setConversationId((current) => current === nextConversationId ? null : current);
      setCurrentConversation((current) => current?.id === nextConversationId ? null : current);
    }),
    applyHistoryFilters: vi.fn(async (nextFilters: ChatConversationHistoryFilters) => {
      setHistoryFilters(nextFilters);
      setRecentPage(1);
      setArchivedPage(1);
    }),
    clearHistoryFilters: vi.fn(async () => {
      setHistoryFilters({ search: "", from: null, to: null });
      setRecentPage(1);
      setArchivedPage(1);
    }),
    setRecentHistoryPage: (value) => setRecentPage((current) => typeof value === "function" ? value(current) : value),
    setArchivedHistoryPage: (value) => setArchivedPage((current) => typeof value === "function" ? value(current) : value),
  };

  return <ChatWorkspaceContent chat={chat} setupOpen={false} closeSetupHref="/chat" />;
}

function BuilderHarness({ cards = [createBuilderCard()] }: { cards?: BuilderChatCard[] } = {}) {
  const chat: UseChatResult = {
    messages: [],
    builderInbox: cards,
    builderProjects: [
      { id: "project-1", name: "Alpha", relativePath: "workspace/alpha" },
      { id: "project-2", name: "Beta", relativePath: "workspace/beta" },
    ],
    builderStackPresets: [
      { key: "next-tailwind", displayName: "Next.js + Tailwind", description: "App Router with Tailwind.", template: "next-app", packageManager: "NPM", tags: ["react", "nextjs", "tailwind"] },
    ],
    builderTemplates: [
      { key: "node-cli", displayName: "Node CLI", description: "Minimal TS CLI package.", defaultPackageManager: "NPM" },
      { key: "next-app", displayName: "Next App", description: "Next.js App Router app.", defaultPackageManager: "NPM" },
    ],
    builderOnboarding: null,
    selectedBuilderProjectId: "project-1",
    activeBuilderProgress: null,
    conversationId: "conv-builder",
    currentConversation: createDetail({ id: "conv-builder", label: "Builder chat", title: "Builder chat", archivedAt: null }),
    recentConversations: [createSummary({ id: "conv-builder", label: "Builder chat", title: "Builder chat" })],
    archivedConversations: [],
    recentPagination: { currentPage: 1, pageSize: PAGE_SIZE, totalItems: 1, totalPages: 1 },
    archivedPagination: { currentPage: 1, pageSize: PAGE_SIZE, totalItems: 0, totalPages: 1 },
    historyFilters: { search: "", from: null, to: null },
    historyConversation: null,
    isPending: false,
    isBootstrapping: false,
    isLoadingHistoryConversation: false,
    isLoadingHistoryLists: false,
    activeRun: {
      conversationId: "conv-builder",
      runId: "run-builder",
      profile: null,
      profileLabel: null,
      provider: "openai",
      model: "gpt-4o",
      startedAt: "2026-04-01T12:00:00.000Z",
      requestCount: 1,
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
      cachedPromptTokens: 0,
    },
    modelPricing: {},
    executionCatalog: {
      defaults: { mode: "agent", pluginId: "builder" },
      plugins: [
        {
          id: "builder",
          displayName: "Builder",
          description: "Launch and govern Builder work from chat.",
          accentColor: "#f59e0b",
          accentSurface: "rgba(245,158,11,0.12)",
          accentBorder: "rgba(245,158,11,0.36)",
          toollessInAsk: false,
          toollessInAgent: false,
        },
      ],
    },
    executionMode: "agent",
    executionPluginId: "builder",
    setExecutionMode: vi.fn(),
    setExecutionPluginId: vi.fn(),
    setSelectedBuilderProjectId: setSelectedBuilderProjectIdSpy,
    startBuilderOnboarding: startBuilderOnboardingSpy,
    updateBuilderOnboardingSpec: updateBuilderOnboardingSpecSpy,
    setBuilderOnboardingStep: setBuilderOnboardingStepSpy,
    cancelBuilderOnboarding: cancelBuilderOnboardingSpy,
    confirmBuilderOnboarding: confirmBuilderOnboardingSpy,
    resolveBuilderInteraction: resolveBuilderInteractionSpy,
    launchBuilderTaskFromChat: launchBuilderTaskFromChatSpy,
    sendMessage: sendMessageSpy,
    sendOraclePrediction: sendOraclePredictionSpy,
    startNewChat: vi.fn(),
    loadConversation: vi.fn(async () => undefined),
    archiveConversation: vi.fn(async () => undefined),
    archiveCurrentConversation: vi.fn(async () => undefined),
    openHistoryConversation: vi.fn(async () => undefined),
    restoreConversation: vi.fn(async () => undefined),
    deleteConversation: vi.fn(async () => undefined),
    applyHistoryFilters: vi.fn(async () => undefined),
    clearHistoryFilters: vi.fn(async () => undefined),
    setRecentHistoryPage: vi.fn(),
    setArchivedHistoryPage: vi.fn(),
  };

  return <ChatWorkspaceContent chat={chat} setupOpen={false} closeSetupHref="/chat" />;
}

describe("chat workspace history panel", () => {
  it("toggles between chat and history panels", async () => {
    render(<Harness />);

    expect(screen.getByText("active conversation")).toBeTruthy();
    expect(screen.getByText(/tokens/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open history" }));
    expect(screen.getByText("conversation history")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open history" }));
    expect(screen.getByText("active conversation")).toBeTruthy();
  });

  it("opens a history conversation for preview without restoring it", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Open history" }));
    expect(screen.getByText("Archived ops thread")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[0]);

    await waitFor(() => {
      expect(screen.getByText("History preview")).toBeTruthy();
      expect(screen.getByText("Previewing Ops triage.")).toBeTruthy();
    });

    expect(screen.queryByText("No archived chats yet.")).toBeNull();
  });

  it("shows archive and delete actions from the history page for active chats", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Harness />);

    expect(screen.getByRole("button", { name: "Archive Chat" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open history" }));
    const recentSection = screen.getByText("Recent").closest("div");
    expect(recentSection).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Archive" })[0]);
    await waitFor(() => expect(screen.getByText("8 total")).toBeTruthy());

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    await waitFor(() => expect(screen.queryByText("Roadmap follow-up")).toBeNull());

    expect(confirmSpy).toHaveBeenCalled();
  });

  it("restores an archived conversation back into the active chat view", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Open history" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Restore" })[0]);

    await waitFor(() => {
      expect(screen.getByText("active conversation")).toBeTruthy();
      expect(screen.getByText("Archived ops thread")).toBeTruthy();
    });
  });

  it("paginates recent and archived history lists", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Open history" }));

    expect(screen.getAllByText(/page 1 \/ 2/i).length).toBe(2);
    expect(screen.queryByText("Extra active 5")).toBeNull();
    expect(screen.queryByText("Archived extra 6")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "next" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "next" })[1]);

    await waitFor(() => {
      expect(screen.getByText("Extra active 5")).toBeTruthy();
      expect(screen.getByText("Archived extra 6")).toBeTruthy();
    });
  });

  it("applies shared search and date filters to both history lists", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Open history" }));
    fireEvent.change(screen.getByPlaceholderText("Search titles, summaries, or messages"), { target: { value: "roadmap" } });
    fireEvent.change(screen.getByLabelText("updated from"), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByLabelText("updated to"), { target: { value: "2026-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(screen.getByText("Roadmap follow-up")).toBeTruthy();
      expect(screen.getByText("1 total")).toBeTruthy();
      expect(screen.getByText("No archived chats match the current filters.")).toBeTruthy();
    });
  });

  it("shows live run metrics in the active conversation header", async () => {
    render(<Harness />);

    expect(screen.getByText(/requests/i)).toBeTruthy();
    expect(screen.getByText(/tokens/i)).toBeTruthy();
    expect(screen.getByText(/cost/i)).toBeTruthy();
    expect(screen.getByText(/165/)).toBeTruthy();
    expect(screen.getByText(/120/)).toBeTruthy();
    expect(screen.getByText(/45/)).toBeTruthy();
    expect(screen.getByText(/\$0\.0021/)).toBeTruthy();
    expect(screen.getByText(/cached/i)).toBeTruthy();
  });

  it("auto-switches to Oracle plugin and sends via sendMessage when oracle intent is detected on submit", async () => {
    render(<Harness />);

    fireEvent.change(screen.getByPlaceholderText("Draft a launch thread about our product update..."), {
      target: { value: "oracle predict btc 150k" },
    });

    const form = screen.getByPlaceholderText("Draft a launch thread about our product update...").closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(setExecutionModeSpy).toHaveBeenCalledWith("agent");
      expect(setExecutionPluginIdSpy).toHaveBeenCalledWith("oracle");
      expect(sendMessageSpy).toHaveBeenCalledWith("oracle predict btc 150k", expect.objectContaining({
        mode: "agent",
        pluginId: "oracle",
      }));
    });

    expect((screen.getByPlaceholderText("Draft a launch thread about our product update...") as HTMLInputElement).value).toBe("");
  });

  it("shows per-message execution chips in the transcript", () => {
    render(<Harness />);

    expect(screen.getAllByText("content").length).toBeGreaterThan(0);
    expect(screen.getAllByText("agent").length).toBeGreaterThan(0);
    expect(screen.getByText("doc: brief.md")).toBeTruthy();
  });

  it("resolves Builder inbox cards from chat", async () => {
    render(<BuilderHarness />);

    fireEvent.click(screen.getByRole("button", { name: "approve" }));

    await waitFor(() => {
      expect(resolveBuilderInteractionSpy).toHaveBeenCalledWith("interaction-1", "approve");
    });
  });

  it("launches Builder tasks from the chat composer", async () => {
    render(<BuilderHarness />);

    fireEvent.change(screen.getByPlaceholderText("Describe what to build or change in the selected project..."), {
      target: { value: "Implement archive and delete cards" },
    });
    fireEvent.change(screen.getByDisplayValue("Alpha · workspace/alpha"), {
      target: { value: "project-2" },
    });

    expect(setSelectedBuilderProjectIdSpy).toHaveBeenCalledWith("project-2");

    const composer = screen.getByPlaceholderText("Describe what to build or change in the selected project...").closest("form");
    expect(composer).toBeTruthy();
    fireEvent.submit(composer!);

    await waitFor(() => {
      expect(launchBuilderTaskFromChatSpy).toHaveBeenCalledWith("Implement archive and delete cards", { projectId: "project-1" });
    });
  });

  it("renders task progress without showing a null iteration denominator", () => {
    render(<BuilderHarness cards={[createBuilderCard({
      kind: "task_execution",
      status: "running",
      title: "Repair builder loop",
      summary: "Builder is repairing the verification step.",
      state: "testing",
      progress: {
        currentIteration: 2,
        maxIterations: null,
        loopPhase: "verifying",
        latestLoopSummary: "Re-running tests after repair.",
      },
      recommendations: [],
      actions: [],
    })]} />);

    expect(screen.getByText("verifying")).toBeTruthy();
    expect(screen.getByText("iteration 2")).toBeTruthy();
    expect(screen.queryByText("iteration 2 of null")).toBeNull();
    expect(screen.getByText("Re-running tests after repair.")).toBeTruthy();
  });

  it("renders structured drift details when expanded", () => {
    render(<BuilderHarness cards={[createBuilderCard({
      details: {
        dependencyDrift: {
          packageManagerChanged: false,
          lockfileChanged: true,
          packages: [
            { label: "packages added", items: ["zod"] },
            { label: "packages changed", items: ["next"] },
          ],
          scripts: [
            { label: "scripts added", items: ["verify"] },
          ],
        },
      },
    })]} />);

    fireEvent.click(screen.getByText("drift details"));

    expect(screen.getByText("dependency contract")).toBeTruthy();
    expect(screen.getByText("Lockfile changed.")).toBeTruthy();
    expect(screen.getByText("packages added")).toBeTruthy();
    expect(screen.getByText("zod")).toBeTruthy();
    expect(screen.getByText("verify")).toBeTruthy();
  });
});

/* ── Builder onboarding ── */

function OnboardingHarness({ onboarding }: { onboarding?: UseChatResult["builderOnboarding"] }) {
  const chat: UseChatResult = {
    messages: [],
    builderInbox: [],
    builderProjects: [
      { id: "project-1", name: "Alpha", relativePath: "workspace/alpha" },
    ],
    builderStackPresets: [
      { key: "next-tailwind", displayName: "Next.js + Tailwind", description: "App Router with Tailwind.", template: "next-app", packageManager: "NPM", tags: ["react", "nextjs", "tailwind"] },
    ],
    builderTemplates: [
      { key: "node-cli", displayName: "Node CLI", description: "Minimal TS CLI package.", defaultPackageManager: "NPM" },
      { key: "next-app", displayName: "Next App", description: "Next.js App Router app.", defaultPackageManager: "NPM" },
    ],
    builderOnboarding: onboarding ?? null,
    selectedBuilderProjectId: "project-1",
    activeBuilderProgress: null,
    conversationId: "conv-onb",
    currentConversation: null,
    recentConversations: [],
    archivedConversations: [],
    recentPagination: { currentPage: 1, pageSize: PAGE_SIZE, totalItems: 0, totalPages: 1 },
    archivedPagination: { currentPage: 1, pageSize: PAGE_SIZE, totalItems: 0, totalPages: 1 },
    historyFilters: { search: "", from: null, to: null },
    historyConversation: null,
    isPending: false,
    isBootstrapping: false,
    isLoadingHistoryConversation: false,
    isLoadingHistoryLists: false,
    activeRun: {
      conversationId: "conv-onb",
      runId: "run-onb",
      profile: null,
      profileLabel: null,
      provider: "openai",
      model: "gpt-4o",
      startedAt: "2026-04-01T12:00:00.000Z",
      requestCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedPromptTokens: 0,
    },
    modelPricing: {},
    executionCatalog: {
      defaults: { mode: "agent", pluginId: "builder" },
      plugins: [
        {
          id: "builder",
          displayName: "Builder",
          description: "Launch and govern Builder work from chat.",
          accentColor: "#f59e0b",
          accentSurface: "rgba(245,158,11,0.12)",
          accentBorder: "rgba(245,158,11,0.36)",
          toollessInAsk: false,
          toollessInAgent: false,
        },
      ],
    },
    executionMode: "agent",
    executionPluginId: "builder",
    setExecutionMode: vi.fn(),
    setExecutionPluginId: vi.fn(),
    setSelectedBuilderProjectId: setSelectedBuilderProjectIdSpy,
    startBuilderOnboarding: startBuilderOnboardingSpy,
    updateBuilderOnboardingSpec: updateBuilderOnboardingSpecSpy,
    setBuilderOnboardingStep: setBuilderOnboardingStepSpy,
    cancelBuilderOnboarding: cancelBuilderOnboardingSpy,
    confirmBuilderOnboarding: confirmBuilderOnboardingSpy,
    resolveBuilderInteraction: resolveBuilderInteractionSpy,
    launchBuilderTaskFromChat: launchBuilderTaskFromChatSpy,
    sendMessage: sendMessageSpy,
    sendOraclePrediction: sendOraclePredictionSpy,
    startNewChat: vi.fn(),
    loadConversation: vi.fn(async () => undefined),
    archiveConversation: vi.fn(async () => undefined),
    archiveCurrentConversation: vi.fn(async () => undefined),
    openHistoryConversation: vi.fn(async () => undefined),
    restoreConversation: vi.fn(async () => undefined),
    deleteConversation: vi.fn(async () => undefined),
    applyHistoryFilters: vi.fn(async () => undefined),
    clearHistoryFilters: vi.fn(async () => undefined),
    setRecentHistoryPage: vi.fn(),
    setArchivedHistoryPage: vi.fn(),
  };

  return <ChatWorkspaceContent chat={chat} setupOpen={false} closeSetupHref="/chat" />;
}

describe("builder onboarding", () => {
  it("shows builder welcome when builder plugin is active and no messages", () => {
    render(<OnboardingHarness />);
    expect(screen.getByTestId("builder-welcome")).toBeTruthy();
    expect(screen.getByTestId("builder-new-project")).toBeTruthy();
    // existing project card
    expect(screen.getByTestId("builder-project-project-1")).toBeTruthy();
  });

  it("clicking new project triggers startBuilderOnboarding", () => {
    render(<OnboardingHarness />);
    fireEvent.click(screen.getByTestId("builder-new-project"));
    expect(startBuilderOnboardingSpy).toHaveBeenCalled();
  });

  it("renders the naming step", () => {
    render(
      <OnboardingHarness
        onboarding={{
          step: "naming",
          spec: { name: "", description: "", stackPresetKey: "", template: "", packageManager: "NPM", docker: true, git: true },
        }}
      />,
    );
    expect(screen.getByTestId("builder-onboarding")).toBeTruthy();
    expect(screen.getByTestId("onboarding-name-input")).toBeTruthy();
    expect(screen.getByTestId("onboarding-desc-input")).toBeTruthy();
    // welcome should not appear during onboarding
    expect(screen.queryByTestId("builder-welcome")).toBeNull();
  });

  it("renders the stack selection step", () => {
    render(
      <OnboardingHarness
        onboarding={{
          step: "stack",
          spec: { name: "My App", description: "A test app", stackPresetKey: "", template: "", packageManager: "NPM", docker: true, git: true },
        }}
      />,
    );
    expect(screen.getByTestId("builder-onboarding")).toBeTruthy();
    expect(screen.getByTestId("onboarding-stack-next-tailwind")).toBeTruthy();
  });

  it("renders the configuring step", () => {
    render(
      <OnboardingHarness
        onboarding={{
          step: "configuring",
          spec: { name: "My App", description: "A test app", stackPresetKey: "next-tailwind", template: "next-app", packageManager: "NPM", docker: true, git: true },
        }}
      />,
    );
    expect(screen.getByTestId("builder-onboarding")).toBeTruthy();
    expect(screen.getByTestId("onboarding-template")).toBeTruthy();
    expect(screen.getByTestId("onboarding-pm")).toBeTruthy();
    expect(screen.getByTestId("onboarding-docker")).toBeTruthy();
    expect(screen.getByTestId("onboarding-git")).toBeTruthy();
    expect(screen.getByTestId("onboarding-review")).toBeTruthy();
  });

  it("renders the confirming step with summary and create button", () => {
    render(
      <OnboardingHarness
        onboarding={{
          step: "confirming",
          spec: { name: "My App", description: "A test app", stackPresetKey: "next-tailwind", template: "next-app", packageManager: "NPM", docker: true, git: true },
        }}
      />,
    );
    expect(screen.getByTestId("builder-onboarding")).toBeTruthy();
    expect(screen.getByTestId("onboarding-confirm")).toBeTruthy();
    expect(screen.getByText("My App")).toBeTruthy();
  });

  it("confirm calls confirmBuilderOnboarding", async () => {
    render(
      <OnboardingHarness
        onboarding={{
          step: "confirming",
          spec: { name: "My App", description: "A test app", stackPresetKey: "next-tailwind", template: "next-app", packageManager: "NPM", docker: true, git: true },
        }}
      />,
    );
    fireEvent.click(screen.getByTestId("onboarding-confirm"));
    await waitFor(() => {
      expect(confirmBuilderOnboardingSpy).toHaveBeenCalled();
    });
  });
});
