"use client";

import Link from "next/link";

export default function OnboardingCompletePage() {
  async function finish(): Promise<void> {
    await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true, step: "complete" }),
    });
    window.location.href = "/chat";
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <section className="w-full max-w-2xl border p-8" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>complete</div>
        <h1 className="text-3xl mb-4">Setup checkpoint reached</h1>
        <p className="text-sm mb-6" style={{ color: "var(--text-dim)" }}>
          Your local agent is configured enough to start drafting, queueing, reviewing, and receiving webhook-driven inbox events. Treat Settings as the place to extend this when future features add new operational requirements.
        </p>
        <div className="space-y-2 text-xs leading-6 mb-6" style={{ color: "var(--text-dim)" }}>
          <div>Review the settings page before going live with real accounts.</div>
          <div>Seed explicit user memory with preferred name, timezone, workflows, and operator constraints before relying on long-running agent behavior.</div>
          <div>Meta webhook verification depends on the verify token you saved during onboarding.</div>
          <div>Workspace and knowledge folder paths now affect document retrieval and file tools.</div>
          <div>Google Business Profile review, post, and hours workflows depend on the account and location resource names you saved during onboarding.</div>
        </div>
        <div className="flex gap-3">
          <button onClick={() => void finish()} className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>enter dashboard</button>
          <Link href="/settings" className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>settings</Link>
          <Link href="/settings#explicit-user-memory" className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>seed memory</Link>
        </div>
      </section>
    </main>
  );
}
