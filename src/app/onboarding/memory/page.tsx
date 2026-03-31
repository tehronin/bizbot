"use client";

import Link from "next/link";
import { UserMemoryPanel } from "@/components/settings/UserMemoryPanel";

export default function OnboardingMemoryPage() {
  async function markStep(): Promise<void> {
    await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "memory" }),
    });
  }

  return (
    <main className="min-h-screen px-6 py-8" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <section className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[0.7fr_1.3fr]">
        <section className="border p-8 space-y-6 self-start" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div>
            <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>step 4: seed explicit memory</div>
            <h1 className="text-3xl mb-4">Teach BizBot the stable facts</h1>
            <p className="text-sm leading-7" style={{ color: "var(--text-dim)" }}>
              Save only the facts BizBot should carry forward across conversations: preferred name, timezone, operating preferences, stable workflows, and hard constraints.
            </p>
          </div>
          <div className="space-y-3 text-xs leading-6" style={{ color: "var(--text-dim)" }}>
            <div>Use plain text for names and short preferences.</div>
            <div>Use JSON for structured workflows, operator settings, and constraints.</div>
            <div>Do not store secrets, tokens, payment details, or conversation noise.</div>
            <div>This memory is injected into the system prompt separately from semantic recall and graph context.</div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => void markStep()} className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>mark step complete</button>
            <Link href="/onboarding/complete" className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>next</Link>
          </div>
        </section>

        <UserMemoryPanel />
      </section>
    </main>
  );
}