/**
 * oracle/verdict.ts — LLM-driven Oracle verdict generation.
 *
 * Produces a structured verdict from evidence + personality using the active LLM.
 * The result schema is designed to power both the chat narration and the Sidecar panel.
 */

import { chatComplete } from "@/lib/agent/kernel";
import type { OracleEvidenceBundle } from "@/lib/oracle/evidence";
import type { OracleSwarmEvidenceBundle } from "@/lib/oracle/swarm";
import { getOraclePersonality, type OraclePersonalityId } from "@/lib/polymarket/personality";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OracleLLMVerdict {
  personality: OraclePersonalityId;
  headline: string;
  summary: string;
  calibratedProbability: number | null;
  confidence: "low" | "medium" | "high";
  keyDrivers: string[];
  risks: string[];
  disconfirmingEvidence: string[];
  sourcesUsed: string[];
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function formatProbability(p: number | null): string {
  return p === null ? "unavailable" : `${(p * 100).toFixed(1)}%`;
}

function buildVerdictSystemPrompt(personalityId: OraclePersonalityId): string {
  const personality = getOraclePersonality(personalityId);
  return [
    "You are the Oracle, a precision prediction analyst.",
    `Your active lens is: ${personality.label} — ${personality.lensPrompt}`,
    "",
    "Produce a JSON verdict object with these exact fields:",
    "  headline: string — one punchy sentence summarizing the verdict",
    "  summary: string — 2-3 sentences of analytical prose",
    "  calibratedProbability: number | null — your best estimate 0-1, null if insufficient evidence",
    "  confidence: 'low' | 'medium' | 'high'",
    "  keyDrivers: string[] — up to 4 bullet strings supporting the verdict",
    "  risks: string[] — up to 3 factors that could invalidate it",
    "  disconfirmingEvidence: string[] — up to 2 pieces of evidence that cut against the verdict",
    "  sourcesUsed: string[] — list of market titles or sources referenced",
    "",
    "Respond with ONLY a JSON object. No markdown, no explanation outside the JSON.",
  ].join("\n");
}

function buildVerdictUserMessage(
  evidence: OracleEvidenceBundle,
  swarmBundle: OracleSwarmEvidenceBundle | null,
): string {
  const lines: string[] = [
    `Prediction target: ${evidence.target.canonicalQuestion}`,
    `Evidence mode: ${evidence.evidenceMode}`,
    `Implied probability (market): ${formatProbability(evidence.inferredProbability)}`,
    `Source agreement: ${evidence.sourceBlend.agreement}`,
    `Overall sentiment: ${evidence.overallSentiment}`,
    `Confidence tier: ${evidence.confidence}`,
    "",
    "Top market candidates:",
  ];

  for (const candidate of evidence.allCandidates.slice(0, 5)) {
    lines.push(
      `- [${candidate.market.source}] ${candidate.market.title} | aligned ${formatProbability(candidate.targetAlignedProbability)} | relevance ${candidate.relevanceScore.toFixed(2)} | ${candidate.sentimentLabel}`,
    );
  }

  if (swarmBundle && swarmBundle.webResearch.length > 0) {
    lines.push("", "Adjacent market research:");
    for (const result of swarmBundle.webResearch) {
      for (const snippet of result.snippets.slice(0, 2)) {
        lines.push(`- ${snippet.title}: ${snippet.excerpt.slice(0, 150)}`);
      }
    }
  }

  if (swarmBundle && swarmBundle.trendSignals.length > 0) {
    lines.push("", "Kalshi conviction signals:");
    for (const signal of swarmBundle.trendSignals) {
      lines.push(`- ${signal.excerpt} (direction: ${signal.trendDirection}, interest: ${signal.interestLevel})`);
    }
  }

  if (swarmBundle && swarmBundle.evidenceGaps.length > 0) {
    lines.push("", "Evidence gaps:");
    for (const gap of swarmBundle.evidenceGaps) {
      lines.push(`- ${gap.lane}: ${gap.reason}`);
    }
  }

  lines.push("", "Produce a structured JSON verdict based on this evidence.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Verdict parser
// ---------------------------------------------------------------------------

function parseVerdictResponse(raw: string, personalityId: OraclePersonalityId): OracleLLMVerdict {
  let parsed: Record<string, unknown>;
  try {
    // Strip optional markdown code fences
    const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    parsed = JSON.parse(clean) as Record<string, unknown>;
  } catch {
    // If the model returned malformed JSON, return a fallback
    return {
      personality: personalityId,
      headline: "Oracle could not produce a structured verdict",
      summary: raw.slice(0, 300),
      calibratedProbability: null,
      confidence: "low",
      keyDrivers: [],
      risks: [],
      disconfirmingEvidence: [],
      sourcesUsed: [],
    };
  }

  const safeStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string").slice(0, 5);
  };

  const rawProb = parsed.calibratedProbability;
  let calibratedProbability: number | null = null;
  if (typeof rawProb === "number" && rawProb >= 0 && rawProb <= 1) {
    calibratedProbability = Number(rawProb.toFixed(4));
  }

  const rawConfidence = parsed.confidence;
  const confidence: OracleLLMVerdict["confidence"] =
    rawConfidence === "low" || rawConfidence === "medium" || rawConfidence === "high"
      ? rawConfidence
      : "low";

  return {
    personality: personalityId,
    headline: typeof parsed.headline === "string" ? parsed.headline.slice(0, 300) : "No headline",
    summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 800) : "",
    calibratedProbability,
    confidence,
    keyDrivers: safeStringArray(parsed.keyDrivers),
    risks: safeStringArray(parsed.risks),
    disconfirmingEvidence: safeStringArray(parsed.disconfirmingEvidence),
    sourcesUsed: safeStringArray(parsed.sourcesUsed),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build an LLM-driven Oracle verdict from the evidence bundle.
 * Falls back gracefully if the LLM call fails.
 */
export async function buildLLMOracleVerdict(
  evidence: OracleEvidenceBundle,
  personalityId: OraclePersonalityId,
  swarmBundle: OracleSwarmEvidenceBundle | null = null,
): Promise<OracleLLMVerdict> {
  try {
    const response = await chatComplete(
      [
        { role: "system", content: buildVerdictSystemPrompt(personalityId) },
        { role: "user", content: buildVerdictUserMessage(evidence, swarmBundle) },
      ],
      undefined,
      undefined,
    );
    return parseVerdictResponse(response.content, personalityId);
  } catch {
    return {
      personality: personalityId,
      headline: evidence.target.canonicalQuestion,
      summary: `Oracle analysis: ${evidence.summaryPacket.slice(0, 200)}`,
      calibratedProbability: evidence.inferredProbability,
      confidence: evidence.confidence,
      keyDrivers: [],
      risks: [],
      disconfirmingEvidence: [],
      sourcesUsed: evidence.allCandidates.slice(0, 3).map((c) => c.market.title),
    };
  }
}
