"use client";

import { useState, useTransition } from "react";

export interface ChatEntry {
  role: "user" | "assistant";
  content: string;
}

interface AgentResponse {
  reply: string;
  conversationId: string;
}

export function useChat() {
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function sendMessage(input: string): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed) return;

    setMessages((current) => [...current, { role: "user", content: trimmed }]);

    startTransition(() => {
      fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, conversationId: conversationId ?? undefined }),
      })
        .then((res) => res.json() as Promise<AgentResponse>)
        .then((data) => {
          setConversationId(data.conversationId);
          setMessages((current) => [...current, { role: "assistant", content: data.reply }]);
        })
        .catch((error: Error) => {
          setMessages((current) => [
            ...current,
            { role: "assistant", content: `Request failed: ${error.message}` },
          ]);
        });
    });
  }

  return { messages, sendMessage, isPending };
}
