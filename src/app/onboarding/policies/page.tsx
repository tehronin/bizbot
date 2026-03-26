"use client";

import Link from "next/link";
import { useState } from "react";

export default function OnboardingPoliciesPage() {
  const [voice, setVoice] = useState("Calm, precise, useful, technically credible.");
  const [guardrails, setGuardrails] = useState("No unsafe claims. No political bait. No confidential data.");

  async function save(): Promise<void> {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: [
          { key: "BRAND_VOICE", value: voice },
          { key: "GUARDRAILS", value: guardrails },
        ],
      }),
    });
    await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "policies" }),
    });
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <section className="w-full max-w-2xl border p-8" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>policies</div>
        <div className="space-y-3 mb-6">
          <textarea value={voice} onChange={(event) => setVoice(event.target.value)} className="w-full min-h-32 bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          <textarea value={guardrails} onChange={(event) => setGuardrails(event.target.value)} className="w-full min-h-32 bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
        </div>
        <div className="flex gap-3">
          <button onClick={() => void save()} className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>save</button>
          <Link href="/onboarding/complete" className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>next</Link>
        </div>
      </section>
    </main>
  );
}
