"use client";

import { useEffect, useState } from "react";

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

const AUTONOMY_PRESETS = [
  {
    id: "manual_only",
    label: "Manual Only",
    description: "Research, drafting, memory, and document lookup only. No direct posting or replies.",
  },
  {
    id: "reply_only",
    label: "PM Replies Only",
    description: "Can draft or send direct-message replies only. Public mentions stay out of the auto-reply path.",
  },
  {
    id: "approval_all_posts",
    label: "Approval For New Posts",
    description: "Can draft new posts, but top-level posts are queued for approval before publishing.",
  },
  {
    id: "wide_open",
    label: "Wide Open",
    description: "Can publish and reply without a human in the loop.",
  },
] as const;

function sanitizeSecretUpdate(value: string): string | null {
  return value.trim().length > 0 ? value.trim() : null;
}

export default function SettingsPage() {
  const [provider, setProvider] = useState("ollama");
  const [ollamaModel, setOllamaModel] = useState("gemma3");
  const [googleModel, setGoogleModel] = useState("gemini-2.0-flash");
  const [openAiModel, setOpenAiModel] = useState("gpt-4o");
  const [embeddingProvider, setEmbeddingProvider] = useState("google");
  const [embeddingModel, setEmbeddingModel] = useState("gemini-embedding-001");
  const [embeddingDimensions, setEmbeddingDimensions] = useState("1536");
  const [temperature, setTemperature] = useState("0.2");
  const [maxTokens, setMaxTokens] = useState("4096");
  const [googleApiKey, setGoogleApiKey] = useState("");
  const [autonomyPreset, setAutonomyPreset] = useState("approval_all_posts");
  const [heartbeatSeconds, setHeartbeatSeconds] = useState("300");
  const [knowledgePath, setKnowledgePath] = useState("knowledge");
  const [knowledgeEnabled, setKnowledgeEnabled] = useState(true);
  const [workspacePath, setWorkspacePath] = useState("./workspace");
  const [settings, setSettings] = useState<SettingRecord[]>([]);
  const [runtime, setRuntime] = useState<LlmStatusResponse | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  async function refreshRuntime(): Promise<void> {
    const response = await fetch("/api/llm");
    const data = (await response.json()) as LlmStatusResponse;
    setRuntime(data);
  }

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json() as Promise<SettingsResponse>)
      .then((data) => {
        setSettings(data.settings ?? []);
        setProvider(data.env?.ACTIVE_LLM_PROVIDER ?? "ollama");
        setOllamaModel(data.env?.OLLAMA_MODEL ?? "gemma3");
        setGoogleModel(data.env?.GOOGLE_MODEL ?? "gemini-2.0-flash");
        setOpenAiModel(data.env?.OPENAI_MODEL ?? "gpt-4o");
        setEmbeddingProvider(data.env?.EMBEDDING_PROVIDER ?? "google");
        setEmbeddingModel(data.env?.EMBEDDING_MODEL ?? "gemini-embedding-001");
        setEmbeddingDimensions(data.env?.EMBEDDING_DIMENSIONS ?? "1536");
        setTemperature(data.env?.LLM_TEMPERATURE ?? "0.2");
        setMaxTokens(data.env?.LLM_MAX_TOKENS ?? "4096");
        setAutonomyPreset(data.env?.BIZBOT_AUTONOMY_PRESET ?? "approval_all_posts");
        setHeartbeatSeconds(data.env?.BIZBOT_AGENT_HEARTBEAT_SECONDS ?? "300");
        setKnowledgePath(data.env?.BIZBOT_KNOWLEDGE_PATH ?? "knowledge");
        setKnowledgeEnabled((data.env?.BIZBOT_KNOWLEDGE_ENABLED ?? "true") !== "false");
        setWorkspacePath(data.env?.BIZBOT_WORKSPACE_PATH ?? "./workspace");
      })
      .catch(() => {});

    void refreshRuntime().catch(() => {});
  }, []);

  async function save(): Promise<void> {
    setSaveState("saving");
    try {
      const env: Record<string, string> = {
        ACTIVE_LLM_PROVIDER: provider,
        OLLAMA_MODEL: ollamaModel,
        GOOGLE_MODEL: googleModel,
        OPENAI_MODEL: openAiModel,
        EMBEDDING_PROVIDER: embeddingProvider,
        EMBEDDING_MODEL: embeddingModel,
        EMBEDDING_DIMENSIONS: embeddingDimensions,
        LLM_TEMPERATURE: temperature,
        LLM_MAX_TOKENS: maxTokens,
        BIZBOT_AUTONOMY_PRESET: autonomyPreset,
        BIZBOT_AGENT_HEARTBEAT_SECONDS: heartbeatSeconds,
        BIZBOT_KNOWLEDGE_PATH: knowledgePath,
        BIZBOT_KNOWLEDGE_ENABLED: knowledgeEnabled ? "true" : "false",
        BIZBOT_WORKSPACE_PATH: workspacePath,
      };

      const safeGoogleApiKey = sanitizeSecretUpdate(googleApiKey);
      if (safeGoogleApiKey) {
        env.GOOGLE_AI_API_KEY = safeGoogleApiKey;
      }

      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env }),
      });

      setSaveState("saved");
      await refreshRuntime();
    } catch {
      setSaveState("error");
    }
  }

  const chatModelOptions = runtime?.options.chatModels[provider] ?? [];
  const embeddingProviderOptions = runtime?.options.embeddingProviders ?? ["google", "openai", "ollama"];
  const embeddingModelOptions = runtime?.options.embeddingModels[embeddingProvider] ?? [];

  return (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <section className="border p-4 space-y-6" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] mb-2" style={{ color: "var(--text-muted)" }}>llm runtime</div>
            <div className="text-sm" style={{ color: "var(--text-dim)" }}>Configure chat provider, model, generation limits, and embedding backend.</div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void refreshRuntime()} className="px-3 py-2 border text-xs uppercase tracking-[0.18em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>refresh status</button>
            <button onClick={() => void save()} className="px-4 py-2 border text-xs uppercase tracking-[0.18em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>save</button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="border p-4 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
            <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>chat</div>
            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
              Provider
            </label>
            <select value={provider} onChange={(event) => setProvider(event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {(runtime?.options.chatProviders ?? ["ollama", "google", "openai", "anthropic", "minimax"]).map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>

            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
              Model
            </label>
            <select
              value={provider === "ollama" ? ollamaModel : provider === "google" ? googleModel : openAiModel}
              onChange={(event) => {
                const value = event.target.value;
                if (provider === "ollama") setOllamaModel(value);
                else if (provider === "google") setGoogleModel(value);
                else setOpenAiModel(value);
              }}
              className="w-full bg-transparent border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)" }}
            >
              {(chatModelOptions.length > 0 ? chatModelOptions : [provider === "ollama" ? ollamaModel : provider === "google" ? googleModel : openAiModel]).map((option) => (
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

          <div className="border p-4 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
            <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>embeddings</div>
            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
              Provider
            </label>
            <select value={embeddingProvider} onChange={(event) => setEmbeddingProvider(event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {embeddingProviderOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>

            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
              Model
            </label>
            <select value={embeddingModel} onChange={(event) => setEmbeddingModel(event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {(embeddingModelOptions.length > 0 ? embeddingModelOptions : [embeddingModel]).map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Vector dimensions</label>
                <input value={embeddingDimensions} onChange={(event) => setEmbeddingDimensions(event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Google API key</label>
                <input value={googleApiKey} onChange={(event) => setGoogleApiKey(event.target.value)} placeholder="Leave blank to keep existing" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
              </div>
            </div>

            <div className="text-xs" style={{ color: "var(--text-dim)" }}>
              Local Ollama embeddings are supported as a setting, but the selected model must match the configured vector dimension. The current database migration uses 1536.
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="border p-4 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
            <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>agent autonomy</div>
            <label className="block text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
              Preset
            </label>
            <select value={autonomyPreset} onChange={(event) => setAutonomyPreset(event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {AUTONOMY_PRESETS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            <div className="space-y-2 text-xs leading-6" style={{ color: "var(--text-dim)" }}>
              {AUTONOMY_PRESETS.map((option) => (
                <div key={option.id} style={{ color: option.id === autonomyPreset ? "var(--text-primary)" : "var(--text-dim)" }}>
                  {option.label}: {option.description}
                </div>
              ))}
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Agent heartbeat seconds</label>
              <input value={heartbeatSeconds} onChange={(event) => setHeartbeatSeconds(event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div className="text-xs" style={{ color: "var(--text-dim)" }}>
              The heartbeat sets the intended cadence for an autonomous/background loop. Chat is still user-triggered unless you run a background worker.
            </div>
          </div>

          <div className="border p-4 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
            <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>knowledge sources</div>
            <label className="flex items-center justify-between border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              <span>Enable company docs folder</span>
              <input type="checkbox" checked={knowledgeEnabled} onChange={(event) => setKnowledgeEnabled(event.target.checked)} />
            </label>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>Docs folder inside workspace</label>
              <input value={knowledgePath} onChange={(event) => setKnowledgePath(event.target.value)} placeholder="knowledge" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
              BizBot answers from recent conversation, saved memory, graph context, and optionally local company docs in the workspace.
            </div>
            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
              Example path: {workspacePath}/{knowledgePath || "knowledge"}
            </div>
          </div>
        </div>

        <div className="border p-4 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
          <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>workspace</div>
          <input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder="Workspace path" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
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
            <div className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}>
              <span style={{ color: "var(--text-muted)" }}>active chat</span>
              <span>{runtime?.activeProvider ?? provider}</span>
            </div>
            <div className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}>
              <span style={{ color: "var(--text-muted)" }}>chat status</span>
              <span style={{ color: runtime?.checks.chat.ok ? "var(--success)" : "var(--danger)" }}>{runtime?.checks.chat.ok ? "ok" : "failed"}</span>
            </div>
            <div className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}>
              <span style={{ color: "var(--text-muted)" }}>embedding status</span>
              <span style={{ color: runtime?.checks.embedding.ok ? "var(--success)" : "var(--danger)" }}>{runtime?.checks.embedding.ok ? "ok" : "failed"}</span>
            </div>
            <div className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}>
              <span style={{ color: "var(--text-muted)" }}>embedding dimensions</span>
              <span>{runtime?.checks.embedding.dimensions ?? embeddingDimensions}</span>
            </div>
            <div className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}>
              <span style={{ color: "var(--text-muted)" }}>autonomy</span>
              <span>{runtime?.autonomy.autonomyPreset ?? autonomyPreset}</span>
            </div>
            <div className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}>
              <span style={{ color: "var(--text-muted)" }}>heartbeat</span>
              <span>{runtime?.autonomy.heartbeatSeconds ?? heartbeatSeconds}s</span>
            </div>
            <div className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}>
              <span style={{ color: "var(--text-muted)" }}>knowledge docs</span>
              <span>{runtime?.knowledge.documentCount ?? 0}</span>
            </div>
            <div className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}>
              <span style={{ color: "var(--text-muted)" }}>last heartbeat</span>
              <span>{runtime?.heartbeat.lastFinishedAt ? new Date(runtime.heartbeat.lastFinishedAt).toLocaleTimeString() : "never"}</span>
            </div>
            {runtime?.checks.embedding.error ? (
              <div className="text-xs leading-6" style={{ color: "var(--danger)" }}>{runtime.checks.embedding.error}</div>
            ) : null}
            {runtime?.autonomy.description ? (
              <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{runtime.autonomy.description}</div>
            ) : null}
            {runtime?.heartbeat.summary ? (
              <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{runtime.heartbeat.summary}</div>
            ) : null}
          </div>
        </section>

        <section className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>what it can do by itself</div>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}>
              <span style={{ color: "var(--text-muted)" }}>Create new posts</span>
              <span>{runtime?.capabilities.canCreatePosts ? "yes" : "no"}</span>
            </div>
            <div className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}>
              <span style={{ color: "var(--text-muted)" }}>Reply directly</span>
              <span>{runtime?.capabilities.canReplyDirectly ? "yes" : "no"}</span>
            </div>
            <div className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}>
              <span style={{ color: "var(--text-muted)" }}>Reply scope</span>
              <span>{runtime?.capabilities.replyScope ?? "none"}</span>
            </div>
            <div className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}>
              <span style={{ color: "var(--text-muted)" }}>Publish without approval</span>
              <span>{runtime?.capabilities.canPublishWithoutApproval ? "yes" : "no"}</span>
            </div>
            <div className="flex justify-between border-b pb-2" style={{ borderColor: "var(--border-sub)" }}>
              <span style={{ color: "var(--text-muted)" }}>Use company docs folder</span>
              <span>{runtime?.capabilities.usesKnowledgeFolder ? "yes" : "no"}</span>
            </div>
            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
              Knowledge sources currently available to the agent: recent chat history, vector memory, the knowledge graph, and the optional company docs folder.
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
