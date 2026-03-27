"use client";

import { useEffect, useMemo, useState } from "react";

interface SettingRecord {
  key: string;
  value: string;
}

interface SettingsResponse {
  settings: SettingRecord[];
  env?: Record<string, string>;
}

interface LlmStatusResponse {
  activeProvider: string;
  activeModel: string;
  configuredProviders: Record<string, boolean>;
  generation: {
    maxTokens: number;
    temperature: number;
  };
  embedding: {
    provider: string;
    model: string;
    dimensions: number;
  };
  autonomy: {
    autonomyPreset: string;
    heartbeatSeconds: number;
    knowledgePath: string;
    knowledgeEnabled: boolean;
    description: string;
  };
  capabilities: {
    canCreatePosts: boolean;
    canReplyDirectly: boolean;
    canPublishWithoutApproval: boolean;
    usesKnowledgeFolder: boolean;
    replyScope: string;
  };
  knowledge: {
    enabled: boolean;
    folder: string;
    absolutePath: string;
    exists: boolean;
    documentCount: number;
  };
  heartbeat: {
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
    summary: string | null;
    serviceRunning?: boolean;
    queueName?: string | null;
  };
  checks: {
    chat: {
      ok: boolean;
      provider: string;
    };
    embedding: {
      ok: boolean;
      provider: string;
      model: string;
      dimensions: number;
      error?: string;
    };
  };
  options: {
    chatProviders: string[];
    chatModels: Record<string, string[]>;
    embeddingProviders: string[];
    embeddingModels: Record<string, string[]>;
  };
}

type SaveState = "idle" | "saving" | "saved" | "error";
type ChatProvider = "ollama" | "google" | "openai" | "anthropic" | "minimax";

const AUTONOMY_PRESETS = [
  { id: "manual_only", label: "Manual Only", description: "Research, drafting, memory, and document lookup only. No direct posting or replies." },
  { id: "reply_only", label: "DM Replies Only", description: "Can draft or send direct-message replies only. Public mentions stay out of the auto-reply path." },
  { id: "approval_all_posts", label: "Approval For New Posts", description: "Can draft new posts, but top-level posts are queued for approval before publishing." },
  { id: "wide_open", label: "Wide Open", description: "Can publish and reply without a human in the loop." },
] as const;

const PUBLIC_ENV_DEFAULTS = {
  ACTIVE_LLM_PROVIDER: "ollama",
  OPENAI_MODEL: "gpt-4o",
  ANTHROPIC_MODEL: "claude-3-5-sonnet-20241022",
  OLLAMA_MODEL: "gemma3",
  OLLAMA_BASE_URL: "http://localhost:11434/v1",
  GOOGLE_MODEL: "gemini-3-flash-preview",
  EMBEDDING_PROVIDER: "google",
  EMBEDDING_MODEL: "gemini-embedding-001",
  EMBEDDING_DIMENSIONS: "1536",
  LLM_TEMPERATURE: "0.2",
  LLM_MAX_TOKENS: "4096",
  MINIMAX_MODEL: "abab6.5s-chat",
  MINIMAX_BASE_URL: "https://api.minimax.chat/v1",
  BIZBOT_AUTONOMY_PRESET: "approval_all_posts",
  BIZBOT_AGENT_HEARTBEAT_SECONDS: "300",
  BIZBOT_KNOWLEDGE_ENABLED: "true",
  BIZBOT_KNOWLEDGE_PATH: "knowledge",
  BIZBOT_WORKSPACE_PATH: "./workspace",
  BIZBOT_PROCESS_WEBHOOK_INBOX_IMMEDIATELY: "true",
  TWITTER_USER_ID: "",
  FACEBOOK_PAGE_ID: "",
  META_PAGE_ID: "",
  INSTAGRAM_BUSINESS_ACCOUNT_ID: "",
  META_INSTAGRAM_ACCOUNT_ID: "",
} as const;

type PublicEnvKey = keyof typeof PUBLIC_ENV_DEFAULTS;

type SecretEnvKey =
  | "GOOGLE_AI_API_KEY"
  | "OPENAI_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "MINIMAX_API_KEY"
  | "META_ACCESS_TOKEN"
  | "META_WEBHOOK_VERIFY_TOKEN"
  | "TWITTER_APP_KEY"
  | "TWITTER_APP_SECRET"
  | "TWITTER_CLIENT_ID"
  | "TWITTER_CLIENT_SECRET"
  | "TWITTER_ACCESS_TOKEN"
  | "TWITTER_ACCESS_TOKEN_SECRET";

const SECRET_ENV_LABELS: Record<SecretEnvKey, string> = {
  GOOGLE_AI_API_KEY: "Google API key",
  OPENAI_API_KEY: "OpenAI API key",
  ANTHROPIC_API_KEY: "Anthropic API key",
  MINIMAX_API_KEY: "MiniMax API key",
  META_ACCESS_TOKEN: "Meta access token",
  META_WEBHOOK_VERIFY_TOKEN: "Meta webhook verify token",
  TWITTER_APP_KEY: "Twitter app key",
  TWITTER_APP_SECRET: "Twitter app secret",
  TWITTER_CLIENT_ID: "Twitter client ID",
  TWITTER_CLIENT_SECRET: "Twitter client secret",
  TWITTER_ACCESS_TOKEN: "Twitter access token",
  TWITTER_ACCESS_TOKEN_SECRET: "Twitter access token secret",
};

const MODEL_KEY_BY_PROVIDER: Record<ChatProvider, PublicEnvKey> = {
  ollama: "OLLAMA_MODEL",
  google: "GOOGLE_MODEL",
  openai: "OPENAI_MODEL",
  anthropic: "ANTHROPIC_MODEL",
  minimax: "MINIMAX_MODEL",
};

const EMPTY_SECRETS: Record<SecretEnvKey, string> = {
  GOOGLE_AI_API_KEY: "",
  OPENAI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  MINIMAX_API_KEY: "",
  META_ACCESS_TOKEN: "",
  META_WEBHOOK_VERIFY_TOKEN: "",
  TWITTER_APP_KEY: "",
  TWITTER_APP_SECRET: "",
  TWITTER_CLIENT_ID: "",
  TWITTER_CLIENT_SECRET: "",
  TWITTER_ACCESS_TOKEN: "",
  TWITTER_ACCESS_TOKEN_SECRET: "",
};

function sanitizeSecretUpdate(value: string): string | null {
  return value.trim().length > 0 ? value.trim() : null;
}

function isPublicEnvKey(value: string): value is PublicEnvKey {
  return value in PUBLIC_ENV_DEFAULTS;
}

export default function SettingsPage() {
  const [publicEnv, setPublicEnv] = useState<Record<PublicEnvKey, string>>({ ...PUBLIC_ENV_DEFAULTS });
  const [secretEnv, setSecretEnv] = useState<Record<SecretEnvKey, string>>({ ...EMPTY_SECRETS });
  const [settings, setSettings] = useState<SettingRecord[]>([]);
  const [runtime, setRuntime] = useState<LlmStatusResponse | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  async function refreshRuntime(): Promise<void> {
    const response = await fetch("/api/llm");
    const data = (await response.json()) as LlmStatusResponse;
    setRuntime(data);
  }

  function updatePublicEnv(key: PublicEnvKey, value: string): void {
    setPublicEnv((current) => ({ ...current, [key]: value }));
  }

  function updateSecretEnv(key: SecretEnvKey, value: string): void {
    setSecretEnv((current) => ({ ...current, [key]: value }));
  }

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json() as Promise<SettingsResponse>)
      .then((data) => {
        setSettings(data.settings ?? []);
        setPublicEnv((current) => {
          const next = { ...current };
          for (const [key, value] of Object.entries(data.env ?? {})) {
            if (isPublicEnvKey(key)) {
              next[key] = value;
            }
          }
          return next;
        });
      })
      .catch(() => {});

    void refreshRuntime().catch(() => {});
  }, []);

  async function save(): Promise<void> {
    setSaveState("saving");
    try {
      const env: Record<string, string> = { ...publicEnv };

      for (const [key, value] of Object.entries(secretEnv) as Array<[SecretEnvKey, string]>) {
        const safeValue = sanitizeSecretUpdate(value);
        if (safeValue) {
          env[key] = safeValue;
        }
      }

      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env }),
      });

      setSecretEnv({ ...EMPTY_SECRETS });
      setSaveState("saved");
      await refreshRuntime();
    } catch {
      setSaveState("error");
    }
  }

  const activeProvider = (publicEnv.ACTIVE_LLM_PROVIDER as ChatProvider) || "ollama";
  const activeModelKey = MODEL_KEY_BY_PROVIDER[activeProvider] ?? "OLLAMA_MODEL";
  const chatModelOptions = runtime?.options.chatModels[activeProvider] ?? [publicEnv[activeModelKey]];
  const embeddingProviderOptions = runtime?.options.embeddingProviders ?? ["google", "openai", "ollama"];
  const embeddingModelOptions = runtime?.options.embeddingModels[publicEnv.EMBEDDING_PROVIDER] ?? [publicEnv.EMBEDDING_MODEL];
  const metaPageId = publicEnv.META_PAGE_ID || publicEnv.FACEBOOK_PAGE_ID;
  const instagramAccountId = publicEnv.META_INSTAGRAM_ACCOUNT_ID || publicEnv.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const knowledgeExample = `${publicEnv.BIZBOT_WORKSPACE_PATH}/${publicEnv.BIZBOT_KNOWLEDGE_PATH || "knowledge"}`;
  const runtimeCards = useMemo(
    () => [
      { label: "active chat", value: runtime?.activeProvider ?? activeProvider },
      { label: "active model", value: runtime?.activeModel ?? publicEnv[activeModelKey] },
      { label: "chat status", value: runtime?.checks.chat.ok ? "ok" : "failed" },
      { label: "embedding status", value: runtime?.checks.embedding.ok ? "ok" : "failed" },
      { label: "worker", value: runtime?.heartbeat.serviceRunning ? "running" : "stopped" },
      { label: "knowledge docs", value: String(runtime?.knowledge.documentCount ?? 0) },
      { label: "autonomy", value: runtime?.autonomy.autonomyPreset ?? publicEnv.BIZBOT_AUTONOMY_PRESET },
      { label: "heartbeat", value: `${runtime?.autonomy.heartbeatSeconds ?? publicEnv.BIZBOT_AGENT_HEARTBEAT_SECONDS}s` },
    ],
    [activeModelKey, activeProvider, publicEnv, runtime],
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
      <section className="border p-4 space-y-6" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] mb-2" style={{ color: "var(--text-muted)" }}>settings</div>
            <div className="text-sm" style={{ color: "var(--text-dim)" }}>
              This page is the operational source of truth for provider setup, workspace + knowledge paths, autonomy, platform credentials, and Meta webhook behavior.
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void refreshRuntime()} className="px-3 py-2 border text-xs uppercase tracking-[0.18em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>refresh status</button>
            <button onClick={() => void save()} className="px-4 py-2 border text-xs uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>save all</button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="border p-4 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
            <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>chat runtime</div>
            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Provider</label>
            <select value={activeProvider} onChange={(event) => updatePublicEnv("ACTIVE_LLM_PROVIDER", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {(runtime?.options.chatProviders ?? ["ollama", "google", "openai", "anthropic", "minimax"]).map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Model</label>
            <select value={publicEnv[activeModelKey]} onChange={(event) => updatePublicEnv(activeModelKey, event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {chatModelOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Temperature</label>
                <input value={publicEnv.LLM_TEMPERATURE} onChange={(event) => updatePublicEnv("LLM_TEMPERATURE", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Max tokens</label>
                <input value={publicEnv.LLM_MAX_TOKENS} onChange={(event) => updatePublicEnv("LLM_MAX_TOKENS", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
              </div>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Ollama base URL</label>
              <input value={publicEnv.OLLAMA_BASE_URL} onChange={(event) => updatePublicEnv("OLLAMA_BASE_URL", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
          </div>

          <div className="border p-4 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
            <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>embeddings</div>
            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Provider</label>
            <select value={publicEnv.EMBEDDING_PROVIDER} onChange={(event) => updatePublicEnv("EMBEDDING_PROVIDER", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {embeddingProviderOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Model</label>
            <select value={publicEnv.EMBEDDING_MODEL} onChange={(event) => updatePublicEnv("EMBEDDING_MODEL", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {embeddingModelOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Vector dimensions</label>
                <input value={publicEnv.EMBEDDING_DIMENSIONS} onChange={(event) => updatePublicEnv("EMBEDDING_DIMENSIONS", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>MiniMax base URL</label>
                <input value={publicEnv.MINIMAX_BASE_URL} onChange={(event) => updatePublicEnv("MINIMAX_BASE_URL", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
              </div>
            </div>
            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
              Keep the embedding dimension aligned with the model that populated your pgvector column. The current default path expects 1536.
            </div>
          </div>
        </div>

        <div className="border p-4 space-y-4" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
          <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>provider credentials</div>
          <div className="grid gap-3 md:grid-cols-2">
            {(Object.entries(SECRET_ENV_LABELS) as Array<[SecretEnvKey, string]>).slice(0, 4).map(([key, label]) => (
              <div key={key}>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>{label}</label>
                <input type="password" value={secretEnv[key]} onChange={(event) => updateSecretEnv(key, event.target.value)} placeholder="Leave blank to keep existing" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="border p-4 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
            <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>agent operations</div>
            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Autonomy preset</label>
            <select value={publicEnv.BIZBOT_AUTONOMY_PRESET} onChange={(event) => updatePublicEnv("BIZBOT_AUTONOMY_PRESET", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {AUTONOMY_PRESETS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            <div className="space-y-2 text-xs leading-6" style={{ color: "var(--text-dim)" }}>
              {AUTONOMY_PRESETS.map((option) => (
                <div key={option.id} style={{ color: option.id === publicEnv.BIZBOT_AUTONOMY_PRESET ? "var(--text-primary)" : "var(--text-dim)" }}>
                  {option.label}: {option.description}
                </div>
              ))}
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Heartbeat seconds</label>
              <input value={publicEnv.BIZBOT_AGENT_HEARTBEAT_SECONDS} onChange={(event) => updatePublicEnv("BIZBOT_AGENT_HEARTBEAT_SECONDS", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <label className="flex items-center justify-between border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              <span>Process webhook inbox immediately</span>
              <input type="checkbox" checked={publicEnv.BIZBOT_PROCESS_WEBHOOK_INBOX_IMMEDIATELY === "true"} onChange={(event) => updatePublicEnv("BIZBOT_PROCESS_WEBHOOK_INBOX_IMMEDIATELY", event.target.checked ? "true" : "false")} />
            </label>
          </div>

          <div className="border p-4 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
            <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>workspace and knowledge</div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Workspace path</label>
              <input value={publicEnv.BIZBOT_WORKSPACE_PATH} onChange={(event) => updatePublicEnv("BIZBOT_WORKSPACE_PATH", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <label className="flex items-center justify-between border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              <span>Enable knowledge folder</span>
              <input type="checkbox" checked={publicEnv.BIZBOT_KNOWLEDGE_ENABLED === "true"} onChange={(event) => updatePublicEnv("BIZBOT_KNOWLEDGE_ENABLED", event.target.checked ? "true" : "false")} />
            </label>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Knowledge folder</label>
              <input value={publicEnv.BIZBOT_KNOWLEDGE_PATH} onChange={(event) => updatePublicEnv("BIZBOT_KNOWLEDGE_PATH", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
              Current docs path: {knowledgeExample}
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="border p-4 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
            <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>meta and webhooks</div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Facebook page ID</label>
              <input value={publicEnv.FACEBOOK_PAGE_ID} onChange={(event) => updatePublicEnv("FACEBOOK_PAGE_ID", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Meta page ID</label>
              <input value={publicEnv.META_PAGE_ID} onChange={(event) => updatePublicEnv("META_PAGE_ID", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Instagram business account ID</label>
              <input value={publicEnv.INSTAGRAM_BUSINESS_ACCOUNT_ID} onChange={(event) => updatePublicEnv("INSTAGRAM_BUSINESS_ACCOUNT_ID", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Meta Instagram account ID</label>
              <input value={publicEnv.META_INSTAGRAM_ACCOUNT_ID} onChange={(event) => updatePublicEnv("META_INSTAGRAM_ACCOUNT_ID", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            {(["META_ACCESS_TOKEN", "META_WEBHOOK_VERIFY_TOKEN"] as SecretEnvKey[]).map((key) => (
              <div key={key}>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>{SECRET_ENV_LABELS[key]}</label>
                <input type="password" value={secretEnv[key]} onChange={(event) => updateSecretEnv(key, event.target.value)} placeholder="Leave blank to keep existing" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
              </div>
            ))}
            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
              Messenger and Instagram real-time ingestion depend on page/account IDs, a valid Meta access token, and the verify token used by /api/webhooks/meta.
            </div>
            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
              Effective page linkage: page {metaPageId || "not set"}, instagram {instagramAccountId || "not set"}
            </div>
          </div>

          <div className="border p-4 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
            <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>twitter credentials</div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Twitter user ID</label>
              <input value={publicEnv.TWITTER_USER_ID} onChange={(event) => updatePublicEnv("TWITTER_USER_ID", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            {(Object.entries(SECRET_ENV_LABELS) as Array<[SecretEnvKey, string]>).filter(([key]) => key.startsWith("TWITTER_")).map(([key, label]) => (
              <div key={key}>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>{label}</label>
                <input type="password" value={secretEnv[key]} onChange={(event) => updateSecretEnv(key, event.target.value)} placeholder="Leave blank to keep existing" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>runtime status</div>
            <div className="text-xs uppercase tracking-[0.18em]" style={{ color: saveState === "saved" ? "var(--success)" : saveState === "error" ? "var(--danger)" : "var(--text-dim)" }}>
              {saveState}
            </div>
          </div>
          <div className="space-y-3 text-sm">
            {runtimeCards.map((card) => (
              <div key={card.label} className="flex justify-between border-b pb-2 gap-4" style={{ borderColor: "var(--border-sub)" }}>
                <span style={{ color: "var(--text-muted)" }}>{card.label}</span>
                <span>{card.value}</span>
              </div>
            ))}
            {runtime?.checks.embedding.error ? <div className="text-xs leading-6" style={{ color: "var(--danger)" }}>{runtime.checks.embedding.error}</div> : null}
            {runtime?.autonomy.description ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{runtime.autonomy.description}</div> : null}
            {runtime?.heartbeat.summary ? <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{runtime.heartbeat.summary}</div> : null}
          </div>
        </section>

        <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>requirements check</div>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}><span style={{ color: "var(--text-muted)" }}>LLM configured</span><span>{runtime?.checks.chat.ok ? "yes" : "needs attention"}</span></div>
            <div className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}><span style={{ color: "var(--text-muted)" }}>Knowledge folder exists</span><span>{runtime?.knowledge.exists ? "yes" : "no"}</span></div>
            <div className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}><span style={{ color: "var(--text-muted)" }}>Meta page IDs present</span><span>{metaPageId && instagramAccountId ? "yes" : "partial"}</span></div>
            <div className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}><span style={{ color: "var(--text-muted)" }}>Webhook immediate processing</span><span>{publicEnv.BIZBOT_PROCESS_WEBHOOK_INBOX_IMMEDIATELY === "true" ? "enabled" : "disabled"}</span></div>
            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
              When new product features add operational requirements, this page should be updated alongside the codepath so operators can satisfy them here instead of editing env files blindly.
            </div>
          </div>
        </section>

        <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>stored settings</div>
          <div className="space-y-2 text-sm max-h-[420px] overflow-auto">
            {settings.map((item) => (
              <div key={item.key} className="flex justify-between border-b pb-2 gap-4" style={{ borderColor: "var(--border-sub)" }}>
                <span style={{ color: "var(--text-muted)" }}>{item.key}</span>
                <span>{item.value}</span>
              </div>
            ))}
          </div>
        </section>
      </section>
    </div>
  );
}
