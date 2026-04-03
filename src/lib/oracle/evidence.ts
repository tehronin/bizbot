import type { OraclePredictionTarget } from "@/lib/oracle/intent";
import {
  getOracleTargetAlignedProbability,
  scoreOracleMarketCandidate,
  scoreOracleMarketSignals,
} from "@/lib/oracle/match";
import { kalshiOracleSourceAdapter } from "@/lib/oracle/kalshi-source";
import { polymarketOracleSourceAdapter } from "@/lib/oracle/polymarket-source";
import type { OracleNormalizedMarket, OracleSourceAdapter } from "@/lib/oracle/sources";

export interface OracleMarketCandidate {
  market: OracleNormalizedMarket;
  relevanceScore: number;
  matchType: "exact" | "adjacent" | "weak";
  matchedSignals: {
    asset: number;
    threshold: number;
    direction: number;
    timeframe: number;
    liquidity: number;
  };
  targetAlignedProbability: number | null;
  sentimentLabel: "bullish" | "bearish" | "mixed" | "unclear";
  notes: string[];
}

export interface OracleEvidenceBundle {
  target: OraclePredictionTarget;
  exactMatch: OracleMarketCandidate | null;
  adjacentMatches: OracleMarketCandidate[];
  allCandidates: OracleMarketCandidate[];
  inferredProbability: number | null;
  sourceProbabilities: Array<{
    source: OracleNormalizedMarket["source"];
    probability: number;
    candidateCount: number;
    weight: number;
  }>;
  sourceBlend: {
    agreement: "none" | "single_source" | "aligned" | "mixed" | "divergent";
    spread: number | null;
  };
  overallSentiment: "bullish" | "bearish" | "mixed" | "unclear";
  confidence: "low" | "medium" | "high";
  evidenceMode: "exact_market" | "adjacent_inference" | "no_useful_match";
  summaryPacket: string;
}

export interface ResolveOracleEvidenceOptions {
  limit?: number;
  perQueryLimit?: number;
}

const NO_MARKET_NEGATIVE_PROBABILITY = 0.18;
const WEAK_CANDIDATE_MIN_RELEVANCE = 0.55;
const MIN_PACKET_CANDIDATES = 3;

function classifyMatchType(score: number, candidate: OracleMarketCandidate["matchedSignals"]): OracleMarketCandidate["matchType"] {
  if (score >= 0.85 && candidate.asset >= 1 && candidate.threshold >= 0.8 && candidate.timeframe >= 0.55) {
    return "exact";
  }
  if (score >= 0.55) {
    return "adjacent";
  }
  return "weak";
}

function classifySentiment(probability: number | null): OracleMarketCandidate["sentimentLabel"] {
  if (probability === null) {
    return "unclear";
  }
  if (probability >= 0.6) return "bullish";
  if (probability <= 0.4) return "bearish";
  return "mixed";
}

function buildCandidateNotes(matchType: OracleMarketCandidate["matchType"], probability: number | null): string[] {
  const notes: string[] = [];
  if (matchType === "adjacent") {
    notes.push("No exact target market found; using adjacent market evidence.");
  }
  if (probability === null) {
    notes.push("Market outcomes did not expose a clean aligned probability.");
  }
  return notes;
}

function buildRetryQueries(target: OraclePredictionTarget): string[] {
  const queries = new Set<string>();
  const asset = target.assetAliases[0] ?? target.asset?.toLowerCase();
  const year = target.timeframeEnd?.slice(0, 4);
  const threshold = target.thresholdValue !== undefined
    ? `${target.thresholdValue}`
    : undefined;

  if (asset && threshold && year) {
    queries.add(`${asset} ${threshold} ${year}`);
  }
  if (asset && threshold) {
    queries.add(`${asset} ${threshold}`);
  }
  if (asset && target.direction && threshold) {
    queries.add(`${asset} ${target.direction} ${threshold}`);
  }
  if (target.canonicalQuestion && target.canonicalQuestion !== target.rawPrompt) {
    queries.add(target.canonicalQuestion);
  }

  return Array.from(queries)
    .map((query) => query.trim())
    .filter((query) => query.length > 0 && !target.searchQueries.includes(query))
    .slice(0, 3);
}

export function listOracleSourceAdapters(): OracleSourceAdapter[] {
  return [polymarketOracleSourceAdapter, kalshiOracleSourceAdapter];
}

function rankCandidates(target: OraclePredictionTarget, markets: OracleNormalizedMarket[]): OracleMarketCandidate[] {
  return markets.map((market) => {
    const matchedSignals = scoreOracleMarketSignals(target, market);
    const relevanceScore = scoreOracleMarketCandidate(target, market);
    const targetAlignedProbability = getOracleTargetAlignedProbability(target, market);
    const matchType = classifyMatchType(relevanceScore, matchedSignals);

    return {
      market,
      relevanceScore,
      matchType,
      matchedSignals,
      targetAlignedProbability,
      sentimentLabel: classifySentiment(targetAlignedProbability),
      notes: buildCandidateNotes(matchType, targetAlignedProbability),
    };
  }).sort((left, right) => right.relevanceScore - left.relevanceScore);
}

function inferProbability(candidates: OracleMarketCandidate[]): number | null {
  const weighted = candidates
    .filter((candidate) => candidate.targetAlignedProbability !== null)
    .map((candidate) => {
      const liquidity = candidate.market.liquidity ?? candidate.market.volume ?? 1;
      const weight = candidate.relevanceScore * Math.log(1 + Math.max(liquidity, 1));
      return {
        probability: candidate.targetAlignedProbability as number,
        weight,
      };
    })
    .filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0);

  if (weighted.length === 0) {
    return null;
  }

  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  const weightedProbability = weighted.reduce((sum, entry) => sum + (entry.probability * entry.weight), 0) / totalWeight;
  return Number(weightedProbability.toFixed(4));
}

function inferSourceProbabilities(candidates: OracleMarketCandidate[]): OracleEvidenceBundle["sourceProbabilities"] {
  const grouped = new Map<OracleNormalizedMarket["source"], OracleMarketCandidate[]>();

  for (const candidate of candidates) {
    if (candidate.targetAlignedProbability === null) {
      continue;
    }
    const existing = grouped.get(candidate.market.source) ?? [];
    existing.push(candidate);
    grouped.set(candidate.market.source, existing);
  }

  return Array.from(grouped.entries())
    .map(([source, sourceCandidates]) => {
      const probability = inferProbability(sourceCandidates);
      const weight = sourceCandidates.reduce((sum, candidate) => {
        const liquidity = candidate.market.liquidity ?? candidate.market.volume ?? 1;
        return sum + (candidate.relevanceScore * Math.log(1 + Math.max(liquidity, 1)));
      }, 0);

      if (probability === null || weight <= 0) {
        return null;
      }

      return {
        source,
        probability,
        candidateCount: sourceCandidates.length,
        weight: Number(weight.toFixed(4)),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) => right.weight - left.weight);
}

function blendSourceProbabilities(sourceProbabilities: OracleEvidenceBundle["sourceProbabilities"]): number | null {
  if (sourceProbabilities.length === 0) {
    return null;
  }

  const totalWeight = sourceProbabilities.reduce((sum, source) => sum + source.weight, 0);
  if (totalWeight <= 0) {
    return null;
  }

  const blended = sourceProbabilities.reduce((sum, source) => sum + (source.probability * source.weight), 0) / totalWeight;
  return Number(blended.toFixed(4));
}

function buildSourceBlend(sourceProbabilities: OracleEvidenceBundle["sourceProbabilities"]): OracleEvidenceBundle["sourceBlend"] {
  if (sourceProbabilities.length === 0) {
    return { agreement: "none", spread: null };
  }

  if (sourceProbabilities.length === 1) {
    return { agreement: "single_source", spread: 0 };
  }

  const probabilities = sourceProbabilities.map((entry) => entry.probability);
  const spread = Number((Math.max(...probabilities) - Math.min(...probabilities)).toFixed(4));

  if (spread <= 0.08) {
    return { agreement: "aligned", spread };
  }
  if (spread <= 0.18) {
    return { agreement: "mixed", spread };
  }
  return { agreement: "divergent", spread };
}

function classifyOverallSentiment(inferredProbability: number | null): OracleEvidenceBundle["overallSentiment"] {
  if (inferredProbability === null) {
    return "unclear";
  }
  if (inferredProbability >= 0.6) return "bullish";
  if (inferredProbability <= 0.4) return "bearish";
  return "mixed";
}

function downgradeConfidence(confidence: OracleEvidenceBundle["confidence"], levels = 1): OracleEvidenceBundle["confidence"] {
  const order: OracleEvidenceBundle["confidence"][] = ["low", "medium", "high"];
  const index = order.indexOf(confidence);
  return order[Math.max(0, index - levels)] ?? "low";
}

function classifyConfidence(
  exactMatch: OracleMarketCandidate | null,
  adjacentMatches: OracleMarketCandidate[],
  inferredProbability: number | null,
  sourceBlend: OracleEvidenceBundle["sourceBlend"],
): OracleEvidenceBundle["confidence"] {
  let baseConfidence: OracleEvidenceBundle["confidence"] = "low";

  if (exactMatch && exactMatch.relevanceScore >= 0.9 && exactMatch.matchedSignals.liquidity >= 0.2) {
    baseConfidence = "high";
  } else if (adjacentMatches.length >= 2 && inferredProbability !== null) {
    baseConfidence = "medium";
  }

  if (sourceBlend.agreement === "divergent") {
    return downgradeConfidence(baseConfidence, 2);
  }
  if (sourceBlend.agreement === "mixed") {
    return downgradeConfidence(baseConfidence, 1);
  }

  return baseConfidence;
}

function filterUsefulCandidates(candidates: OracleMarketCandidate[]): OracleMarketCandidate[] {
  const filtered = candidates.filter((candidate) => {
    if (candidate.matchType === "exact") {
      return true;
    }

    if (candidate.matchType === "adjacent") {
      return candidate.matchedSignals.asset >= 1
        && candidate.matchedSignals.threshold >= 0.6
        && candidate.matchedSignals.direction >= 0.5
        && candidate.relevanceScore >= WEAK_CANDIDATE_MIN_RELEVANCE;
    }

    const strongAssetMatch = candidate.matchedSignals.asset >= 1;
    const directionalSupport = candidate.matchedSignals.direction >= 0.5;
    const numericSupport = candidate.matchedSignals.threshold >= 0.6 || candidate.matchedSignals.timeframe >= 0.55;
    return candidate.relevanceScore >= WEAK_CANDIDATE_MIN_RELEVANCE && strongAssetMatch && directionalSupport && numericSupport;
  });

  return filtered.slice(0, MIN_PACKET_CANDIDATES);
}

function getNoMarketFallbackProbability(): number {
  return NO_MARKET_NEGATIVE_PROBABILITY;
}

function buildSummaryPacket(bundle: Omit<OracleEvidenceBundle, "summaryPacket">): string {
  const lines = [
    "Oracle target:",
    `- User prompt: ${bundle.target.rawPrompt}`,
    `- Canonical target: ${bundle.target.canonicalQuestion}`,
    `- Evidence mode: ${bundle.evidenceMode}`,
    `- Implied probability: ${bundle.inferredProbability ?? "n/a"}`,
    `- Sentiment: ${bundle.overallSentiment}`,
    `- Confidence: ${bundle.confidence}`,
    `- Source blend: ${bundle.sourceProbabilities.length > 0 ? bundle.sourceProbabilities.map((source) => `${source.source} ${(source.probability * 100).toFixed(1)}%`).join(" | ") : "n/a"}`,
    `- Source agreement: ${bundle.sourceBlend.agreement}${bundle.sourceBlend.spread !== null ? ` (spread ${(bundle.sourceBlend.spread * 100).toFixed(1)} pts)` : ""}`,
    "",
    "Top evidence:",
  ];

  if (bundle.evidenceMode === "no_useful_match") {
    lines.push("1. No exact or adjacent active market was found for this target across the enabled sources.");
    lines.push("2. Treat the absence of active market support as a weak negative signal against the target, not proof.");
    lines.push("3. Keep the prediction themed and personality-driven, but explicitly mark confidence as low.");
    return lines.join("\n");
  }

  for (const [index, candidate] of bundle.allCandidates.slice(0, 3).entries()) {
    lines.push(
      `${index + 1}. [${candidate.market.source}] ${candidate.market.title} | aligned probability ${candidate.targetAlignedProbability ?? "n/a"} | relevance ${candidate.relevanceScore}`,
    );
  }

  return lines.join("\n");
}

export function buildOracleEvidenceBundle(target: OraclePredictionTarget, markets: OracleNormalizedMarket[]): OracleEvidenceBundle {
  const deduped = Array.from(new Map(markets.map((market) => [`${market.source}:${market.sourceMarketId}`, market])).values());
  const rankedCandidates = rankCandidates(target, deduped);
  const exactMatches = rankedCandidates.filter((candidate) => candidate.matchType === "exact");
  const exactMatch = exactMatches[0] ?? null;
  const adjacentMatches = rankedCandidates.filter((candidate) => candidate.matchType === "adjacent").slice(0, 5);
  const usefulCandidates = filterUsefulCandidates(rankedCandidates);
  const inferencePool = exactMatches.length > 0 ? exactMatches : adjacentMatches;
  const sourceProbabilities = inferSourceProbabilities(inferencePool);
  const sourceBlend = buildSourceBlend(sourceProbabilities);
  const evidenceMode: OracleEvidenceBundle["evidenceMode"] = exactMatch
    ? "exact_market"
    : adjacentMatches.length > 0
      ? "adjacent_inference"
      : "no_useful_match";
  const inferredProbability = evidenceMode === "no_useful_match"
    ? getNoMarketFallbackProbability()
    : blendSourceProbabilities(sourceProbabilities);
  const overallSentiment = evidenceMode === "no_useful_match"
    ? "bearish"
    : classifyOverallSentiment(inferredProbability);
  const confidence = evidenceMode === "no_useful_match"
    ? "low"
    : classifyConfidence(exactMatch, adjacentMatches, inferredProbability, sourceBlend);

  const baseBundle: Omit<OracleEvidenceBundle, "summaryPacket"> = {
    target,
    exactMatch,
    adjacentMatches,
    allCandidates: usefulCandidates,
    inferredProbability,
    sourceProbabilities,
    sourceBlend,
    overallSentiment,
    confidence,
    evidenceMode,
  };

  return {
    ...baseBundle,
    summaryPacket: buildSummaryPacket(baseBundle),
  };
}

export async function resolveOraclePredictionEvidence(
  target: OraclePredictionTarget,
  options?: ResolveOracleEvidenceOptions,
): Promise<OracleEvidenceBundle> {
  const limit = Math.max(3, Math.min(options?.limit ?? 12, 20));
  const queryList = target.searchQueries.slice(0, 6);
  const perQueryLimit = Math.max(3, Math.min(options?.perQueryLimit ?? Math.ceil(limit / Math.max(queryList.length, 1)) + 1, 10));
  const adapters = listOracleSourceAdapters();
  const runSearches = async (queries: string[]) => Promise.all(
    adapters.flatMap((adapter) => queries.map(async (query) => {
      try {
        return await adapter.search(target, {
          limit: perQueryLimit,
          queryOverride: query,
        });
      } catch {
        return { source: adapter.source, query, markets: [] };
      }
    })),
  );

  let resultSets = await runSearches(queryList);
  const noMarketsFound = resultSets.every((result) => result.markets.length === 0);
  if (noMarketsFound) {
    const retryQueries = buildRetryQueries(target);
    if (retryQueries.length > 0) {
      resultSets = resultSets.concat(await runSearches(retryQueries));
    }
  }

  const dedupedMarkets = Array.from(new Map(
    resultSets.flatMap((result) => result.markets).map((market) => [`${market.source}:${market.sourceMarketId}`, market]),
  ).values()).slice(0, limit);

  return buildOracleEvidenceBundle(target, dedupedMarkets);
}