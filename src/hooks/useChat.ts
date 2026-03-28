"use client";

import { useState, useTransition } from "react";

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

export function useChat() {
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveRunState>({
    conversationId: null,
    runId: null,
    profile: null,
    profileLabel: null,
    provider: null,
    model: null,
  });
  const [isPending, startTransition] = useTransition();

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
                setConversationId(event.conversationId);
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
        })
        .catch((error: Error) => {
          setMessages((current) => [
            ...current,
            createEntry("assistant", `Request failed: ${error.message}`),
          ]);
        });
    });
  }

  return { messages, sendMessage, isPending, activeRun, conversationId };
}
