"use client";

import { useMemo, useState } from "react";
import { MEMORY_FACT_CATEGORIES, type MemoryFactCategory } from "@/lib/agent/memory/facts";
import { useChat } from "@/hooks/useChat";

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

export default function ChatPage() {
  const [input, setInput] = useState("");
  const [memoryDraft, setMemoryDraft] = useState<{
    messageId: string;
    category: MemoryFactCategory;
    key: string;
    value: string;
  } | null>(null);
  const [memoryState, setMemoryState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const { messages, sendMessage, isPending, activeRun, conversationId } = useChat();

  const promotableMessages = useMemo(
    () => messages.filter((message) => message.role === "user" || message.role === "assistant"),
    [messages],
  );

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

  return (
    <div className="grid gap-4 h-full" style={{ gridTemplateRows: "1fr auto" }}>
      <section className="grid gap-3 md:grid-cols-4">
        {[
          { label: "conversation", value: conversationId ?? "not started" },
          { label: "run", value: activeRun.runId ?? "idle" },
          { label: "lane", value: activeRun.profileLabel ?? "unrouted" },
          { label: "model", value: activeRun.model ?? "pending" },
        ].map((card) => (
          <div key={card.label} className="border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
            <div className="text-[10px] uppercase tracking-[0.24em] mb-2" style={{ color: "var(--text-muted)" }}>{card.label}</div>
            <div className="text-sm break-all" style={{ color: "var(--text-primary)" }}>{card.value}</div>
          </div>
        ))}
      </section>
      <section className="border p-4 overflow-auto" style={{ borderColor: "var(--border)", background: "var(--bg-surface)", minHeight: 500 }}>
        <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>
          agent console
        </div>
        <div className="space-y-3">
          {messages.length === 0 && (
            <div className="text-sm" style={{ color: "var(--text-muted)" }}>
              Ask BizBot to draft, schedule, inspect analytics, or recall brand context.
            </div>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              className="border px-4 py-3 whitespace-pre-wrap"
              style={{
                borderColor:
                  message.role === "user"
                    ? "var(--accent-dim)"
                    : message.role === "meta"
                      ? "rgba(36,196,162,0.28)"
                    : message.role === "status"
                      ? "rgba(255,255,255,0.08)"
                      : message.role === "tool"
                        ? "rgba(91,106,240,0.18)"
                        : "var(--border)",
                background:
                  message.role === "user"
                    ? "rgba(91,106,240,0.08)"
                    : message.role === "meta"
                      ? "rgba(36,196,162,0.08)"
                    : message.role === "status"
                      ? "rgba(255,255,255,0.03)"
                      : message.role === "tool"
                        ? "rgba(91,106,240,0.05)"
                        : "var(--bg-raised)",
              }}
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="text-[10px] uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>
                  {message.role}
                </div>
                {(message.role === "user" || message.role === "assistant") ? (
                  <button
                    onClick={() => {
                      setMemoryDraft({
                        messageId: message.id,
                        category: inferCategoryFromText(message.content),
                        key: inferKeyFromText(message.content),
                        value: message.content,
                      });
                      setMemoryState("idle");
                      setMemoryError(null);
                    }}
                    className="px-2 py-1 border text-[10px] uppercase tracking-[0.18em]"
                    style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                  >
                    promote to memory
                  </button>
                ) : null}
              </div>
              {message.content}
              {message.role === "meta" ? (
                <div className="flex flex-wrap gap-2 mt-3 text-[11px]" style={{ color: "var(--text-dim)" }}>
                  {message.profileLabel ? <span>lane {message.profileLabel}</span> : null}
                  {message.provider ? <span>provider {message.provider}</span> : null}
                  {message.model ? <span>model {message.model}</span> : null}
                  {message.runId ? <span>run {message.runId}</span> : null}
                </div>
              ) : null}
              {message.role === "tool" && message.round ? (
                <div className="mt-2 text-[11px]" style={{ color: "var(--text-dim)" }}>round {message.round}</div>
              ) : null}
              {message.role === "tool" && message.args ? (
                <pre className="mt-3 overflow-auto text-xs" style={{ color: "var(--text-dim)" }}>{message.args}</pre>
              ) : null}
              {message.role === "tool" && message.result ? (
                <pre className="mt-3 overflow-auto text-xs" style={{ color: "var(--text-dim)" }}>{message.result}</pre>
              ) : null}
            </div>
          ))}
        </div>
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
            <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: memoryState === "saved" ? "var(--success)" : memoryState === "error" ? "var(--danger)" : "var(--text-dim)" }}>{memoryState}</div>
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
          void sendMessage(input);
          setInput("");
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Draft a launch thread about our product update..."
          className="flex-1 bg-transparent outline-none text-sm"
        />
        <button
          type="submit"
          disabled={isPending || !input.trim()}
          className="px-4 py-2 text-sm uppercase tracking-[0.18em] border"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          {isPending ? "Running" : "Send"}
        </button>
      </form>
    </div>
  );
}
