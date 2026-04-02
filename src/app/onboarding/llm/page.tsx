"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type ChatProvider = "ollama" | "google" | "openai" | "anthropic" | "minimax";

const CHAT_MODELS: Record<ChatProvider, string[]> = {
  ollama: ["gemma3", "gemma3:4b", "gemma3:12b", "llama3.2"],
  google: ["gemini-3-flash-preview", "gemini-2.5-flash"],
  openai: ["gpt-4o", "gpt-4.1-mini"],
  anthropic: ["claude-3-5-sonnet-20241022", "claude-3-7-sonnet-latest"],
  minimax: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5", "MiniMax-M2.5-highspeed", "M2-her", "abab6.5s-chat"],
};

const EMBEDDING_MODELS: Record<string, string[]> = {
  google: ["gemini-embedding-001", "gemini-embedding-2-preview"],
  openai: ["text-embedding-3-small", "text-embedding-3-large"],
  ollama: ["mxbai-embed-large", "nomic-embed-text", "all-minilm"],
};

const PROVIDER_KEY_LABELS: Record<Exclude<ChatProvider, "ollama">, string> = {
  google: "Google API key",
  openai: "OpenAI API key",
  anthropic: "Anthropic API key",
  minimax: "MiniMax API key",
};

export default function OnboardingLlmPage() {
  const [provider, setProvider] = useState<ChatProvider>("google");
  const [models, setModels] = useState<Record<ChatProvider, string>>({
    ollama: "gemma3",
    google: "gemini-3-flash-preview",
    openai: "gpt-4o",
    anthropic: "claude-3-5-sonnet-20241022",
    minimax: "MiniMax-M2.7",
  });
  const [embeddingProvider, setEmbeddingProvider] = useState("google");
  const [embeddingModel, setEmbeddingModel] = useState("gemini-embedding-001");
  const [temperature, setTemperature] = useState("0.2");
  const [maxTokens, setMaxTokens] = useState("4096");
  const [googleApiKey, setGoogleApiKey] = useState("");
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [miniMaxApiKey, setMiniMaxApiKey] = useState("");

  const providerReadiness = useMemo(() => ([
    {
      provider: "google",
      ready: googleApiKey.trim().length > 0,
      reason: googleApiKey.trim().length > 0 ? "Ready" : "Add Google API key",
    },
    {
      provider: "openai",
      ready: openAiApiKey.trim().length > 0,
      reason: openAiApiKey.trim().length > 0 ? "Ready" : "Add OpenAI API key",
    },
    {
      provider: "anthropic",
      ready: anthropicApiKey.trim().length > 0,
      reason: anthropicApiKey.trim().length > 0 ? "Ready" : "Add Anthropic API key",
    },
    {
      provider: "minimax",
      ready: miniMaxApiKey.trim().length > 0,
      reason: miniMaxApiKey.trim().length > 0 ? "Ready" : "Add MiniMax API key",
    },
    {
      provider: "ollama",
      ready: true,
      reason: "Local endpoint",
    },
  ] as const), [anthropicApiKey, googleApiKey, miniMaxApiKey, openAiApiKey]);

  const readinessByProvider = Object.fromEntries(providerReadiness.map((entry) => [entry.provider, entry]));
  const selectedProviderReadiness = readinessByProvider[provider];
  const selectedEmbeddingReadiness =
    embeddingProvider === "google"
      ? { ready: googleApiKey.trim().length > 0, reason: googleApiKey.trim().length > 0 ? "Ready" : "Add Google API key" }
      : embeddingProvider === "openai"
        ? { ready: openAiApiKey.trim().length > 0, reason: openAiApiKey.trim().length > 0 ? "Ready" : "Add OpenAI API key" }
        : { ready: true, reason: "Local endpoint" };
  const embeddingProviderReadiness = {
    google: googleApiKey.trim().length > 0,
    openai: openAiApiKey.trim().length > 0,
    ollama: true,
  };

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
            Pick the agent LLM role and the embedding role separately. Adding an API key makes a provider available, but the active agent role only changes when you explicitly select it.
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Agent LLM role</label>
                <div className="text-xs leading-6 mt-2" style={{ color: "var(--text-dim)" }}>
                  Controls chat, tool calling, and the main agent loop. This does not affect embeddings.
                </div>
              </div>
              <div className="text-xs uppercase tracking-[0.16em]" style={{ color: selectedProviderReadiness.ready ? "var(--success)" : "var(--danger)" }}>
                {selectedProviderReadiness.ready ? "ready" : "needs setup"}
              </div>
            </div>
            <select value={provider} onChange={(event) => setProvider(event.target.value as ChatProvider)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {Object.keys(CHAT_MODELS).map((option) => (
                <option
                  key={option}
                  value={option}
                  disabled={!readinessByProvider[option as ChatProvider]?.ready && option !== provider}
                >
                  {option} · {readinessByProvider[option as ChatProvider]?.reason ?? ""}
                </option>
              ))}
            </select>
            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Active provider model</label>
            <select value={models[provider]} onChange={(event) => setModels((current) => ({ ...current, [provider]: event.target.value }))} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {CHAT_MODELS[provider].map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <div className="grid gap-2">
              {providerReadiness.map((entry) => (
                <div key={entry.provider} className="flex items-center justify-between border px-3 py-2 text-xs uppercase tracking-[0.14em]" style={{ borderColor: entry.provider === provider ? "var(--accent)" : "var(--border)", color: "var(--text-primary)", background: entry.provider === provider ? "var(--accent-glow)" : "transparent" }}>
                  <span>{entry.provider}</span>
                  <span style={{ color: entry.ready ? "var(--success)" : "var(--text-dim)" }}>{entry.reason}</span>
                </div>
              ))}
            </div>
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
            <div className="flex items-start justify-between gap-4">
              <div>
                <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Embedding role</label>
                <div className="text-xs leading-6 mt-2" style={{ color: "var(--text-dim)" }}>
                  Controls vector generation only. For the intended split, keep embeddings on Google and use MiniMax M2.7 for the agent role.
                </div>
              </div>
              <div className="text-xs uppercase tracking-[0.16em]" style={{ color: selectedEmbeddingReadiness.ready ? "var(--success)" : "var(--danger)" }}>
                {selectedEmbeddingReadiness.ready ? "ready" : "needs setup"}
              </div>
            </div>
            <select value={embeddingProvider} onChange={(event) => {
              const nextProvider = event.target.value;
              setEmbeddingProvider(nextProvider);
              setEmbeddingModel(EMBEDDING_MODELS[nextProvider]?.[0] ?? embeddingModel);
            }} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {Object.keys(EMBEDDING_MODELS).map((option) => (
                <option
                  key={option}
                  value={option}
                  disabled={!embeddingProviderReadiness[option as keyof typeof embeddingProviderReadiness] && option !== embeddingProvider}
                >
                  {option} · {embeddingProviderReadiness[option as keyof typeof embeddingProviderReadiness] ? "Ready" : option === "ollama" ? "Local endpoint" : `Add ${option === "google" ? "Google" : "OpenAI"} API key`}
                </option>
              ))}
            </select>
            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Embedding model</label>
            <select value={embeddingModel} onChange={(event) => setEmbeddingModel(event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {(EMBEDDING_MODELS[embeddingProvider] ?? [embeddingModel]).map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
              The recommended split is Google embeddings plus MiniMax M2.7 for the agent role. Changing credentials does not auto-switch the active role.
            </div>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>{PROVIDER_KEY_LABELS.google}</label>
            <input value={googleApiKey} onChange={(event) => setGoogleApiKey(event.target.value)} placeholder="GOOGLE_AI_API_KEY" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </div>
          <div className="space-y-1">
            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>{PROVIDER_KEY_LABELS.openai}</label>
            <input value={openAiApiKey} onChange={(event) => setOpenAiApiKey(event.target.value)} placeholder="OPENAI_API_KEY" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </div>
          <div className="space-y-1">
            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>{PROVIDER_KEY_LABELS.anthropic}</label>
            <input value={anthropicApiKey} onChange={(event) => setAnthropicApiKey(event.target.value)} placeholder="ANTHROPIC_API_KEY" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </div>
          <div className="space-y-1">
            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>{PROVIDER_KEY_LABELS.minimax}</label>
            <input value={miniMaxApiKey} onChange={(event) => setMiniMaxApiKey(event.target.value)} placeholder="MINIMAX_API_KEY" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </div>
        </div>
        <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
          Suggested first-run path: enter Google and MiniMax credentials, keep Embedding role on Google, then explicitly set Agent LLM role to MiniMax M2.7 once it shows as ready.
        </div>
        <div className="flex gap-3">
          <button onClick={() => void save()} className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>save</button>
          <Link href="/onboarding/platforms" className="px-4 py-2 border text-sm uppercase tracking-[0.18em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>next</Link>
        </div>
      </section>
    </main>
  );
}
