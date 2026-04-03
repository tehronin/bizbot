export interface OraclePredictionTarget {
  rawPrompt: string;
  normalizedPrompt: string;
  asset?: string;
  assetAliases: string[];
  direction?: "over" | "under" | "above" | "below" | "hit" | "miss";
  thresholdValue?: number;
  thresholdUnit?: "usd" | "percent" | "points";
  timeframeText?: string;
  timeframeStart?: string;
  timeframeEnd?: string;
  canonicalQuestion: string;
  searchQueries: string[];
}

export interface OraclePredictionIntent {
  matched: boolean;
  query: string;
  target?: OraclePredictionTarget;
}

export interface OracleIntentOptions {
  referenceDate?: Date;
}

const ORACLE_MATCHER = /\boracle\b/i;
const PREDICTION_MATCHER = /\bpredict(?:ion|ions)?\b/i;
const ASSET_ALIASES: Record<string, string[]> = {
  BTC: ["btc", "bitcoin"],
  ETH: ["eth", "ethereum"],
  SOL: ["sol", "solana"],
};
const MONTH_LOOKUP = new Map([
  ["january", 0], ["jan", 0],
  ["february", 1], ["feb", 1],
  ["march", 2], ["mar", 2],
  ["april", 3], ["apr", 3],
  ["may", 4],
  ["june", 5], ["jun", 5],
  ["july", 6], ["jul", 6],
  ["august", 7], ["aug", 7],
  ["september", 8], ["sep", 8], ["sept", 8],
  ["october", 9], ["oct", 9],
  ["november", 10], ["nov", 10],
  ["december", 11], ["dec", 11],
]);
const ORACLE_FILLER_PATTERNS = [
  /\boracle(?:\s+bot)?\b/gi,
  /\bpredictions?\b/gi,
  /\bpredict\b/gi,
  /\b(?:can|could|would|should|will)\s+you\b/gi,
  /\bdo\s+you\s+think\b/gi,
  /\b(?:give|show|run|make)\s+me\b/gi,
  /\b(?:please|just|maybe|kindly)\b/gi,
  /\b(?:for\s+me|for\s+us|to\s+me|to\s+us)\b/gi,
  /\b(?:right\s+now|at\s+the\s+moment|this\s+year|this\s+month|this\s+week|today)\b/gi,
  /\b(?:about|regarding)\b/gi,
  /\b(?:the|a|an|your|you|me|us)\b/gi,
];

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatThreshold(value: number, unit: OraclePredictionTarget["thresholdUnit"]): string {
  if (unit === "percent") {
    return `${value}%`;
  }

  if (unit === "usd") {
    if (value >= 1000) {
      return `${Number.isInteger(value / 1000) ? value / 1000 : (value / 1000).toFixed(1)}k`;
    }
  }

  return `${value}`;
}

function parseCompactNumber(raw: string): number | undefined {
  const normalized = raw.replace(/,/g, "").trim().toLowerCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)(k|m|b)?$/i);
  if (!match) {
    return undefined;
  }

  const base = Number(match[1]);
  if (!Number.isFinite(base)) {
    return undefined;
  }

  const suffix = match[2]?.toLowerCase();
  const multiplier = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : suffix === "b" ? 1_000_000_000 : 1;
  return base * multiplier;
}

function detectAsset(message: string): { asset?: string; aliases: string[] } {
  const lower = message.toLowerCase();
  for (const [asset, aliases] of Object.entries(ASSET_ALIASES)) {
    if (aliases.some((alias) => new RegExp(`\\b${alias}\\b`, "i").test(lower))) {
      return { asset, aliases };
    }
  }

  return { asset: undefined, aliases: [] };
}

function detectDirection(message: string): OraclePredictionTarget["direction"] | undefined {
  if (/\b(over|above)\b/i.test(message)) return "over";
  if (/\b(under|below)\b/i.test(message)) return "under";
  if (/\b(hit|reach)\b/i.test(message)) return "hit";
  if (/\bmiss\b/i.test(message)) return "miss";
  return undefined;
}

function detectThreshold(message: string): Pick<OraclePredictionTarget, "thresholdValue" | "thresholdUnit"> {
  const moneyMatch = message.match(/\b(?:over|above|under|below|to|hit|reach)?\s*\$?(\d+(?:,\d{3})*(?:\.\d+)?[kmb]?)\b/i);
  if (!moneyMatch) {
    return {};
  }

  const thresholdValue = parseCompactNumber(moneyMatch[1]);
  if (thresholdValue === undefined) {
    return {};
  }

  const thresholdUnit = /%/.test(moneyMatch[0]) ? "percent" : "usd";
  return { thresholdValue, thresholdUnit };
}

function resolveMonthWindow(monthIndex: number, referenceDate: Date): { timeframeStart: string; timeframeEnd: string } {
  const year = monthIndex >= referenceDate.getMonth() ? referenceDate.getFullYear() : referenceDate.getFullYear() + 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  return { timeframeStart: formatIsoDate(start), timeframeEnd: formatIsoDate(end) };
}

function detectTimeframe(message: string, referenceDate: Date): Pick<OraclePredictionTarget, "timeframeText" | "timeframeStart" | "timeframeEnd"> {
  const lower = message.toLowerCase();

  if (/\bthis year\b/.test(lower)) {
    return {
      timeframeText: "this year",
      timeframeStart: `${referenceDate.getFullYear()}-01-01`,
      timeframeEnd: `${referenceDate.getFullYear()}-12-31`,
    };
  }

  const byMonthMatch = lower.match(/\bby\s+([a-z]+)\b/);
  if (byMonthMatch) {
    const monthIndex = MONTH_LOOKUP.get(byMonthMatch[1]);
    if (monthIndex !== undefined) {
      return {
        timeframeText: `by ${byMonthMatch[1]}`,
        ...resolveMonthWindow(monthIndex, referenceDate),
      };
    }
  }

  return {};
}

function buildCanonicalQuestion(target: {
  asset?: string;
  direction?: OraclePredictionTarget["direction"];
  thresholdValue?: number;
  thresholdUnit?: OraclePredictionTarget["thresholdUnit"];
  timeframeEnd?: string;
  normalizedPrompt: string;
}): string {
  if (!target.asset || target.thresholdValue === undefined) {
    return target.normalizedPrompt;
  }

  const directionText = target.direction === "under" || target.direction === "below"
    ? "trade under"
    : target.direction === "miss"
      ? "miss"
      : target.direction === "hit"
        ? "hit"
        : "trade over";
  const threshold = formatThreshold(target.thresholdValue, target.thresholdUnit);
  const timeframeText = target.timeframeEnd ? ` by ${target.timeframeEnd}` : "";
  return `Will ${target.asset} ${directionText} ${threshold}${timeframeText}?`;
}

function buildSearchQueries(target: OraclePredictionTarget): string[] {
  const queries = new Set<string>();
  const threshold = target.thresholdValue !== undefined ? formatThreshold(target.thresholdValue, target.thresholdUnit) : undefined;
  const year = target.timeframeEnd?.slice(0, 4);
  const baseTerms = target.assetAliases.length > 0 ? target.assetAliases : target.asset ? [target.asset.toLowerCase()] : [];

  queries.add(target.normalizedPrompt);

  for (const alias of baseTerms) {
    if (threshold) {
      queries.add(`${alias} ${threshold}`);
      if (year) {
        queries.add(`${alias} ${threshold} ${year}`);
      }
      if (target.direction) {
        queries.add(`${alias} ${target.direction} ${threshold}`);
      }
    } else {
      queries.add(alias);
    }
  }

  return Array.from(queries).filter((query) => query.trim().length > 0).slice(0, 6);
}

function cleanOracleQuery(message: string): string {
  let cleaned = message.trim();

  for (const pattern of ORACLE_FILLER_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }

  return cleaned
    .replace(/[?!,.;:]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\s*(?:on|for|about|regarding)\s+/i, "")
    .trim();
}

export function parseOraclePredictionTarget(message: string, options?: OracleIntentOptions): OraclePredictionTarget | null {
  const trimmed = message.trim();
  if (!trimmed) {
    return null;
  }

  const normalizedPrompt = cleanOracleQuery(trimmed);
  const referenceDate = options?.referenceDate ?? new Date();
  const { asset, aliases } = detectAsset(trimmed);
  const direction = detectDirection(trimmed);
  const { thresholdValue, thresholdUnit } = detectThreshold(trimmed);
  const timeframe = detectTimeframe(trimmed, referenceDate);
  const target: OraclePredictionTarget = {
    rawPrompt: trimmed,
    normalizedPrompt,
    ...(asset ? { asset } : {}),
    assetAliases: aliases,
    ...(direction ? { direction } : {}),
    ...(thresholdValue !== undefined ? { thresholdValue } : {}),
    ...(thresholdUnit ? { thresholdUnit } : {}),
    ...timeframe,
    canonicalQuestion: "",
    searchQueries: [],
  };

  target.canonicalQuestion = buildCanonicalQuestion(target);
  target.searchQueries = buildSearchQueries(target);
  return target;
}

export function getOraclePredictionIntent(message: string, options?: OracleIntentOptions): OraclePredictionIntent {
  const trimmed = message.trim();
  const matched = ORACLE_MATCHER.test(trimmed) && PREDICTION_MATCHER.test(trimmed);

  if (!matched) {
    return { matched: false, query: "" };
  }

  const query = cleanOracleQuery(trimmed);
  const target = parseOraclePredictionTarget(trimmed, options) ?? undefined;

  return {
    matched: true,
    query: query || trimmed,
    ...(target ? { target } : {}),
  };
}
