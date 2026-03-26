"use client";

import { useEffect, useState } from "react";

interface InboxItem {
  id: string;
  channelType: string;
  status: string;
  authorName: string | null;
  authorHandle: string | null;
  content: string;
  replyContent: string | null;
  receivedAt: string;
  platform: {
    displayName: string;
  };
}

interface InboxResponse {
  items: InboxItem[];
}

type InboxAction = "approve" | "dismiss" | "draft" | "resend";

export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionItemId, setActionItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/inbox");
      if (!response.ok) {
        throw new Error("Failed to load inbox");
      }
      const data = (await response.json()) as InboxResponse;
      setItems(data.items ?? []);
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function runAction(id: string, action: InboxAction): Promise<void> {
    setActionItemId(id);
    setError(null);
    try {
      const response = await fetch(`/api/inbox/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? `Inbox action failed: ${action}`);
      }

      await load();
    } catch (actionError) {
      setError(String(actionError));
    } finally {
      setActionItemId(null);
    }
  }

  function canApprove(item: InboxItem): boolean {
    return item.status === "OPEN" || item.status === "DRAFTED" || item.status === "FAILED";
  }

  function canDraft(item: InboxItem): boolean {
    return item.status === "OPEN" || item.status === "FAILED";
  }

  function canResend(item: InboxItem): boolean {
    return item.status === "DRAFTED" || item.status === "FAILED";
  }

  function canDismiss(item: InboxItem): boolean {
    return item.status !== "DISMISSED" && item.status !== "REPLIED";
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>inbox</div>
          <div className="text-sm mt-2" style={{ color: "var(--text-dim)" }}>Mentions and direct-message inbox items processed by the heartbeat loop.</div>
        </div>
        <button onClick={() => void load()} className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--accent)" }}>refresh</button>
      </div>

      <div className="space-y-3">
        {loading ? <div className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</div> : null}
        {error ? <div className="text-sm" style={{ color: "var(--danger, #d16b6b)" }}>{error}</div> : null}
        {!loading && items.length === 0 ? <div className="text-sm" style={{ color: "var(--text-muted)" }}>No inbox items yet.</div> : null}
        {items.map((item) => (
          <article key={item.id} className="border p-4 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
            <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em]" style={{ color: "var(--text-muted)" }}>
              <span>{item.platform.displayName}</span>
              <span>{item.channelType}</span>
              <span>{item.status}</span>
            </div>
            <div className="text-sm" style={{ color: "var(--text-dim)" }}>{item.authorHandle ?? item.authorName ?? "unknown"}</div>
            <div className="text-sm whitespace-pre-wrap">{item.content}</div>
            {item.replyContent ? (
              <div className="border p-3 text-sm whitespace-pre-wrap" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                {item.replyContent}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-3 text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>
              {canDraft(item) ? (
                <button
                  onClick={() => void runAction(item.id, "draft")}
                  disabled={actionItemId === item.id}
                  style={{ color: "var(--text-primary)" }}
                >
                  draft reply
                </button>
              ) : null}
              {canApprove(item) ? (
                <button
                  onClick={() => void runAction(item.id, "approve")}
                  disabled={actionItemId === item.id}
                  style={{ color: "var(--accent)" }}
                >
                  approve / send
                </button>
              ) : null}
              {canResend(item) ? (
                <button
                  onClick={() => void runAction(item.id, "resend")}
                  disabled={actionItemId === item.id}
                  style={{ color: "var(--text-dim)" }}
                >
                  resend draft
                </button>
              ) : null}
              {canDismiss(item) ? (
                <button
                  onClick={() => void runAction(item.id, "dismiss")}
                  disabled={actionItemId === item.id}
                  style={{ color: "var(--text-muted)" }}
                >
                  dismiss
                </button>
              ) : null}
            </div>
            <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
              {new Date(item.receivedAt).toLocaleString()}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}