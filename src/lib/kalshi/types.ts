export interface KalshiSeries {
  ticker: string;
  title: string;
  category?: string;
  tags?: string[];
}

export interface KalshiMarket {
  ticker: string;
  eventTicker?: string;
  title: string;
  subtitle?: string;
  yesBid?: number;
  yesAsk?: number;
  noBid?: number;
  noAsk?: number;
  lastPrice?: number;
  volume?: number;
  liquidity?: number;
  closeTime?: string;
  status: string;
}