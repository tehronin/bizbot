"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useDashboardShellState } from "@/components/layout/DashboardShellStateProvider";

interface SettingsResponse {
  settings: Array<{ key: string; value: string }>;
  env?: Record<string, string>;
}

interface AgenticSetupResponse {
  state: {
    tone: "missing" | "partial" | "ready";
    label: string;
    detail: string;
    nextRequiredLabel: string | null;
    isFirstRun: boolean;
    completionPercent: number;
  };
}

function getSetupTooltip(state: AgenticSetupResponse["state"] | null): string {
  if (!state) {
    return "Open guided setup";
  }

  if (state.isFirstRun) {
    return `${state.detail}\nRecommended start: Google key for chat + embeddings.`;
  }

  if (state.nextRequiredLabel) {
    return `${state.detail}\nNext item: ${state.nextRequiredLabel}`;
  }

  return state.detail;
}

export default function Header() {
  const { pendingApprovalCount } = useDashboardShellState();
  const [provider, setProvider] = useState<string | null>(null);
  const [now, setNow] = useState<string>("");
  const [setupState, setSetupState] = useState<AgenticSetupResponse["state"] | null>(null);

  function refreshHeaderState(): void {
    fetch("/api/settings")
      .then((res) => res.json() as Promise<SettingsResponse>)
      .then((data) => {
        const activeProvider = data.env?.ACTIVE_LLM_PROVIDER
          ?? data.settings.find((entry) => entry.key === "ACTIVE_LLM_PROVIDER")?.value;
        if (activeProvider) {
          setProvider(activeProvider);
        }
      })
      .catch(() => {});

    fetch("/api/agentic-setup")
      .then((res) => res.json() as Promise<AgenticSetupResponse>)
      .then((data) => setSetupState(data.state))
      .catch(() => {});
  }

  useEffect(() => {
    const updateNow = () => setNow(new Date().toLocaleString());
    updateNow();
    const timer = window.setInterval(updateNow, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    refreshHeaderState();

    const handleSetupChanged = () => refreshHeaderState();
    window.addEventListener("bizbot:agentic-setup-changed", handleSetupChanged);
    return () => window.removeEventListener("bizbot:agentic-setup-changed", handleSetupChanged);
  }, []);

  const setupToneClasses =
    setupState?.tone === "ready"
      ? "border-success text-success bg-success/10"
      : setupState?.tone === "partial"
        ? "border-warning text-warning bg-warning/10"
        : "border-danger text-danger bg-danger/10";

  return (
    <header
      className="h-14 flex items-center justify-between px-5 border-b border-border bg-surface"
    >
      <div>
        <div className="font-mono text-[9px] uppercase tracking-widest text-dim">
          command console
        </div>
        <div className="text-xs font-mono min-h-[1rem] text-primary">
          {now || " "}
        </div>
      </div>
      <div className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-widest">
        <Link href="/chat?setup=1" className={`inline-flex items-center gap-2 border px-3 py-2 ${setupToneClasses}`} title={getSetupTooltip(setupState)}>
          <span>{setupState?.tone === "ready" ? "check" : setupState?.tone === "partial" ? "pending" : "setup"}</span>
          <span>{setupState?.label ?? "Start setup"}</span>
        </Link>
        <div className="text-muted">
          provider
          <span className={`ml-2 ${provider ? "text-accent" : "text-dim"}`}>
            {provider ?? "detecting"}
          </span>
        </div>
        <div className="text-muted">
          approvals
          <span className={`ml-2 ${pendingApprovalCount > 0 ? "text-danger" : "text-primary"}`}>
            {pendingApprovalCount}
          </span>
        </div>
      </div>
    </header>
  );
}
