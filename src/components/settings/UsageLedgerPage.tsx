"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PaginationControls } from "@/components/layout/PaginationControls";
import { usePagination } from "@/hooks/usePagination";
import {
  getDefaultUsageLedgerModelPricing,
  parseUsageLedgerModelPricingSetting,
  serializeUsageLedgerModelPricingSetting,
  USAGE_LEDGER_MODEL_PRICING_SETTING_KEY,
} from "@/lib/agent/usage-ledger-pricing";

interface UsageLedgerEntry {
  id: string;
  day: string;
  provider: string;
  model: string;
  runCount: number;
  requestCount: number;
  startedAt: string;
  updatedAt: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
  averageTokensPerRun: number;
  averageTokensPerRequest: number;
  averagePromptTokensPerRequest: number;
  averageCompletionTokensPerRequest: number;
  statusCounts: Partial<Record<string, number>>;
}

interface UsageLedgerRunSummary {
  runId: string;
  conversationId: string;
  profile: string;
  profileLabel: string;
  provider: string;
  model: string;
  status: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
  averageTokensPerRequest: number;
}

interface ModelPricingInput {
  promptUsdPerMillion: string;
  completionUsdPerMillion: string;
}

interface SettingRecord {
  key: string;
  value: string;
}

interface PricingPresetBadge {
  label: string;
  color: string;
  borderColor: string;
  background: string;
}

interface UsageLedgerResponse {
  snapshot: {
    totals: {
      entryCount: number;
      runCount: number;
      requestCount: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      cachedPromptTokens: number;
      averageTokensPerRun: number;
      averageTokensPerRequest: number;
    };
    entries: UsageLedgerEntry[];
  };
  selectedEntryId: string | null;
  entryRuns: UsageLedgerRunSummary[];
  error?: string;
}

const ENTRY_PAGE_SIZE = 10;
const RUN_PAGE_SIZE = 8;
function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function formatDay(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function normalizeNumberInput(value: string): number {
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function getEstimatedCost(promptTokens: number, completionTokens: number, pricing: ModelPricingInput): number {
  return (promptTokens / 1_000_000) * normalizeNumberInput(pricing.promptUsdPerMillion)
    + (completionTokens / 1_000_000) * normalizeNumberInput(pricing.completionUsdPerMillion);
}

function isZeroCostPricing(pricing: ModelPricingInput): boolean {
  return normalizeNumberInput(pricing.promptUsdPerMillion) === 0
    && normalizeNumberInput(pricing.completionUsdPerMillion) === 0;
}

function getPricingPresetBadge(model: string, provider: string, pricing: ModelPricingInput): PricingPresetBadge {
  const defaults = getDefaultUsageLedgerModelPricing(model, provider);
  const normalizedPrompt = normalizeNumberInput(pricing.promptUsdPerMillion);
  const normalizedCompletion = normalizeNumberInput(pricing.completionUsdPerMillion);

  if (isZeroCostPricing(pricing)) {
    return {
      label: "zero-cost local",
      color: "var(--success)",
      borderColor: "var(--success)",
      background: "rgba(34,197,94,0.10)",
    };
  }

  if (normalizedPrompt === defaults.promptUsdPerMillion && normalizedCompletion === defaults.completionUsdPerMillion) {
    return {
      label: "default",
      color: "var(--accent)",
      borderColor: "var(--accent)",
      background: "var(--accent-glow)",
    };
  }

  return {
    label: "custom",
    color: "var(--warning)",
    borderColor: "var(--warning)",
    background: "rgba(245,158,11,0.10)",
  };
}

function csvEscape(value: string | number): string {
  const text = String(value);
  if (!/[",\n]/.test(text)) {
    return text;
  }
  return `"${text.replaceAll("\"", '""')}"`;
}

function createEmptyTotals(): UsageLedgerResponse["snapshot"]["totals"] {
  return {
    entryCount: 0,
    runCount: 0,
    requestCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedPromptTokens: 0,
    averageTokensPerRun: 0,
    averageTokensPerRequest: 0,
  };
}

export function UsageLedgerPage() {
  const [entries, setEntries] = useState<UsageLedgerEntry[]>([]);
  const [entryRuns, setEntryRuns] = useState<UsageLedgerRunSummary[]>([]);
  const [totals, setTotals] = useState<UsageLedgerResponse["snapshot"]["totals"]>(createEmptyTotals());
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [pricingSaveState, setPricingSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [modelPricing, setModelPricing] = useState<Record<string, ModelPricingInput>>({});

  const modelOptions = useMemo(
    () => [...new Set(entries.map((entry) => `${entry.provider}::${entry.model}`))]
      .map((value) => {
        const [provider, model] = value.split("::");
        return { provider, model };
      })
      .sort((left, right) => left.model.localeCompare(right.model) || left.provider.localeCompare(right.provider)),
    [entries],
  );

  const providerOptions = useMemo(() => [...new Set(entries.map((entry) => entry.provider))].sort((left, right) => left.localeCompare(right)), [entries]);

  const filteredEntries = useMemo(() => entries.filter((entry) => {
    if (providerFilter !== "all" && entry.provider !== providerFilter) {
      return false;
    }
    if (startDate && entry.day < startDate) {
      return false;
    }
    if (endDate && entry.day > endDate) {
      return false;
    }
    return true;
  }), [endDate, entries, providerFilter, startDate]);

  const filteredTotals = useMemo(() => {
    const next = filteredEntries.reduce((accumulator, entry) => ({
      entryCount: accumulator.entryCount + 1,
      runCount: accumulator.runCount + entry.runCount,
      requestCount: accumulator.requestCount + entry.requestCount,
      promptTokens: accumulator.promptTokens + entry.promptTokens,
      completionTokens: accumulator.completionTokens + entry.completionTokens,
      totalTokens: accumulator.totalTokens + entry.totalTokens,
      cachedPromptTokens: accumulator.cachedPromptTokens + entry.cachedPromptTokens,
      averageTokensPerRun: 0,
      averageTokensPerRequest: 0,
    }), createEmptyTotals());

    next.averageTokensPerRun = next.runCount > 0 ? next.totalTokens / next.runCount : 0;
    next.averageTokensPerRequest = next.requestCount > 0 ? next.totalTokens / next.requestCount : 0;
    return next;
  }, [filteredEntries]);

  const filteredEstimatedCost = useMemo(() => filteredEntries.reduce((sum, entry) => {
    const pricing = modelPricing[entry.model] ?? {
      promptUsdPerMillion: String(getDefaultUsageLedgerModelPricing(entry.model, entry.provider).promptUsdPerMillion),
      completionUsdPerMillion: String(getDefaultUsageLedgerModelPricing(entry.model, entry.provider).completionUsdPerMillion),
    };
    return sum + getEstimatedCost(entry.promptTokens, entry.completionTokens, pricing);
  }, 0), [filteredEntries, modelPricing]);

  const entryPagination = usePagination(filteredEntries, ENTRY_PAGE_SIZE);
  const runPagination = usePagination(entryRuns, RUN_PAGE_SIZE);

  const selectedEntry = useMemo(
    () => filteredEntries.find((entry) => entry.id === selectedEntryId) ?? entries.find((entry) => entry.id === selectedEntryId) ?? null,
    [entries, filteredEntries, selectedEntryId],
  );

  const loadLedger = useCallback(async (targetEntryId?: string | null): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      const requestedEntryId = targetEntryId === undefined ? selectedEntryId : targetEntryId;
      if (requestedEntryId) {
        params.set("entryId", requestedEntryId);
      }

      const response = await fetch(`/api/usage-ledger${params.size ? `?${params.toString()}` : ""}`);
      const data = (await response.json()) as UsageLedgerResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load usage ledger.");
      }

      setEntries(data.snapshot.entries ?? []);
      setTotals(data.snapshot.totals ?? createEmptyTotals());
      setEntryRuns(data.entryRuns ?? []);

      const nextSelectedEntryId = requestedEntryId && data.snapshot.entries.some((entry) => entry.id === requestedEntryId)
        ? requestedEntryId
        : null;
      setSelectedEntryId(nextSelectedEntryId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setEntryRuns([]);
    } finally {
      setLoading(false);
    }
  }, [selectedEntryId]);

  useEffect(() => {
    void loadLedger(null);
  }, [loadLedger]);

  useEffect(() => {
    let cancelled = false;

    async function loadPricingSettings(): Promise<void> {
      try {
        const response = await fetch("/api/settings");
        const data = (await response.json()) as { settings?: SettingRecord[] };
        if (!response.ok || cancelled) {
          return;
        }

        const stored = data.settings?.find((setting) => setting.key === USAGE_LEDGER_MODEL_PRICING_SETTING_KEY)?.value ?? null;
        const parsed = parseUsageLedgerModelPricingSetting(stored);
        const nextPricing = Object.fromEntries(Object.entries(parsed).map(([model, pricing]) => [model, {
          promptUsdPerMillion: String(pricing.promptUsdPerMillion),
          completionUsdPerMillion: String(pricing.completionUsdPerMillion),
        }]));
        setModelPricing(nextPricing);
      } catch {
        if (!cancelled) {
          setPricingSaveState("error");
        }
      }
    }

    void loadPricingSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedEntryId && !filteredEntries.some((entry) => entry.id === selectedEntryId)) {
      setSelectedEntryId(null);
      setEntryRuns([]);
    }
  }, [filteredEntries, selectedEntryId]);

  function getPricingForModel(model: string, provider: string): ModelPricingInput {
    const existing = modelPricing[model];
    if (existing) {
      return existing;
    }

    const defaults = getDefaultUsageLedgerModelPricing(model, provider);
    return {
      promptUsdPerMillion: String(defaults.promptUsdPerMillion),
      completionUsdPerMillion: String(defaults.completionUsdPerMillion),
    };
  }

  function updatePricing(model: string, provider: string, field: keyof ModelPricingInput, value: string): void {
    setModelPricing((current) => ({
      ...current,
      [model]: {
        ...getPricingForModel(model, provider),
        [field]: value,
      },
    }));
    setPricingSaveState("idle");
  }

  async function savePricing(): Promise<void> {
    setPricingSaveState("saving");
    try {
      const normalized = Object.fromEntries(Object.entries(modelPricing).map(([model, pricing]) => [model, {
        promptUsdPerMillion: normalizeNumberInput(pricing.promptUsdPerMillion),
        completionUsdPerMillion: normalizeNumberInput(pricing.completionUsdPerMillion),
      }]));

      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: [{
            key: USAGE_LEDGER_MODEL_PRICING_SETTING_KEY,
            value: serializeUsageLedgerModelPricingSetting(normalized),
          }],
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save pricing settings.");
      }

      setPricingSaveState("saved");
    } catch {
      setPricingSaveState("error");
    }
  }

  function exportCsv(): void {
    const headers = [
      "day",
      "provider",
      "model",
      "runs",
      "requests",
      "prompt_tokens",
      "completion_tokens",
      "total_tokens",
      "cached_prompt_tokens",
      "avg_tokens_per_run",
      "avg_tokens_per_request",
      "avg_prompt_tokens_per_request",
      "avg_completion_tokens_per_request",
      "estimated_cost_usd",
      "status_counts",
    ];

    const rows = filteredEntries.map((entry) => {
      const pricing = getPricingForModel(entry.model, entry.provider);
      return [
        entry.day,
        entry.provider,
        entry.model,
        entry.runCount,
        entry.requestCount,
        entry.promptTokens,
        entry.completionTokens,
        entry.totalTokens,
        entry.cachedPromptTokens,
        entry.averageTokensPerRun.toFixed(2),
        entry.averageTokensPerRequest.toFixed(2),
        entry.averagePromptTokensPerRequest.toFixed(2),
        entry.averageCompletionTokensPerRequest.toFixed(2),
        getEstimatedCost(entry.promptTokens, entry.completionTokens, pricing).toFixed(6),
        Object.entries(entry.statusCounts).map(([status, count]) => `${status}:${count}`).join("|"),
      ].map(csvEscape).join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `usage-ledger-${startDate || "all"}-${endDate || "all"}-${providerFilter}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function deleteEntry(entry: UsageLedgerEntry): Promise<void> {
    const pricing = getPricingForModel(entry.model, entry.provider);
    const summary = [
      `Delete ledger row for ${entry.provider} ${entry.model} on ${entry.day}?`,
      "",
      `Runs removed: ${formatNumber(entry.runCount)}`,
      `Requests removed: ${formatNumber(entry.requestCount)}`,
      `Prompt tokens removed: ${formatNumber(entry.promptTokens)}`,
      `Completion tokens removed: ${formatNumber(entry.completionTokens)}`,
      `Total tokens removed: ${formatNumber(entry.totalTokens)}`,
      `Estimated cost removed: ${formatMoney(getEstimatedCost(entry.promptTokens, entry.completionTokens, pricing))}`,
    ].join("\n");

    if (typeof window !== "undefined" && !window.confirm(summary)) {
      return;
    }

    setDeletingKey(`entry:${entry.id}`);
    setError(null);
    try {
      const response = await fetch("/api/usage-ledger", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: entry.id }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to delete ledger entry.");
      }

      await loadLedger(selectedEntryId === entry.id ? null : selectedEntryId);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setDeletingKey(null);
    }
  }

  async function deleteRun(run: UsageLedgerRunSummary): Promise<void> {
    const pricing = getPricingForModel(run.model, run.provider);
    const summary = [
      `Delete run ${run.runId}?`,
      "",
      `Provider: ${run.provider} / ${run.model}`,
      `Requests removed: ${formatNumber(run.requestCount)}`,
      `Prompt tokens removed: ${formatNumber(run.promptTokens)}`,
      `Completion tokens removed: ${formatNumber(run.completionTokens)}`,
      `Total tokens removed: ${formatNumber(run.totalTokens)}`,
      `Estimated cost removed: ${formatMoney(getEstimatedCost(run.promptTokens, run.completionTokens, pricing))}`,
    ].join("\n");

    if (typeof window !== "undefined" && !window.confirm(summary)) {
      return;
    }

    setDeletingKey(`run:${run.runId}`);
    setError(null);
    try {
      const response = await fetch("/api/usage-ledger", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.runId }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to delete run.");
      }

      await loadLedger(selectedEntryId);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setDeletingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>settings</div>
          <h1 className="text-2xl" style={{ color: "var(--text-primary)" }}>usage ledger</h1>
          <p className="mt-2 text-sm max-w-3xl" style={{ color: "var(--text-dim)" }}>
            Daily usage totals are aggregated from local agent run journal files. Filters stay local to this page, cost estimates use editable model-level USD assumptions per million tokens, and those assumptions are saved in settings.
          </p>
        </div>
        <Link href="/settings" className="border px-3 py-2 text-xs uppercase tracking-[0.16em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
          back to settings
        </Link>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {[
          { label: "ledger rows", value: formatNumber(filteredTotals.entryCount) },
          { label: "runs", value: formatNumber(filteredTotals.runCount) },
          { label: "requests", value: formatNumber(filteredTotals.requestCount) },
          { label: "total tokens", value: formatNumber(filteredTotals.totalTokens) },
          { label: "avg tokens / run", value: formatNumber(Math.round(filteredTotals.averageTokensPerRun)) },
          { label: "avg tokens / request", value: formatNumber(Math.round(filteredTotals.averageTokensPerRequest)) },
        ].map((card) => (
          <div key={card.label} className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
            <div className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>{card.label}</div>
            <div className="mt-3 text-2xl" style={{ color: "var(--text-primary)" }}>{card.value}</div>
          </div>
        ))}
      </section>

      <section className="border p-4 space-y-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>filters and pricing</div>
            <div className="text-sm mt-1" style={{ color: "var(--text-dim)" }}>
              Filter the ledger by date range and provider. Cost estimates update immediately from the model pricing presets below and can be exported as CSV.
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-sm" style={{ color: "var(--text-primary)" }}>
              estimated filtered cost {formatMoney(filteredEstimatedCost)}
            </div>
            <div className="text-xs uppercase tracking-[0.16em]" style={{ color: pricingSaveState === "saved" ? "var(--success)" : pricingSaveState === "error" ? "var(--danger)" : "var(--text-dim)" }}>
              pricing {pricingSaveState}
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-4">
          <div>
            <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>provider</label>
            <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
              <option value="all">all providers</option>
              {providerOptions.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>start date</label>
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }} />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>end date</label>
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }} />
          </div>
          <div className="flex items-end">
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => {
                  setProviderFilter("all");
                  setStartDate("");
                  setEndDate("");
                }}
                className="border px-3 py-2 text-xs uppercase tracking-[0.16em]"
                style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
              >
                clear filters
              </button>
              <button
                onClick={exportCsv}
                disabled={filteredEntries.length === 0}
                className="border px-3 py-2 text-xs uppercase tracking-[0.16em] disabled:opacity-50"
                style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
              >
                export csv
              </button>
              <button
                onClick={() => void savePricing()}
                className="border px-3 py-2 text-xs uppercase tracking-[0.16em]"
                style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
              >
                save pricing
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {modelOptions.length === 0 ? (
            <div className="text-sm" style={{ color: "var(--text-dim)" }}>No model data recorded yet.</div>
          ) : modelOptions.map(({ provider, model }) => {
            const pricing = getPricingForModel(model, provider);
            return (
              <div key={`${provider}:${model}`} className="border p-3 space-y-2" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>{provider}</div>
                  <span
                    className="border px-2 py-1 text-[10px] uppercase tracking-[0.16em]"
                    style={{
                      color: getPricingPresetBadge(model, provider, pricing).color,
                      borderColor: getPricingPresetBadge(model, provider, pricing).borderColor,
                      background: getPricingPresetBadge(model, provider, pricing).background,
                    }}
                  >
                    {getPricingPresetBadge(model, provider, pricing).label}
                  </span>
                </div>
                <div className="text-sm break-all" style={{ color: "var(--text-primary)" }}>{model}</div>
                <div>
                  <label className="block text-[11px] uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-dim)" }}>prompt $ / 1M</label>
                  <input value={pricing.promptUsdPerMillion} onChange={(event) => updatePricing(model, provider, "promptUsdPerMillion", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }} />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-dim)" }}>completion $ / 1M</label>
                  <input value={pricing.completionUsdPerMillion} onChange={(event) => updatePricing(model, provider, "completionUsdPerMillion", event.target.value)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="border p-4 space-y-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>daily ledger</div>
              <div className="text-sm mt-1" style={{ color: "var(--text-dim)" }}>Grouped by day, provider, and model with request counts and token averages.</div>
            </div>
            <button onClick={() => void loadLedger(selectedEntryId)} className="border px-3 py-2 text-xs uppercase tracking-[0.16em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
              refresh
            </button>
          </div>

          {error ? <div className="border px-3 py-2 text-sm" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{error}</div> : null}
          {loading ? <div className="text-sm" style={{ color: "var(--text-dim)" }}>Loading usage ledger...</div> : null}
          {!loading && entryPagination.totalItems === 0 ? <div className="text-sm" style={{ color: "var(--text-dim)" }}>No usage rows match the current filters.</div> : null}

          <div className="space-y-3">
            {entryPagination.pageItems.map((entry) => {
              const isSelected = entry.id === selectedEntryId;
              const pricing = getPricingForModel(entry.model, entry.provider);
              const presetBadge = getPricingPresetBadge(entry.model, entry.provider, pricing);
              const estimatedCost = getEstimatedCost(entry.promptTokens, entry.completionTokens, pricing);
              const statusSummary = Object.entries(entry.statusCounts).map(([status, count]) => `${status} ${count}`).join(" - ");

              return (
                <div key={entry.id} className="border p-4 space-y-4" style={{ borderColor: isSelected ? "var(--accent)" : "var(--border-sub)", background: isSelected ? "rgba(199, 92, 31, 0.08)" : "var(--bg-raised)" }}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em]" style={{ color: "var(--text-muted)" }}>{formatDay(entry.day)}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <div className="text-base" style={{ color: "var(--text-primary)" }}>{entry.provider} / {entry.model}</div>
                        <span className="border px-2 py-1 text-[10px] uppercase tracking-[0.16em]" style={{ color: presetBadge.color, borderColor: presetBadge.borderColor, background: presetBadge.background }}>
                          {presetBadge.label}
                        </span>
                      </div>
                      <div className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>{entry.runCount} runs - {entry.requestCount} requests - {statusSummary || "no statuses"}</div>
                    </div>
                    <div className="text-right text-xs space-y-1" style={{ color: "var(--text-dim)" }}>
                      <div>updated {formatTimestamp(entry.updatedAt)}</div>
                      <div>cached {formatNumber(entry.cachedPromptTokens)}</div>
                      <div>cost {formatMoney(estimatedCost)}</div>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6 text-sm">
                    <div><span style={{ color: "var(--text-muted)" }}>prompt / day</span><div>{formatNumber(entry.promptTokens)}</div></div>
                    <div><span style={{ color: "var(--text-muted)" }}>completion / day</span><div>{formatNumber(entry.completionTokens)}</div></div>
                    <div><span style={{ color: "var(--text-muted)" }}>total / day</span><div>{formatNumber(entry.totalTokens)}</div></div>
                    <div><span style={{ color: "var(--text-muted)" }}>avg / run</span><div>{formatNumber(Math.round(entry.averageTokensPerRun))}</div></div>
                    <div><span style={{ color: "var(--text-muted)" }}>avg / request</span><div>{formatNumber(Math.round(entry.averageTokensPerRequest))}</div></div>
                    <div><span style={{ color: "var(--text-muted)" }}>started</span><div>{formatTimestamp(entry.startedAt)}</div></div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 text-sm">
                    <div><span style={{ color: "var(--text-muted)" }}>avg prompt / request</span><div>{formatNumber(Math.round(entry.averagePromptTokensPerRequest))}</div></div>
                    <div><span style={{ color: "var(--text-muted)" }}>avg completion / request</span><div>{formatNumber(Math.round(entry.averageCompletionTokensPerRequest))}</div></div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button onClick={() => void loadLedger(isSelected ? null : entry.id)} className="border px-3 py-2 text-xs uppercase tracking-[0.16em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                      {isSelected ? "hide runs" : "view runs"}
                    </button>
                    <button onClick={() => void deleteEntry(entry)} disabled={deletingKey === `entry:${entry.id}`} className="border px-3 py-2 text-xs uppercase tracking-[0.16em] disabled:opacity-50" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
                      delete row
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <PaginationControls currentPage={entryPagination.currentPage} totalPages={entryPagination.totalPages} startItem={entryPagination.startItem} endItem={entryPagination.endItem} totalItems={entryPagination.totalItems} setCurrentPage={entryPagination.setCurrentPage} />
        </section>

        <section className="border p-4 space-y-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div>
            <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>run details</div>
            <div className="text-sm mt-1" style={{ color: "var(--text-dim)" }}>
              {selectedEntry ? `${formatDay(selectedEntry.day)} - ${selectedEntry.provider} / ${selectedEntry.model}` : "Select a ledger row to inspect individual journal records."}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 text-sm">
            <div><span style={{ color: "var(--text-muted)" }}>raw totals loaded</span><div>{formatNumber(totals.totalTokens)} tokens across {formatNumber(totals.requestCount)} requests</div></div>
            <div><span style={{ color: "var(--text-muted)" }}>filtered totals</span><div>{formatNumber(filteredTotals.totalTokens)} tokens across {formatNumber(filteredTotals.requestCount)} requests</div></div>
          </div>

          {!selectedEntry ? <div className="text-sm" style={{ color: "var(--text-dim)" }}>No ledger row selected.</div> : null}
          {selectedEntry && runPagination.totalItems === 0 ? <div className="text-sm" style={{ color: "var(--text-dim)" }}>This ledger row has no remaining runs.</div> : null}

          <div className="space-y-3">
            {runPagination.pageItems.map((run) => {
              const pricing = getPricingForModel(run.model, run.provider);
              return (
                <div key={run.runId} className="border p-4 space-y-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>{run.profileLabel}</div>
                      <div className="mt-2 text-sm break-all" style={{ color: "var(--text-primary)" }}>{run.runId}</div>
                      <div className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>conversation {run.conversationId}</div>
                    </div>
                    <div className="text-right text-xs" style={{ color: run.status === "failed" ? "var(--danger)" : "var(--text-dim)" }}>
                      <div>{run.status}</div>
                      <div className="mt-1">{formatTimestamp(run.updatedAt)}</div>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 text-sm">
                    <div><span style={{ color: "var(--text-muted)" }}>provider</span><div>{run.provider} / {run.model}</div></div>
                    <div><span style={{ color: "var(--text-muted)" }}>started</span><div>{formatTimestamp(run.startedAt)}</div></div>
                    <div><span style={{ color: "var(--text-muted)" }}>requests</span><div>{formatNumber(run.requestCount)}</div></div>
                    <div><span style={{ color: "var(--text-muted)" }}>avg / request</span><div>{formatNumber(Math.round(run.averageTokensPerRequest))}</div></div>
                    <div><span style={{ color: "var(--text-muted)" }}>prompt</span><div>{formatNumber(run.promptTokens)}</div></div>
                    <div><span style={{ color: "var(--text-muted)" }}>completion</span><div>{formatNumber(run.completionTokens)}</div></div>
                    <div><span style={{ color: "var(--text-muted)" }}>total</span><div>{formatNumber(run.totalTokens)}</div></div>
                    <div><span style={{ color: "var(--text-muted)" }}>cost</span><div>{formatMoney(getEstimatedCost(run.promptTokens, run.completionTokens, pricing))}</div></div>
                  </div>

                  <div>
                    <button onClick={() => void deleteRun(run)} disabled={deletingKey === `run:${run.runId}`} className="border px-3 py-2 text-xs uppercase tracking-[0.16em] disabled:opacity-50" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
                      delete run
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {selectedEntry ? <PaginationControls currentPage={runPagination.currentPage} totalPages={runPagination.totalPages} startItem={runPagination.startItem} endItem={runPagination.endItem} totalItems={runPagination.totalItems} setCurrentPage={runPagination.setCurrentPage} /> : null}
        </section>
      </div>
    </div>
  );
}