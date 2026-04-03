export interface OraclePredictionIntent {
  matched: boolean;
  query: string;
}

const ORACLE_MATCHER = /\boracle\b/i;
const PREDICTION_MATCHER = /\bpredict(?:ion|ions)?\b/i;

export function getOraclePredictionIntent(message: string): OraclePredictionIntent {
  const trimmed = message.trim();
  const matched = ORACLE_MATCHER.test(trimmed) && PREDICTION_MATCHER.test(trimmed);

  if (!matched) {
    return { matched: false, query: "" };
  }

  const query = trimmed
    .replace(/\boracle\b/gi, " ")
    .replace(/\bpredictions?\b/gi, " ")
    .replace(/\bpredict\b/gi, " ")
    .replace(/\b(can|could|would|should|please|about|for|on|me|us|the|a|an|your|you)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    matched: true,
    query: query || trimmed,
  };
}
