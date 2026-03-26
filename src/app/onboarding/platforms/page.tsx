"use client";

import Link from "next/link";
import { useState } from "react";

export default function OnboardingPlatformsPage() {
  const [twitterUserId, setTwitterUserId] = useState("");
  const [facebookPageId, setFacebookPageId] = useState("");

  async function save(): Promise<void> {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        env: {
          TWITTER_USER_ID: twitterUserId,
          FACEBOOK_PAGE_ID: facebookPageId,
        },
      }),
    });
    await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "platforms" }),
    });
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <section className="w-full max-w-2xl border p-8" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>platform ids</div>
        <div className="space-y-3 mb-6">
          <input value={twitterUserId} onChange={(event) => setTwitterUserId(event.target.value)} placeholder="TWITTER_USER_ID" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          <input value={facebookPageId} onChange={(event) => setFacebookPageId(event.target.value)} placeholder="FACEBOOK_PAGE_ID" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
        </div>
        <div className="flex gap-3">
          <button onClick={() => void save()} className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>save</button>
          <Link href="/onboarding/policies" className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>next</Link>
        </div>
      </section>
    </main>
  );
}
