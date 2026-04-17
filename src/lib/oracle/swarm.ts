/**
 * oracle/swarm.ts — Swarm-powered parallel evidence collection for Oracle predictions.
 *
 * Dispatches three concurrent work items:
 *   1. market_search  — Kalshi + Polymarket prediction market odds
 *   2. web_research   — Adjacent prediction market research using alternate queries
 *   3. trend_analysis — Kalshi series coverage as a market-interest proxy
 */

import type { OraclePredictionTarget } from "@/lib/oracle/intent";
import {
  buildOracleEvidenceBundle,
  resolveOraclePredictionEvidence,
  type OracleEvidenceBundle,
  type ResolveOracleEvidenceOptions,
} from "@/lib/oracle/evidence";
import { listKalshiSeries } from "@/lib/kalshi/service";
import { searchPolymarketMarkets } from "@/lib/polymarket/service";
import { executeSwarmPlan } from "@/lib/swarm/runtime";
import type { SwarmExecutionPlan, SwarmWorkItem } from "@/lib/swarm/types";

export interface OracleWebResearchResult {
  query: string;
  snippets: Array<{
    url: string;
    title: string;
    excerpt: string;
  }>;
}

export interface OracleTrendSignal {
  query: string;
  trendDirection: "rising" | "stable" | "declining" | "unknown";
  interestLevel: "high" | "moderate" | "low" | "unknown";
  excerpt: string;
}

export interface OracleEvidenceGap {
  lane: "market_search" | "web_research" | "trend_analysis";
  reason: string;
}

export interface OracleSwarmEvidenceBundle {
  market: OracleEvidenceBundle;
  webResearch: OracleWebResearchResult[];
  trendSignals: OracleTrendSignal[];
  evidenceGaps: OracleEvidenceGap[];
  swarmTrace: {
    planId: string;
    durationMs: number;
    workerCount: number;
    completedCount: number;
    failedCount: number;
  };
}

function buildResearchQueries(target: OraclePredictionTarget): string[] {
  const queries: string[] = [];
  const asset = target.asset?.toLowerCase() ?? "";
  const year = target.timeframeEnd?.slice(0, 4) ?? new Date().getFullYear().toString();

  if (asset && target.thresholdValue !== undefined) {
    queries.push(`${asset} ${target.thresholdValue} ${year}`);
  }
  if (asset) {
    queries.push(`${asset} price forecast ${year}`);
  }
  if (target.canonicalQuestion && !asset) {
    queries.push(target.canonicalQuestion);
  }

  return queries.slice(0, 2);
}

function buildTrendQueries(target: OraclePredictionTarget): string[] {
  const base = target.asset?.toLowerCase() ?? target.normalizedPrompt.slice(0, 30);
  return [base].filter((value) => value.length > 0).slice(0, 2);
}

async function executeStructuredResearch(queries: string[]): Promise<OracleWebResearchResult[]> {
  const results: OracleWebResearchResult[] = [];

  for (const query of queries) {
    try {
      const searchResult = await searchPolymarketMarkets(query, 5);
      results.push({
        query,
        snippets: searchResult.markets.slice(0, 4).map((market) => ({
          url: market.url ?? "https://polymarket.com",
          title: market.question,
          excerpt: [
            market.outcomes
              .map((outcome) => {
                const probability = typeof outcome.price === "number" ? `${(outcome.price * 100).toFixed(1)}%` : "n/a";
                return `${outcome.label}: ${probability}`;
              })
              .join(" | "),
            market.endDate ? `Closes: ${market.endDate}` : null,
            market.volume !== undefined ? `Volume: $${market.volume.toLocaleString()}` : null,
          ].filter((value): value is string => Boolean(value)).join(" - "),
        })),
      });
    } catch {
      results.push({ query, snippets: [] });
    }
  }

  return results;
}

async function executeMarketSignals(queries: string[]): Promise<OracleTrendSignal[]> {
  let series: Awaited<ReturnType<typeof listKalshiSeries>>;

  try {
    series = await listKalshiSeries();
  } catch {
    return queries.map((query) => ({
      query,
      trendDirection: "unknown",
      interestLevel: "unknown",
      excerpt: "Kalshi series unavailable",
    }));
  }

  return queries.map((query) => {
    const lower = query.toLowerCase();
    const matchCount = series.filter((item) => {
      if (item.title.toLowerCase().includes(lower)) {
        return true;
      }

      return item.tags?.some((tag) => lower.includes(tag.toLowerCase()) || tag.toLowerCase().includes(lower)) ?? false;
    }).length;

    const trendDirection: OracleTrendSignal["trendDirection"] = matchCount >= 5
      ? "rising"
      : matchCount >= 2
        ? "stable"
        : matchCount === 1
          ? "declining"
          : "unknown";

    const interestLevel: OracleTrendSignal["interestLevel"] = matchCount >= 10
      ? "high"
      : matchCount >= 3
        ? "moderate"
        : matchCount >= 1
          ? "low"
          : "unknown";

    return {
      query,
      trendDirection,
      interestLevel,
      excerpt: `${matchCount} active Kalshi series match "${query}"`,
    };
  });
}

export function buildOracleSwarmPlan(
  target: OraclePredictionTarget,
  options?: { limit?: number },
): SwarmExecutionPlan {
  const planId = `oracle-swarm-${Date.now()}`;
  const limit = options?.limit ?? 12;

  const workItems: SwarmWorkItem[] = [
    {
      id: "market_search",
      type: "oracle_market",
      sourceId: "oracle",
      sourceKind: "prediction_markets",
      operation: "search_and_rank",
      instructions: [
        `Search Kalshi and Polymarket for markets matching: ${target.canonicalQuestion}`,
        `Use search queries: ${target.searchQueries.join(", ")}`,
        "Score and rank results by relevance to the prediction target.",
      ],
      constraints: {
        maxOutputChars: 8000,
        mustIncludeEvidenceRefs: true,
        allowToolCalls: false,
      },
      payload: { target, limit },
    },
    {
      id: "web_research",
      type: "oracle_web",
      sourceId: "oracle",
      sourceKind: "market_research",
      operation: "structured_research",
      instructions: [
        `Find adjacent prediction markets for: ${target.canonicalQuestion}`,
        "Use alternate query variants to surface related prediction markets.",
        "Format results as structured snippets with probabilities.",
      ],
      constraints: {
        maxOutputChars: 6000,
        mustIncludeEvidenceRefs: true,
        allowToolCalls: false,
      },
      payload: {
        queries: buildResearchQueries(target),
      },
    },
    {
      id: "trend_analysis",
      type: "oracle_trends",
      sourceId: "oracle",
      sourceKind: "market_signals",
      operation: "conviction_analysis",
      instructions: [
        `Analyze market coverage for: ${target.asset ?? target.normalizedPrompt}`,
        "Higher Kalshi series count indicates stronger prediction market interest.",
        "Use series coverage as a proxy for momentum and conviction.",
      ],
      constraints: {
        maxOutputChars: 4000,
        mustIncludeEvidenceRefs: false,
        allowToolCalls: false,
      },
      payload: {
        queries: buildTrendQueries(target),
      },
    },
  ];

  return {
    id: planId,
    mode: "oracle_swarm",
    reason: `Parallel evidence collection for Oracle prediction: ${target.canonicalQuestion}`,
    taskSummary: `Oracle swarm: market search + structured research + market signals for "${target.canonicalQuestion}"`,
    workItems,
    aggregationStrategy: "deterministic_merge",
    validationRules: ["structured_outputs_only"],
    failurePolicy: "fallback_to_single_agent",
    plannerConfidence: 0.85,
    createdAt: new Date().toISOString(),
  };
}

interface OracleSwarmWorkerOutput extends Record<string, unknown> {
  workItemId: string;
  evidence?: OracleEvidenceBundle;
  webResearch?: OracleWebResearchResult[];
  trendSignals?: OracleTrendSignal[];
}

async function oracleSwarmWorker(workItem: SwarmWorkItem): Promise<OracleSwarmWorkerOutput> {
  switch (workItem.id) {
    case "market_search": {
      const target = workItem.payload.target as OraclePredictionTarget;
      const limit = (workItem.payload.limit as number) ?? 12;
      const evidence = await resolveOraclePredictionEvidence(target, { limit });
      return { workItemId: workItem.id, evidence };
    }
    case "web_research": {
      const queries = workItem.payload.queries as string[];
      const webResearch = await executeStructuredResearch(queries);
      return { workItemId: workItem.id, webResearch };
    }
    case "trend_analysis": {
      const queries = workItem.payload.queries as string[];
      const trendSignals = await executeMarketSignals(queries);
      return { workItemId: workItem.id, trendSignals };
    }
    default:
      throw new Error(`Unknown Oracle swarm work item: ${workItem.id}`);
  }
}

function buildSwarmSummaryPacket(bundle: OracleSwarmEvidenceBundle): string {
  const lines: string[] = [bundle.market.summaryPacket, ""];

  if (bundle.webResearch.some((item) => item.snippets.length > 0)) {
    lines.push("Adjacent market research:");
    for (const result of bundle.webResearch) {
      if (result.snippets.length === 0) {
        continue;
      }
      lines.push(`- Query: "${result.query}"`);
      for (const snippet of result.snippets.slice(0, 3)) {
        lines.push(`  - ${snippet.title}: ${snippet.excerpt.slice(0, 200)}`);
      }
    }
    lines.push("");
  }

  if (bundle.trendSignals.some((item) => item.trendDirection !== "unknown")) {
    lines.push("Kalshi market coverage signals:");
    for (const signal of bundle.trendSignals) {
      lines.push(`- "${signal.query}": direction=${signal.trendDirection}, interest=${signal.interestLevel} - ${signal.excerpt}`);
    }
    lines.push("");
  }

  if (bundle.evidenceGaps.length > 0) {
    lines.push("Evidence gaps:");
    for (const gap of bundle.evidenceGaps) {
      lines.push(`- ${gap.lane}: ${gap.reason}`);
    }
    lines.push("");
  }

  lines.push(`Swarm: ${bundle.swarmTrace.workerCount} workers, ${bundle.swarmTrace.completedCount} completed, ${bundle.swarmTrace.failedCount} failed, ${bundle.swarmTrace.durationMs}ms total`);

  return lines.join("\n");
}

export async function resolveOracleSwarmEvidence(
  target: OraclePredictionTarget,
  options?: ResolveOracleEvidenceOptions,
): Promise<OracleSwarmEvidenceBundle> {
  const plan = buildOracleSwarmPlan(target, options);
  const { results, trace } = await executeSwarmPlan<OracleSwarmWorkerOutput>(plan, oracleSwarmWorker);

  const marketResult = results.find((result) => result.workItemId === "market_search");
  const webResult = results.find((result) => result.workItemId === "web_research");
  const trendResult = results.find((result) => result.workItemId === "trend_analysis");

  const marketEvidence = marketResult?.status === "completed" && marketResult.output.evidence
    ? marketResult.output.evidence as OracleEvidenceBundle
    : buildOracleEvidenceBundle(target, []);

  const webResearch = webResult?.status === "completed" && webResult.output.webResearch
    ? webResult.output.webResearch as OracleWebResearchResult[]
    : [];

  const trendSignals = trendResult?.status === "completed" && trendResult.output.trendSignals
    ? trendResult.output.trendSignals as OracleTrendSignal[]
    : [];

  const evidenceGaps: OracleEvidenceGap[] = [];
  if (marketResult?.status === "failed") {
    evidenceGaps.push({ lane: "market_search", reason: marketResult.diagnostics[0] ?? "Unknown error" });
  }
  if (webResult?.status === "failed") {
    evidenceGaps.push({ lane: "web_research", reason: webResult.diagnostics[0] ?? "Unknown error" });
  }
  if (trendResult?.status === "failed") {
    evidenceGaps.push({ lane: "trend_analysis", reason: trendResult.diagnostics[0] ?? "Unknown error" });
  }

  const bundle: OracleSwarmEvidenceBundle = {
    market: marketEvidence,
    webResearch,
    trendSignals,
    evidenceGaps,
    swarmTrace: {
      planId: trace.planId,
      durationMs: trace.durationMs,
      workerCount: trace.workerCount,
      completedCount: results.filter((result) => result.status === "completed").length,
      failedCount: results.filter((result) => result.status === "failed").length,
    },
  };

  return {
    ...bundle,
    market: {
      ...bundle.market,
      summaryPacket: buildSwarmSummaryPacket(bundle),
    },
  };
}
