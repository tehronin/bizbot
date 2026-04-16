/**
 * oracle/swarm.ts — Swarm-powered parallel evidence collection for Oracle predictions.
 *
 * Dispatches three concurrent work items:
 *   1. market_search  — Kalshi + Polymarket prediction market odds
 *   2. web_research   — Browser-based OSINT search for supporting evidence
 *   3. trend_analysis — Google Trends frequency data for the prediction topic
 *
 * Results are merged into a single OracleSwarmEvidenceBundle that extends the
 * base market evidence with web research and trend signals.
 */

import type { SwarmExecutionPlan, SwarmWorkItem } from "@/lib/swarm/types";
import { executeSwarmPlan } from "@/lib/swarm/runtime";
import type { OraclePredictionTarget } from "@/lib/oracle/intent";
import {
  resolveOraclePredictionEvidence,
  buildOracleEvidenceBundle,
  type OracleEvidenceBundle,
  type ResolveOracleEvidenceOptions,
} from "@/lib/oracle/evidence";
import { navigatePage } from "@/lib/browser/engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export interface OracleSwarmEvidenceBundle {
  market: OracleEvidenceBundle;
  webResearch: OracleWebResearchResult[];
  trendSignals: OracleTrendSignal[];
  swarmTrace: {
    planId: string;
    durationMs: number;
    workerCount: number;
    completedCount: number;
    failedCount: number;
  };
}

// ---------------------------------------------------------------------------
// Web Research Worker
// ---------------------------------------------------------------------------

function buildWebSearchQueries(target: OraclePredictionTarget): string[] {
  const queries: string[] = [];
  const asset = target.asset?.toLowerCase() ?? "";
  const threshold = target.thresholdValue !== undefined ? `${target.thresholdValue}` : "";
  const year = target.timeframeEnd?.slice(0, 4) ?? new Date().getFullYear().toString();

  // Direct prediction-related search
  if (asset && threshold) {
    queries.push(`${asset} price prediction ${threshold} ${year}`);
  }

  // Expert analysis / outlook search
  if (asset) {
    queries.push(`${asset} price forecast ${year} analysis`);
  }

  // News / recent developments
  if (target.canonicalQuestion) {
    queries.push(`${target.canonicalQuestion} latest news`);
  }

  return queries.slice(0, 3);
}

function buildGoogleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`;
}

function parseGoogleSearchResults(text: string, limit = 5): Array<{ title: string; excerpt: string }> {
  // Google search results are rendered as blocks of text.
  // Each result typically has a title line followed by descriptive text.
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 10);
  const results: Array<{ title: string; excerpt: string }> = [];

  for (let i = 0; i < lines.length && results.length < limit; i++) {
    const line = lines[i]!;
    // Skip navigation/chrome elements
    if (line.startsWith("About ") || line.startsWith("Sign in") || line === "Google" || line.includes("All ") || line.startsWith("Tools")) {
      continue;
    }
    // Look for lines that seem like result titles (usually followed by a description)
    const nextLine = lines[i + 1];
    if (nextLine && nextLine.length > 30 && line.length < 200) {
      results.push({
        title: line.slice(0, 200),
        excerpt: nextLine.slice(0, 500),
      });
      i += 1; // skip the excerpt line
    }
  }

  return results;
}

async function executeWebResearch(queries: string[]): Promise<OracleWebResearchResult[]> {
  const results: OracleWebResearchResult[] = [];

  for (const query of queries) {
    try {
      const url = buildGoogleSearchUrl(query);
      const { result } = await navigatePage(url);
      const parsed = parseGoogleSearchResults(result.text);
      results.push({
        query,
        snippets: parsed.map((item) => ({
          url: result.url,
          title: item.title,
          excerpt: item.excerpt,
        })),
      });
    } catch {
      results.push({ query, snippets: [] });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Trend Analysis Worker
// ---------------------------------------------------------------------------

function buildTrendQueries(target: OraclePredictionTarget): string[] {
  const queries: string[] = [];
  const asset = target.asset?.toLowerCase() ?? target.normalizedPrompt.slice(0, 30);

  // Google Trends explore URL
  queries.push(asset);

  // Add threshold variant if relevant
  if (target.thresholdValue !== undefined) {
    queries.push(`${asset} ${target.thresholdValue}`);
  }

  return queries.slice(0, 2);
}

function buildGoogleTrendsUrl(query: string): string {
  return `https://trends.google.com/trends/explore?q=${encodeURIComponent(query)}&hl=en`;
}

function parseTrendDirection(text: string): OracleTrendSignal["trendDirection"] {
  const lower = text.toLowerCase();
  if (lower.includes("breakout") || lower.includes("increase") || lower.includes("rising") || lower.includes("surge") || lower.includes("peak")) {
    return "rising";
  }
  if (lower.includes("decline") || lower.includes("decreasing") || lower.includes("falling") || lower.includes("drop")) {
    return "declining";
  }
  if (lower.includes("steady") || lower.includes("stable") || lower.includes("flat")) {
    return "stable";
  }
  return "unknown";
}

function parseInterestLevel(text: string): OracleTrendSignal["interestLevel"] {
  const lower = text.toLowerCase();
  if (lower.includes("100") || lower.includes("peak popularity") || lower.includes("breakout")) {
    return "high";
  }
  if (lower.includes("interest over time") || lower.length > 200) {
    return "moderate";
  }
  return "low";
}

async function executeTrendAnalysis(queries: string[]): Promise<OracleTrendSignal[]> {
  const signals: OracleTrendSignal[] = [];

  for (const query of queries) {
    try {
      const url = buildGoogleTrendsUrl(query);
      const { result } = await navigatePage(url);
      const excerpt = result.text.slice(0, 1000);
      signals.push({
        query,
        trendDirection: parseTrendDirection(excerpt),
        interestLevel: parseInterestLevel(excerpt),
        excerpt: excerpt.slice(0, 500),
      });
    } catch {
      signals.push({
        query,
        trendDirection: "unknown",
        interestLevel: "unknown",
        excerpt: "",
      });
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Swarm Planner
// ---------------------------------------------------------------------------

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
      payload: {
        target,
        limit,
      },
    },
    {
      id: "web_research",
      type: "oracle_web",
      sourceId: "oracle",
      sourceKind: "web_search",
      operation: "osint_research",
      instructions: [
        `Search for web evidence related to: ${target.canonicalQuestion}`,
        "Collect expert analysis, news articles, and price predictions.",
        "Extract key data points that support or contradict the prediction.",
      ],
      constraints: {
        maxOutputChars: 6000,
        mustIncludeEvidenceRefs: true,
        allowToolCalls: false,
      },
      payload: {
        queries: buildWebSearchQueries(target),
      },
    },
    {
      id: "trend_analysis",
      type: "oracle_trends",
      sourceId: "oracle",
      sourceKind: "search_trends",
      operation: "frequency_analysis",
      instructions: [
        `Analyze Google Trends search frequency for: ${target.asset ?? target.normalizedPrompt}`,
        "Determine if public interest is rising, stable, or declining.",
        "Higher search interest may indicate stronger market sentiment.",
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
    taskSummary: `Oracle swarm: market search + web OSINT + trend analysis for "${target.canonicalQuestion}"`,
    workItems,
    aggregationStrategy: "deterministic_merge",
    validationRules: ["structured_outputs_only"],
    failurePolicy: "fallback_to_single_agent",
    plannerConfidence: 0.85,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Swarm Worker
// ---------------------------------------------------------------------------

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
      const webResearch = await executeWebResearch(queries);
      return { workItemId: workItem.id, webResearch };
    }

    case "trend_analysis": {
      const queries = workItem.payload.queries as string[];
      const trendSignals = await executeTrendAnalysis(queries);
      return { workItemId: workItem.id, trendSignals };
    }

    default:
      throw new Error(`Unknown Oracle swarm work item: ${workItem.id}`);
  }
}

// ---------------------------------------------------------------------------
// Enhanced Summary Packet
// ---------------------------------------------------------------------------

function buildSwarmSummaryPacket(bundle: OracleSwarmEvidenceBundle): string {
  const lines: string[] = [];

  // Market evidence section (from base evidence)
  lines.push(bundle.market.summaryPacket);
  lines.push("");

  // Web research section
  if (bundle.webResearch.length > 0) {
    const hasSnippets = bundle.webResearch.some((r) => r.snippets.length > 0);
    if (hasSnippets) {
      lines.push("Web research findings:");
      for (const result of bundle.webResearch) {
        if (result.snippets.length === 0) continue;
        lines.push(`- Query: "${result.query}"`);
        for (const snippet of result.snippets.slice(0, 3)) {
          lines.push(`  - ${snippet.title}: ${snippet.excerpt.slice(0, 200)}`);
        }
      }
      lines.push("");
    }
  }

  // Trend analysis section
  if (bundle.trendSignals.length > 0) {
    const hasSignals = bundle.trendSignals.some((s) => s.trendDirection !== "unknown");
    if (hasSignals) {
      lines.push("Search trend signals:");
      for (const signal of bundle.trendSignals) {
        lines.push(`- "${signal.query}": direction=${signal.trendDirection}, interest=${signal.interestLevel}`);
      }
      lines.push("");
    }
  }

  // Swarm execution metadata
  lines.push(`Swarm: ${bundle.swarmTrace.workerCount} workers, ${bundle.swarmTrace.completedCount} completed, ${bundle.swarmTrace.failedCount} failed, ${bundle.swarmTrace.durationMs}ms total`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function resolveOracleSwarmEvidence(
  target: OraclePredictionTarget,
  options?: ResolveOracleEvidenceOptions,
): Promise<OracleSwarmEvidenceBundle> {
  const plan = buildOracleSwarmPlan(target, options);
  const { results, trace } = await executeSwarmPlan<OracleSwarmWorkerOutput>(plan, oracleSwarmWorker);

  // Extract results by work item ID
  const marketResult = results.find((r) => r.workItemId === "market_search");
  const webResult = results.find((r) => r.workItemId === "web_research");
  const trendResult = results.find((r) => r.workItemId === "trend_analysis");

  const marketEvidence = (marketResult?.status === "completed" && marketResult.output.evidence)
    ? marketResult.output.evidence as OracleEvidenceBundle
    : buildOracleEvidenceBundle(target, []);

  const webResearch = (webResult?.status === "completed" && webResult.output.webResearch)
    ? webResult.output.webResearch as OracleWebResearchResult[]
    : [];

  const trendSignals = (trendResult?.status === "completed" && trendResult.output.trendSignals)
    ? trendResult.output.trendSignals as OracleTrendSignal[]
    : [];

  const completedCount = results.filter((r) => r.status === "completed").length;
  const failedCount = results.filter((r) => r.status === "failed").length;

  const bundle: OracleSwarmEvidenceBundle = {
    market: marketEvidence,
    webResearch,
    trendSignals,
    swarmTrace: {
      planId: trace.planId,
      durationMs: trace.durationMs,
      workerCount: trace.workerCount,
      completedCount,
      failedCount,
    },
  };

  // Replace the market summary packet with the enhanced swarm version
  bundle.market = {
    ...bundle.market,
    summaryPacket: buildSwarmSummaryPacket(bundle),
  };

  return bundle;
}
