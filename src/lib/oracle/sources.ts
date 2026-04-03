import type { OraclePredictionTarget } from "@/lib/oracle/intent";

export type OracleMarketSourceId = "polymarket" | "kalshi";

export interface OracleNormalizedOutcome {
  label: string;
  probability: number | null;
}

export interface OracleNormalizedMarket {
  source: OracleMarketSourceId;
  sourceMarketId: string;
  title: string;
  subtitle?: string;
  slug?: string;
  url?: string;
  closeTime?: string;
  active: boolean;
  closed: boolean;
  liquidity?: number;
  volume?: number;
  outcomes: OracleNormalizedOutcome[];
  raw?: unknown;
}

export interface OracleSourceSearchResult {
  source: OracleMarketSourceId;
  query: string;
  markets: OracleNormalizedMarket[];
}

export interface OracleSourceSearchOptions {
  limit?: number;
  queryOverride?: string;
}

export interface OracleSourceAdapter {
  source: OracleMarketSourceId;
  search: (target: OraclePredictionTarget, options?: OracleSourceSearchOptions) => Promise<OracleSourceSearchResult>;
}