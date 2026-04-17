-- CreateTable
CREATE TABLE "OraclePrediction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT,
  "rawPrompt" TEXT NOT NULL,
  "normalizedPrompt" TEXT NOT NULL,
  "canonicalQuestion" TEXT NOT NULL,
  "asset" TEXT,
  "personality" TEXT NOT NULL,
  "isWatched" BOOLEAN NOT NULL DEFAULT false,
  "analysisCount" INTEGER NOT NULL DEFAULT 0,
  "lastEvidenceMode" TEXT,
  "lastImpliedProbability" DOUBLE PRECISION,
  "lastCalibratedProbability" DOUBLE PRECISION,
  "lastConfidence" TEXT,
  "lastSentiment" TEXT,
  "lastHeadline" TEXT,
  "lastSummary" TEXT,
  "lastSummaryPacket" TEXT,
  "lastSourceBlend" JSONB,
  "lastEvidenceGaps" JSONB,
  "lastVerdict" JSONB,
  "lastAnalyzedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OraclePrediction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OraclePrediction_userId_canonicalQuestion_key" ON "OraclePrediction"("userId", "canonicalQuestion");

-- CreateIndex
CREATE INDEX "OraclePrediction_userId_isWatched_updatedAt_idx" ON "OraclePrediction"("userId", "isWatched", "updatedAt");

-- CreateIndex
CREATE INDEX "OraclePrediction_userId_updatedAt_idx" ON "OraclePrediction"("userId", "updatedAt");

-- AddForeignKey
ALTER TABLE "OraclePrediction" ADD CONSTRAINT "OraclePrediction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
