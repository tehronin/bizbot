import { searchPolymarketMarkets } from "@/lib/polymarket/service";
import type { PolymarketMarket } from "@/lib/polymarket/types";
import type { OraclePredictionTarget } from "@/lib/oracle/intent";
import type {
  OracleNormalizedMarket,
  OracleSourceAdapter,
  OracleSourceSearchOptions,
  OracleSourceSearchResult,
} from "@/lib/oracle/sources";

export function normalizePolymarketMarket(market: PolymarketMarket): OracleNormalizedMarket {
  return {
    source: "polymarket",
    sourceMarketId: market.id,
    title: market.question,
    ...(market.subtitle ? { subtitle: market.subtitle } : {}),
    ...(market.slug ? { slug: market.slug } : {}),
    ...(market.url ? { url: market.url } : {}),
    ...(market.endDate ? { closeTime: market.endDate } : {}),
    active: market.active,
    closed: market.closed,
    ...(market.liquidity !== undefined ? { liquidity: market.liquidity } : {}),
    ...(market.volume !== undefined ? { volume: market.volume } : {}),
    outcomes: market.outcomes.map((outcome) => ({
      label: outcome.label,
      probability: outcome.price,
    })),
    raw: market,
  };
}

export async function searchPolymarketOracleSource(
  target: OraclePredictionTarget,
  options?: OracleSourceSearchOptions,
): Promise<OracleSourceSearchResult> {
  const query = options?.queryOverride?.trim() || target.searchQueries[0] || target.normalizedPrompt;
  const result = await searchPolymarketMarkets(query, options?.limit ?? 5);

  return {
    source: "polymarket",
    query: result.query,
    markets: result.markets.map((market) => normalizePolymarketMarket(market)),
  };
}

export const polymarketOracleSourceAdapter: OracleSourceAdapter = {
  source: "polymarket",
  search: searchPolymarketOracleSource,
};