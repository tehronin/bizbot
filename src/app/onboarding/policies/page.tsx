"use client";

import Link from "next/link";
import { useState } from "react";

const AUTONOMY_PRESETS = [
  { id: "manual_only", label: "Manual Only" },
  { id: "reply_only", label: "DM Replies Only" },
  { id: "approval_all_posts", label: "Approval For New Posts" },
  { id: "wide_open", label: "Wide Open" },
] as const;

export default function OnboardingPoliciesPage() {
  const [voice, setVoice] = useState("Calm, precise, useful, technically credible.");
  const [guardrails, setGuardrails] = useState("No unsafe claims. No political bait. No confidential data.");
  const [autonomyPreset, setAutonomyPreset] = useState("approval_all_posts");
  const [heartbeatSeconds, setHeartbeatSeconds] = useState("300");
  const [knowledgeEnabled, setKnowledgeEnabled] = useState(true);
  const [knowledgePath, setKnowledgePath] = useState("knowledge");

  async function save(): Promise<void> {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: [
          { key: "BRAND_VOICE", value: voice },
          { key: "GUARDRAILS", value: guardrails },
        ],
        env: {
          BIZBOT_AUTONOMY_PRESET: autonomyPreset,
          BIZBOT_AGENT_HEARTBEAT_SECONDS: heartbeatSeconds,
          BIZBOT_KNOWLEDGE_ENABLED: knowledgeEnabled ? "true" : "false",
          BIZBOT_KNOWLEDGE_PATH: knowledgePath,
        },
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
      <section className="w-full max-w-3xl border p-8 space-y-6" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div>
          <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>step 3: policies + runtime behavior</div>
          <div className="text-sm max-w-2xl" style={{ color: "var(--text-dim)" }}>
            Set the operating guardrails and the runtime rules that change how aggressively the worker drafts, replies, and uses company documents.
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Autonomy preset</label>
            <select value={autonomyPreset} onChange={(event) => setAutonomyPreset(event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {AUTONOMY_PRESETS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Heartbeat seconds</label>
              <input value={heartbeatSeconds} onChange={(event) => setHeartbeatSeconds(event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <label className="flex items-center justify-between border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              <span>Enable knowledge folder</span>
              <input type="checkbox" checked={knowledgeEnabled} onChange={(event) => setKnowledgeEnabled(event.target.checked)} />
            </label>
            <input value={knowledgePath} onChange={(event) => setKnowledgePath(event.target.value)} placeholder="BIZBOT_KNOWLEDGE_PATH" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </div>
          <div className="space-y-3">
            <textarea value={voice} onChange={(event) => setVoice(event.target.value)} className="w-full min-h-32 bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            <textarea value={guardrails} onChange={(event) => setGuardrails(event.target.value)} className="w-full min-h-32 bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={() => void save()} className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>save</button>
          <Link href="/onboarding/complete" className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>next</Link>
        </div>
      </section>
    </main>
  );
}
