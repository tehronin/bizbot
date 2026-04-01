"use client";

import { useMemo, useState } from "react";
import { AgenticSetupDrawer } from "@/components/chat/AgenticSetupDrawer";
import { useChat, type ChatEntry, type UseChatResult } from "@/hooks/useChat";
import { MEMORY_FACT_CATEGORIES, type MemoryFactCategory } from "@/lib/agent/memory/facts";

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
            className="border px-4 py-3 whitespace-pre-wrap"
            style={{
              borderColor: group.entry.role === "user" ? "var(--accent-dim)" : "var(--border)",
              background: group.entry.role === "user" ? "rgba(91,106,240,0.08)" : "var(--bg-raised)",
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
                ? { bg: "rgba(36,196,162,0.10)", border: "rgba(36,196,162,0.30)", dot: "rgb(36,196,162)" }
                : entry.role === "tool"
                  ? { bg: "rgba(91,106,240,0.08)", border: "rgba(91,106,240,0.22)", dot: "rgb(91,106,240)" }
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
  const [actionError, setActionError] = useState<string | null>(null);
  const [memoryDraft, setMemoryDraft] = useState<{
    messageId: string;
    category: MemoryFactCategory;
    key: string;
    value: string;
  } | null>(null);
  const [memoryState, setMemoryState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [memoryError, setMemoryError] = useState<string | null>(null);

  const currentConversation = chat.recentConversations.find((conversation) => conversation.id === chat.conversationId) ?? null;

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

  async function handleArchiveConversation(): Promise<void> {
    setActionError(null);
    try {
      await chat.archiveCurrentConversation();
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
    if (typeof window !== "undefined" && !window.confirm("Delete this archived conversation? This removes it from history.")) {
      return;
    }

    setActionError(null);
    try {
      await chat.deleteConversation(nextConversationId);
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
          <div>
            <div className="text-xs uppercase tracking-[0.24em] mb-1" style={{ color: "var(--text-muted)" }}>
              {panelMode === "chat" ? "active conversation" : "conversation history"}
            </div>
            <div className="text-sm" style={{ color: "var(--text-primary)" }}>
              {panelMode === "chat"
                ? (currentConversation?.label ?? "New chat")
                : "Recent and archived chats"}
            </div>
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
              onClick={() => void handleArchiveConversation()}
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
            <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] h-full">
              <div className="space-y-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.24em] mb-2" style={{ color: "var(--text-muted)" }}>Recent</div>
                  <div className="space-y-2">
                    {chat.recentConversations.length === 0 ? (
                      <div className="border p-3 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                        No active chats yet.
                      </div>
                    ) : chat.recentConversations.map((conversation) => (
                      <div key={conversation.id} className="border p-3" style={{ borderColor: conversation.id === chat.conversationId ? "var(--accent)" : "var(--border)" }}>
                        <div className="text-sm" style={{ color: "var(--text-primary)" }}>{conversation.label}</div>
                        <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>{conversation.preview ?? "No messages yet"}</div>
                        <div className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>{formatTimestamp(conversation.lastMessageAt)}</div>
                        <button
                          type="button"
                          onClick={() => void handleSwitchConversation(conversation.id)}
                          className="mt-3 px-3 py-2 text-xs uppercase tracking-[0.18em] border"
                          style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                        >
                          Open Chat
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs uppercase tracking-[0.24em] mb-2" style={{ color: "var(--text-muted)" }}>Archived</div>
                  <div className="space-y-2">
                    {chat.archivedConversations.length === 0 ? (
                      <div className="border p-3 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                        No archived chats yet.
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
                            Open
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
                </div>
              </div>

              <div className="border p-4 overflow-auto" style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}>
                {chat.isLoadingHistoryConversation ? (
                  <div className="text-sm" style={{ color: "var(--text-muted)" }}>Loading conversation…</div>
                ) : chat.historyConversation ? (
                  <div className="space-y-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.24em] mb-2" style={{ color: "var(--text-muted)" }}>History preview</div>
                      <div className="text-lg" style={{ color: "var(--text-primary)" }}>{chat.historyConversation.label}</div>
                      <div className="text-xs mt-2" style={{ color: "var(--text-dim)" }}>
                        {chat.historyConversation.archivedAt ? `Archived ${formatTimestamp(chat.historyConversation.archivedAt)}` : "Active"}
                      </div>
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
                    Select an archived chat to inspect it without restoring it.
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
            void chat.sendMessage(input);
            setInput("");
          }}
        >
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Draft a launch thread about our product update..."
            className="flex-1 bg-transparent outline-none text-sm"
            disabled={panelMode === "history"}
          />
          <button
            type="submit"
            disabled={panelMode === "history" || chat.isPending || !input.trim()}
            className="px-4 py-2 text-sm uppercase tracking-[0.18em] border disabled:opacity-50"
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