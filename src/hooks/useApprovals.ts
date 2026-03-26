"use client";

import { useCallback, useEffect, useState } from "react";

export interface ApprovalRecord {
  id: string;
  postId: string;
  status: string;
  notes: string | null;
  createdAt: string;
}

interface ApprovalsResponse {
  approvals?: ApprovalRecord[];
  pendingApprovals?: ApprovalRecord[];
}

export function useApprovals() {
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    fetch("/api/approvals")
      .then((res) => res.json() as Promise<ApprovalsResponse>)
      .then((data) => setApprovals(data.approvals ?? data.pendingApprovals ?? []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { approvals, loading, reload };
}
