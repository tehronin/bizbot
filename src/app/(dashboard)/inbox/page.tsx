"use client";

import { PaginationControls } from "@/components/layout/PaginationControls";
import { usePagination } from "@/hooks/usePagination";
import { useEffect, useState } from "react";

interface InboxItem {
  id: string;
  channelType: string;
  status: string;
  leadStage: string;
  leadSummary: string | null;
  cannedResponseNodeKey: string | null;
  authorName: string | null;
  authorHandle: string | null;
  content: string;
  replyContent: string | null;
  receivedAt: string;
  cannedResponseTree: {
    name: string;
  } | null;
  platform: {
    displayName: string;
  };
}

interface InboxResponse {
  items: InboxItem[];
}

type InboxAction = "approve" | "dismiss" | "draft" | "resend";
type LeadStage = "NONE" | "LEAD" | "QUALIFIED" | "CONTACTED" | "CONVERTED" | "LOST";

const LEAD_STAGES: LeadStage[] = ["NONE", "LEAD", "QUALIFIED", "CONTACTED", "CONVERTED", "LOST"];

export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionItemId, setActionItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const itemsPagination = usePagination(items, 15);

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

  async function updateLead(id: string, leadStage: LeadStage): Promise<void> {
    setActionItemId(id);
    setError(null);
    try {
      const response = await fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadStage }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Lead update failed.");
      }

      await load();
    } catch (leadError) {
      setError(String(leadError));
    } finally {
      setActionItemId(null);
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
    <section className="border p-4 border-border bg-surface">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-muted">inbox</div>
          <div className="text-sm mt-2 text-dim">Mentions and direct-message inbox items processed by the heartbeat loop.</div>
        </div>
        <button onClick={() => void load()} className="text-xs uppercase tracking-[0.18em] text-accent">refresh</button>
      </div>

      <div className="space-y-3">
        {loading ? <div className="text-sm text-muted">Loading…</div> : null}
        {error ? <div className="text-sm text-danger">{error}</div> : null}
        {!loading && items.length === 0 ? <div className="text-sm text-muted">No inbox items yet.</div> : null}
        {itemsPagination.pageItems.map((item) => (
          <article key={item.id} className="border p-4 space-y-3 border-border-sub bg-raised">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-muted">
              <span>{item.platform.displayName}</span>
              <span>{item.channelType}</span>
              <span>{item.status}</span>
            </div>
            <div className="flex flex-wrap gap-3 text-xs uppercase tracking-[0.18em] text-muted">
              <span>lead {item.leadStage}</span>
              {item.cannedResponseTree ? <span>tree {item.cannedResponseTree.name}</span> : null}
              {item.cannedResponseNodeKey ? <span>node {item.cannedResponseNodeKey}</span> : null}
            </div>
            <div className="text-sm text-dim">{item.authorHandle ?? item.authorName ?? "unknown"}</div>
            <div className="text-sm whitespace-pre-wrap">{item.content}</div>
            {item.replyContent ? (
              <div className="border p-3 text-sm whitespace-pre-wrap border-border bg-surface">
                {item.replyContent}
              </div>
            ) : null}
            {item.leadSummary ? (
              <div className="text-xs leading-6 text-dim">
                {item.leadSummary}
              </div>
            ) : null}
            <label className="block text-xs uppercase tracking-[0.18em] text-muted">
              Lead stage
            </label>
            <select
              value={item.leadStage}
              onChange={(event) => void updateLead(item.id, event.target.value as LeadStage)}
              disabled={actionItemId === item.id}
              className="w-full max-w-52 bg-transparent border px-3 py-2 text-xs border-border"
            >
              {LEAD_STAGES.map((stage) => (
                <option key={stage} value={stage}>{stage}</option>
              ))}
            </select>
            <div className="flex flex-wrap gap-3 text-xs uppercase tracking-[0.18em] text-muted">
              {canDraft(item) ? (
                <button
                  onClick={() => void runAction(item.id, "draft")}
                  disabled={actionItemId === item.id}
                  className="text-primary"
                >
                  draft reply
                </button>
              ) : null}
              {canApprove(item) ? (
                <button
                  onClick={() => void runAction(item.id, "approve")}
                  disabled={actionItemId === item.id}
                  className="text-accent"
                >
                  approve / send
                </button>
              ) : null}
              {canResend(item) ? (
                <button
                  onClick={() => void runAction(item.id, "resend")}
                  disabled={actionItemId === item.id}
                  className="text-dim"
                >
                  resend draft
                </button>
              ) : null}
              {canDismiss(item) ? (
                <button
                  onClick={() => void runAction(item.id, "dismiss")}
                  disabled={actionItemId === item.id}
                  className="text-muted"
                >
                  dismiss
                </button>
              ) : null}
            </div>
            <div className="text-xs uppercase tracking-[0.16em] text-muted">
              {new Date(item.receivedAt).toLocaleString()}
            </div>
          </article>
        ))}
        {!loading ? <PaginationControls {...itemsPagination} /> : null}
      </div>
    </section>
  );
}