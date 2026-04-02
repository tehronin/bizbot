"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import {
  MEMORY_FACT_CATEGORIES,
  MEMORY_FACT_CATEGORY_LABELS,
  MEMORY_FACT_SOURCES,
  MEMORY_FACT_SOURCE_LABELS,
  type MemoryFactCategory,
  type MemoryFactSource,
} from "@/lib/agent/memory/facts";
import { DEFAULT_AGENT_USER_ID } from "@/lib/agent/user-context";

interface UserMemoryFactRecord {
  id: string;
  userId: string;
  category: MemoryFactCategory;
  key: string;
  value: unknown;
  source: MemoryFactSource;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface UserMemoryResponse {
  userId: string;
  facts: UserMemoryFactRecord[];
}

type SaveState = "idle" | "saving" | "saved" | "error";
type ValueMode = "text" | "json";

const QUICK_START_PRESETS: Array<{
  label: string;
  category: MemoryFactCategory;
  key: string;
  valueMode: ValueMode;
  value: string;
}> = [
  { label: "preferred name", category: "identity", key: "preferred_name", valueMode: "text", value: "" },
  { label: "timezone", category: "preference", key: "timezone", valueMode: "text", value: "America/Chicago" },
  { label: "writing style", category: "preference", key: "writing_style", valueMode: "text", value: "concise, direct, operational" },
  { label: "review reply workflow", category: "workflow", key: "review_reply_workflow", valueMode: "json", value: JSON.stringify({ tone: "calm", length: "short" }, null, 2) },
  { label: "operator constraints", category: "constraint", key: "operator_constraints", valueMode: "json", value: JSON.stringify({ neverStore: ["tokens", "payment_details"], replyApproval: true }, null, 2) },
  { label: "default lane", category: "operator_setting", key: "default_operator_lane", valueMode: "text", value: "general_operator" },
];

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function getInitialMode(value: unknown): ValueMode {
  return typeof value === "string" ? "text" : "json";
}

function buildFactValue(valueMode: ValueMode, valueInput: string): unknown {
  if (valueMode === "text") {
    return valueInput;
  }

  return JSON.parse(valueInput);
}

export function UserMemoryPanel({ userId = DEFAULT_AGENT_USER_ID }: { userId?: string }) {
  const [facts, setFacts] = useState<UserMemoryFactRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<MemoryFactCategory | "all">("all");
  const [filterQuery, setFilterQuery] = useState("");
  const [category, setCategory] = useState<MemoryFactCategory>("identity");
  const [key, setKey] = useState("");
  const [source, setSource] = useState<MemoryFactSource>("user");
  const [valueMode, setValueMode] = useState<ValueMode>("text");
  const [valueInput, setValueInput] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);

  async function loadFacts(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/user-memory?userId=${encodeURIComponent(userId)}`);
      const data = (await response.json()) as UserMemoryResponse;
      setFacts(data.facts ?? []);
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      setLoading(false);
    }
  }

  const loadUserFacts = useEffectEvent(() => {
    void loadFacts();
  });

  useEffect(() => {
    loadUserFacts();
  }, [userId]);

  const filteredFacts = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();

    return facts.filter((fact) => {
      if (filterCategory !== "all" && fact.category !== filterCategory) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = `${fact.key} ${fact.category} ${formatValue(fact.value)}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [facts, filterCategory, filterQuery]);

  function resetForm(): void {
    setCategory("identity");
    setKey("");
    setSource("user");
    setValueMode("text");
    setValueInput("");
    setEditingKey(null);
  }

  function loadPreset(label: string): void {
    const preset = QUICK_START_PRESETS.find((entry) => entry.label === label);
    if (!preset) {
      return;
    }

    setCategory(preset.category);
    setKey(preset.key);
    setSource("user");
    setValueMode(preset.valueMode);
    setValueInput(preset.value);
    setEditingKey(null);
    setError(null);
  }

  function editFact(fact: UserMemoryFactRecord): void {
    setCategory(fact.category);
    setKey(fact.key);
    setSource(fact.source);
    setValueMode(getInitialMode(fact.value));
    setValueInput(formatValue(fact.value));
    setEditingKey(fact.key);
    setError(null);
  }

  async function saveFact(): Promise<void> {
    setSaveState("saving");
    setError(null);

    try {
      const payload = {
        userId,
        category,
        key,
        source,
        value: buildFactValue(valueMode, valueInput),
      };

      const response = await fetch("/api/user-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to save user memory fact.");
      }

      await loadFacts();
      setSaveState("saved");
      resetForm();
    } catch (saveError) {
      setSaveState("error");
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  }

  async function forgetFact(targetKey: string): Promise<void> {
    if (typeof window !== "undefined" && !window.confirm(`Forget stored fact \"${targetKey}\"?`)) {
      return;
    }

    setSaveState("saving");
    setError(null);
    try {
      const response = await fetch("/api/user-memory", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, key: targetKey }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to forget user memory fact.");
      }

      await loadFacts();
      setSaveState("saved");
      if (editingKey === targetKey) {
        resetForm();
      }
    } catch (forgetError) {
      setSaveState("error");
      setError(forgetError instanceof Error ? forgetError.message : String(forgetError));
    }
  }

  return (
    <section id="explicit-user-memory" className="border p-4 space-y-4 min-w-0" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2 min-w-0 flex-1">
          <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>explicit user memory</div>
          <div className="text-sm" style={{ color: "var(--text-dim)" }}>
            Store only stable, user-approved identity details, preferences, workflows, constraints, and operator settings. This feeds the executor’s [User Memory] prompt block directly.
          </div>
          <div className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>
            scope {userId} · {facts.length} active facts
          </div>
        </div>
        <button onClick={() => void loadFacts()} className="px-3 py-2 border text-xs uppercase tracking-[0.18em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
          refresh
        </button>
      </div>

      <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
        <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>recommended starting points</div>
        <div className="grid gap-2">
          {QUICK_START_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => loadPreset(preset.label)}
              className="flex items-center justify-between border px-3 py-2 text-left text-xs uppercase tracking-[0.16em]"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)", background: "transparent" }}
            >
              <span>{preset.label}</span>
              <span style={{ color: "var(--text-muted)" }}>{MEMORY_FACT_CATEGORY_LABELS[preset.category]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
        <div className="grid gap-3 sm:grid-cols-[0.9fr_1.1fr]">
          <div>
            <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>filter category</label>
            <select value={filterCategory} onChange={(event) => setFilterCategory(event.target.value as MemoryFactCategory | "all")} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              <option value="all">all</option>
              {MEMORY_FACT_CATEGORIES.map((option) => (
                <option key={option} value={option}>{MEMORY_FACT_CATEGORY_LABELS[option]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>search key or value</label>
            <input value={filterQuery} onChange={(event) => setFilterQuery(event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </div>
        </div>

        <div className="space-y-2 max-h-[360px] overflow-auto">
          {loading ? <div className="text-sm" style={{ color: "var(--text-dim)" }}>loading facts…</div> : null}
          {!loading && filteredFacts.length === 0 ? <div className="text-sm" style={{ color: "var(--text-dim)" }}>No active facts match the current filter.</div> : null}
          {filteredFacts.map((fact) => (
            <article key={fact.id} className="border p-3 space-y-3" style={{ borderColor: editingKey === fact.key ? "var(--accent)" : "var(--border)", background: editingKey === fact.key ? "var(--accent-glow)" : "var(--bg-surface)" }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>{fact.key}</div>
                  <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-dim)" }}>
                    {MEMORY_FACT_CATEGORY_LABELS[fact.category]} · {MEMORY_FACT_SOURCE_LABELS[fact.source]}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => editFact(fact)} className="px-3 py-2 border text-xs uppercase tracking-[0.16em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>edit</button>
                  <button onClick={() => void forgetFact(fact.key)} className="px-3 py-2 border text-xs uppercase tracking-[0.16em]" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>forget</button>
                </div>
              </div>
              <pre className="overflow-auto border p-3 text-xs leading-6 whitespace-pre-wrap break-words" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)", color: "var(--text-primary)" }}>{formatValue(fact.value)}</pre>
            </article>
          ))}
        </div>
      </div>

      <div className="border p-3 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
        <div className="flex items-center justify-between gap-4">
          <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>
            {editingKey ? `editing ${editingKey}` : "store or update fact"}
          </div>
          <div className="text-xs uppercase tracking-[0.16em]" style={{ color: saveState === "saved" ? "var(--success)" : saveState === "error" ? "var(--danger)" : "var(--text-dim)" }}>{saveState}</div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>category</label>
            <select value={category} onChange={(event) => setCategory(event.target.value as MemoryFactCategory)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {MEMORY_FACT_CATEGORIES.map((option) => (
                <option key={option} value={option}>{MEMORY_FACT_CATEGORY_LABELS[option]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>source</label>
            <select value={source} onChange={(event) => setSource(event.target.value as MemoryFactSource)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {MEMORY_FACT_SOURCES.map((option) => (
                <option key={option} value={option}>{MEMORY_FACT_SOURCE_LABELS[option]}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>key</label>
          <input value={key} onChange={(event) => setKey(event.target.value)} placeholder="preferred_name" className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
        </div>
        <div className="grid gap-3 sm:grid-cols-[0.7fr_1.3fr]">
          <div>
            <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>value mode</label>
            <select value={valueMode} onChange={(event) => setValueMode(event.target.value as ValueMode)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              <option value="text">plain text</option>
              <option value="json">json</option>
            </select>
          </div>
          <div className="text-xs leading-6 pt-6" style={{ color: "var(--text-dim)" }}>
            Use plain text for names, timezones, or short preferences. Use JSON for workflows, constraints, and structured operator settings.
          </div>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>value</label>
          <textarea value={valueInput} onChange={(event) => setValueInput(event.target.value)} rows={valueMode === "json" ? 8 : 4} placeholder={valueMode === "json" ? '{\n  "tone": "calm"\n}' : "America/Chicago"} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
        </div>
        <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
          Never store secrets, credentials, tokens, payment details, or speculative profile guesses here. This surface is for durable, user-approved facts only.
        </div>
        {error ? <div className="text-xs leading-6" style={{ color: "var(--danger)" }}>{error}</div> : null}
        <div className="flex gap-2">
          <button onClick={() => void saveFact()} disabled={!key.trim() || !valueInput.trim() || saveState === "saving"} className="px-4 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>save fact</button>
          <button onClick={resetForm} className="px-4 py-2 border text-xs uppercase tracking-[0.18em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>clear</button>
        </div>
      </div>
    </section>
  );
}

export type { UserMemoryFactRecord };