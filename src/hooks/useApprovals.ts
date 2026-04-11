"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  const isMountedRef = useRef(true);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  const fetchApprovals = useCallback(async (): Promise<ApprovalRecord[]> => {
    const response = await fetch("/api/approvals");
    const data = (await response.json()) as ApprovalsResponse;
    return data.approvals ?? data.pendingApprovals ?? [];
  }, []);

  const reload = useCallback(() => {
    if (!isMountedRef.current) {
      return;
    }

    setLoading(true);
    fetchApprovals()
      .then((nextApprovals) => {
        if (isMountedRef.current) {
          setApprovals(nextApprovals);
        }
      })
      .finally(() => {
        if (isMountedRef.current) {
          setLoading(false);
        }
      });
  }, [fetchApprovals]);

  useEffect(() => {
    let cancelled = false;

    void fetchApprovals()
      .then((nextApprovals) => {
        if (!cancelled) {
          setApprovals(nextApprovals);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fetchApprovals]);

  return { approvals, loading, reload };
}
