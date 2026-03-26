"use client";

import { useEffect, useState } from "react";

interface SettingsResponse {
  settings: Array<{ key: string; value: string }>;
}

interface ApprovalsResponse {
  approvals?: Array<{ id: string }>;
}

export default function Header() {
  const [provider, setProvider] = useState("openai");
  const [pending, setPending] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json() as Promise<SettingsResponse>)
      .then((data) => {
        const activeProvider = data.settings.find((entry) => entry.key === "ACTIVE_LLM_PROVIDER")?.value;
        if (activeProvider) {
          setProvider(activeProvider);
        }
      })
      .catch(() => {});

    fetch("/api/approvals")
      .then((res) => res.json() as Promise<ApprovalsResponse>)
      .then((data) => setPending(data.approvals?.length ?? 0))
      .catch(() => {});
  }, []);

  return (
    <header
      className="flex items-center justify-between px-6 py-4 border-b"
      style={{ borderColor: "var(--border-sub)", background: "var(--bg-surface)" }}
    >
      <div>
        <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>
          stealth console
        </div>
        <div className="text-sm" style={{ color: "var(--text-primary)" }}>
          {now.toLocaleString()}
        </div>
      </div>
      <div className="flex items-center gap-6 text-xs uppercase tracking-[0.2em]">
        <div style={{ color: "var(--text-muted)" }}>
          provider
          <span className="ml-2" style={{ color: "var(--accent)" }}>{provider}</span>
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
