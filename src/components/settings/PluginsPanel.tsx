"use client";

import Link from "next/link";

export function PluginsPanel() {
  return (
    <section className="border p-4 space-y-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>plugin controls</div>
        <div className="text-sm" style={{ color: "var(--text-dim)" }}>
          Use the dedicated plugins page to inspect builtin and external integrations, toggle live exposure, and disconnect external MCP entries without deleting retained data.
        </div>
      </div>

      <Link
        href="/plugins"
        className="flex items-center justify-between gap-4 border p-3 text-sm"
        style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "var(--accent-glow)" }}
      >
        <span>Open plugin catalog</span>
        <span className="text-xs uppercase tracking-[0.18em]">manage</span>
      </Link>
    </section>
  );
}