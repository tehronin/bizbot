import type { PolymarketMarket, PolymarketOutcome, PolymarketSearchResult } from "@/lib/polymarket/types";

const DEFAULT_POLYMARKET_BASE_URL = "https://gamma-api.polymarket.com";

function getBaseUrl(): string {
  return (process.env.BIZBOT_POLYMARKET_BASE_URL ?? DEFAULT_POLYMARKET_BASE_URL).replace(/\/$/, "");
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

function readBoolean(record: Record<string, unknown>, keys: string[], fallback = false): boolean {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return fallback;
}

function normalizeOutcomes(record: Record<string, unknown>): PolymarketOutcome[] {
  const labels = Array.isArray(record.outcomes) ? record.outcomes : Array.isArray(record.outcomeNames) ? record.outcomeNames : [];
  const prices = Array.isArray(record.outcomePrices) ? record.outcomePrices : Array.isArray(record.prices) ? record.prices : [];
  const outcomes: PolymarketOutcome[] = [];

  for (let index = 0; index < labels.length; index += 1) {
    const label = typeof labels[index] === "string" ? labels[index].trim() : "";
    if (!label) {
      continue;
    }
    const rawPrice = prices[index];
    const price = typeof rawPrice === "number"
      ? rawPrice
      : typeof rawPrice === "string" && rawPrice.trim().length > 0
        ? Number(rawPrice)
        : null;

    outcomes.push({
      label,
      price: typeof price === "number" && Number.isFinite(price) ? price : null,
    });
  }

  return outcomes;
}

function normalizeMarket(raw: unknown): PolymarketMarket {
  const record = asRecord(raw);
  if (!record) {
    throw new Error("Polymarket market payload must be an object.");
  }

  const id = readString(record, ["id", "conditionId", "marketId"]);
  const question = readString(record, ["question", "title"]);
  if (!id || !question) {
    throw new Error("Polymarket market payload is missing an id or question.");
  }

  const subtitle = readString(record, ["description", "subtitle"]);
  const slug = readString(record, ["slug"]);
  const endDate = readString(record, ["endDate", "end_date", "endTime"]);
  const volume = readNumber(record, ["volume", "volumeNum", "volume24hr"]);
  const liquidity = readNumber(record, ["liquidity", "liquidityNum"]);
  const url = readString(record, ["url", "marketUrl"]);

  return {
    id,
    question,
    ...(subtitle ? { subtitle } : {}),
    ...(slug ? { slug } : {}),
    active: readBoolean(record, ["active"], true),
    closed: readBoolean(record, ["closed", "isClosed"], false),
    ...(endDate ? { endDate } : {}),
    ...(volume !== undefined ? { volume } : {}),
    ...(liquidity !== undefined ? { liquidity } : {}),
    outcomes: normalizeOutcomes(record),
    ...(url ? { url } : {}),
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
    throw new Error(`Polymarket request failed with status ${response.status}.`);
  }

  return response.json();
}

export async function searchPolymarketMarkets(query: string, limit = 5): Promise<PolymarketSearchResult> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error("Polymarket search query is required.");
  }

  const normalizedLimit = Math.max(1, Math.min(limit, 10));
  const params = new URLSearchParams({
    search: trimmedQuery,
    limit: String(normalizedLimit),
    closed: "false",
  });
  const payload = await fetchJson("/markets", params);
  if (!Array.isArray(payload)) {
    throw new Error("Polymarket search payload must be an array.");
  }

  return {
    query: trimmedQuery,
    markets: payload.slice(0, normalizedLimit).map((entry) => normalizeMarket(entry)),
  };
}

export async function getPolymarketMarket(marketId: string): Promise<PolymarketMarket> {
  const trimmedMarketId = marketId.trim();
  if (!trimmedMarketId) {
    throw new Error("Polymarket market id is required.");
  }

  const payload = await fetchJson(`/markets/${encodeURIComponent(trimmedMarketId)}`);
  return normalizeMarket(payload);
}