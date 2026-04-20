import type { BuilderRun } from "@prisma/client";
import { getDefaultUsageLedgerModelPricing } from "@/lib/agent/usage-ledger-pricing";
import type { BuilderCacheStats } from "@/lib/builder/cache";
import { isFailureEnvelope, type FailureEnvelope } from "@/lib/failures";

type BuilderRunLike = Pick<BuilderRun, "status" | "startedAt" | "finishedAt" | "metadata">;

export interface BuilderRunTelemetryState {
  durationMs: number | null;
  mode: "analysis_only" | "scaffold" | "implementation" | "verification" | null;
  template: string | null;
  provider: string | null;
  model: string | null;
  blockedReason: string | null;
  failureEnvelope: FailureEnvelope | null;
  verificationOutcome: "passed" | "failed" | "skipped" | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
  requestCount: number;
  estimatedCostUsd: number;
}

export interface BuilderTelemetrySummary {
  completedRuns: number;
  runningRuns: number;
  avgDurationMs: number;
  avgTimeToCompletionMs: number;
  totalDurationMs: number;
  blockedReasonCounts: Record<string, number>;
  topBlockedReason: string | null;
  modeCounts: Record<string, number>;
  templateCounts: Record<string, number>;
  tokenTotals: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedPromptTokens: number;
    requestCount: number;
    estimatedCostUsd: number;
  };
  cache: {
    planning: {
      lookups: number;
      hits: number;
      misses: number;
      bypasses: number;
      writes: number;
      keyChanges: number;
      hitRate: number;
    };
    projection: {
      syncs: number;
      filesWritten: number;
      filesSkipped: number;
      manifestWrites: number;
      manifestReused: number;
      writeSkipRate: number;
    };
  };
}

export interface BuilderBudgetProfile {
  mode: "analysis_only" | "scaffold" | "implementation" | "verification";
  maxIterations: number;
  maxDurationMs: number;
  maxTotalTokens: number;
  maxEstimatedCostUsd: number;
  maxRequestCount: number;
  maxRetries: number;
  rationale: string;
  observedRuns: number;
  observedAvgDurationMs: number;
  observedAvgTotalTokens: number;
  observedAvgCostUsd: number;
  topBlockedReason: string | null;
}

const DEFAULT_BUDGET_PROFILES: Record<BuilderBudgetProfile["mode"], Omit<BuilderBudgetProfile, "mode" | "observedRuns" | "observedAvgDurationMs" | "observedAvgTotalTokens" | "observedAvgCostUsd" | "topBlockedReason">> = {
  analysis_only: {
    maxIterations: 1,
    maxDurationMs: 5 * 60 * 1000,
    maxTotalTokens: 12_000,
    maxEstimatedCostUsd: 0.1,
    maxRequestCount: 2,
    maxRetries: 0,
    rationale: "Analysis-only work should inspect and summarize without spending on repair loops.",
  },
  scaffold: {
    maxIterations: 2,
    maxDurationMs: 10 * 60 * 1000,
    maxTotalTokens: 20_000,
    maxEstimatedCostUsd: 0.2,
    maxRequestCount: 3,
    maxRetries: 1,
    rationale: "Scaffold tasks should allow one repair pass for deterministic bootstrap or script fixes.",
  },
  implementation: {
    maxIterations: 3,
    maxDurationMs: 20 * 60 * 1000,
    maxTotalTokens: 60_000,
    maxEstimatedCostUsd: 0.75,
    maxRequestCount: 6,
    maxRetries: 2,
    rationale: "Implementation tasks carry the highest change surface and need room for verification-driven repair.",
  },
  verification: {
    maxIterations: 2,
    maxDurationMs: 8 * 60 * 1000,
    maxTotalTokens: 16_000,
    maxEstimatedCostUsd: 0.15,
    maxRequestCount: 2,
    maxRetries: 1,
    rationale: "Verification-focused work should stay tight and only allow a bounded follow-up pass.",
  },
};

function roundMetric(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function roundCurrency(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

function buildCacheTelemetrySummary(stats?: BuilderCacheStats | null): BuilderTelemetrySummary["cache"] {
  const planningLookups = stats?.planning.lookups ?? 0;
  const planningHits = stats?.planning.hits ?? 0;
  const projectionConsidered = (stats?.projection.filesWritten ?? 0) + (stats?.projection.filesSkipped ?? 0);
  return {
    planning: {
      lookups: planningLookups,
      hits: planningHits,
      misses: stats?.planning.misses ?? 0,
      bypasses: stats?.planning.bypasses ?? 0,
      writes: stats?.planning.writes ?? 0,
      keyChanges: stats?.planning.keyChanges ?? 0,
      hitRate: roundMetric(planningLookups > 0 ? planningHits / planningLookups : 0),
    },
    projection: {
      syncs: stats?.projection.syncs ?? 0,
      filesWritten: stats?.projection.filesWritten ?? 0,
      filesSkipped: stats?.projection.filesSkipped ?? 0,
      manifestWrites: stats?.projection.manifestWrites ?? 0,
      manifestReused: stats?.projection.manifestReused ?? 0,
      writeSkipRate: roundMetric(projectionConsidered > 0 ? (stats?.projection.filesSkipped ?? 0) / projectionConsidered : 0),
    },
  };
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readMode(value: unknown): BuilderRunTelemetryState["mode"] {
  switch (value) {
    case "analysis_only":
    case "scaffold":
    case "implementation":
    case "verification":
      return value;
    default:
      return null;
  }
}

function detectVerificationOutcome(metadata: Record<string, unknown> | null): BuilderRunTelemetryState["verificationOutcome"] {
  const telemetry = readObject(metadata?.telemetry);
  const explicit = readString(telemetry?.verificationOutcome);
  if (explicit === "passed" || explicit === "failed" || explicit === "skipped") {
    return explicit;
  }

  const loop = readObject(metadata?.loop);
  if (!loop) {
    return null;
  }
  if (loop.verificationSkipped === true) {
    return "skipped";
  }
  if (loop.verified === true) {
    return "passed";
  }
  if (loop.verificationSkipped === false) {
    return "failed";
  }
  return null;
}

function detectProviderAndModel(metadata: Record<string, unknown> | null): { provider: string | null; model: string | null } {
  const telemetry = readObject(metadata?.telemetry);
  const explicitProvider = readString(telemetry?.provider);
  const explicitModel = readString(telemetry?.model);
  if (explicitProvider || explicitModel) {
    return { provider: explicitProvider, model: explicitModel };
  }

  const loop = readObject(metadata?.loop);
  const iterations = Array.isArray(loop?.iterations) ? loop.iterations : [];
  const lastIteration = iterations.length > 0 ? readObject(iterations.at(-1)) : null;
  const provider = readString(lastIteration?.provider)
    ?? (() => {
      const command = readString(lastIteration?.command);
      return command?.startsWith("bizbot-agent:") ? command.slice("bizbot-agent:".length) : null;
    })();
  const args = Array.isArray(lastIteration?.args) ? lastIteration.args : [];
  const model = readString(lastIteration?.model) ?? readString(args[2]);
  return { provider, model };
}

function detectBlockedReason(metadata: Record<string, unknown> | null): string | null {
  const telemetry = readObject(metadata?.telemetry);
  const explicit = readString(telemetry?.blockedReason);
  if (explicit) {
    return explicit;
  }

  const cancellationReason = readString(metadata?.cancellationReason);
  if (cancellationReason) {
    return cancellationReason;
  }

  const loop = readObject(metadata?.loop);
  const iterations = Array.isArray(loop?.iterations) ? loop.iterations : [];
  const lastIteration = iterations.length > 0 ? readObject(iterations.at(-1)) : null;
  return readString(lastIteration?.review && readObject(lastIteration.review)?.reason);
}

function detectFailureEnvelope(metadata: Record<string, unknown> | null): FailureEnvelope | null {
  const telemetry = readObject(metadata?.telemetry);
  const explicit = telemetry?.failureEnvelope;
  if (isFailureEnvelope(explicit)) {
    return explicit;
  }

  return null;
}

function detectUsage(metadata: Record<string, unknown> | null): Omit<BuilderRunTelemetryState, "durationMs" | "mode" | "template" | "provider" | "model" | "blockedReason" | "failureEnvelope" | "verificationOutcome" | "estimatedCostUsd"> {
  const telemetry = readObject(metadata?.telemetry);
  const usage = readObject(telemetry?.usage) ?? readObject(readObject(metadata?.loop)?.usage);

  return {
    promptTokens: readNumber(usage?.promptTokens),
    completionTokens: readNumber(usage?.completionTokens),
    totalTokens: readNumber(usage?.totalTokens),
    cachedPromptTokens: readNumber(usage?.cachedPromptTokens),
    requestCount: readNumber(usage?.requestCount),
  };
}

function estimateCostUsd(provider: string | null, model: string | null, usage: Pick<BuilderRunTelemetryState, "promptTokens" | "completionTokens">): number {
  if (!model && !provider) {
    return 0;
  }
  const pricing = getDefaultUsageLedgerModelPricing(model ?? "", provider ?? undefined);
  const promptCost = (usage.promptTokens / 1_000_000) * pricing.promptUsdPerMillion;
  const completionCost = (usage.completionTokens / 1_000_000) * pricing.completionUsdPerMillion;
  return roundCurrency(promptCost + completionCost);
}

export function extractBuilderRunTelemetry(run: BuilderRunLike, fallbackTemplate?: string): BuilderRunTelemetryState {
  const metadata = readObject(run.metadata);
  const telemetry = readObject(metadata?.telemetry);
  const providerAndModel = detectProviderAndModel(metadata);
  const usage = detectUsage(metadata);
  const durationMs = run.finishedAt instanceof Date
    ? Math.max(0, run.finishedAt.getTime() - run.startedAt.getTime())
    : null;

  return {
    durationMs,
    mode: readMode(telemetry?.mode ?? metadata?.mode),
    template: readString(telemetry?.template ?? metadata?.template) ?? fallbackTemplate ?? null,
    provider: providerAndModel.provider,
    model: providerAndModel.model,
    blockedReason: detectBlockedReason(metadata),
    failureEnvelope: detectFailureEnvelope(metadata),
    verificationOutcome: detectVerificationOutcome(metadata),
    ...usage,
    estimatedCostUsd: estimateCostUsd(providerAndModel.provider, providerAndModel.model, usage),
  };
}

export function summarizeBuilderRunTelemetry(runs: BuilderRunLike[], fallbackTemplate?: string, cacheStats?: BuilderCacheStats | null): BuilderTelemetrySummary {
  if (runs.length === 0) {
    return {
      completedRuns: 0,
      runningRuns: 0,
      avgDurationMs: 0,
      avgTimeToCompletionMs: 0,
      totalDurationMs: 0,
      blockedReasonCounts: {},
      topBlockedReason: null,
      modeCounts: {},
      templateCounts: {},
      tokenTotals: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedPromptTokens: 0,
        requestCount: 0,
        estimatedCostUsd: 0,
      },
      cache: buildCacheTelemetrySummary(cacheStats),
    };
  }

  const durations: number[] = [];
  const blockedReasonCounts: Record<string, number> = {};
  const modeCounts: Record<string, number> = {};
  const templateCounts: Record<string, number> = {};
  let runningRuns = 0;
  const tokenTotals = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedPromptTokens: 0,
    requestCount: 0,
    estimatedCostUsd: 0,
  };

  for (const run of runs) {
    const telemetry = extractBuilderRunTelemetry(run, fallbackTemplate);
    if (telemetry.durationMs !== null) {
      durations.push(telemetry.durationMs);
    }
    if (run.status === "RUNNING") {
      runningRuns += 1;
    }
    if (telemetry.blockedReason) {
      blockedReasonCounts[telemetry.blockedReason] = (blockedReasonCounts[telemetry.blockedReason] ?? 0) + 1;
    }
    if (telemetry.mode) {
      modeCounts[telemetry.mode] = (modeCounts[telemetry.mode] ?? 0) + 1;
    }
    if (telemetry.template) {
      templateCounts[telemetry.template] = (templateCounts[telemetry.template] ?? 0) + 1;
    }

    tokenTotals.promptTokens += telemetry.promptTokens;
    tokenTotals.completionTokens += telemetry.completionTokens;
    tokenTotals.totalTokens += telemetry.totalTokens;
    tokenTotals.cachedPromptTokens += telemetry.cachedPromptTokens;
    tokenTotals.requestCount += telemetry.requestCount;
    tokenTotals.estimatedCostUsd = roundMetric(tokenTotals.estimatedCostUsd + telemetry.estimatedCostUsd);
  }

  const topBlockedReason = Object.entries(blockedReasonCounts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;

  return {
    completedRuns: durations.length,
    runningRuns,
    avgDurationMs: roundMetric(durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0),
    avgTimeToCompletionMs: roundMetric(durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0),
    totalDurationMs: roundMetric(durations.reduce((sum, value) => sum + value, 0)),
    blockedReasonCounts,
    topBlockedReason,
    modeCounts,
    templateCounts,
    tokenTotals: {
      promptTokens: tokenTotals.promptTokens,
      completionTokens: tokenTotals.completionTokens,
      totalTokens: tokenTotals.totalTokens,
      cachedPromptTokens: tokenTotals.cachedPromptTokens,
      requestCount: tokenTotals.requestCount,
      estimatedCostUsd: roundMetric(tokenTotals.estimatedCostUsd),
    },
    cache: buildCacheTelemetrySummary(cacheStats),
  };
}

export function summarizeBuilderBudgetProfiles(runs: BuilderRunLike[], fallbackTemplate?: string): BuilderBudgetProfile[] {
  const buckets = new Map<BuilderBudgetProfile["mode"], BuilderRunTelemetryState[]>();
  for (const run of runs) {
    const telemetry = extractBuilderRunTelemetry(run, fallbackTemplate);
    if (!telemetry.mode) {
      continue;
    }
    const current = buckets.get(telemetry.mode) ?? [];
    current.push(telemetry);
    buckets.set(telemetry.mode, current);
  }

  return (["analysis_only", "scaffold", "implementation", "verification"] as const).map((mode) => {
    const observed = buckets.get(mode) ?? [];
    const blockedReasonCounts: Record<string, number> = {};
    for (const entry of observed) {
      if (entry.blockedReason) {
        blockedReasonCounts[entry.blockedReason] = (blockedReasonCounts[entry.blockedReason] ?? 0) + 1;
      }
    }
    const topBlockedReason = Object.entries(blockedReasonCounts)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;

    return {
      mode,
      ...DEFAULT_BUDGET_PROFILES[mode],
      observedRuns: observed.length,
      observedAvgDurationMs: roundMetric(observed.length > 0 ? observed.reduce((sum, entry) => sum + (entry.durationMs ?? 0), 0) / observed.length : 0),
      observedAvgTotalTokens: roundMetric(observed.length > 0 ? observed.reduce((sum, entry) => sum + entry.totalTokens, 0) / observed.length : 0),
      observedAvgCostUsd: roundCurrency(observed.length > 0 ? observed.reduce((sum, entry) => sum + entry.estimatedCostUsd, 0) / observed.length : 0),
      topBlockedReason,
    } satisfies BuilderBudgetProfile;
  });
}