import type { OraclePredictionTarget } from "@/lib/oracle/intent";
import type { OracleNormalizedMarket } from "@/lib/oracle/sources";

function normalizeOracleText(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9.%$\s]/g, " ").replace(/\s+/g, " ").trim();
}

function parseCompactNumber(raw: string): number | undefined {
  const normalized = raw.replace(/,/g, "").trim().toLowerCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)(k|m|b)?$/);
  if (!match) {
    return undefined;
  }

  const base = Number(match[1]);
  if (!Number.isFinite(base)) {
    return undefined;
  }

  const suffix = match[2];
  const multiplier = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : suffix === "b" ? 1_000_000_000 : 1;
  return base * multiplier;
}

function extractNumericThresholds(text: string): number[] {
  const matches = text.match(/\$?\d+(?:,\d{3})*(?:\.\d+)?[kmb]?/gi) ?? [];
  return matches
    .map((match) => parseCompactNumber(match.replace(/^\$/, "")))
    .filter((value): value is number => value !== undefined);
}

function scoreAssetMatch(target: OraclePredictionTarget, haystack: string): number {
  if (!target.asset || target.assetAliases.length === 0) {
    return 0;
  }

  return target.assetAliases.some((alias) => new RegExp(`\\b${alias}\\b`, "i").test(haystack)) ? 1 : 0;
}

function scoreThresholdMatch(target: OraclePredictionTarget, haystack: string): number {
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
    return 0;
  }

  const ratio = closest / Math.max(target.thresholdValue, 1);
  if (ratio <= 0.05) return 0.8;
  if (ratio <= 0.15) return 0.6;
  if (ratio <= 0.3) return 0.35;
  return 0;
}

function scoreDirectionMatch(target: OraclePredictionTarget, haystack: string): number {
  if (!target.direction) {
    return 0;
  }

  if (["over", "above", "hit"].includes(target.direction)) {
    if (/\b(over|above|hit|hits|reach|reaches)\b/i.test(haystack)) return 1;
    if (/\bwill .*\b\d/.test(haystack) || /\bby\b/i.test(haystack)) return 0.5;
    return 0;
  }

  if (/\b(under|below|miss|misses)\b/i.test(haystack)) return 1;
  if (/\bwill .*\b\d/.test(haystack) || /\bby\b/i.test(haystack)) return 0.5;
  return 0;
}

function scoreTimeframeMatch(target: OraclePredictionTarget, haystack: string): number {
  if (!target.timeframeEnd) {
    return 0;
  }

  const year = target.timeframeEnd.slice(0, 4);
  if (haystack.includes(year)) {
    return 1;
  }

  const marketYear = haystack.match(/\b(20\d{2})\b/);
  if (!marketYear) {
    return 0.35;
  }

  const difference = Math.abs(Number(marketYear[1]) - Number(year));
  if (difference === 1) return 0.55;
  return 0;
}

function normalizeLiquidity(market: OracleNormalizedMarket): number {
  const raw = market.liquidity ?? market.volume ?? 0;
  if (!raw || raw <= 0) {
    return 0.1;
  }

  return Math.min(1, Math.log10(raw + 1) / 6);
}

export function getOracleTargetAlignedProbability(target: OraclePredictionTarget, market: OracleNormalizedMarket): number | null {
  const marketText = normalizeOracleText(`${market.title} ${market.subtitle ?? ""}`);
  const marketLeansUp = /\b(over|above|hit|hits|reach|reaches)\b/i.test(marketText);
  const marketLeansDown = /\b(under|below|miss|misses)\b/i.test(marketText);
  const targetLeansDown = ["under", "below", "miss"].includes(target.direction ?? "");
  const yesOutcome = market.outcomes.find((outcome) => /^(yes|over|above)$/i.test(outcome.label) && typeof outcome.probability === "number");
  const noOutcome = market.outcomes.find((outcome) => /^(no|under|below)$/i.test(outcome.label) && typeof outcome.probability === "number");

  if (targetLeansDown && marketLeansDown && typeof yesOutcome?.probability === "number") {
    return yesOutcome.probability;
  }

  if (targetLeansDown && marketLeansUp && typeof noOutcome?.probability === "number") {
    return noOutcome.probability;
  }

  if (!targetLeansDown && marketLeansDown && typeof noOutcome?.probability === "number") {
    return noOutcome.probability;
  }

  if (typeof yesOutcome?.probability === "number") {
    return yesOutcome.probability;
  }

  const leading = [...market.outcomes]
    .filter((outcome): outcome is { label: string; probability: number } => typeof outcome.probability === "number")
    .sort((left, right) => right.probability - left.probability)[0];

  return leading?.probability ?? null;
}

export function scoreOracleMarketSignals(target: OraclePredictionTarget, market: OracleNormalizedMarket) {
  const haystack = normalizeOracleText(`${market.title} ${market.subtitle ?? ""} ${market.slug ?? ""}`);
  return {
    asset: scoreAssetMatch(target, haystack),
    threshold: scoreThresholdMatch(target, haystack),
    direction: scoreDirectionMatch(target, haystack),
    timeframe: scoreTimeframeMatch(target, haystack),
    liquidity: normalizeLiquidity(market),
  };
}

export function scoreOracleMarketCandidate(target: OraclePredictionTarget, market: OracleNormalizedMarket): number {
  const signals = scoreOracleMarketSignals(target, market);
  return Number((signals.asset * 0.35
    + signals.threshold * 0.25
    + signals.direction * 0.15
    + signals.timeframe * 0.15
    + signals.liquidity * 0.1).toFixed(4));
}