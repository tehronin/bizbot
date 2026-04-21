"use client";

import { PaginationControls } from "@/components/layout/PaginationControls";
import { usePagination } from "@/hooks/usePagination";
import { useApprovals } from "@/hooks/useApprovals";

export default function ApprovalsPage() {
  const { approvals, loading, reload } = useApprovals();
  const approvalsPagination = usePagination(approvals, 15);

  async function decide(id: string, decision: "approve" | "reject"): Promise<void> {
    await fetch(`/api/approvals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    reload();
  }

  return (
    <section className="border p-4 border-border bg-surface">
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs uppercase tracking-[0.24em] text-muted">approval queue</div>
        <button onClick={reload} className="text-xs uppercase tracking-[0.18em] text-accent">refresh</button>
      </div>
      <div className="space-y-3">
        {loading && <div className="text-sm text-muted">Loading…</div>}
        {!loading && approvals.length === 0 && <div className="text-sm text-muted">No pending approvals.</div>}
        {approvalsPagination.pageItems.map((approval) => (
          <article key={approval.id} className="border p-4 border-border-sub bg-raised">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.24em] mb-2 text-muted">
              <span>{approval.status}</span>
              <span>{new Date(approval.createdAt).toLocaleString()}</span>
            </div>
            <div className="text-sm mb-4">Post: {approval.postId}</div>
            {approval.notes && <div className="text-sm mb-4 text-muted">{approval.notes}</div>}
            <div className="flex gap-3">
              <button onClick={() => void decide(approval.id, "approve")} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] border-success text-success">approve</button>
              <button onClick={() => void decide(approval.id, "reject")} className="px-3 py-2 border text-xs uppercase tracking-[0.18em] border-danger text-danger">reject</button>
            </div>
          </article>
        ))}
        {!loading ? <PaginationControls {...approvalsPagination} /> : null}
      </div>
    </section>
  );
}
