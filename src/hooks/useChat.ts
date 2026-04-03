"use client";

import { useEffect, useState, useTransition } from "react";
import type {
  ChatConversationBootstrap,
  ChatConversationDetail,
  ChatConversationHistoryFilters,
  ChatConversationMessage,
  ChatConversationPagination,
  ChatConversationSummary,
  ChatConversationUsageSummary,
} from "@/lib/chat/types";
import type { UsageLedgerModelPricing } from "@/lib/agent/usage-ledger-pricing";
import { BIZBOT_SIDECAR_EVENT } from "@/lib/sidecar/types";
import type { SidecarPanel, SidecarAction } from "@/lib/sidecar/types";

export interface ChatEntry {
  id: string;
  role: "user" | "assistant" | "status" | "tool" | "meta";
  content: string;
  runId?: string;
  profile?: string;
  profileLabel?: string;
  provider?: string;
  model?: string;
  name?: string;
  args?: string;
  result?: string;
  round?: number;
  phase?: "call" | "result";
}

interface AgentResponse {
  reply: string;
  conversationId: string;
  runId: string;
}

interface AgentStreamEvent {
  type: "meta" | "usage" | "status" | "tool_call" | "tool_result" | "sidecar" | "assistant_message" | "done" | "error";
  conversationId?: string;
  runId?: string;
  profile?: string;
  profileLabel?: string;
  provider?: string;
  model?: string;
  round?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedPromptTokens?: number;
  requestCount?: number;
  content?: string;
  message?: string;
  reply?: string;
  error?: string;
  name?: string;
  args?: object;
  result?: string;
  action?: SidecarAction;
  panel?: SidecarPanel | null;
}

export interface ActiveRunState {
  conversationId: string | null;
  runId: string | null;
  profile: string | null;
  profileLabel: string | null;
  provider: string | null;
  model: string | null;
  startedAt: string | null;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
}

export interface UseChatResult {
  messages: ChatEntry[];
  conversationId: string | null;
  currentConversation: ChatConversationDetail | null;
  recentConversations: ChatConversationSummary[];
  archivedConversations: ChatConversationSummary[];
  recentPagination: ChatConversationPagination;
  archivedPagination: ChatConversationPagination;
  historyFilters: ChatConversationHistoryFilters;
  historyConversation: ChatConversationDetail | null;
  isPending: boolean;
  isBootstrapping: boolean;
  isLoadingHistoryConversation: boolean;
  isLoadingHistoryLists: boolean;
  activeRun: ActiveRunState;
  modelPricing: Record<string, UsageLedgerModelPricing>;
  sendMessage: (input: string) => Promise<void>;
  startNewChat: () => void;
  loadConversation: (nextConversationId: string) => Promise<void>;
  archiveConversation: (nextConversationId: string) => Promise<void>;
  archiveCurrentConversation: () => Promise<void>;
  openHistoryConversation: (nextConversationId: string) => Promise<void>;
  restoreConversation: (nextConversationId: string) => Promise<void>;
  deleteConversation: (nextConversationId: string) => Promise<void>;
  applyHistoryFilters: (nextFilters: ChatConversationHistoryFilters) => Promise<void>;
  clearHistoryFilters: () => Promise<void>;
  setRecentHistoryPage: React.Dispatch<React.SetStateAction<number>>;
  setArchivedHistoryPage: React.Dispatch<React.SetStateAction<number>>;
}

const SELECTED_CONVERSATION_STORAGE_KEY = "bizbot:selected-chat-conversation-id";

interface InternalActiveRunState extends ActiveRunState {
  runBaseRequestCount: number;
  runBasePromptTokens: number;
  runBaseCompletionTokens: number;
  runBaseTotalTokens: number;
  runBaseCachedPromptTokens: number;
}

const IDLE_ACTIVE_RUN: InternalActiveRunState = {
  conversationId: null,
  runId: null,
  profile: null,
  profileLabel: null,
  provider: null,
  model: null,
  startedAt: null,
  requestCount: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cachedPromptTokens: 0,
  runBaseRequestCount: 0,
  runBasePromptTokens: 0,
  runBaseCompletionTokens: 0,
  runBaseTotalTokens: 0,
  runBaseCachedPromptTokens: 0,
};

const DEFAULT_HISTORY_FILTERS: ChatConversationHistoryFilters = {
  search: "",
  from: null,
  to: null,
};

const DEFAULT_HISTORY_PAGINATION: ChatConversationPagination = {
  currentPage: 1,
  pageSize: 6,
  totalItems: 0,
  totalPages: 1,
};

function getStoredSelectedConversationId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(SELECTED_CONVERSATION_STORAGE_KEY);
}

function persistSelectedConversationId(nextConversationId: string | null): void {
  if (typeof window === "undefined") {
    return;
  }

  if (nextConversationId) {
    window.localStorage.setItem(SELECTED_CONVERSATION_STORAGE_KEY, nextConversationId);
    return;
  }

  window.localStorage.removeItem(SELECTED_CONVERSATION_STORAGE_KEY);
}

function toPublicActiveRun(state: InternalActiveRunState): ActiveRunState {
  return {
    conversationId: state.conversationId,
    runId: state.runId,
    profile: state.profile,
    profileLabel: state.profileLabel,
    provider: state.provider,
    model: state.model,
    startedAt: state.startedAt,
    requestCount: state.requestCount,
    promptTokens: state.promptTokens,
    completionTokens: state.completionTokens,
    totalTokens: state.totalTokens,
    cachedPromptTokens: state.cachedPromptTokens,
  };
}

function createInternalActiveRun(state?: ChatConversationUsageSummary | ActiveRunState | null): InternalActiveRunState {
  if (!state) {
    return { ...IDLE_ACTIVE_RUN };
  }

  return {
    ...state,
    runBaseRequestCount: state.requestCount,
    runBasePromptTokens: state.promptTokens,
    runBaseCompletionTokens: state.completionTokens,
    runBaseTotalTokens: state.totalTokens,
    runBaseCachedPromptTokens: state.cachedPromptTokens,
  };
}

function createEntry(role: ChatEntry["role"], content: string): ChatEntry {
  return {
    id: `${role}-${crypto.randomUUID()}`,
    role,
    content,
  };
}

function appendStreamEntries(
  current: ChatEntry[],
  event: AgentStreamEvent,
): ChatEntry[] {
  switch (event.type) {
    case "meta":
      return [
        ...current,
        {
          id: `meta-${event.runId ?? crypto.randomUUID()}`,
          role: "meta",
          content: `${event.profileLabel ?? event.profile ?? "Agent"} routed this request.`,
          runId: event.runId,
          profile: event.profile,
          profileLabel: event.profileLabel,
          provider: event.provider,
          model: event.model,
        },
      ];
    case "status":
      return [...current, createEntry("status", event.message ?? "Working...")];
    case "tool_call":
      return [
        ...current,
        {
          id: `tool-call-${event.runId ?? crypto.randomUUID()}-${event.name ?? "tool"}-${event.round ?? 0}`,
          role: "tool",
          content: `Calling ${event.name ?? "tool"}`,
          name: event.name,
          args: event.args ? JSON.stringify(event.args, null, 2) : undefined,
          round: event.round,
          phase: "call",
        },
      ];
    case "tool_result":
      return [
        ...current,
        {
          id: `tool-result-${event.runId ?? crypto.randomUUID()}-${event.name ?? "tool"}-${event.round ?? 0}`,
          role: "tool",
          content: `${event.name ?? "tool"} completed.`,
          name: event.name,
          result: event.result,
          round: event.round,
          phase: "result",
        },
      ];
    case "assistant_message":
      return [...current, createEntry("assistant", event.content ?? "")];
    case "error":
      return [...current, createEntry("assistant", `Request failed: ${event.error ?? "Unknown error"}`)];
    default:
      return current;
  }
}

function parseSsePayload(buffer: string): {
  events: AgentStreamEvent[];
  remainder: string;
} {
  const blocks = buffer.split("\n\n");
  const remainder = blocks.pop() ?? "";
  const events: AgentStreamEvent[] = [];

  for (const block of blocks) {
    const dataLine = block
      .split("\n")
      .find((line) => line.startsWith("data: "));
    if (!dataLine) {
      continue;
    }

    try {
      events.push(JSON.parse(dataLine.slice(6)) as AgentStreamEvent);
    } catch {
      // ignore malformed event
    }
  }

  return { events, remainder };
}

function mapConversationMessageToEntry(message: ChatConversationMessage): ChatEntry {
  if (message.role === "USER") {
    return createEntry("user", message.content);
  }

  if (message.role === "ASSISTANT") {
    return createEntry("assistant", message.content);
  }

  if (message.role === "TOOL") {
    return createEntry("tool", message.content);
  }

  return createEntry("meta", message.content);
}

function mapConversationMessages(messages: ChatConversationMessage[]): ChatEntry[] {
  return messages.map(mapConversationMessageToEntry);
}

async function readJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

export function useChat(): UseChatResult {
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [currentConversation, setCurrentConversation] = useState<ChatConversationDetail | null>(null);
  const [recentConversations, setRecentConversations] = useState<ChatConversationSummary[]>([]);
  const [archivedConversations, setArchivedConversations] = useState<ChatConversationSummary[]>([]);
  const [recentPagination, setRecentPagination] = useState<ChatConversationPagination>(DEFAULT_HISTORY_PAGINATION);
  const [archivedPagination, setArchivedPagination] = useState<ChatConversationPagination>(DEFAULT_HISTORY_PAGINATION);
  const [historyFilters, setHistoryFilters] = useState<ChatConversationHistoryFilters>(DEFAULT_HISTORY_FILTERS);
  const [historyConversation, setHistoryConversation] = useState<ChatConversationDetail | null>(null);
  const [activeRun, setActiveRun] = useState<InternalActiveRunState>(IDLE_ACTIVE_RUN);
  const [modelPricing, setModelPricing] = useState<Record<string, UsageLedgerModelPricing>>({});
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isLoadingHistoryConversation, setIsLoadingHistoryConversation] = useState(false);
  const [isLoadingHistoryLists, setIsLoadingHistoryLists] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function loadBootstrap(options?: {
    selectedConversationId?: string | null;
    replaceCurrent?: boolean;
    recentPage?: number;
    archivedPage?: number;
    historyFilters?: ChatConversationHistoryFilters;
  }): Promise<void> {
    const replaceCurrent = options?.replaceCurrent ?? false;
    const nextConversationId = options?.selectedConversationId ?? conversationId;
    const nextRecentPage = options?.recentPage ?? recentPagination.currentPage;
    const nextArchivedPage = options?.archivedPage ?? archivedPagination.currentPage;
    const nextFilters = options?.historyFilters ?? historyFilters;
    const params = new URLSearchParams();
    if (nextConversationId) {
      params.set("selectedId", nextConversationId);
    }
    params.set("recentPage", String(nextRecentPage));
    params.set("archivedPage", String(nextArchivedPage));
    params.set("historyPageSize", String(recentPagination.pageSize || DEFAULT_HISTORY_PAGINATION.pageSize));
    if (nextFilters.search) {
      params.set("historySearch", nextFilters.search);
    }
    if (nextFilters.from) {
      params.set("historyFrom", nextFilters.from);
    }
    if (nextFilters.to) {
      params.set("historyTo", nextFilters.to);
    }

    const response = await fetch(`/api/chat/conversations${params.toString() ? `?${params.toString()}` : ""}`);
    const payload = await readJson<ChatConversationBootstrap & { error?: string }>(response);

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load chat conversations.");
    }

    setRecentConversations(payload.recentConversations);
    setArchivedConversations(payload.archivedConversations);
    setRecentPagination(payload.recentPagination);
    setArchivedPagination(payload.archivedPagination);
    setHistoryFilters(payload.historyFilters);
    setModelPricing(payload.modelPricing);
    setConversationId(payload.currentConversationId);
    setCurrentConversation(payload.currentConversation);
    persistSelectedConversationId(payload.currentConversationId);

    if (replaceCurrent) {
      setMessages(payload.currentConversation ? mapConversationMessages(payload.currentConversation.messages) : []);
      setActiveRun(createInternalActiveRun(payload.activeRun));
    }

    setHistoryConversation((current) => {
      if (!current) {
        return current;
      }

      const stillVisible = payload.archivedConversations.some((conversation) => conversation.id === current.id)
        || payload.recentConversations.some((conversation) => conversation.id === current.id);

      return stillVisible ? current : null;
    });
  }

  useEffect(() => {
    void (async () => {
      try {
        await loadBootstrap({
          selectedConversationId: getStoredSelectedConversationId(),
          replaceCurrent: true,
        });
      } finally {
        setIsBootstrapping(false);
      }
    })();
    // Initial bootstrap is intentionally one-time; later refreshes are explicit user actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadConversation(nextConversationId: string): Promise<void> {
    setIsBootstrapping(true);
    try {
      await loadBootstrap({ selectedConversationId: nextConversationId, replaceCurrent: true });
    } finally {
      setIsBootstrapping(false);
    }
  }

  function startNewChat(): void {
    setConversationId(null);
    setCurrentConversation(null);
    setMessages([]);
    setActiveRun(IDLE_ACTIVE_RUN);
    setHistoryConversation(null);
    persistSelectedConversationId(null);
  }

  async function openHistoryConversation(nextConversationId: string): Promise<void> {
    setIsLoadingHistoryConversation(true);
    try {
      const response = await fetch(`/api/chat/conversations/${nextConversationId}`);
      const payload = await readJson<{ conversation?: ChatConversationDetail; error?: string }>(response);

      if (!response.ok || !payload.conversation) {
        throw new Error(payload.error ?? "Failed to load conversation.");
      }

      setHistoryConversation(payload.conversation);
    } finally {
      setIsLoadingHistoryConversation(false);
    }
  }

  async function archiveConversation(nextConversationId: string): Promise<void> {
    const response = await fetch(`/api/chat/conversations/${nextConversationId}/archive`, { method: "POST" });
    const payload = await readJson<{ error?: string }>(response);

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to archive conversation.");
    }

    setHistoryConversation((current) => current?.id === nextConversationId ? null : current);
    setIsBootstrapping(true);
    try {
      const nextSelectedConversationId = conversationId === nextConversationId ? null : conversationId;
      await loadBootstrap({
        selectedConversationId: nextSelectedConversationId,
        replaceCurrent: conversationId === nextConversationId,
      });
    } finally {
      setIsBootstrapping(false);
    }
  }

  async function archiveCurrentConversation(): Promise<void> {
    if (!conversationId) {
      return;
    }

    await archiveConversation(conversationId);
  }

  async function restoreConversation(nextConversationId: string): Promise<void> {
    const response = await fetch(`/api/chat/conversations/${nextConversationId}/restore`, { method: "POST" });
    const payload = await readJson<{ error?: string }>(response);

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to restore conversation.");
    }

    setHistoryConversation(null);
    setIsBootstrapping(true);
    try {
      await loadBootstrap({ selectedConversationId: nextConversationId, replaceCurrent: true });
    } finally {
      setIsBootstrapping(false);
    }
  }

  async function deleteConversation(nextConversationId: string): Promise<void> {
    const response = await fetch(`/api/chat/conversations/${nextConversationId}`, { method: "DELETE" });
    const payload = await readJson<{ error?: string }>(response);

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to delete conversation.");
    }

    setHistoryConversation((current) => current?.id === nextConversationId ? null : current);
    setIsBootstrapping(true);
    try {
      const nextSelectedConversationId = conversationId === nextConversationId ? null : conversationId;
      await loadBootstrap({
        selectedConversationId: nextSelectedConversationId,
        replaceCurrent: true,
      });
    } finally {
      setIsBootstrapping(false);
    }
  }

  async function applyHistoryFilters(nextFilters: ChatConversationHistoryFilters): Promise<void> {
    setIsLoadingHistoryLists(true);
    try {
      await loadBootstrap({
        selectedConversationId: conversationId,
        replaceCurrent: false,
        recentPage: 1,
        archivedPage: 1,
        historyFilters: nextFilters,
      });
    } finally {
      setIsLoadingHistoryLists(false);
    }
  }

  async function clearHistoryFilters(): Promise<void> {
    await applyHistoryFilters(DEFAULT_HISTORY_FILTERS);
  }

  const setRecentHistoryPage: React.Dispatch<React.SetStateAction<number>> = async (value) => {
    const nextPage = Math.max(
      1,
      Math.min(
        typeof value === "function" ? value(recentPagination.currentPage) : value,
        recentPagination.totalPages,
      ),
    );

    setIsLoadingHistoryLists(true);
    try {
      await loadBootstrap({
        selectedConversationId: conversationId,
        replaceCurrent: false,
        recentPage: nextPage,
      });
    } finally {
      setIsLoadingHistoryLists(false);
    }
  };

  const setArchivedHistoryPage: React.Dispatch<React.SetStateAction<number>> = async (value) => {
    const nextPage = Math.max(
      1,
      Math.min(
        typeof value === "function" ? value(archivedPagination.currentPage) : value,
        archivedPagination.totalPages,
      ),
    );

    setIsLoadingHistoryLists(true);
    try {
      await loadBootstrap({
        selectedConversationId: conversationId,
        replaceCurrent: false,
        archivedPage: nextPage,
      });
    } finally {
      setIsLoadingHistoryLists(false);
    }
  };

  async function sendMessage(input: string): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed) return;

    setMessages((current) => [...current, createEntry("user", trimmed)]);

    startTransition(() => {
      fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, conversationId: conversationId ?? undefined, stream: true }),
      })
        .then(async (res) => {
          let nextConversationId = conversationId;

          if (!res.ok || !res.body) {
            const payload = await (res.json() as Promise<Partial<AgentResponse> & { error?: string }>);
            throw new Error(payload.error ?? "Request failed");
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const parsed = parseSsePayload(buffer);
            buffer = parsed.remainder;

            for (const event of parsed.events) {
              if (event.conversationId) {
                nextConversationId = event.conversationId;
                setConversationId(event.conversationId);
                persistSelectedConversationId(event.conversationId);
              }
              if (event.type === "meta") {
                setActiveRun((current) => {
                  const nextConversationId = event.conversationId ?? current.conversationId ?? conversationId;
                  const baseline = current.conversationId === nextConversationId ? current : IDLE_ACTIVE_RUN;

                  return {
                    ...baseline,
                    conversationId: nextConversationId,
                    runId: event.runId ?? null,
                    profile: event.profile ?? baseline.profile,
                    profileLabel: event.profileLabel ?? baseline.profileLabel,
                    provider: event.provider ?? baseline.provider,
                    model: event.model ?? baseline.model,
                    startedAt: new Date().toISOString(),
                    runBaseRequestCount: baseline.requestCount,
                    runBasePromptTokens: baseline.promptTokens,
                    runBaseCompletionTokens: baseline.completionTokens,
                    runBaseTotalTokens: baseline.totalTokens,
                    runBaseCachedPromptTokens: baseline.cachedPromptTokens,
                  };
                });
              } else if (event.type === "usage") {
                setActiveRun((current) => ({
                  ...current,
                  conversationId: event.conversationId ?? current.conversationId,
                  runId: event.runId ?? current.runId,
                  requestCount: current.runBaseRequestCount + (event.requestCount ?? 0),
                  promptTokens: current.runBasePromptTokens + (event.promptTokens ?? 0),
                  completionTokens: current.runBaseCompletionTokens + (event.completionTokens ?? 0),
                  totalTokens: current.runBaseTotalTokens + (event.totalTokens ?? 0),
                  cachedPromptTokens: current.runBaseCachedPromptTokens + (event.cachedPromptTokens ?? 0),
                }));
              } else if (event.type === "sidecar" && event.action) {
                window.dispatchEvent(new CustomEvent(BIZBOT_SIDECAR_EVENT, {
                  detail: {
                    action: event.action,
                    panel: event.panel ?? null,
                  },
                }));
              }
              setMessages((current) => appendStreamEntries(current, event));
            }
          }

          if (nextConversationId) {
            await loadBootstrap({ selectedConversationId: nextConversationId, replaceCurrent: false });
          }
        })
        .catch((error: Error) => {
          setMessages((current) => [
            ...current,
            createEntry("assistant", `Request failed: ${error.message}`),
          ]);
        });
    });
  }

  return {
    messages,
    conversationId,
    currentConversation,
    recentConversations,
    archivedConversations,
    recentPagination,
    archivedPagination,
    historyFilters,
    historyConversation,
    isPending,
    isBootstrapping,
    isLoadingHistoryConversation,
    isLoadingHistoryLists,
    activeRun: toPublicActiveRun(activeRun),
    modelPricing,
    sendMessage,
    startNewChat,
    loadConversation,
    archiveConversation,
    archiveCurrentConversation,
    openHistoryConversation,
    restoreConversation,
    deleteConversation,
    applyHistoryFilters,
    clearHistoryFilters,
    setRecentHistoryPage,
    setArchivedHistoryPage,
  };
}
