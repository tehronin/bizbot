export const USAGE_LEDGER_MODEL_PRICING_SETTING_KEY = "usage_ledger_model_pricing";

export interface UsageLedgerModelPricing {
  promptUsdPerMillion: number;
  completionUsdPerMillion: number;
}

const DEFAULT_MODEL_PRICING: Record<string, UsageLedgerModelPricing> = {
  "gemini-3-flash-preview": { promptUsdPerMillion: 0.5, completionUsdPerMillion: 3 },
  "gemini-2.5-flash": { promptUsdPerMillion: 0.3, completionUsdPerMillion: 2.5 },
  "gpt-4o": { promptUsdPerMillion: 5, completionUsdPerMillion: 15 },
  "claude-3-5-sonnet-20241022": { promptUsdPerMillion: 3, completionUsdPerMillion: 15 },
  "MiniMax-M2.7": { promptUsdPerMillion: 0.3, completionUsdPerMillion: 1.2 },
  "MiniMax-M2.7-highspeed": { promptUsdPerMillion: 0.6, completionUsdPerMillion: 2.4 },
  "MiniMax-M2.5": { promptUsdPerMillion: 0.3, completionUsdPerMillion: 1.2 },
  "MiniMax-M2.5-highspeed": { promptUsdPerMillion: 0.6, completionUsdPerMillion: 2.4 },
  "M2-her": { promptUsdPerMillion: 0.3, completionUsdPerMillion: 1.2 },
  "abab6.5s-chat": { promptUsdPerMillion: 1.1, completionUsdPerMillion: 8 },
  "gemma3": { promptUsdPerMillion: 0, completionUsdPerMillion: 0 },
};

const PROVIDER_FALLBACK_PRICING: Record<string, UsageLedgerModelPricing> = {
  google: { promptUsdPerMillion: 0.5, completionUsdPerMillion: 3 },
  openai: { promptUsdPerMillion: 5, completionUsdPerMillion: 15 },
  anthropic: { promptUsdPerMillion: 3, completionUsdPerMillion: 15 },
  minimax: { promptUsdPerMillion: 0.3, completionUsdPerMillion: 1.2 },
  ollama: { promptUsdPerMillion: 0, completionUsdPerMillion: 0 },
};

function normalizePricingRecord(value: unknown): UsageLedgerModelPricing | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const promptUsdPerMillion = Number.parseFloat(String((value as Record<string, unknown>).promptUsdPerMillion ?? "0"));
  const completionUsdPerMillion = Number.parseFloat(String((value as Record<string, unknown>).completionUsdPerMillion ?? "0"));

  return {
    promptUsdPerMillion: Number.isFinite(promptUsdPerMillion) && promptUsdPerMillion >= 0 ? promptUsdPerMillion : 0,
    completionUsdPerMillion: Number.isFinite(completionUsdPerMillion) && completionUsdPerMillion >= 0 ? completionUsdPerMillion : 0,
  };
}

export function getDefaultUsageLedgerModelPricing(model: string, provider?: string): UsageLedgerModelPricing {
  return DEFAULT_MODEL_PRICING[model]
    ?? (provider ? PROVIDER_FALLBACK_PRICING[provider] : undefined)
    ?? { promptUsdPerMillion: 0, completionUsdPerMillion: 0 };
}

export function getResolvedUsageLedgerModelPricing(
  model: string,
  provider?: string,
  pricingByModel?: Record<string, UsageLedgerModelPricing>,
): UsageLedgerModelPricing {
  return pricingByModel?.[model] ?? getDefaultUsageLedgerModelPricing(model, provider);
}

export function parseUsageLedgerModelPricingSetting(value: string | null | undefined): Record<string, UsageLedgerModelPricing> {
  if (!value || value.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const normalizedEntries = Object.entries(parsed)
      .map(([model, pricing]) => {
        const normalized = normalizePricingRecord(pricing);
        return normalized ? [model, normalized] as const : null;
      })
      .filter((entry): entry is readonly [string, UsageLedgerModelPricing] => entry !== null);

    return Object.fromEntries(normalizedEntries);
  } catch {
    return {};
  }
}

export function serializeUsageLedgerModelPricingSetting(pricingByModel: Record<string, UsageLedgerModelPricing>): string {
  const normalizedEntries = Object.entries(pricingByModel)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([model, pricing]) => [model, normalizePricingRecord(pricing) ?? { promptUsdPerMillion: 0, completionUsdPerMillion: 0 }] as const);

  return JSON.stringify(Object.fromEntries(normalizedEntries));
}