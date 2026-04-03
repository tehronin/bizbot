import { getKalshiMarkets, listKalshiSeries } from "@/lib/kalshi/service";
import type { KalshiMarket, KalshiSeries } from "@/lib/kalshi/types";
import type { OraclePredictionTarget } from "@/lib/oracle/intent";
import { scoreOracleMarketCandidate } from "@/lib/oracle/match";
import type {
  OracleNormalizedMarket,
  OracleSourceAdapter,
  OracleSourceSearchOptions,
  OracleSourceSearchResult,
} from "@/lib/oracle/sources";

function normalizeText(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9.%$\s]/g, " ").replace(/\s+/g, " ").trim();
}

function extractNumericThresholds(text: string): number[] {
  const matches = text.match(/\$?\d+(?:,\d{3})*(?:\.\d+)?[kmb]?/gi) ?? [];
  return matches
    .map((match) => {
      const normalized = match.replace(/^\$/, "").replace(/,/g, "").toLowerCase();
      const parts = normalized.match(/^(\d+(?:\.\d+)?)(k|m|b)?$/);
      if (!parts) {
        return undefined;
      }

      const base = Number(parts[1]);
      if (!Number.isFinite(base)) {
        return undefined;
      }

      const multiplier = parts[2] === "k" ? 1_000 : parts[2] === "m" ? 1_000_000 : parts[2] === "b" ? 1_000_000_000 : 1;
      return base * multiplier;
    })
    .filter((value): value is number => value !== undefined);
}

function midpoint(left?: number, right?: number): number | undefined {
  if (left !== undefined && right !== undefined) {
    return Number(((left + right) / 2).toFixed(4));
  }

  return left ?? right;
}

function clampProbability(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) {
    return null;
  }

  if (value < 0 || value > 1) {
    return null;
  }

  return Number(value.toFixed(4));
}

function resolveYesProbability(market: KalshiMarket): number | null {
  const midpointYes = midpoint(market.yesBid, market.yesAsk);
  const midpointNo = midpoint(market.noBid, market.noAsk);
  const lastPrice = clampProbability(market.lastPrice);
  const yesFromQuotes = clampProbability(midpointYes);
  const yesFromNo = midpointNo !== undefined ? clampProbability(1 - midpointNo) : null;

  if (lastPrice !== null && lastPrice > 0) {
    return lastPrice;
  }
  if (yesFromQuotes !== null) {
    return yesFromQuotes;
  }
  if (yesFromNo !== null) {
    return yesFromNo;
  }

  return lastPrice;
}

export function normalizeKalshiMarket(market: KalshiMarket): OracleNormalizedMarket {
  const yesProbability = resolveYesProbability(market);
  const noProbability = yesProbability === null ? null : Number((1 - yesProbability).toFixed(4));
  const marketText = [market.title, market.subtitle].filter(Boolean).join(" ");
  const lower = normalizeText(marketText);
  const active = /^(active|open|initialized)$/i.test(market.status);
  const closed = /^(closed|settled)$/i.test(market.status);
  const slug = market.ticker.toLowerCase();

  return {
    source: "kalshi",
    sourceMarketId: market.ticker,
    title: market.title,
    ...(market.subtitle ? { subtitle: market.subtitle } : {}),
    slug,
    url: `https://kalshi.com/markets/${slug}`,
    ...(market.closeTime ? { closeTime: market.closeTime } : {}),
    active,
    closed,
    ...(market.liquidity !== undefined ? { liquidity: market.liquidity } : {}),
    ...(market.volume !== undefined ? { volume: market.volume } : {}),
    outcomes: [
      { label: /\b(above|over|higher|hit|reach)\b/i.test(lower) ? "Above" : /\b(below|under|lower)\b/i.test(lower) ? "Below" : "Yes", probability: yesProbability },
      { label: /\b(above|over|higher|hit|reach)\b/i.test(lower) ? "Below" : /\b(below|under|lower)\b/i.test(lower) ? "Above" : "No", probability: noProbability },
    ],
    raw: market,
  };
}

function scoreAssetSeries(target: OraclePredictionTarget, haystack: string): number {
  if (target.assetAliases.length === 0) {
    return 0;
  }

  return target.assetAliases.some((alias) => new RegExp(`\\b${alias}\\b`, "i").test(haystack)) ? 1 : 0;
}

function scoreThresholdSeries(target: OraclePredictionTarget, haystack: string): number {
  if (target.thresholdValue === undefined) {
    return 0;
  }

  const values = extractNumericThresholds(haystack);
  if (values.includes(target.thresholdValue)) {
    return 1;
  }

  const closest = values.reduce<number | null>((best, value) => {
    const distance = Math.abs(value - target.thresholdValue!);
    return best === null || distance < best ? distance : best;
  }, null);

  if (closest === null) {
    return /\b(above|below|range|max|price|hit)\b/i.test(haystack) ? 0.35 : 0;
  }

  const ratio = closest / Math.max(target.thresholdValue, 1);
  if (ratio <= 0.05) return 0.8;
  if (ratio <= 0.2) return 0.55;
  return 0.25;
}

function scoreQueryTokenOverlap(query: string, haystack: string): number {
  const tokens = Array.from(new Set(
    normalizeText(query)
      .split(" ")
      .filter((token) => token.length >= 3 && !/^\d+$/.test(token)),
  ));
  if (tokens.length === 0) {
    return 0;
  }

  const matches = tokens.filter((token) => haystack.includes(token)).length;
  return Math.min(0.6, matches * 0.15);
}

function scoreKalshiSeries(target: OraclePredictionTarget, query: string, series: KalshiSeries): number {
  const haystack = normalizeText([series.ticker, series.title, series.category, ...(series.tags ?? [])].join(" "));
  const assetScore = scoreAssetSeries(target, haystack);
  const thresholdScore = scoreThresholdSeries(target, haystack);
  const year = target.timeframeEnd?.slice(0, 4);
  const timeframeScore = year && haystack.includes(year) ? 0.35 : /\b(month|year|daily|today)\b/i.test(haystack) ? 0.15 : 0;
  const queryScore = scoreQueryTokenOverlap(query, haystack);
  const categoryScore = /crypto/i.test(series.category ?? "") ? 0.15 : 0;

  return Number((assetScore * 0.45 + thresholdScore * 0.2 + timeframeScore * 0.1 + queryScore * 0.15 + categoryScore).toFixed(4));
}

function selectCandidateSeries(target: OraclePredictionTarget, query: string, seriesList: KalshiSeries[]): KalshiSeries[] {
  return [...seriesList]
    .map((series) => ({ series, score: scoreKalshiSeries(target, query, series) }))
    .filter((entry) => entry.score >= 0.3)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((entry) => entry.series);
}

export async function searchKalshiOracleSource(
  target: OraclePredictionTarget,
  options?: OracleSourceSearchOptions,
): Promise<OracleSourceSearchResult> {
  const query = options?.queryOverride?.trim() || target.searchQueries[0] || target.normalizedPrompt;
  const limit = Math.max(1, Math.min(options?.limit ?? 5, 10));
  const seriesList = await listKalshiSeries();
  const candidateSeries = selectCandidateSeries(target, query, seriesList);

  const marketSets = await Promise.all(
    candidateSeries.map(async (series) => {
      try {
        return await getKalshiMarkets({
          seriesTicker: series.ticker,
          status: "open",
          limit: Math.max(limit, 10),
          mveFilter: "exclude",
        });
      } catch {
        return [];
      }
    }),
  );

  const markets = marketSets
    .flatMap((set) => set)
    .map((market) => normalizeKalshiMarket(market))
    .sort((left, right) => scoreOracleMarketCandidate(target, right) - scoreOracleMarketCandidate(target, left))
    .slice(0, limit);

  return {
    source: "kalshi",
    query,
    markets,
  };
}

export const kalshiOracleSourceAdapter: OracleSourceAdapter = {
  source: "kalshi",
  search: searchKalshiOracleSource,
};