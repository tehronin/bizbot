"use client";

import Link from "next/link";
import { useState } from "react";

export default function OnboardingLlmPage() {
  const [provider, setProvider] = useState("openai");
  const [openAiKey, setOpenAiKey] = useState("");

  async function save(): Promise<void> {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: [{ key: "ACTIVE_LLM_PROVIDER", value: provider }],
        env: { OPENAI_API_KEY: openAiKey },
      }),
    });
    await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "llm" }),
    });
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <section className="w-full max-w-2xl border p-8" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>llm provider</div>
        <div className="space-y-3 mb-6">
          <input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="ACTIVE_LLM_PROVIDER" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          <input value={openAiKey} onChange={(event) => setOpenAiKey(event.target.value)} placeholder="OPENAI_API_KEY" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
        </div>
        <div className="flex gap-3">
          <button onClick={() => void save()} className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>save</button>
          <Link href="/onboarding/platforms" className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>next</Link>
        </div>
      </section>
    </main>
  );
}
