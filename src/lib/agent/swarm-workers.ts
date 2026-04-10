import type { SwarmWorkItem } from "@/lib/swarm/types";

export interface ChatSwarmClaim {
  text: string;
  evidenceRef: string;
}

export interface ChatSwarmContradiction {
  leftSourceId: string;
  rightSourceId: string;
  summary: string;
  evidenceRefs: string[];
}

export interface ChatSwarmSourceFinding {
  sourceId: string;
  sourceKind: string;
  summary: string;
  claims: ChatSwarmClaim[];
  evidenceRefs: string[];
  gaps: string[];
}

export interface ChatSwarmAuditResult {
  passed: boolean;
  unsupportedSentences: string[];
  contradictionReminderMissing: boolean;
  evidenceCoverage: number;
  summary: string;
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "in", "is", "it", "of", "on", "or", "that", "the", "to", "was", "were", "with", "this", "these", "those", "but", "into", "than", "then", "their", "there", "about",
]);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function tokenizeSentences(value: string): string[] {
  return value
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((entry) => normalizeWhitespace(entry))
    .filter(Boolean);
}

function extractKeywords(value: string): string[] {
  return normalizeWhitespace(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function summarizeSourceText(text: string, maxChars: number): string {
  const sentences = tokenizeSentences(text);
  const summary = sentences.slice(0, 2).join(" ");
  if (!summary) {
    return normalizeWhitespace(text).slice(0, maxChars);
  }
  return summary.length <= maxChars ? summary : `${summary.slice(0, Math.max(0, maxChars - 3))}...`;
}

function extractClaims(text: string, sourceId: string, maxClaims = 4): ChatSwarmClaim[] {
  const sentences = tokenizeSentences(text)
    .filter((sentence) => sentence.length >= 24)
    .slice(0, maxClaims);

  return sentences.map((sentence, index) => ({
    text: sentence,
    evidenceRef: `${sourceId}#claim_${index + 1}`,
  }));
}

export async function executeChatSwarmWorkItem(workItem: SwarmWorkItem): Promise<Record<string, unknown>> {
  const sourceText = typeof workItem.payload.sourceText === "string" ? workItem.payload.sourceText : "";
  const sourceKind = typeof workItem.payload.sourceKind === "string" ? workItem.payload.sourceKind : workItem.sourceKind;
  const maxOutputChars = workItem.constraints.maxOutputChars ?? 320;

  switch (workItem.type) {
    case "source_summary":
      return {
        sourceId: workItem.sourceId,
        sourceKind,
        summary: summarizeSourceText(sourceText, maxOutputChars),
      };
    case "source_claim_extraction": {
      const claims = extractClaims(sourceText, workItem.sourceId);
      return {
        sourceId: workItem.sourceId,
        sourceKind,
        claims,
        evidenceRefs: claims.map((claim) => claim.evidenceRef),
      };
    }
    default:
      throw new Error(`Unsupported chat swarm work item: ${workItem.type}`);
  }
}

function stripNegationTokens(tokens: string[]): string[] {
  return tokens.filter((token) => token !== "not" && token !== "no" && token !== "never" && token !== "without");
}

function hasNegation(value: string): boolean {
  return /\b(?:not|no|never|without)\b/i.test(value);
}

function findContradictions(findings: ChatSwarmSourceFinding[]): ChatSwarmContradiction[] {
  const contradictions: ChatSwarmContradiction[] = [];

  for (let leftIndex = 0; leftIndex < findings.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < findings.length; rightIndex += 1) {
      const left = findings[leftIndex];
      const right = findings[rightIndex];

      for (const leftClaim of left.claims) {
        for (const rightClaim of right.claims) {
          const leftTokens = stripNegationTokens(extractKeywords(leftClaim.text));
          const rightTokens = stripNegationTokens(extractKeywords(rightClaim.text));
          const overlap = leftTokens.filter((token) => rightTokens.includes(token));
          if (overlap.length < 2) {
            continue;
          }
          if (hasNegation(leftClaim.text) === hasNegation(rightClaim.text)) {
            continue;
          }

          contradictions.push({
            leftSourceId: left.sourceId,
            rightSourceId: right.sourceId,
            summary: `Potential contradiction between ${left.sourceId} and ${right.sourceId} around: ${overlap.slice(0, 4).join(", ")}.`,
            evidenceRefs: [leftClaim.evidenceRef, rightClaim.evidenceRef],
          });
        }
      }
    }
  }

  return contradictions;
}

export function buildChatSwarmSynthesisPacket(findings: ChatSwarmSourceFinding[], auditRequested: boolean): {
  summaries: Array<{ sourceId: string; sourceKind: string; summary: string }>;
  claims: ChatSwarmClaim[];
  contradictions: ChatSwarmContradiction[];
  evidenceRefs: string[];
  sourceCoverage: Array<{ sourceId: string; sourceKind: string; claimCount: number; summaryPresent: boolean }>;
  gaps: string[];
  auditNeeded: boolean;
} {
  const claims = findings.flatMap((finding) => finding.claims);
  const contradictions = findContradictions(findings);
  const evidenceRefs = Array.from(new Set(claims.map((claim) => claim.evidenceRef)));
  const gaps = findings.flatMap((finding) => finding.gaps);

  return {
    summaries: findings.map((finding) => ({
      sourceId: finding.sourceId,
      sourceKind: finding.sourceKind,
      summary: finding.summary,
    })),
    claims,
    contradictions,
    evidenceRefs,
    sourceCoverage: findings.map((finding) => ({
      sourceId: finding.sourceId,
      sourceKind: finding.sourceKind,
      claimCount: finding.claims.length,
      summaryPresent: Boolean(finding.summary),
    })),
    gaps,
    auditNeeded: auditRequested || contradictions.length > 0 || findings.length >= 4,
  };
}

function splitDraftSentences(draft: string): string[] {
  return tokenizeSentences(draft).filter((sentence) => sentence.length >= 18);
}

function sentenceHasEvidenceOverlap(sentence: string, supportedTexts: string[]): boolean {
  const sentenceTokens = extractKeywords(sentence);
  if (sentenceTokens.length === 0) {
    return true;
  }

  return supportedTexts.some((supportedText) => {
    const supportedTokens = extractKeywords(supportedText);
    const overlap = sentenceTokens.filter((token) => supportedTokens.includes(token));
    return overlap.length >= 2;
  });
}

export function auditChatSwarmDraft(args: {
  draft: string;
  findings: ChatSwarmSourceFinding[];
  contradictions: ChatSwarmContradiction[];
}): ChatSwarmAuditResult {
  const supportedTexts = [
    ...args.findings.map((finding) => finding.summary),
    ...args.findings.flatMap((finding) => finding.claims.map((claim) => claim.text)),
  ].filter(Boolean);
  const draftSentences = splitDraftSentences(args.draft);
  const unsupportedSentences = draftSentences.filter((sentence) => !sentenceHasEvidenceOverlap(sentence, supportedTexts));
  const contradictionReminderMissing = args.contradictions.length > 0 && !/\b(?:contradiction|conflict|however|disagree|inconsistent)\b/i.test(args.draft);
  const evidenceCoverage = draftSentences.length === 0
    ? 1
    : (draftSentences.length - unsupportedSentences.length) / draftSentences.length;
  const passed = unsupportedSentences.length === 0 && !contradictionReminderMissing;

  return {
    passed,
    unsupportedSentences,
    contradictionReminderMissing,
    evidenceCoverage,
    summary: passed
      ? "Draft aligned with swarm evidence."
      : contradictionReminderMissing
        ? "Draft omitted a contradiction reminder despite conflicting source findings."
        : "Draft contains sentences that are not well-supported by the swarm evidence.",
  };
}