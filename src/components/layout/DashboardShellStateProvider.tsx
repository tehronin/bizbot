"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export const BIZBOT_APPROVALS_CHANGED_EVENT = "bizbot:approvals-changed";

interface ApprovalsResponse {
  approvals?: Array<{ id: string }>;
}

interface DashboardShellStateValue {
  pendingApprovalCount: number;
}

const DashboardShellStateContext = createContext<DashboardShellStateValue | null>(null);

export function DashboardShellStateProvider({ children }: { children: ReactNode }) {
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const loadPendingApprovalCount = () => {
      fetch("/api/approvals")
        .then((response) => response.json() as Promise<ApprovalsResponse>)
        .then((payload) => {
          if (!cancelled) {
            setPendingApprovalCount(payload.approvals?.length ?? 0);
          }
        })
        .catch(() => undefined);
    };

    loadPendingApprovalCount();
    window.addEventListener(BIZBOT_APPROVALS_CHANGED_EVENT, loadPendingApprovalCount);

    return () => {
      cancelled = true;
      window.removeEventListener(BIZBOT_APPROVALS_CHANGED_EVENT, loadPendingApprovalCount);
    };
  }, []);

  return (
    <DashboardShellStateContext.Provider value={{ pendingApprovalCount }}>
      {children}
    </DashboardShellStateContext.Provider>
  );
}

export function useDashboardShellState(): DashboardShellStateValue {
  const value = useContext(DashboardShellStateContext);
  if (!value) {
    throw new Error("useDashboardShellState must be used within DashboardShellStateProvider.");
  }

  return value;
}