"use client";

import { useState } from "react";
import { useChat } from "@/hooks/useChat";

export default function ChatPage() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, isPending, activeRun, conversationId } = useChat();

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
              <div className="text-[10px] uppercase tracking-[0.24em] mb-2" style={{ color: "var(--text-muted)" }}>
                {message.role}
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
