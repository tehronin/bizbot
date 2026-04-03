export interface PolymarketOutcome {
  label: string;
  price: number | null;
}

export interface PolymarketMarket {
  id: string;
  question: string;
  subtitle?: string;
  slug?: string;
  active: boolean;
  closed: boolean;
  endDate?: string;
  volume?: number;
  liquidity?: number;
  outcomes: PolymarketOutcome[];
  url?: string;
}

export interface PolymarketSearchResult {
  markets: PolymarketMarket[];
  query: string;
}