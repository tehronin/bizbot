"use client";

import { useEffect, useState } from "react";

interface SettingRecord {
  key: string;
  value: string;
}

export default function SettingsPage() {
  const [provider, setProvider] = useState("openai");
  const [workspacePath, setWorkspacePath] = useState("./workspace");
  const [settings, setSettings] = useState<SettingRecord[]>([]);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json() as Promise<{ settings: SettingRecord[] }>)
      .then((data) => setSettings(data.settings ?? []))
      .catch(() => {});
  }, []);

  async function save(): Promise<void> {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: [{ key: "ACTIVE_LLM_PROVIDER", value: provider }],
        env: { BIZBOT_WORKSPACE_PATH: workspacePath },
      }),
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>runtime</div>
        <div className="space-y-3">
          <input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="Active provider" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          <input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder="Workspace path" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          <button onClick={() => void save()} className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>save</button>
        </div>
      </section>
      <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>stored settings</div>
        <div className="space-y-2 text-sm">
          {settings.map((item) => (
            <div key={item.key} className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}>
              <span style={{ color: "var(--text-muted)" }}>{item.key}</span>
              <span>{item.value}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
