import { getActiveMemoryFacts, setMemoryFact } from "@/lib/agent/memory/service";
import type { OracleEvidenceBundle } from "@/lib/oracle/evidence";
import type { PolymarketMarket } from "@/lib/polymarket/types";

export const ORACLE_PERSONALITIES = [
  {
    id: "balanced",
    label: "Balanced",
    description: "Neutral and evidence-weighted. Prefer base rates and explicit uncertainty.",
  },
  {
    id: "bullish",
    label: "Bullish",
    description: "Optimistic and momentum-aware. Emphasize upside cases without ignoring risk.",
  },
  {
    id: "skeptical",
    label: "Skeptical",
    description: "Adversarial and downside-aware. Stress weak assumptions and failure paths.",
  },
] as const;

export type OraclePersonalityId = (typeof ORACLE_PERSONALITIES)[number]["id"];

export interface OracleVerdict {
  personality: OraclePersonalityId;
  headline: string;
  summary: string;
  confidence: "low" | "medium" | "high";
}

const PERSONALITY_MAP = new Map(ORACLE_PERSONALITIES.map((personality) => [personality.id, personality]));

function getLeadingOutcome(market: PolymarketMarket): { label: string; price: number } | null {
  const pricedOutcomes = market.outcomes.filter((outcome) => typeof outcome.price === "number") as Array<{ label: string; price: number }>;
  if (pricedOutcomes.length === 0) {
    return null;
  }

  return [...pricedOutcomes].sort((left, right) => right.price - left.price)[0];
}

export function listOraclePersonalities() {
  return ORACLE_PERSONALITIES.map((personality) => ({ ...personality }));
}

export function isOraclePersonalityId(value: string): value is OraclePersonalityId {
  return PERSONALITY_MAP.has(value as OraclePersonalityId);
}

export function getOraclePersonality(id: OraclePersonalityId) {
  const personality = PERSONALITY_MAP.get(id);
  if (!personality) {
    throw new Error(`Unknown Oracle personality '${id}'.`);
  }
  return personality;
}

export async function getStoredOraclePersonality(userId: string): Promise<OraclePersonalityId | null> {
  const facts = await getActiveMemoryFacts({
    userId,
    keys: ["oracle_bot_personality"],
  });
  const value = facts[0]?.value;
  if (typeof value !== "string" || !isOraclePersonalityId(value)) {
    return null;
  }
  return value;
}

export async function resolveOraclePersonality(userId: string, preferred?: string): Promise<OraclePersonalityId> {
  if (preferred && isOraclePersonalityId(preferred)) {
    return preferred;
  }

  return (await getStoredOraclePersonality(userId)) ?? "balanced";
}

export async function storeOraclePersonality(userId: string, personality: OraclePersonalityId) {
  return setMemoryFact({
    userId,
    category: "operator_setting",
    key: "oracle_bot_personality",
    value: personality,
    source: "user",
  });
}

export function buildOracleVerdict(market: PolymarketMarket, personality: OraclePersonalityId): OracleVerdict {
  const leader = getLeadingOutcome(market);
  const leaderText = leader ? `${leader.label} at ${(leader.price * 100).toFixed(1)}%` : "No priced outcome available";
  const dateText = market.endDate ? `Resolution window ends ${market.endDate}.` : "Resolution timing is not clearly published.";

  switch (personality) {
    case "bullish":
      return {
        personality,
        headline: `${market.question} leans toward ${leaderText}`,
        summary: `Momentum view: ${leaderText}. ${dateText} Upside framing matters here, but volume and liquidity still need confirmation before treating this as conviction rather than chatter.`,
        confidence: leader && leader.price >= 0.7 ? "high" : leader && leader.price >= 0.58 ? "medium" : "low",
      };
    case "skeptical":
      return {
        personality,
        headline: `${market.question} still has room to break against consensus`,
        summary: `Skeptical view: ${leaderText}. ${dateText} The current leader may simply reflect crowd positioning. Look for thin liquidity, event-path dependence, and reasons the market could be overpricing certainty.`,
        confidence: leader && leader.price >= 0.8 ? "medium" : "low",
      };
    case "balanced":
      return {
        personality,
        headline: `${market.question} currently prices ${leaderText}`,
        summary: `Balanced view: ${leaderText}. ${dateText} Treat this as a live implied probability, not truth. Combine market pricing with external evidence before acting.`,
        confidence: leader && leader.price >= 0.68 ? "medium" : "low",
      };
  }
}

function formatProbability(probability: number | null): string {
  return probability === null ? "n/a" : `${(probability * 100).toFixed(1)}%`;
}

export function formatOracleEvidencePacket(bundle: OracleEvidenceBundle, personality: OraclePersonalityId): string {
  const selectedPersonality = getOraclePersonality(personality);
  const evidenceLines = bundle.allCandidates.slice(0, 3).map((candidate, index) => {
    return `${index + 1}. [${candidate.market.source}] ${candidate.market.title} | aligned odds ${formatProbability(candidate.targetAlignedProbability)} | relevance ${candidate.relevanceScore.toFixed(2)} | sentiment ${candidate.sentimentLabel}`;
  });
  const sourceBlendLine = bundle.sourceProbabilities.length > 0
    ? bundle.sourceProbabilities.map((source) => `${source.source} ${formatProbability(source.probability)} (${source.candidateCount} candidate${source.candidateCount === 1 ? "" : "s"})`).join(" | ")
    : "n/a";

  return [
    `Oracle personality: ${selectedPersonality.label}`,
    `Personality guidance: ${selectedPersonality.description}`,
    `User prompt: ${bundle.target.rawPrompt}`,
    `Canonical target: ${bundle.target.canonicalQuestion}`,
    `Evidence mode: ${bundle.evidenceMode}`,
    `Implied probability: ${formatProbability(bundle.inferredProbability)}`,
    `Source blend: ${sourceBlendLine}`,
    `Source agreement: ${bundle.sourceBlend.agreement}${bundle.sourceBlend.spread !== null ? ` (spread ${(bundle.sourceBlend.spread * 100).toFixed(1)} pts)` : ""}`,
    `Market sentiment: ${bundle.overallSentiment}`,
    `Confidence: ${bundle.confidence}`,
    "Top evidence:",
    ...evidenceLines,
    "Instruction: Write a short Oracle prediction grounded only in this market evidence. Treat odds as sentiment and implied probability, not certainty. If evidence mode is adjacent_inference, say the prediction uses adjacent markets rather than an exact market. If evidence mode is no_useful_match, treat the absence of active multi-market support as a weak negative signal against the target and still produce a themed prediction with low confidence.",
  ].join("\n");
}

export function buildOracleFallbackReply(bundle: OracleEvidenceBundle, personality: OraclePersonalityId): string {
  const selectedPersonality = getOraclePersonality(personality);
  const probabilityText = formatProbability(bundle.inferredProbability);

  if (bundle.evidenceMode === "no_useful_match") {
    return `Oracle sees no active multi-market support for ${bundle.target.canonicalQuestion}. ${selectedPersonality.label} mode treats that absence as a weak negative signal against the target. Implied probability: ${probabilityText}. Confidence: ${bundle.confidence}.`;
  }

  const framing = bundle.evidenceMode === "exact_market"
    ? "Oracle found an exact market for this target."
    : "Oracle is inferring from adjacent markets for this target.";

  return `${framing} Implied probability: ${probabilityText}. Sentiment: ${bundle.overallSentiment}. Confidence: ${bundle.confidence}.`;
}