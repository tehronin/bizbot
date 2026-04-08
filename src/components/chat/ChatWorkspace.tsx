"use client";

import { useEffect, useMemo, useState } from "react";
import { AgenticSetupDrawer } from "@/components/chat/AgenticSetupDrawer";
import { PaginationControls } from "@/components/layout/PaginationControls";
import { useChat, type ChatEntry, type UseChatResult } from "@/hooks/useChat";
import { MEMORY_FACT_CATEGORIES, type MemoryFactCategory } from "@/lib/agent/memory/facts";
import { getResolvedUsageLedgerModelPricing } from "@/lib/agent/usage-ledger-pricing";
import { getOraclePredictionIntent } from "@/lib/oracle/intent";

type PanelMode = "chat" | "history";

interface ChatWorkspaceContentProps {
  chat: UseChatResult;
  setupOpen: boolean;
  closeSetupHref: string;
}

function inferCategoryFromText(content: string): MemoryFactCategory {
  const lower = content.toLowerCase();
  if (/name|call me|i am|i'm/.test(lower)) return "identity";
  if (/prefer|timezone|style|voice|tone/.test(lower)) return "preference";
  if (/workflow|process|when replying|steps/.test(lower)) return "workflow";
  if (/never|don't|do not|must not|avoid|constraint/.test(lower)) return "constraint";
  if (/default|setting|lane|operator/.test(lower)) return "operator_setting";
  return "other";
}

function inferKeyFromText(content: string): string {
  return content
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "remembered_fact";
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "No messages yet";
  }

  return new Date(value).toLocaleString();
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MessageGroups({
  messages,
  onPromote,
}: {
  messages: ChatEntry[];
  onPromote?: (message: ChatEntry) => void;
}) {
  const [expandedBadges, setExpandedBadges] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const groups: Array<{ kind: "message"; entry: ChatEntry } | { kind: "badges"; entries: ChatEntry[] }> = [];
    for (const message of messages) {
      if (message.role === "user" || message.role === "assistant") {
        groups.push({ kind: "message", entry: message });
        continue;
      }

      const last = groups.at(-1);
      if (last && last.kind === "badges") {
        last.entries.push(message);
      } else {
        groups.push({ kind: "badges", entries: [message] });
      }
    }

    return groups;
  }, [messages]);

  function toggleBadge(id: string): void {
    setExpandedBadges((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {messages.length === 0 && (
        <div className="text-sm" style={{ color: "var(--text-muted)" }}>
          Ask BizBot to draft, schedule, inspect analytics, or recall brand context.
        </div>
      )}
      {grouped.map((group, groupIndex) => (
        group.kind === "message" ? (
          <div
            key={group.entry.id}
            data-testid={`chat-message-${group.entry.role}`}
            className="border px-4 py-3 whitespace-pre-wrap"
            style={{
              borderColor: group.entry.role === "user" ? "var(--accent-dim)" : "var(--border)",
              background: group.entry.role === "user" ? "rgba(56,189,248,0.08)" : "var(--bg-raised)",
            }}
          >
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>
                {group.entry.role}
              </div>
              {onPromote ? (
                <button
                  type="button"
                  onClick={() => onPromote(group.entry)}
                  className="px-2 py-1 border text-xs uppercase tracking-[0.18em]"
                  style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                >
                  promote to memory
                </button>
              ) : null}
            </div>
            {group.entry.content}
          </div>
        ) : (
          <div key={`badge-group-${groupIndex}`} className="flex flex-wrap gap-1.5 py-1">
            {group.entries.map((entry) => {
              const isExpanded = expandedBadges.has(entry.id);
              const badgeColor = entry.role === "meta"
                ? { bg: "rgba(34,197,94,0.10)", border: "rgba(34,197,94,0.30)", dot: "rgb(34,197,94)" }
                : entry.role === "tool"
                  ? { bg: "rgba(56,189,248,0.08)", border: "rgba(56,189,248,0.22)", dot: "rgb(56,189,248)" }
                  : { bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.10)", dot: "rgba(255,255,255,0.35)" };
              const label = entry.role === "meta"
                ? (entry.profileLabel ? `Routed -> ${entry.profileLabel}` : "Routed")
                : entry.role === "tool"
                  ? (entry.name ?? "tool call")
                  : entry.content;

              return (
                <div key={entry.id} className="inline-flex flex-col">
                  <button
                    type="button"
                    onClick={() => toggleBadge(entry.id)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
                    style={{
                      background: badgeColor.bg,
                      border: `1px solid ${badgeColor.border}`,
                      color: "var(--text-dim)",
                    }}
                  >
                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: badgeColor.dot }} />
                    {label}
                    <span className="text-[9px]" style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
                  </button>
                  {isExpanded && (
                    <div
                      className="mt-1 px-3 py-2 rounded text-xs whitespace-pre-wrap overflow-auto max-h-48"
                      style={{
                        background: badgeColor.bg,
                        border: `1px solid ${badgeColor.border}`,
                        color: "var(--text-dim)",
                      }}
                    >
                      {entry.content}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ))}
    </div>
  );
}

export function ChatWorkspaceContent({ chat, setupOpen, closeSetupHref }: ChatWorkspaceContentProps) {
  const [input, setInput] = useState("");
  const [panelMode, setPanelMode] = useState<PanelMode>("chat");
  const [oracleModeQuery, setOracleModeQuery] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [memoryDraft, setMemoryDraft] = useState<{
    messageId: string;
    category: MemoryFactCategory;
    key: string;
    value: string;
  } | null>(null);
  const [memoryState, setMemoryState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [historySearchDraft, setHistorySearchDraft] = useState(chat.historyFilters.search);
  const [historyFromDraft, setHistoryFromDraft] = useState(chat.historyFilters.from ?? "");
  const [historyToDraft, setHistoryToDraft] = useState(chat.historyFilters.to ?? "");

  const currentConversation = chat.currentConversation;
  const hasHistoryFilters = Boolean(chat.historyFilters.search || chat.historyFilters.from || chat.historyFilters.to);
  const oracleIntent = getOraclePredictionIntent(input);
  const activeRunCostEstimate = useMemo(() => {
    const pricing = getResolvedUsageLedgerModelPricing(
      chat.activeRun.model ?? "",
      chat.activeRun.provider ?? undefined,
      chat.modelPricing,
    );

    return ((chat.activeRun.promptTokens / 1_000_000) * pricing.promptUsdPerMillion)
      + ((chat.activeRun.completionTokens / 1_000_000) * pricing.completionUsdPerMillion);
  }, [chat.activeRun.completionTokens, chat.activeRun.model, chat.activeRun.promptTokens, chat.activeRun.provider, chat.modelPricing]);

  useEffect(() => {
    setHistorySearchDraft(chat.historyFilters.search);
    setHistoryFromDraft(chat.historyFilters.from ?? "");
    setHistoryToDraft(chat.historyFilters.to ?? "");
  }, [chat.historyFilters]);

  function paginationRange(page: { currentPage: number; pageSize: number; totalItems: number }) {
    if (page.totalItems === 0) {
      return { startItem: 0, endItem: 0 };
    }

    const startItem = (page.currentPage - 1) * page.pageSize + 1;
    return {
      startItem,
      endItem: Math.min(startItem + page.pageSize - 1, page.totalItems),
    };
  }

  const recentRange = paginationRange(chat.recentPagination);
  const archivedRange = paginationRange(chat.archivedPagination);

  async function promoteToMemory(): Promise<void> {
    if (!memoryDraft) {
      return;
    }

    setMemoryState("saving");
    setMemoryError(null);
    try {
      const response = await fetch("/api/user-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: memoryDraft.category,
          key: memoryDraft.key,
          value: memoryDraft.value,
          source: "user",
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to store explicit memory fact.");
      }
      setMemoryState("saved");
      setMemoryDraft(null);
    } catch (error) {
      setMemoryState("error");
      setMemoryError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleArchiveConversation(nextConversationId: string): Promise<void> {
    setActionError(null);
    try {
      await chat.archiveConversation(nextConversationId);
      setPanelMode("history");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleSwitchConversation(nextConversationId: string): Promise<void> {
    setActionError(null);
    try {
      await chat.loadConversation(nextConversationId);
      setPanelMode("chat");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleOpenArchivedConversation(nextConversationId: string): Promise<void> {
    setActionError(null);
    try {
      await chat.openHistoryConversation(nextConversationId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleRestoreConversation(nextConversationId: string): Promise<void> {
    setActionError(null);
    try {
      await chat.restoreConversation(nextConversationId);
      setPanelMode("chat");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleDeleteConversation(nextConversationId: string): Promise<void> {
    const conversation = chat.recentConversations.find((entry) => entry.id === nextConversationId)
      ?? chat.archivedConversations.find((entry) => entry.id === nextConversationId)
      ?? null;
    const label = conversation?.label ?? "this conversation";
    const stateLabel = conversation?.archivedAt ? "archived" : "active";

    if (typeof window !== "undefined" && !window.confirm(`Delete ${stateLabel} conversation "${label}"? This removes it from history.`)) {
      return;
    }

    setActionError(null);
    try {
      await chat.deleteConversation(nextConversationId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleApplyHistoryFilters(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setActionError(null);
    try {
      await chat.applyHistoryFilters({
        search: historySearchDraft,
        from: historyFromDraft || null,
        to: historyToDraft || null,
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleClearHistoryFilters(): Promise<void> {
    setActionError(null);
    setHistorySearchDraft("");
    setHistoryFromDraft("");
    setHistoryToDraft("");
    try {
      await chat.clearHistoryFilters();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <>
      <div className="grid gap-4 h-full" style={{ gridTemplateRows: "auto auto 1fr auto auto" }}>
        <section className="grid gap-3 grid-cols-4">
          {[
            { label: "conversation", value: chat.conversationId ?? "new chat" },
            { label: "run", value: chat.activeRun.runId ?? "idle" },
            { label: "lane", value: chat.activeRun.profileLabel ?? "unrouted" },
            { label: "model", value: chat.activeRun.model ?? "pending" },
          ].map((card) => (
            <div key={card.label} className="border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
              <div className="text-xs uppercase tracking-[0.24em] mb-2" style={{ color: "var(--text-muted)" }}>{card.label}</div>
              <div className="text-sm break-all" style={{ color: "var(--text-primary)" }}>{card.value}</div>
            </div>
          ))}
        </section>

        <section className="border p-4 flex items-center justify-between gap-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="min-w-0 flex-1">
            <div className="text-xs uppercase tracking-[0.24em] mb-1" style={{ color: "var(--text-muted)" }}>
              {panelMode === "chat" ? "active conversation" : "conversation history"}
            </div>
            <div className="text-sm" style={{ color: "var(--text-primary)" }}>
              {panelMode === "chat"
                ? (currentConversation?.label ?? "New chat")
                : "Manage recent and archived chats"}
            </div>
            {panelMode === "chat" ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs" style={{ color: "var(--text-dim)" }}>
                <div className="border px-3 py-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <span style={{ color: "var(--text-muted)" }}>requests</span> {formatNumber(chat.activeRun.requestCount)}
                </div>
                <div className="border px-3 py-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <span style={{ color: "var(--text-muted)" }}>tokens</span> {formatNumber(chat.activeRun.totalTokens)}
                </div>
                <div className="border px-3 py-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <span style={{ color: "var(--text-muted)" }}>prompt</span> {formatNumber(chat.activeRun.promptTokens)}
                </div>
                <div className="border px-3 py-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <span style={{ color: "var(--text-muted)" }}>completion</span> {formatNumber(chat.activeRun.completionTokens)}
                </div>
                <div className="border px-3 py-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <span style={{ color: "var(--text-muted)" }}>cost</span> {formatUsd(activeRunCostEstimate)}
                </div>
                {chat.activeRun.cachedPromptTokens > 0 ? (
                  <div className="border px-3 py-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                    <span style={{ color: "var(--text-muted)" }}>cached</span> {formatNumber(chat.activeRun.cachedPromptTokens)}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                chat.startNewChat();
                setPanelMode("chat");
                setActionError(null);
              }}
              className="px-3 py-2 text-xs uppercase tracking-[0.18em] border"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              New Chat
            </button>
            <button
              type="button"
              onClick={() => chat.conversationId ? void handleArchiveConversation(chat.conversationId) : undefined}
              disabled={!chat.conversationId || chat.isPending || chat.isBootstrapping}
              className="px-3 py-2 text-xs uppercase tracking-[0.18em] border disabled:opacity-50"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              Archive Chat
            </button>
            <button
              type="button"
              aria-label="Open history"
              onClick={() => setPanelMode((current) => current === "chat" ? "history" : "chat")}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-[0.18em] border"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              <HistoryIcon />
              History
            </button>
          </div>
        </section>

        <section className="border p-4 overflow-auto" style={{ borderColor: "var(--border)", background: "var(--bg-surface)", minHeight: 500 }}>
          {panelMode === "chat" ? (
            <>
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>
                  agent console
                </div>
                {chat.isBootstrapping && (
                  <div className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>
                    loading chat
                  </div>
                )}
              </div>
              <div className="space-y-3">
                <MessageGroups
                  messages={chat.messages}
                  onPromote={(message) => {
                    if (message.role !== "user" && message.role !== "assistant") {
                      return;
                    }

                    setMemoryDraft({
                      messageId: message.id,
                      category: inferCategoryFromText(message.content),
                      key: inferKeyFromText(message.content),
                      value: message.content,
                    });
                    setMemoryState("idle");
                    setMemoryError(null);
                  }}
                />
              </div>
            </>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] h-full">
              <div className="space-y-4 min-w-0">
                <form onSubmit={(event) => void handleApplyHistoryFilters(event)} className="border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>history filters</div>
                      <div className="text-xs mt-2" style={{ color: "var(--text-dim)" }}>Search titles and messages, then narrow both lists by updated date.</div>
                    </div>
                    {chat.isLoadingHistoryLists ? (
                      <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-dim)" }}>refreshing</div>
                    ) : null}
                  </div>
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,180px))_auto]">
                    <label className="space-y-1.5">
                      <span className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>search</span>
                      <input
                        aria-label="history search"
                        value={historySearchDraft}
                        onChange={(event) => setHistorySearchDraft(event.target.value)}
                        placeholder="Search titles, summaries, or messages"
                        className="w-full border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-primary)" }}
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>updated from</span>
                      <input
                        aria-label="updated from"
                        type="date"
                        value={historyFromDraft}
                        onChange={(event) => setHistoryFromDraft(event.target.value)}
                        className="w-full border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-primary)" }}
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>updated to</span>
                      <input
                        aria-label="updated to"
                        type="date"
                        value={historyToDraft}
                        onChange={(event) => setHistoryToDraft(event.target.value)}
                        className="w-full border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-primary)" }}
                      />
                    </label>
                    <div className="flex gap-2 items-end">
                      <button
                        type="submit"
                        disabled={chat.isLoadingHistoryLists}
                        className="px-3 py-2 text-xs uppercase tracking-[0.18em] border disabled:opacity-50"
                        style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleClearHistoryFilters()}
                        disabled={!hasHistoryFilters && !historySearchDraft && !historyFromDraft && !historyToDraft}
                        className="px-3 py-2 text-xs uppercase tracking-[0.18em] border disabled:opacity-50"
                        style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </form>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                    <div className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>recent chats</div>
                    <div className="mt-2 text-xl" style={{ color: "var(--text-primary)" }}>{chat.recentPagination.totalItems}</div>
                    <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>{hasHistoryFilters ? "Matching active conversations after filters." : "Active conversations you can preview, open, archive, or delete."}</div>
                  </div>
                  <div className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                    <div className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>archived chats</div>
                    <div className="mt-2 text-xl" style={{ color: "var(--text-primary)" }}>{chat.archivedPagination.totalItems}</div>
                    <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>{hasHistoryFilters ? "Matching archived conversations after filters." : "Archived conversations remain inspectable, restorable, and deletable."}</div>
                  </div>
                </div>

                <div className="grid gap-4 2xl:grid-cols-2">
                  <div className="border p-4 space-y-3 min-w-0" style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>Recent</div>
                      <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-dim)" }}>{chat.recentPagination.totalItems} total</div>
                    </div>
                    <div className="space-y-2">
                    {chat.recentPagination.totalItems === 0 ? (
                      <div className="border p-3 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                        {hasHistoryFilters ? "No active chats match the current filters." : "No active chats yet."}
                      </div>
                    ) : chat.recentConversations.map((conversation) => (
                      <div key={conversation.id} className="border p-3" style={{ borderColor: conversation.id === chat.conversationId ? "var(--accent)" : "var(--border)" }}>
                        <div className="text-sm" style={{ color: "var(--text-primary)" }}>{conversation.label}</div>
                        <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>{conversation.preview ?? "No messages yet"}</div>
                        <div className="text-[11px] mt-2 flex items-center justify-between gap-3" style={{ color: "var(--text-muted)" }}>
                          <span>{formatTimestamp(conversation.lastMessageAt)}</span>
                          <span>{conversation.messageCount} messages</span>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-3">
                          <button
                            type="button"
                            onClick={() => void handleOpenArchivedConversation(conversation.id)}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border"
                            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                          >
                            Preview
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleSwitchConversation(conversation.id)}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border"
                            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                          >
                            Open Chat
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleArchiveConversation(conversation.id)}
                            disabled={chat.isPending || chat.isBootstrapping}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border disabled:opacity-50"
                            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                          >
                            Archive
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteConversation(conversation.id)}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border"
                            style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                    </div>
                    <PaginationControls
                      currentPage={chat.recentPagination.currentPage}
                      totalPages={chat.recentPagination.totalPages}
                      startItem={recentRange.startItem}
                      endItem={recentRange.endItem}
                      totalItems={chat.recentPagination.totalItems}
                      setCurrentPage={chat.setRecentHistoryPage}
                    />
                  </div>

                  <div className="border p-4 space-y-3 min-w-0" style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>Archived</div>
                      <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-dim)" }}>{chat.archivedPagination.totalItems} total</div>
                    </div>
                    <div className="space-y-2">
                    {chat.archivedPagination.totalItems === 0 ? (
                      <div className="border p-3 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                        {hasHistoryFilters ? "No archived chats match the current filters." : "No archived chats yet."}
                      </div>
                    ) : chat.archivedConversations.map((conversation) => (
                      <div key={conversation.id} className="border p-3" style={{ borderColor: chat.historyConversation?.id === conversation.id ? "var(--accent)" : "var(--border)" }}>
                        <div className="text-sm" style={{ color: "var(--text-primary)" }}>{conversation.label}</div>
                        <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>{conversation.preview ?? "No messages yet"}</div>
                        <div className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>
                          Archived {formatTimestamp(conversation.archivedAt)}
                        </div>
                        <div className="flex flex-wrap gap-2 mt-3">
                          <button
                            type="button"
                            onClick={() => void handleOpenArchivedConversation(conversation.id)}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border"
                            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                          >
                            Preview
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRestoreConversation(conversation.id)}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border"
                            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                          >
                            Restore
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteConversation(conversation.id)}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border"
                            style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                    </div>
                    <PaginationControls
                      currentPage={chat.archivedPagination.currentPage}
                      totalPages={chat.archivedPagination.totalPages}
                      startItem={archivedRange.startItem}
                      endItem={archivedRange.endItem}
                      totalItems={chat.archivedPagination.totalItems}
                      setCurrentPage={chat.setArchivedHistoryPage}
                    />
                  </div>
                </div>
              </div>

              <div className="border p-4 overflow-auto min-w-0" style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}>
                {chat.isLoadingHistoryConversation ? (
                  <div className="text-sm" style={{ color: "var(--text-muted)" }}>Loading conversation...</div>
                ) : chat.historyConversation ? (
                  <div className="space-y-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.24em] mb-2" style={{ color: "var(--text-muted)" }}>History preview</div>
                      <div className="text-lg" style={{ color: "var(--text-primary)" }}>{chat.historyConversation.label}</div>
                      <div className="text-xs mt-2" style={{ color: "var(--text-dim)" }}>
                        {chat.historyConversation.archivedAt ? `Archived ${formatTimestamp(chat.historyConversation.archivedAt)}` : "Active"}
                      </div>
                      <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
                        {chat.historyConversation.messageCount} messages · last updated {formatTimestamp(chat.historyConversation.lastMessageAt)}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {chat.historyConversation.archivedAt ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleRestoreConversation(chat.historyConversation!.id)}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border"
                            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                          >
                            Restore
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteConversation(chat.historyConversation!.id)}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border"
                            style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                          >
                            Delete
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleSwitchConversation(chat.historyConversation!.id)}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border"
                            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                          >
                            Open Chat
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteConversation(chat.historyConversation!.id)}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border"
                            style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                    <MessageGroups messages={chat.historyConversation.messages.map((message) => (
                      message.role === "USER"
                        ? { id: message.id, role: "user", content: message.content }
                        : message.role === "ASSISTANT"
                          ? { id: message.id, role: "assistant", content: message.content }
                          : message.role === "TOOL"
                            ? { id: message.id, role: "tool", content: message.content }
                            : { id: message.id, role: "meta", content: message.content }
                    ))} />
                  </div>
                ) : (
                  <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                    Select a recent or archived chat to preview it, then archive, restore, open, or delete it from here.
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {memoryDraft ? (
          <section className="border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.24em] mb-2" style={{ color: "var(--text-muted)" }}>promote message to explicit memory</div>
                <div className="text-sm" style={{ color: "var(--text-dim)" }}>
                  Convert a stable fact from chat into durable user memory. Edit the category, key, and value before saving.
                </div>
              </div>
              <div className="text-xs uppercase tracking-[0.16em]" style={{ color: memoryState === "saved" ? "var(--success)" : memoryState === "error" ? "var(--danger)" : "var(--text-dim)" }}>{memoryState}</div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>category</label>
                <select value={memoryDraft.category} onChange={(event) => setMemoryDraft((current) => current ? { ...current, category: event.target.value as MemoryFactCategory } : current)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                  {MEMORY_FACT_CATEGORIES.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>key</label>
                <input value={memoryDraft.key} onChange={(event) => setMemoryDraft((current) => current ? { ...current, key: event.target.value } : current)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
              </div>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>value</label>
              <textarea value={memoryDraft.value} onChange={(event) => setMemoryDraft((current) => current ? { ...current, value: event.target.value } : current)} rows={5} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
              Use this only for durable, user-approved facts. Do not promote temporary requests, guesses, secrets, or tool noise.
            </div>
            {memoryError ? <div className="text-xs leading-6" style={{ color: "var(--danger)" }}>{memoryError}</div> : null}
            <div className="flex gap-2">
              <button onClick={() => void promoteToMemory()} disabled={memoryState === "saving" || !memoryDraft.key.trim() || !memoryDraft.value.trim()} className="px-4 py-2 text-sm uppercase tracking-[0.18em] border disabled:opacity-50" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                {memoryState === "saving" ? "Saving" : "save memory fact"}
              </button>
              <button onClick={() => { setMemoryDraft(null); setMemoryState("idle"); setMemoryError(null); }} className="px-4 py-2 text-sm uppercase tracking-[0.18em] border" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                cancel
              </button>
            </div>
          </section>
        ) : null}

        <form
          className="border p-3 flex gap-3"
          style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
          onSubmit={(event) => {
            event.preventDefault();
            setOracleModeQuery(null);
            void chat.sendMessage(input);
            setInput("");
          }}
        >
          <div className="flex-1 space-y-2">
            <input
              data-testid="chat-input"
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                if (oracleModeQuery) {
                  setOracleModeQuery(null);
                }
              }}
              placeholder="Draft a launch thread about our product update..."
              className="w-full bg-transparent outline-none text-sm"
              disabled={panelMode === "history"}
            />
            {panelMode === "chat" && oracleModeQuery ? (
              <div
                data-testid="oracle-mode-chip"
                className="inline-flex items-center gap-2 px-3 py-1 text-[11px] uppercase tracking-[0.18em] border"
                style={{ borderColor: "var(--warning)", color: "var(--warning)", background: "rgba(245,158,11,0.08)" }}
              >
                <span>Oracle mode</span>
                <span style={{ color: "var(--text-dim)", textTransform: "none", letterSpacing: "0.04em" }}>
                  {oracleModeQuery}
                </span>
              </div>
            ) : null}
            {panelMode === "chat" && oracleIntent.matched ? (
              <button
                data-testid="oracle-trigger-button"
                type="button"
                disabled={chat.isPending || !input.trim()}
                onClick={() => {
                  setOracleModeQuery(oracleIntent.query || input.trim());
                  void chat.sendOraclePrediction(input);
                  setInput("");
                }}
                className="inline-flex items-center gap-2 px-3 py-1 text-xs uppercase tracking-[0.18em] border disabled:opacity-50"
                style={{ borderColor: "var(--warning)", color: "var(--warning)", background: "rgba(245,158,11,0.08)" }}
              >
                <span>Oracle</span>
                <span>Run prediction</span>
              </button>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={panelMode === "history" || chat.isPending || !input.trim()}
            className="px-4 py-2 text-sm uppercase tracking-[0.18em] border disabled:opacity-40"
            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
          >
            {chat.isPending ? "Running" : "Send"}
          </button>
        </form>

        {actionError ? (
          <div className="text-xs" style={{ color: "var(--danger)" }}>{actionError}</div>
        ) : null}
      </div>
      <AgenticSetupDrawer open={setupOpen} closeHref={closeSetupHref} />
    </>
  );
}

export function ChatWorkspace(props: Omit<ChatWorkspaceContentProps, "chat">) {
  const chat = useChat();
  return <ChatWorkspaceContent {...props} chat={chat} />;
}