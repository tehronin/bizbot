"use client";

import Link from "next/link";
import { useState } from "react";

export default function OnboardingLlmPage() {
  const [provider, setProvider] = useState("ollama");
  const [ollamaModel, setOllamaModel] = useState("gemma3");
  const [embeddingProvider, setEmbeddingProvider] = useState("google");
  const [embeddingModel, setEmbeddingModel] = useState("gemini-embedding-001");
  const [googleApiKey, setGoogleApiKey] = useState("");

  async function save(): Promise<void> {
    const env: Record<string, string> = {
      ACTIVE_LLM_PROVIDER: provider,
      OLLAMA_MODEL: ollamaModel,
      EMBEDDING_PROVIDER: embeddingProvider,
      EMBEDDING_MODEL: embeddingModel,
    };

    if (googleApiKey.trim().length > 0) {
      env.GOOGLE_AI_API_KEY = googleApiKey.trim();
    }

    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        env,
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
          <input value={ollamaModel} onChange={(event) => setOllamaModel(event.target.value)} placeholder="OLLAMA_MODEL" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          <input value={embeddingProvider} onChange={(event) => setEmbeddingProvider(event.target.value)} placeholder="EMBEDDING_PROVIDER" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          <input value={embeddingModel} onChange={(event) => setEmbeddingModel(event.target.value)} placeholder="EMBEDDING_MODEL" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          <input value={googleApiKey} onChange={(event) => setGoogleApiKey(event.target.value)} placeholder="GOOGLE_AI_API_KEY (optional if already saved)" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
        </div>
        <div className="flex gap-3">
          <button onClick={() => void save()} className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>save</button>
          <Link href="/onboarding/platforms" className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>next</Link>
        </div>
      </section>
    </main>
  );
}
