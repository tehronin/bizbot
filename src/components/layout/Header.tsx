"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface SettingsResponse {
  settings: Array<{ key: string; value: string }>;
  env?: Record<string, string>;
}

interface ApprovalsResponse {
  approvals?: Array<{ id: string }>;
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
  const [provider, setProvider] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [now, setNow] = useState<Date>(() => new Date());
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

    fetch("/api/approvals")
      .then((res) => res.json() as Promise<ApprovalsResponse>)
      .then((data) => setPending(data.approvals?.length ?? 0))
      .catch(() => {});

    fetch("/api/agentic-setup")
      .then((res) => res.json() as Promise<AgenticSetupResponse>)
      .then((data) => setSetupState(data.state))
      .catch(() => {});
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    refreshHeaderState();

    const handleSetupChanged = () => refreshHeaderState();
    window.addEventListener("bizbot:agentic-setup-changed", handleSetupChanged);
    return () => window.removeEventListener("bizbot:agentic-setup-changed", handleSetupChanged);
  }, []);

  const setupToneColor =
    setupState?.tone === "ready"
      ? "var(--success)"
      : setupState?.tone === "partial"
        ? "var(--warning)"
        : "var(--danger)";

  const setupToneBackground =
    setupState?.tone === "ready"
      ? "rgba(34,197,94,0.10)"
      : setupState?.tone === "partial"
        ? "rgba(245,158,11,0.10)"
        : "rgba(239,68,68,0.10)";

  return (
    <header
      className="h-14 flex items-center justify-between px-5 border-b"
      style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
    >
      <div>
        <div className="font-mono text-[9px] uppercase tracking-widest" style={{ color: "var(--text-dim)" }}>
          command console
        </div>
        <div className="text-xs font-mono" style={{ color: "var(--text-primary)" }}>
          {now ? now.toLocaleString() : "--"}
        </div>
      </div>
      <div className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-widest">
        <Link href="/chat?setup=1" className="inline-flex items-center gap-2 border px-3 py-2" style={{ borderColor: setupToneColor, color: setupToneColor, background: setupToneBackground }} title={getSetupTooltip(setupState)}>
          <span>{setupState?.tone === "ready" ? "check" : setupState?.tone === "partial" ? "pending" : "setup"}</span>
          <span>{setupState?.label ?? "Start setup"}</span>
        </Link>
        <div style={{ color: "var(--text-muted)" }}>
          provider
          <span className="ml-2" style={{ color: provider ? "var(--accent)" : "var(--text-dim)" }}>
            {provider ?? "detecting"}
          </span>
        </div>
        <div style={{ color: "var(--text-muted)" }}>
          approvals
          <span className="ml-2" style={{ color: pending > 0 ? "var(--danger)" : "var(--text-primary)" }}>
            {pending}
          </span>
        </div>
      </div>
    </header>
  );
}
