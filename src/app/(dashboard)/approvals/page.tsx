"use client";

import { useApprovals } from "@/hooks/useApprovals";

export default function ApprovalsPage() {
  const { approvals, loading, reload } = useApprovals();

  async function decide(id: string, decision: "approve" | "reject"): Promise<void> {
    await fetch(`/api/approvals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    reload();
  }

  return (
    <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>approval queue</div>
        <button onClick={reload} className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--accent)" }}>refresh</button>
      </div>
      <div className="space-y-3">
        {loading && <div className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</div>}
        {!loading && approvals.length === 0 && <div className="text-sm" style={{ color: "var(--text-muted)" }}>No pending approvals.</div>}
        {approvals.map((approval) => (
          <article key={approval.id} className="border p-4" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
            <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.24em] mb-2" style={{ color: "var(--text-muted)" }}>
              <span>{approval.status}</span>
              <span>{new Date(approval.createdAt).toLocaleString()}</span>
            </div>
            <div className="text-sm mb-4">Post: {approval.postId}</div>
            {approval.notes && <div className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>{approval.notes}</div>}
            <div className="flex gap-3">
              <button onClick={() => void decide(approval.id, "approve")} className="px-3 py-2 border text-xs uppercase tracking-[0.18em]" style={{ borderColor: "var(--success)", color: "var(--success)" }}>approve</button>
              <button onClick={() => void decide(approval.id, "reject")} className="px-3 py-2 border text-xs uppercase tracking-[0.18em]" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>reject</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
