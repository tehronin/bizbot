"use client";

import Link from "next/link";
import { useState } from "react";

type ChatProvider = "ollama" | "google" | "openai" | "anthropic" | "minimax";

const CHAT_MODELS: Record<ChatProvider, string[]> = {
  ollama: ["gemma3", "gemma3:4b", "gemma3:12b", "llama3.2"],
  google: ["gemini-3-flash-preview", "gemini-2.5-flash"],
  openai: ["gpt-4o", "gpt-4.1-mini"],
  anthropic: ["claude-3-5-sonnet-20241022", "claude-3-7-sonnet-latest"],
  minimax: ["abab6.5s-chat"],
};

const EMBEDDING_MODELS: Record<string, string[]> = {
  google: ["gemini-embedding-001", "gemini-embedding-2-preview"],
  openai: ["text-embedding-3-small", "text-embedding-3-large"],
  ollama: ["mxbai-embed-large", "nomic-embed-text", "all-minilm"],
};

export default function OnboardingLlmPage() {
  const [provider, setProvider] = useState<ChatProvider>("google");
  const [models, setModels] = useState<Record<ChatProvider, string>>({
    ollama: "gemma3",
    google: "gemini-3-flash-preview",
    openai: "gpt-4o",
    anthropic: "claude-3-5-sonnet-20241022",
    minimax: "abab6.5s-chat",
  });
  const [embeddingProvider, setEmbeddingProvider] = useState("google");
  const [embeddingModel, setEmbeddingModel] = useState("gemini-embedding-001");
  const [temperature, setTemperature] = useState("0.2");
  const [maxTokens, setMaxTokens] = useState("4096");
  const [googleApiKey, setGoogleApiKey] = useState("");
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [miniMaxApiKey, setMiniMaxApiKey] = useState("");

  async function save(): Promise<void> {
    const env: Record<string, string> = {
      ACTIVE_LLM_PROVIDER: provider,
      OLLAMA_MODEL: models.ollama,
      GOOGLE_MODEL: models.google,
      OPENAI_MODEL: models.openai,
      ANTHROPIC_MODEL: models.anthropic,
      MINIMAX_MODEL: models.minimax,
      EMBEDDING_PROVIDER: embeddingProvider,
      EMBEDDING_MODEL: embeddingModel,
      LLM_TEMPERATURE: temperature,
      LLM_MAX_TOKENS: maxTokens,
    };

    if (googleApiKey.trim()) env.GOOGLE_AI_API_KEY = googleApiKey.trim();
    if (openAiApiKey.trim()) env.OPENAI_API_KEY = openAiApiKey.trim();
    if (anthropicApiKey.trim()) env.ANTHROPIC_API_KEY = anthropicApiKey.trim();
    if (miniMaxApiKey.trim()) env.MINIMAX_API_KEY = miniMaxApiKey.trim();

    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ env }),
    });
    await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "llm" }),
    });
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <section className="w-full max-w-3xl border p-8 space-y-6" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div>
          <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>step 1: llm + embeddings</div>
          <div className="text-sm max-w-2xl" style={{ color: "var(--text-dim)" }}>
            Pick the active chat provider, save model defaults for the providers you expect to use, and enter only the API keys you want to update.
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Active chat provider</label>
            <select value={provider} onChange={(event) => setProvider(event.target.value as ChatProvider)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {Object.keys(CHAT_MODELS).map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Active provider model</label>
            <select value={models[provider]} onChange={(event) => setModels((current) => ({ ...current, [provider]: event.target.value }))} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {CHAT_MODELS[provider].map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Temperature</label>
                <input value={temperature} onChange={(event) => setTemperature(event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Max tokens</label>
                <input value={maxTokens} onChange={(event) => setMaxTokens(event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Embedding provider</label>
            <select value={embeddingProvider} onChange={(event) => {
              const nextProvider = event.target.value;
              setEmbeddingProvider(nextProvider);
              setEmbeddingModel(EMBEDDING_MODELS[nextProvider]?.[0] ?? embeddingModel);
            }} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {Object.keys(EMBEDDING_MODELS).map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Embedding model</label>
            <select value={embeddingModel} onChange={(event) => setEmbeddingModel(event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {(EMBEDDING_MODELS[embeddingProvider] ?? [embeddingModel]).map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
              Google is the most complete current path because it supports native Gemini tool use, Search grounding, and code execution in the agent loop.
            </div>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <input value={googleApiKey} onChange={(event) => setGoogleApiKey(event.target.value)} placeholder="GOOGLE_AI_API_KEY" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          <input value={openAiApiKey} onChange={(event) => setOpenAiApiKey(event.target.value)} placeholder="OPENAI_API_KEY" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          <input value={anthropicApiKey} onChange={(event) => setAnthropicApiKey(event.target.value)} placeholder="ANTHROPIC_API_KEY" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          <input value={miniMaxApiKey} onChange={(event) => setMiniMaxApiKey(event.target.value)} placeholder="MINIMAX_API_KEY" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
        </div>
        <div className="flex gap-3">
          <button onClick={() => void save()} className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>save</button>
          <Link href="/onboarding/platforms" className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>next</Link>
        </div>
      </section>
    </main>
  );
}
