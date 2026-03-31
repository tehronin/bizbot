"use client";

import { useEffect, useMemo, useState } from "react";
import { UserMemoryPanel } from "@/components/settings/UserMemoryPanel";

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
  providerStatuses: Array<{
    provider: string;
    model: string;
    configured: boolean;
    available: boolean;
    active: boolean;
    reason: string;
  }>;
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
  mcp: {
    serverEndpoint: string;
    authRequired: boolean;
    connectedClients: Array<{
      name: string;
      url: string;
      connected: boolean;
      toolCount: number;
    }>;
  };
  crm: {
    activeProvider: string;
    providers: Array<{
      name: string;
      label: string;
      active: boolean;
      connected: boolean;
      mode: "local" | "stub" | "live";
      details: Record<string, string | boolean | null>;
    }>;
  };
  infrastructure: {
    redisConfigured: boolean;
    memgraphConfigured: boolean;
    memgraphUri: string | null;
    memgraphUser: string | null;
    devWebConflictStrategy: string;
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
  BIZBOT_DEV_WEB_CONFLICT: "reuse",
  BIZBOT_KNOWLEDGE_ENABLED: "true",
  BIZBOT_KNOWLEDGE_PATH: "knowledge",
  BIZBOT_WORKSPACE_PATH: "./workspace",
  BIZBOT_PROCESS_WEBHOOK_INBOX_IMMEDIATELY: "true",
  BIZBOT_BUILDER_WORKSPACE_PATH: "",
  BIZBOT_BUILDER_ALLOWED_COMMANDS: "npm,pnpm,npx,git,node",
  BIZBOT_BUILDER_DEFAULT_TEMPLATE: "node-cli",
  BIZBOT_BUILDER_DEFAULT_PACKAGE_MANAGER: "NPM",
  BIZBOT_BUILDER_INIT_GIT: "true",
  BIZBOT_BUILDER_INSTALL_DEPS: "false",
  BIZBOT_BUILDER_DEFAULT_AGENTIC_PROFILE: "codex",
  BIZBOT_BUILDER_AGENTIC_TIMEOUT_SECONDS: "900",
  BIZBOT_BUILDER_CODEX_ENABLED: "false",
  BIZBOT_BUILDER_CODEX_COMMAND: "codex",
  BIZBOT_BUILDER_CODEX_MODEL: "",
  BIZBOT_BUILDER_CLAUDE_CODE_ENABLED: "false",
  BIZBOT_BUILDER_CLAUDE_CODE_COMMAND: "claude",
  CRM_PROVIDER: "internal",
  HUBSPOT_PORTAL_ID: "",
  HUBSPOT_BASE_URL: "https://api.hubapi.com",
  MCP_SERVERS: "[]",
  REDIS_URL: "",
  MEMGRAPH_URI: "",
  MEMGRAPH_USER: "",
  GOOGLE_BUSINESS_ACCOUNT_NAME: "",
  GOOGLE_BUSINESS_LOCATION_NAME: "",
  GOOGLE_BUSINESS_INFO_LOCATION_NAME: "",
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
  | "HUBSPOT_PRIVATE_APP_TOKEN"
  | "MCP_AUTH_TOKEN"
  | "MEMGRAPH_PASSWORD"
  | "GOOGLE_BUSINESS_CLIENT_ID"
  | "GOOGLE_BUSINESS_CLIENT_SECRET"
  | "GOOGLE_BUSINESS_REFRESH_TOKEN"
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
  HUBSPOT_PRIVATE_APP_TOKEN: "HubSpot private app token",
  MCP_AUTH_TOKEN: "MCP auth token",
  MEMGRAPH_PASSWORD: "Memgraph password",
  GOOGLE_BUSINESS_CLIENT_ID: "Google Business OAuth client ID",
  GOOGLE_BUSINESS_CLIENT_SECRET: "Google Business OAuth client secret",
  GOOGLE_BUSINESS_REFRESH_TOKEN: "Google Business refresh token",
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
  HUBSPOT_PRIVATE_APP_TOKEN: "",
  MCP_AUTH_TOKEN: "",
  MEMGRAPH_PASSWORD: "",
  GOOGLE_BUSINESS_CLIENT_ID: "",
  GOOGLE_BUSINESS_CLIENT_SECRET: "",
  GOOGLE_BUSINESS_REFRESH_TOKEN: "",
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
  const providerStatuses = runtime?.providerStatuses ?? [];
  const providerStatusByName = Object.fromEntries(providerStatuses.map((status) => [status.provider, status]));
  const selectedProviderStatus = providerStatusByName[activeProvider];
  const selectedEmbeddingProviderStatus =
    publicEnv.EMBEDDING_PROVIDER === "google"
      ? { available: Boolean(secretEnv.GOOGLE_AI_API_KEY || runtime?.configuredProviders.google), reason: "Uses Google API key" }
      : publicEnv.EMBEDDING_PROVIDER === "openai"
        ? { available: Boolean(secretEnv.OPENAI_API_KEY || runtime?.configuredProviders.openai), reason: "Uses OpenAI API key" }
        : { available: true, reason: "Uses local Ollama endpoint" };
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
      { label: "crm", value: runtime?.crm.activeProvider ?? publicEnv.CRM_PROVIDER },
      { label: "mcp clients", value: String(runtime?.mcp.connectedClients.length ?? 0) },
      { label: "redis", value: runtime?.infrastructure.redisConfigured ? "configured" : "default/local" },
      { label: "knowledge docs", value: String(runtime?.knowledge.documentCount ?? 0) },
      { label: "autonomy", value: runtime?.autonomy.autonomyPreset ?? publicEnv.BIZBOT_AUTONOMY_PRESET },
      { label: "heartbeat", value: `${runtime?.autonomy.heartbeatSeconds ?? publicEnv.BIZBOT_AGENT_HEARTBEAT_SECONDS}s` },
    ],
    [activeModelKey, activeProvider, publicEnv, runtime],
  );

  return (
    <div className="space-y-6">
      <section className="border p-4 space-y-6" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] mb-2" style={{ color: "var(--text-muted)" }}>settings</div>
            <div className="text-sm" style={{ color: "var(--text-dim)" }}>
              This page is the operational source of truth for provider setup, explicit model roles, workspace + knowledge paths, autonomy, platform credentials, and Meta webhook behavior.
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void refreshRuntime()} className="px-3 py-2 border text-xs uppercase tracking-[0.18em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>refresh status</button>
            <button onClick={() => void save()} className="px-4 py-2 border text-xs uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>save all</button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="border p-4 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>agent llm role</div>
                <div className="text-xs leading-6 mt-2" style={{ color: "var(--text-dim)" }}>
                  Controls chat, tool calling, and the main agent loop. This does not change embeddings.
                </div>
              </div>
              <div className="text-xs uppercase tracking-[0.16em]" style={{ color: selectedProviderStatus?.available ? "var(--success)" : "var(--danger)" }}>
                {selectedProviderStatus?.available ? "ready" : "needs setup"}
              </div>
            </div>
            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Active provider</label>
            <select value={activeProvider} onChange={(event) => updatePublicEnv("ACTIVE_LLM_PROVIDER", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {(runtime?.options.chatProviders ?? ["ollama", "google", "openai", "anthropic", "minimax"]).map((option) => (
                <option
                  key={option}
                  value={option}
                  disabled={providerStatusByName[option] ? !providerStatusByName[option].available && option !== activeProvider : false}
                >
                  {option}{providerStatusByName[option] ? ` · ${providerStatusByName[option].reason}` : ""}
                </option>
              ))}
            </select>
            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Active model</label>
            <select value={publicEnv[activeModelKey]} onChange={(event) => updatePublicEnv(activeModelKey, event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {chatModelOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <div className="grid gap-2">
              {providerStatuses.map((status) => (
                <div key={status.provider} className="flex items-center justify-between border px-3 py-2 text-xs uppercase tracking-[0.14em]" style={{ borderColor: status.active ? "var(--accent)" : "var(--border)", color: "var(--text-primary)", background: status.active ? "var(--accent-glow)" : "transparent" }}>
                  <span>{status.provider}</span>
                  <span style={{ color: status.available ? "var(--success)" : "var(--text-dim)" }}>{status.reason}</span>
                </div>
              ))}
            </div>
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
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>MiniMax base URL</label>
              <input value={publicEnv.MINIMAX_BASE_URL} onChange={(event) => updatePublicEnv("MINIMAX_BASE_URL", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
              Entering credentials only makes a provider available. The agent will switch only when you explicitly change the active provider here.
            </div>
          </div>

          <div className="border p-4 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>embedding role</div>
                <div className="text-xs leading-6 mt-2" style={{ color: "var(--text-dim)" }}>
                  Controls vector generation only. This is independent from the agent LLM role.
                </div>
              </div>
              <div className="text-xs uppercase tracking-[0.16em]" style={{ color: selectedEmbeddingProviderStatus.available ? "var(--success)" : "var(--danger)" }}>
                {selectedEmbeddingProviderStatus.available ? "ready" : "needs setup"}
              </div>
            </div>
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
              <div className="flex items-end">
                <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
                  {selectedEmbeddingProviderStatus.reason}
                </div>
              </div>
            </div>
            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
              Keep the embedding dimension aligned with the model that populated your pgvector column. The current default path expects 1536. For the intended production split, leave embeddings on Google and switch the agent role to MiniMax.
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
            <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>CRM and HubSpot</div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>CRM provider</label>
              <select value={publicEnv.CRM_PROVIDER} onChange={(event) => updatePublicEnv("CRM_PROVIDER", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                <option value="internal">internal</option>
                <option value="hubspot">hubspot</option>
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>HubSpot portal ID</label>
              <input value={publicEnv.HUBSPOT_PORTAL_ID} onChange={(event) => updatePublicEnv("HUBSPOT_PORTAL_ID", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>HubSpot base URL</label>
              <input value={publicEnv.HUBSPOT_BASE_URL} onChange={(event) => updatePublicEnv("HUBSPOT_BASE_URL", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>{SECRET_ENV_LABELS.HUBSPOT_PRIVATE_APP_TOKEN}</label>
              <input type="password" value={secretEnv.HUBSPOT_PRIVATE_APP_TOKEN} onChange={(event) => updateSecretEnv("HUBSPOT_PRIVATE_APP_TOKEN", event.target.value)} placeholder="Leave blank to keep existing" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div className="space-y-2 text-xs leading-6" style={{ color: "var(--text-dim)" }}>
              {(runtime?.crm.providers ?? []).map((provider) => (
                <div key={provider.name} className="border px-3 py-2" style={{ borderColor: "var(--border)" }}>
                  <div>{provider.label}: {provider.mode}</div>
                  <div>{provider.connected ? "connected" : "not connected"}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="border p-4 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
            <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>MCP and infrastructure</div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>MCP servers JSON</label>
              <textarea value={publicEnv.MCP_SERVERS} onChange={(event) => updatePublicEnv("MCP_SERVERS", event.target.value)} rows={5} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>{SECRET_ENV_LABELS.MCP_AUTH_TOKEN}</label>
              <input type="password" value={secretEnv.MCP_AUTH_TOKEN} onChange={(event) => updateSecretEnv("MCP_AUTH_TOKEN", event.target.value)} placeholder="Leave blank to keep existing" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Redis URL</label>
              <input value={publicEnv.REDIS_URL} onChange={(event) => updatePublicEnv("REDIS_URL", event.target.value)} placeholder="Optional if using local default" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Memgraph URI</label>
                <input value={publicEnv.MEMGRAPH_URI} onChange={(event) => updatePublicEnv("MEMGRAPH_URI", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Memgraph user</label>
                <input value={publicEnv.MEMGRAPH_USER} onChange={(event) => updatePublicEnv("MEMGRAPH_USER", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
              </div>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>{SECRET_ENV_LABELS.MEMGRAPH_PASSWORD}</label>
              <input type="password" value={secretEnv.MEMGRAPH_PASSWORD} onChange={(event) => updateSecretEnv("MEMGRAPH_PASSWORD", event.target.value)} placeholder="Leave blank to keep existing" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Dev web conflict strategy</label>
              <select value={publicEnv.BIZBOT_DEV_WEB_CONFLICT} onChange={(event) => updatePublicEnv("BIZBOT_DEV_WEB_CONFLICT", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                <option value="reuse">reuse</option>
                <option value="replace">replace</option>
              </select>
            </div>
            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
              MCP endpoint: {runtime?.mcp.serverEndpoint ?? "/api/mcp"}. Auth {runtime?.mcp.authRequired ? "required" : "optional"}. Imported clients: {runtime?.mcp.connectedClients.length ?? 0}.
            </div>
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

          <div className="border p-4 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
            <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>builder mode</div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Builder workspace path</label>
              <input value={publicEnv.BIZBOT_BUILDER_WORKSPACE_PATH} onChange={(event) => updatePublicEnv("BIZBOT_BUILDER_WORKSPACE_PATH", event.target.value)} placeholder="External path outside this repo" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Allowed raw commands</label>
              <input value={publicEnv.BIZBOT_BUILDER_ALLOWED_COMMANDS} onChange={(event) => updatePublicEnv("BIZBOT_BUILDER_ALLOWED_COMMANDS", event.target.value)} placeholder="npm,pnpm,npx,git,node" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Default template</label>
                <input value={publicEnv.BIZBOT_BUILDER_DEFAULT_TEMPLATE} onChange={(event) => updatePublicEnv("BIZBOT_BUILDER_DEFAULT_TEMPLATE", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Default package manager</label>
                <select value={publicEnv.BIZBOT_BUILDER_DEFAULT_PACKAGE_MANAGER} onChange={(event) => updatePublicEnv("BIZBOT_BUILDER_DEFAULT_PACKAGE_MANAGER", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                  <option value="NPM">NPM</option>
                  <option value="PNPM">PNPM</option>
                </select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center justify-between border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                <span>Initialize git by default</span>
                <input type="checkbox" checked={publicEnv.BIZBOT_BUILDER_INIT_GIT === "true"} onChange={(event) => updatePublicEnv("BIZBOT_BUILDER_INIT_GIT", event.target.checked ? "true" : "false")} />
              </label>
              <label className="flex items-center justify-between border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                <span>Install dependencies by default</span>
                <input type="checkbox" checked={publicEnv.BIZBOT_BUILDER_INSTALL_DEPS === "true"} onChange={(event) => updatePublicEnv("BIZBOT_BUILDER_INSTALL_DEPS", event.target.checked ? "true" : "false")} />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Default agentic profile</label>
                <input value={publicEnv.BIZBOT_BUILDER_DEFAULT_AGENTIC_PROFILE} onChange={(event) => updatePublicEnv("BIZBOT_BUILDER_DEFAULT_AGENTIC_PROFILE", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Agentic timeout seconds</label>
                <input value={publicEnv.BIZBOT_BUILDER_AGENTIC_TIMEOUT_SECONDS} onChange={(event) => updatePublicEnv("BIZBOT_BUILDER_AGENTIC_TIMEOUT_SECONDS", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
              </div>
            </div>
            <div className="border p-3 space-y-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
              <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>codex adapter</div>
              <label className="flex items-center justify-between border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                <span>Enable Codex adapter</span>
                <input type="checkbox" checked={publicEnv.BIZBOT_BUILDER_CODEX_ENABLED === "true"} onChange={(event) => updatePublicEnv("BIZBOT_BUILDER_CODEX_ENABLED", event.target.checked ? "true" : "false")} />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Codex command</label>
                  <input value={publicEnv.BIZBOT_BUILDER_CODEX_COMMAND} onChange={(event) => updatePublicEnv("BIZBOT_BUILDER_CODEX_COMMAND", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Codex model override</label>
                  <input value={publicEnv.BIZBOT_BUILDER_CODEX_MODEL} onChange={(event) => updatePublicEnv("BIZBOT_BUILDER_CODEX_MODEL", event.target.value)} placeholder="optional" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
                </div>
              </div>
            </div>
            <div className="border p-3 space-y-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
              <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>claude code adapter</div>
              <label className="flex items-center justify-between border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                <span>Enable Claude Code adapter</span>
                <input type="checkbox" checked={publicEnv.BIZBOT_BUILDER_CLAUDE_CODE_ENABLED === "true"} onChange={(event) => updatePublicEnv("BIZBOT_BUILDER_CLAUDE_CODE_ENABLED", event.target.checked ? "true" : "false")} />
              </label>
              <div>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Claude command</label>
                <input value={publicEnv.BIZBOT_BUILDER_CLAUDE_CODE_COMMAND} onChange={(event) => updatePublicEnv("BIZBOT_BUILDER_CLAUDE_CODE_COMMAND", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
              </div>
            </div>
            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
              Builder Mode should point at an external workspace. Raw commands stay behind the allowlist; agentic adapters such as Codex run through the dedicated builder project flow instead of the generic command surface.
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="border p-4 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
            <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>google business profile</div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Account name</label>
              <input value={publicEnv.GOOGLE_BUSINESS_ACCOUNT_NAME} onChange={(event) => updatePublicEnv("GOOGLE_BUSINESS_ACCOUNT_NAME", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Review/post location name</label>
              <input value={publicEnv.GOOGLE_BUSINESS_LOCATION_NAME} onChange={(event) => updatePublicEnv("GOOGLE_BUSINESS_LOCATION_NAME", event.target.value)} placeholder="accounts/*/locations/*" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Business info location name</label>
              <input value={publicEnv.GOOGLE_BUSINESS_INFO_LOCATION_NAME} onChange={(event) => updatePublicEnv("GOOGLE_BUSINESS_INFO_LOCATION_NAME", event.target.value)} placeholder="locations/*" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>{SECRET_ENV_LABELS.GOOGLE_BUSINESS_CLIENT_ID}</label>
              <input type="password" value={secretEnv.GOOGLE_BUSINESS_CLIENT_ID} onChange={(event) => updateSecretEnv("GOOGLE_BUSINESS_CLIENT_ID", event.target.value)} placeholder="Leave blank to keep existing" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>{SECRET_ENV_LABELS.GOOGLE_BUSINESS_CLIENT_SECRET}</label>
              <input type="password" value={secretEnv.GOOGLE_BUSINESS_CLIENT_SECRET} onChange={(event) => updateSecretEnv("GOOGLE_BUSINESS_CLIENT_SECRET", event.target.value)} placeholder="Leave blank to keep existing" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>{SECRET_ENV_LABELS.GOOGLE_BUSINESS_REFRESH_TOKEN}</label>
              <input type="password" value={secretEnv.GOOGLE_BUSINESS_REFRESH_TOKEN} onChange={(event) => updateSecretEnv("GOOGLE_BUSINESS_REFRESH_TOKEN", event.target.value)} placeholder="Leave blank to keep existing" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
              Reviews and local posts use the v4 `accounts/*/locations/*` resource name. Hours updates use the Business Information `locations/*` resource name. Access tokens are now minted locally from the OAuth refresh token instead of being stored directly.
            </div>
          </div>

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

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <UserMemoryPanel />

        <div className="space-y-6">
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
              <div className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}><span style={{ color: "var(--text-muted)" }}>CRM provider</span><span>{runtime?.crm.activeProvider ?? publicEnv.CRM_PROVIDER}</span></div>
              <div className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}><span style={{ color: "var(--text-muted)" }}>MCP HTTP auth</span><span>{runtime?.mcp.authRequired ? "required" : "disabled"}</span></div>
              <div className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}><span style={{ color: "var(--text-muted)" }}>Redis configured</span><span>{runtime?.infrastructure.redisConfigured ? "yes" : "local default"}</span></div>
              <div className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}><span style={{ color: "var(--text-muted)" }}>Memgraph configured</span><span>{runtime?.infrastructure.memgraphConfigured ? "yes" : "no"}</span></div>
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
        </div>
      </section>
    </div>
  );
}
