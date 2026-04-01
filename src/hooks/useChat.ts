"use client";

import { useEffect, useState, useTransition } from "react";
import type {
  ChatConversationBootstrap,
  ChatConversationDetail,
  ChatConversationMessage,
  ChatConversationSummary,
} from "@/lib/chat/types";

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
  type: "meta" | "status" | "tool_call" | "tool_result" | "assistant_message" | "done" | "error";
  conversationId?: string;
  runId?: string;
  profile?: string;
  profileLabel?: string;
  provider?: string;
  model?: string;
  content?: string;
  message?: string;
  reply?: string;
  error?: string;
  name?: string;
  args?: object;
  result?: string;
  round?: number;
}

export interface ActiveRunState {
  conversationId: string | null;
  runId: string | null;
  profile: string | null;
  profileLabel: string | null;
  provider: string | null;
  model: string | null;
}

export interface UseChatResult {
  messages: ChatEntry[];
  conversationId: string | null;
  recentConversations: ChatConversationSummary[];
  archivedConversations: ChatConversationSummary[];
  historyConversation: ChatConversationDetail | null;
  isPending: boolean;
  isBootstrapping: boolean;
  isLoadingHistoryConversation: boolean;
  activeRun: ActiveRunState;
  sendMessage: (input: string) => Promise<void>;
  startNewChat: () => void;
  loadConversation: (nextConversationId: string) => Promise<void>;
  archiveCurrentConversation: () => Promise<void>;
  openHistoryConversation: (nextConversationId: string) => Promise<void>;
  restoreConversation: (nextConversationId: string) => Promise<void>;
  deleteConversation: (nextConversationId: string) => Promise<void>;
}

const SELECTED_CONVERSATION_STORAGE_KEY = "bizbot:selected-chat-conversation-id";

const IDLE_ACTIVE_RUN: ActiveRunState = {
  conversationId: null,
  runId: null,
  profile: null,
  profileLabel: null,
  provider: null,
  model: null,
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
  const [recentConversations, setRecentConversations] = useState<ChatConversationSummary[]>([]);
  const [archivedConversations, setArchivedConversations] = useState<ChatConversationSummary[]>([]);
  const [historyConversation, setHistoryConversation] = useState<ChatConversationDetail | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveRunState>(IDLE_ACTIVE_RUN);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isLoadingHistoryConversation, setIsLoadingHistoryConversation] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function loadBootstrap(nextConversationId: string | null, replaceCurrent: boolean): Promise<void> {
    const params = new URLSearchParams();
    if (nextConversationId) {
      params.set("selectedId", nextConversationId);
    }

    const response = await fetch(`/api/chat/conversations${params.toString() ? `?${params.toString()}` : ""}`);
    const payload = await readJson<ChatConversationBootstrap & { error?: string }>(response);

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load chat conversations.");
    }

    setRecentConversations(payload.recentConversations);
    setArchivedConversations(payload.archivedConversations);
    setConversationId(payload.currentConversationId);
    persistSelectedConversationId(payload.currentConversationId);

    if (replaceCurrent) {
      setMessages(payload.currentConversation ? mapConversationMessages(payload.currentConversation.messages) : []);
      setActiveRun(IDLE_ACTIVE_RUN);
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
        await loadBootstrap(getStoredSelectedConversationId(), true);
      } finally {
        setIsBootstrapping(false);
      }
    })();
  }, []);

  async function loadConversation(nextConversationId: string): Promise<void> {
    setIsBootstrapping(true);
    try {
      await loadBootstrap(nextConversationId, true);
    } finally {
      setIsBootstrapping(false);
    }
  }

  function startNewChat(): void {
    setConversationId(null);
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

  async function archiveCurrentConversation(): Promise<void> {
    if (!conversationId) {
      return;
    }

    const response = await fetch(`/api/chat/conversations/${conversationId}/archive`, { method: "POST" });
    const payload = await readJson<{ error?: string }>(response);

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to archive conversation.");
    }

    setHistoryConversation(null);
    setIsBootstrapping(true);
    try {
      await loadBootstrap(null, true);
    } finally {
      setIsBootstrapping(false);
    }
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
      await loadBootstrap(nextConversationId, true);
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

    setArchivedConversations((current) => current.filter((conversation) => conversation.id !== nextConversationId));
    setHistoryConversation((current) => current?.id === nextConversationId ? null : current);

    if (conversationId) {
      await loadBootstrap(conversationId, false);
    }
  }

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
                setActiveRun({
                  conversationId: event.conversationId ?? conversationId,
                  runId: event.runId ?? null,
                  profile: event.profile ?? null,
                  profileLabel: event.profileLabel ?? null,
                  provider: event.provider ?? null,
                  model: event.model ?? null,
                });
              }
              setMessages((current) => appendStreamEntries(current, event));
            }
          }

          if (nextConversationId) {
            await loadBootstrap(nextConversationId, false);
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
    recentConversations,
    archivedConversations,
    historyConversation,
    isPending,
    isBootstrapping,
    isLoadingHistoryConversation,
    activeRun,
    sendMessage,
    startNewChat,
    loadConversation,
    archiveCurrentConversation,
    openHistoryConversation,
    restoreConversation,
    deleteConversation,
  };
}
