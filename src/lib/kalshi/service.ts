import type { KalshiMarket, KalshiSeries } from "@/lib/kalshi/types";

const DEFAULT_KALSHI_BASE_URL = "https://api.elections.kalshi.com/trade-api/v2";
const SERIES_CACHE_TTL_MS = 5 * 60 * 1000;

let kalshiSeriesCache: { expiresAt: number; value: KalshiSeries[] } | null = null;
let kalshiSeriesPromise: Promise<KalshiSeries[]> | null = null;

function getBaseUrl(): string {
  return (process.env.BIZBOT_KALSHI_BASE_URL ?? DEFAULT_KALSHI_BASE_URL).replace(/\/$/, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function readStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value
    .map((entry) => typeof entry === "string" ? entry.trim() : "")
    .filter((entry) => entry.length > 0);

  return entries.length > 0 ? entries : undefined;
}

function normalizeSeries(raw: unknown): KalshiSeries {
  const record = asRecord(raw);
  if (!record) {
    throw new Error("Kalshi series payload must be an object.");
  }

  const ticker = readString(record, ["ticker"]);
  const title = readString(record, ["title"]);
  if (!ticker || !title) {
    throw new Error("Kalshi series payload is missing a ticker or title.");
  }

  const category = readString(record, ["category"]);
  const tags = readStringArray(record, "tags");

  return {
    ticker,
    title,
    ...(category ? { category } : {}),
    ...(tags ? { tags } : {}),
  };
}

function normalizeMarket(raw: unknown): KalshiMarket {
  const record = asRecord(raw);
  if (!record) {
    throw new Error("Kalshi market payload must be an object.");
  }

  const ticker = readString(record, ["ticker"]);
  const title = readString(record, ["title"]);
  if (!ticker || !title) {
    throw new Error("Kalshi market payload is missing a ticker or title.");
  }

  const status = readString(record, ["status"]) ?? "unknown";
  const eventTicker = readString(record, ["event_ticker"]);
  const subtitle = readString(record, ["subtitle", "yes_sub_title"]);
  const closeTime = readString(record, ["close_time", "expiration_time"]);
  const yesBid = readNumber(record, ["yes_bid_dollars"]);
  const yesAsk = readNumber(record, ["yes_ask_dollars"]);
  const noBid = readNumber(record, ["no_bid_dollars"]);
  const noAsk = readNumber(record, ["no_ask_dollars"]);
  const lastPrice = readNumber(record, ["last_price_dollars"]);
  const volume = readNumber(record, ["volume_fp", "volume_24h_fp"]);
  const liquidity = readNumber(record, ["liquidity_dollars"]);

  return {
    ticker,
    ...(eventTicker ? { eventTicker } : {}),
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(yesBid !== undefined ? { yesBid } : {}),
    ...(yesAsk !== undefined ? { yesAsk } : {}),
    ...(noBid !== undefined ? { noBid } : {}),
    ...(noAsk !== undefined ? { noAsk } : {}),
    ...(lastPrice !== undefined ? { lastPrice } : {}),
    ...(volume !== undefined ? { volume } : {}),
    ...(liquidity !== undefined ? { liquidity } : {}),
    ...(closeTime ? { closeTime } : {}),
    status,
  };
}

async function fetchJson(path: string, params?: URLSearchParams): Promise<unknown> {
  const url = `${getBaseUrl()}${path}${params ? `?${params.toString()}` : ""}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Kalshi request failed with status ${response.status}.`);
  }

  return response.json();
}

export async function listKalshiSeries(): Promise<KalshiSeries[]> {
  const now = Date.now();
  if (kalshiSeriesCache && kalshiSeriesCache.expiresAt > now) {
    return kalshiSeriesCache.value;
  }

  if (!kalshiSeriesPromise) {
    kalshiSeriesPromise = (async () => {
      const payload = await fetchJson("/series");
      const record = asRecord(payload);
      const series = Array.isArray(record?.series) ? record.series.map((entry) => normalizeSeries(entry)) : [];
      kalshiSeriesCache = {
        value: series,
        expiresAt: Date.now() + SERIES_CACHE_TTL_MS,
      };
      return series;
    })().finally(() => {
      kalshiSeriesPromise = null;
    });
  }

  return kalshiSeriesPromise;
}

export interface GetKalshiMarketsOptions {
  seriesTicker?: string;
  status?: "open" | "closed" | "paused" | "settled" | "unopened";
  limit?: number;
  cursor?: string;
  mveFilter?: "exclude" | "only";
}

export async function getKalshiMarkets(options?: GetKalshiMarketsOptions): Promise<KalshiMarket[]> {
  const params = new URLSearchParams();
  params.set("limit", String(Math.max(1, Math.min(options?.limit ?? 25, 200))));
  if (options?.seriesTicker) {
    params.set("series_ticker", options.seriesTicker);
  }
  if (options?.status) {
    params.set("status", options.status);
  }
  if (options?.cursor) {
    params.set("cursor", options.cursor);
  }
  if (options?.mveFilter) {
    params.set("mve_filter", options.mveFilter);
  }

  const payload = await fetchJson("/markets", params);
  const record = asRecord(payload);
  if (!Array.isArray(record?.markets)) {
    throw new Error("Kalshi markets payload must contain a markets array.");
  }

  return record.markets.map((entry) => normalizeMarket(entry));
}

export function resetKalshiServiceCache() {
  kalshiSeriesCache = null;
  kalshiSeriesPromise = null;
}