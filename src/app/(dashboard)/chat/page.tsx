"use client";

import { useState } from "react";
import { useChat } from "@/hooks/useChat";

export default function ChatPage() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, isPending } = useChat();

  return (
    <div className="grid gap-4 h-full" style={{ gridTemplateRows: "1fr auto" }}>
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
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className="border px-4 py-3 whitespace-pre-wrap"
              style={{
                borderColor: message.role === "user" ? "var(--accent-dim)" : "var(--border)",
                background: message.role === "user" ? "rgba(91,106,240,0.08)" : "var(--bg-raised)",
              }}
            >
              <div className="text-[10px] uppercase tracking-[0.24em] mb-2" style={{ color: "var(--text-muted)" }}>
                {message.role}
              </div>
              {message.content}
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
