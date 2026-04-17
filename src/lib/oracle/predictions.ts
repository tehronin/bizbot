import type { JsonValue } from "@/lib/agent/tools";
import { db } from "@/lib/db";
import type { OraclePredictionTarget } from "@/lib/oracle/intent";
import type { OracleLLMVerdict } from "@/lib/oracle/verdict";
import type { OracleEvidenceGap } from "@/lib/oracle/swarm";
import type { OraclePersonalityId } from "@/lib/polymarket/personality";

const MAX_PREDICTION_LIST_LIMIT = 50;

export interface OraclePredictionRecord {
  id: string;
  userId: string;
  conversationId: string | null;
  rawPrompt: string;
  normalizedPrompt: string;
  canonicalQuestion: string;
  asset: string | null;
  personality: string;
  isWatched: boolean;
  analysisCount: number;
  lastEvidenceMode: string | null;
  lastImpliedProbability: number | null;
  lastCalibratedProbability: number | null;
  lastConfidence: string | null;
  lastSentiment: string | null;
  lastHeadline: string | null;
  lastSummary: string | null;
  lastSummaryPacket: string | null;
  lastSourceBlend: JsonValue | null;
  lastEvidenceGaps: JsonValue | null;
  lastVerdict: JsonValue | null;
  lastAnalyzedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersistOraclePredictionInput {
  userId: string;
  conversationId?: string | null;
  target: OraclePredictionTarget;
  personality: OraclePersonalityId;
  evidenceMode: string;
  impliedProbability: number | null;
  calibratedProbability: number | null;
  confidence: string;
  sentiment: string;
  headline: string | null;
  summary: string | null;
  summaryPacket: string;
  sourceBlend: JsonValue;
  evidenceGaps: OracleEvidenceGap[];
  verdict: OracleLLMVerdict | Record<string, unknown> | null;
  isWatched?: boolean;
}

export interface ListOraclePredictionsParams {
  userId: string;
  watchedOnly?: boolean;
  limit?: number;
}

function toOraclePredictionRecord(prediction: {
  id: string;
  userId: string;
  conversationId: string | null;
  rawPrompt: string;
  normalizedPrompt: string;
  canonicalQuestion: string;
  asset: string | null;
  personality: string;
  isWatched: boolean;
  analysisCount: number;
  lastEvidenceMode: string | null;
  lastImpliedProbability: number | null;
  lastCalibratedProbability: number | null;
  lastConfidence: string | null;
  lastSentiment: string | null;
  lastHeadline: string | null;
  lastSummary: string | null;
  lastSummaryPacket: string | null;
  lastSourceBlend: unknown;
  lastEvidenceGaps: unknown;
  lastVerdict: unknown;
  lastAnalyzedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): OraclePredictionRecord {
  return {
    id: prediction.id,
    userId: prediction.userId,
    conversationId: prediction.conversationId,
    rawPrompt: prediction.rawPrompt,
    normalizedPrompt: prediction.normalizedPrompt,
    canonicalQuestion: prediction.canonicalQuestion,
    asset: prediction.asset,
    personality: prediction.personality,
    isWatched: prediction.isWatched,
    analysisCount: prediction.analysisCount,
    lastEvidenceMode: prediction.lastEvidenceMode,
    lastImpliedProbability: prediction.lastImpliedProbability,
    lastCalibratedProbability: prediction.lastCalibratedProbability,
    lastConfidence: prediction.lastConfidence,
    lastSentiment: prediction.lastSentiment,
    lastHeadline: prediction.lastHeadline,
    lastSummary: prediction.lastSummary,
    lastSummaryPacket: prediction.lastSummaryPacket,
    lastSourceBlend: prediction.lastSourceBlend as JsonValue | null,
    lastEvidenceGaps: prediction.lastEvidenceGaps as JsonValue | null,
    lastVerdict: prediction.lastVerdict as JsonValue | null,
    lastAnalyzedAt: prediction.lastAnalyzedAt?.toISOString() ?? null,
    createdAt: prediction.createdAt.toISOString(),
    updatedAt: prediction.updatedAt.toISOString(),
  };
}

async function ensureUserExists(userId: string): Promise<void> {
  await db.user.upsert({
    where: { id: userId },
    create: { id: userId, name: "User" },
    update: {},
  });
}

export async function persistOraclePrediction(input: PersistOraclePredictionInput): Promise<OraclePredictionRecord> {
  await ensureUserExists(input.userId);

  const prediction = await db.oraclePrediction.upsert({
    where: {
      userId_canonicalQuestion: {
        userId: input.userId,
        canonicalQuestion: input.target.canonicalQuestion,
      },
    },
    create: {
      userId: input.userId,
      conversationId: input.conversationId ?? null,
      rawPrompt: input.target.rawPrompt,
      normalizedPrompt: input.target.normalizedPrompt,
      canonicalQuestion: input.target.canonicalQuestion,
      asset: input.target.asset ?? null,
      personality: input.personality,
      isWatched: input.isWatched ?? false,
      analysisCount: 1,
      lastEvidenceMode: input.evidenceMode,
      lastImpliedProbability: input.impliedProbability,
      lastCalibratedProbability: input.calibratedProbability,
      lastConfidence: input.confidence,
      lastSentiment: input.sentiment,
      lastHeadline: input.headline,
      lastSummary: input.summary,
      lastSummaryPacket: input.summaryPacket,
      lastSourceBlend: input.sourceBlend as never,
      lastEvidenceGaps: input.evidenceGaps as never,
      lastVerdict: input.verdict as never,
      lastAnalyzedAt: new Date(),
    },
    update: {
      conversationId: input.conversationId ?? null,
      rawPrompt: input.target.rawPrompt,
      normalizedPrompt: input.target.normalizedPrompt,
      asset: input.target.asset ?? null,
      personality: input.personality,
      analysisCount: { increment: 1 },
      lastEvidenceMode: input.evidenceMode,
      lastImpliedProbability: input.impliedProbability,
      lastCalibratedProbability: input.calibratedProbability,
      lastConfidence: input.confidence,
      lastSentiment: input.sentiment,
      lastHeadline: input.headline,
      lastSummary: input.summary,
      lastSummaryPacket: input.summaryPacket,
      lastSourceBlend: input.sourceBlend as never,
      lastEvidenceGaps: input.evidenceGaps as never,
      lastVerdict: input.verdict as never,
      lastAnalyzedAt: new Date(),
      ...(input.isWatched ? { isWatched: true } : {}),
    },
  });

  return toOraclePredictionRecord(prediction);
}

export async function listOraclePredictions(params: ListOraclePredictionsParams): Promise<OraclePredictionRecord[]> {
  const predictions = await db.oraclePrediction.findMany({
    where: {
      userId: params.userId,
      ...(params.watchedOnly ? { isWatched: true } : {}),
    },
    orderBy: [{ updatedAt: "desc" }],
    take: Math.max(1, Math.min(params.limit ?? 10, MAX_PREDICTION_LIST_LIMIT)),
  });

  return predictions.map((prediction) => toOraclePredictionRecord(prediction));
}
