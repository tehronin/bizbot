import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userUpsert: vi.fn(),
  oraclePredictionUpsert: vi.fn(),
  oraclePredictionFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      upsert: mocks.userUpsert,
    },
    oraclePrediction: {
      upsert: mocks.oraclePredictionUpsert,
      findMany: mocks.oraclePredictionFindMany,
    },
  },
}));

import { listOraclePredictions, persistOraclePrediction } from "@/lib/oracle/predictions";

describe("oracle prediction persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts a prediction log by user and canonical question", async () => {
    mocks.oraclePredictionUpsert.mockResolvedValue({
      id: "pred-1",
      userId: "user-1",
      conversationId: "conv-1",
      rawPrompt: "Will BTC hit 150k by year end?",
      normalizedPrompt: "will btc hit 150k by year end?",
      canonicalQuestion: "Will BTC hit 150k by 2026-12-31?",
      asset: "BTC",
      personality: "balanced",
      isWatched: false,
      analysisCount: 1,
      lastEvidenceMode: "market_exact",
      lastImpliedProbability: 0.43,
      lastCalibratedProbability: 0.47,
      lastConfidence: "medium",
      lastSentiment: "bullish",
      lastHeadline: "BTC is live but not favored yet.",
      lastSummary: "Markets are constructive but still below a majority probability.",
      lastSummaryPacket: "packet",
      lastSourceBlend: { agreement: "moderate", sources: [] },
      lastEvidenceGaps: [],
      lastVerdict: { headline: "BTC is live but not favored yet." },
      lastAnalyzedAt: new Date("2026-04-17T14:00:00.000Z"),
      createdAt: new Date("2026-04-17T14:00:00.000Z"),
      updatedAt: new Date("2026-04-17T14:00:00.000Z"),
    });

    const record = await persistOraclePrediction({
      userId: "user-1",
      conversationId: "conv-1",
      target: {
        rawPrompt: "Will BTC hit 150k by year end?",
        normalizedPrompt: "will btc hit 150k by year end?",
        asset: "BTC",
        assetAliases: ["btc", "bitcoin"],
        direction: "hit",
        thresholdValue: 150000,
        thresholdUnit: "usd",
        timeframeText: "by year end",
        timeframeEnd: "2026-12-31",
        canonicalQuestion: "Will BTC hit 150k by 2026-12-31?",
        searchQueries: ["btc 150k 2026"],
      },
      personality: "balanced",
      evidenceMode: "market_exact",
      impliedProbability: 0.43,
      calibratedProbability: 0.47,
      confidence: "medium",
      sentiment: "bullish",
      headline: "BTC is live but not favored yet.",
      summary: "Markets are constructive but still below a majority probability.",
      summaryPacket: "packet",
      sourceBlend: { agreement: "moderate", sources: [] },
      evidenceGaps: [],
      verdict: { headline: "BTC is live but not favored yet." },
    });

    expect(mocks.userUpsert).toHaveBeenCalledWith({
      where: { id: "user-1" },
      create: { id: "user-1", name: "User" },
      update: {},
    });
    expect(mocks.oraclePredictionUpsert).toHaveBeenCalledWith({
      where: {
        userId_canonicalQuestion: {
          userId: "user-1",
          canonicalQuestion: "Will BTC hit 150k by 2026-12-31?",
        },
      },
      create: expect.objectContaining({
        userId: "user-1",
        conversationId: "conv-1",
        canonicalQuestion: "Will BTC hit 150k by 2026-12-31?",
        isWatched: false,
        analysisCount: 1,
      }),
      update: expect.objectContaining({
        conversationId: "conv-1",
        personality: "balanced",
        analysisCount: { increment: 1 },
      }),
    });
    expect(record.id).toBe("pred-1");
    expect(record.lastCalibratedProbability).toBe(0.47);
  });

  it("promotes an existing prediction into watch mode when requested", async () => {
    mocks.oraclePredictionUpsert.mockResolvedValue({
      id: "pred-1",
      userId: "user-1",
      conversationId: null,
      rawPrompt: "Will the Fed cut by September?",
      normalizedPrompt: "will the fed cut by september?",
      canonicalQuestion: "Will the Fed cut by September 2026?",
      asset: "FED",
      personality: "skeptical",
      isWatched: true,
      analysisCount: 2,
      lastEvidenceMode: "market_adjacent",
      lastImpliedProbability: 0.58,
      lastCalibratedProbability: 0.61,
      lastConfidence: "medium",
      lastSentiment: "bullish",
      lastHeadline: "A cut is slightly favored.",
      lastSummary: "Rate markets lean toward a cut before September.",
      lastSummaryPacket: "packet",
      lastSourceBlend: { agreement: "high", sources: [] },
      lastEvidenceGaps: [],
      lastVerdict: { headline: "A cut is slightly favored." },
      lastAnalyzedAt: new Date("2026-04-17T14:05:00.000Z"),
      createdAt: new Date("2026-04-17T14:00:00.000Z"),
      updatedAt: new Date("2026-04-17T14:05:00.000Z"),
    });

    await persistOraclePrediction({
      userId: "user-1",
      target: {
        rawPrompt: "Will the Fed cut by September?",
        normalizedPrompt: "will the fed cut by september?",
        asset: "FED",
        assetAliases: ["fed"],
        timeframeText: "by September",
        timeframeEnd: "2026-09-30",
        canonicalQuestion: "Will the Fed cut by September 2026?",
        searchQueries: ["fed cut september 2026"],
      },
      personality: "skeptical",
      evidenceMode: "market_adjacent",
      impliedProbability: 0.58,
      calibratedProbability: 0.61,
      confidence: "medium",
      sentiment: "bullish",
      headline: "A cut is slightly favored.",
      summary: "Rate markets lean toward a cut before September.",
      summaryPacket: "packet",
      sourceBlend: { agreement: "high", sources: [] },
      evidenceGaps: [],
      verdict: { headline: "A cut is slightly favored." },
      isWatched: true,
    });

    expect(mocks.oraclePredictionUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        isWatched: true,
        analysisCount: { increment: 1 },
      }),
    }));
  });

  it("lists recent predictions for the current user", async () => {
    mocks.oraclePredictionFindMany.mockResolvedValue([
      {
        id: "pred-2",
        userId: "user-1",
        conversationId: null,
        rawPrompt: "Will NVDA beat Q3 revenue?",
        normalizedPrompt: "will nvda beat q3 revenue?",
        canonicalQuestion: "Will NVDA beat Q3 revenue expectations?",
        asset: "NVDA",
        personality: "balanced",
        isWatched: true,
        analysisCount: 3,
        lastEvidenceMode: "market_exact",
        lastImpliedProbability: 0.67,
        lastCalibratedProbability: 0.64,
        lastConfidence: "high",
        lastSentiment: "bullish",
        lastHeadline: "A beat is favored.",
        lastSummary: "Prediction markets and comps lean positive.",
        lastSummaryPacket: "packet",
        lastSourceBlend: { agreement: "high", sources: [] },
        lastEvidenceGaps: [],
        lastVerdict: { headline: "A beat is favored." },
        lastAnalyzedAt: new Date("2026-04-17T14:10:00.000Z"),
        createdAt: new Date("2026-04-17T14:00:00.000Z"),
        updatedAt: new Date("2026-04-17T14:10:00.000Z"),
      },
    ]);

    const records = await listOraclePredictions({ userId: "user-1", watchedOnly: true, limit: 5 });

    expect(mocks.oraclePredictionFindMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        isWatched: true,
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 5,
    });
    expect(records[0]?.canonicalQuestion).toBe("Will NVDA beat Q3 revenue expectations?");
    expect(records[0]?.isWatched).toBe(true);
  });
});
