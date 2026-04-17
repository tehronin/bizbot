import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";
import { resolveAgentUserId } from "@/lib/agent/user-context";
import { isBuiltinPluginEnabled } from "@/lib/agent/plugins/settings";
import { getPolymarketMarket, searchPolymarketMarkets } from "@/lib/polymarket/service";
import { type OracleEvidenceBundle, type OracleMarketCandidate } from "@/lib/oracle/evidence";
import { parseOraclePredictionTarget } from "@/lib/oracle/intent";
import { listOraclePredictions, persistOraclePrediction, type OraclePredictionRecord } from "@/lib/oracle/predictions";
import { buildLLMOracleVerdict, type OracleLLMVerdict } from "@/lib/oracle/verdict";
import type { OracleNormalizedMarket } from "@/lib/oracle/sources";
import {
  resolveOracleSwarmEvidence,
  type OracleWebResearchResult,
  type OracleTrendSignal,
  type OracleEvidenceGap,
} from "@/lib/oracle/swarm";
import { searchKalshiOracleSource } from "@/lib/oracle/kalshi-source";
import { normalizePolymarketMarket } from "@/lib/oracle/polymarket-source";
import {
  buildOracleFallbackReply,
  formatOracleEvidencePacket,
  buildOracleVerdict,
  getOraclePersonality,
  getStoredOraclePersonality,
  listOraclePersonalities,
  resolveOraclePersonality,
  storeOraclePersonality,
  type OraclePersonalityId,
} from "@/lib/polymarket/personality";
import { registerSidecarInteractionHandler } from "@/lib/sidecar/router";
import { createValidatedSidecarPanel } from "@/lib/sidecar/validation";
import type {
  SidecarInteractionResult,
  SidecarPanel,
  SidecarSelectionContent,
  SidecarToolResult,
} from "@/lib/sidecar/types";

interface OracleSearchMarketsArgs {
  query: string;
  limit?: number;
  interactive?: boolean;
}

interface OracleMarketVerdictArgs {
  marketId: string;
  personality?: string;
}

interface OracleAnalyzePredictionArgs {
  prompt: string;
  limit?: number;
  personality?: string;
}

interface OracleWatchPredictionArgs {
  prompt: string;
  limit?: number;
  personality?: string;
}

interface OracleListPredictionsArgs {
  limit?: number;
  watchedOnly?: boolean;
}

interface OracleAnalyzePredictionResult {
  target: OracleEvidenceBundle["target"];
  personality: OraclePersonalityId;
  personalityLabel: string;
  evidenceMode: OracleEvidenceBundle["evidenceMode"];
  impliedProbability: number | null;
  confidence: OracleEvidenceBundle["confidence"];
  sentiment: OracleEvidenceBundle["overallSentiment"];
  sourceBlend: OracleEvidenceBundle["sourceBlend"] & {
    sources: OracleEvidenceBundle["sourceProbabilities"];
  };
  exactMatch: ReturnType<typeof summarizeCandidate> | null;
  adjacentMatches: Array<ReturnType<typeof summarizeCandidate>>;
  summaryPacket: string;
  fallbackReply: string;
  llmVerdict: OracleLLMVerdict;
  evidenceGaps: OracleEvidenceGap[];
  webResearch: OracleWebResearchResult[];
  trendSignals: OracleTrendSignal[];
  predictionLogId: string;
  watchEnabled: boolean;
  swarmTrace: {
    planId: string;
    durationMs: number;
    workerCount: number;
    completedCount: number;
    failedCount: number;
  };
}

function ensureOracleEnabled(): void {
  if (!isBuiltinPluginEnabled("oracle")) {
    throw new Error("Oracle plugin is disabled.");
  }
}

function cloneSelectionContent(content: SidecarSelectionContent, selectedItemIds: string[]): SidecarSelectionContent {
  return {
    ...content,
    items: content.items.map((item) => ({ ...item })),
    actions: content.actions.map((action) => ({ ...action })),
    interaction: { ...content.interaction },
    selectedItemIds,
  };
}

function buildPersonalityPanel(selectedItemIds: string[] = []): SidecarToolResult {
  return {
    ok: true,
    action: "open",
    panel: createValidatedSidecarPanel({
      title: "Oracle personality",
      content: {
        type: "selection",
        title: "Choose Oracle personality",
        description: "Set the default market voice Oracle should use for future verdicts.",
        selectionMode: "single",
        items: listOraclePersonalities().map((personality) => ({
          id: personality.id,
          title: personality.label,
          description: personality.description,
        })),
        ...(selectedItemIds.length > 0 ? { selectedItemIds } : {}),
        actions: [
          { id: "oracle_personality_toggle", label: "Choose", kind: "toggle" },
          { id: "oracle_personality_apply", label: "Save personality", kind: "apply" },
          { id: "oracle_personality_clear", label: "Clear selection", kind: "clear" },
          { id: "oracle_personality_close", label: "Close", kind: "close" },
        ],
        interaction: { routeKey: "oracle.personality.select" },
      },
    }),
  };
}

function formatMarketSummary(market: Awaited<ReturnType<typeof getPolymarketMarket>>): string {
  const outcomes = market.outcomes.length > 0
    ? market.outcomes
      .map((outcome) => `${outcome.label}: ${typeof outcome.price === "number" ? `${(outcome.price * 100).toFixed(1)}%` : "n/a"}`)
      .join(", ")
    : "No priced outcomes available.";

  return `${market.question}\nOutcomes: ${outcomes}`;
}

function summarizeCandidate(candidate: OracleMarketCandidate) {
  return {
    source: candidate.market.source,
    marketId: candidate.market.sourceMarketId,
    question: candidate.market.title,
    relevanceScore: candidate.relevanceScore,
    targetAlignedProbability: candidate.targetAlignedProbability,
    sentiment: candidate.sentimentLabel,
    endDate: candidate.market.closeTime ?? null,
  };
}

function formatNormalizedOracleMarketSummary(market: OracleNormalizedMarket, index: number): string {
  return `${index + 1}. [${market.source.toUpperCase()}] ${market.title}`;
}

function formatStoredPredictionSummary(prediction: OraclePredictionRecord, index: number): string {
  const probabilityText = prediction.lastCalibratedProbability !== null
    ? `${(prediction.lastCalibratedProbability * 100).toFixed(1)}%`
    : prediction.lastImpliedProbability !== null
      ? `~${(prediction.lastImpliedProbability * 100).toFixed(1)}%`
      : "n/a";
  const watchText = prediction.isWatched ? "watching" : "logged";
  return `${index + 1}. ${prediction.canonicalQuestion} [${watchText}] ${probabilityText}`;
}

function buildPredictionListSummary(predictions: OraclePredictionRecord[], watchedOnly: boolean): string {
  if (predictions.length === 0) {
    return watchedOnly ? "No watched Oracle predictions are stored yet." : "No Oracle prediction logs are stored yet.";
  }

  return predictions.map((prediction, index) => formatStoredPredictionSummary(prediction, index)).join("\n");
}

function formatVerdictSidecarMarkdown(
  verdict: OracleLLMVerdict,
  impliedProbability: number | null,
  evidenceGaps: OracleEvidenceGap[],
  evidenceMode: OracleEvidenceBundle["evidenceMode"],
): string {
  const probText = verdict.calibratedProbability !== null
    ? `${(verdict.calibratedProbability * 100).toFixed(1)}%`
    : impliedProbability !== null
      ? `~${(impliedProbability * 100).toFixed(1)}% (market-implied)`
      : "Unavailable";

  const confidenceBadge: Record<OracleLLMVerdict["confidence"], string> = {
    low: "Low",
    medium: "Medium",
    high: "High",
  };

  const lines: string[] = [
    `## ${verdict.headline}`,
    "",
    `**Probability:** ${probText} · **Confidence:** ${confidenceBadge[verdict.confidence]} · **Mode:** ${evidenceMode.replace(/_/g, " ")}`,
    "",
    `**Lens:** ${verdict.personality.charAt(0).toUpperCase() + verdict.personality.slice(1)}`,
    "",
    verdict.summary,
    "",
  ];

  if (verdict.keyDrivers.length > 0) {
    lines.push("### Key Drivers");
    for (const driver of verdict.keyDrivers) {
      lines.push(`- ${driver}`);
    }
    lines.push("");
  }

  if (verdict.risks.length > 0) {
    lines.push("### Risks");
    for (const risk of verdict.risks) {
      lines.push(`- ${risk}`);
    }
    lines.push("");
  }

  if (verdict.disconfirmingEvidence.length > 0) {
    lines.push("### Against the Verdict");
    for (const item of verdict.disconfirmingEvidence) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (verdict.sourcesUsed.length > 0) {
    lines.push("### Sources");
    for (const source of verdict.sourcesUsed) {
      lines.push(`- ${source}`);
    }
    lines.push("");
  }

  if (evidenceGaps.length > 0) {
    lines.push("### Evidence Gaps");
    for (const gap of evidenceGaps) {
      lines.push(`- **${gap.lane}:** ${gap.reason}`);
    }
  }

  return lines.join("\n");
}

function buildVerdictSidecarPanel(
  verdict: OracleLLMVerdict,
  impliedProbability: number | null,
  evidenceGaps: OracleEvidenceGap[],
  evidenceMode: OracleEvidenceBundle["evidenceMode"],
  target: string,
): SidecarToolResult {
  return {
    ok: true,
    action: "open",
    panel: createValidatedSidecarPanel({
      title: `Oracle: ${target.slice(0, 60)}`,
      content: {
        type: "markdown",
        markdown: formatVerdictSidecarMarkdown(verdict, impliedProbability, evidenceGaps, evidenceMode),
      },
    }),
  };
}

async function analyzeOraclePrediction(
  { prompt, limit, personality }: OracleAnalyzePredictionArgs,
  context: { userId?: string; conversationId?: string | null },
  watch = false,
): Promise<OracleAnalyzePredictionResult & { _sidecar: SidecarToolResult }> {
  ensureOracleEnabled();
  const userId = resolveAgentUserId(context.userId);
  const target = parseOraclePredictionTarget(prompt);
  if (!target) {
    throw new Error("Oracle prediction analysis requires a non-empty prompt.");
  }

  const resolvedPersonality = await resolveOraclePersonality(userId, personality);
  const swarmBundle = await resolveOracleSwarmEvidence(target, { limit });
  const evidence = swarmBundle.market;
  const llmVerdict = await buildLLMOracleVerdict(evidence, resolvedPersonality, swarmBundle);
  const sourceBlend = {
    ...evidence.sourceBlend,
    sources: evidence.sourceProbabilities,
  };
  const summaryPacket = formatOracleEvidencePacket(evidence, resolvedPersonality);
  const fallbackReply = buildOracleFallbackReply(evidence, resolvedPersonality);
  const persistedPrediction = await persistOraclePrediction({
    userId,
    conversationId: context.conversationId ?? null,
    target: evidence.target,
    personality: resolvedPersonality,
    evidenceMode: evidence.evidenceMode,
    impliedProbability: evidence.inferredProbability,
    calibratedProbability: llmVerdict.calibratedProbability,
    confidence: llmVerdict.confidence,
    sentiment: evidence.overallSentiment,
    headline: llmVerdict.headline,
    summary: llmVerdict.summary,
    summaryPacket,
    sourceBlend,
    evidenceGaps: swarmBundle.evidenceGaps,
    verdict: llmVerdict,
    isWatched: watch,
  });
  const result: OracleAnalyzePredictionResult = {
    target: evidence.target,
    personality: resolvedPersonality,
    personalityLabel: getOraclePersonality(resolvedPersonality).label,
    evidenceMode: evidence.evidenceMode,
    impliedProbability: evidence.inferredProbability,
    confidence: evidence.confidence,
    sentiment: evidence.overallSentiment,
    sourceBlend,
    exactMatch: evidence.exactMatch ? summarizeCandidate(evidence.exactMatch) : null,
    adjacentMatches: evidence.adjacentMatches.map((candidate) => summarizeCandidate(candidate)),
    summaryPacket,
    fallbackReply,
    llmVerdict,
    evidenceGaps: swarmBundle.evidenceGaps,
    webResearch: swarmBundle.webResearch,
    trendSignals: swarmBundle.trendSignals,
    predictionLogId: persistedPrediction.id,
    watchEnabled: persistedPrediction.isWatched,
    swarmTrace: swarmBundle.swarmTrace,
  };
  const _sidecar = buildVerdictSidecarPanel(
    llmVerdict,
    evidence.inferredProbability,
    swarmBundle.evidenceGaps,
    evidence.evidenceMode,
    target.canonicalQuestion,
  );
  return { ...result, _sidecar };
}

function buildMarketSelectionPanel(query: string, markets: Awaited<ReturnType<typeof searchPolymarketMarkets>>["markets"]): SidecarToolResult {
  return {
    ok: true,
    action: "open",
    panel: createValidatedSidecarPanel({
      title: "Oracle market shortlist",
      content: {
        type: "selection",
        title: "Select a market to inspect",
        description: `Interactive shortlist for \"${query.trim()}\".`,
        selectionMode: "single",
        items: markets.map((market) => ({
          id: market.id,
          title: market.question,
          description: [market.endDate, market.volume !== undefined ? `volume ${market.volume}` : undefined].filter(Boolean).join(" · ") || undefined,
        })),
        actions: [
          { id: "oracle_market_toggle", label: "Choose", kind: "toggle" },
          { id: "oracle_market_apply", label: "Open verdict", kind: "apply" },
          { id: "oracle_market_clear", label: "Clear selection", kind: "clear" },
          { id: "oracle_market_close", label: "Close", kind: "close" },
        ],
        interaction: { routeKey: "oracle.market.select" },
      },
    }),
  };
}

function buildVerdictPanel(panel: SidecarPanel, verdict: ReturnType<typeof buildOracleVerdict>, market: Awaited<ReturnType<typeof getPolymarketMarket>>): SidecarInteractionResult {
  return {
    ok: true,
    action: "update",
    panel: createValidatedSidecarPanel({
      panelId: panel.panelId,
      title: panel.title,
      content: {
        type: "markdown",
        markdown: `## ${verdict.headline}\n\n${verdict.summary}\n\n- Confidence: ${verdict.confidence}\n- Personality: ${getOraclePersonality(verdict.personality).label}\n- Market: ${formatMarketSummary(market)}`,
      },
    }),
  };
}

registerSidecarInteractionHandler("oracle.personality.select", async (context) => {
  ensureOracleEnabled();

  if (context.action.kind === "toggle") {
    return {
      ok: true,
      action: "update",
      panel: createValidatedSidecarPanel({
        panelId: context.panel.panelId,
        title: context.panel.title,
        content: cloneSelectionContent(context.panel.content as SidecarSelectionContent, context.selectedItemIds),
      }),
    };
  }

  if (context.action.kind === "clear") {
    return {
      ok: true,
      action: "update",
      panel: createValidatedSidecarPanel({
        panelId: context.panel.panelId,
        title: context.panel.title,
        content: cloneSelectionContent(context.panel.content as SidecarSelectionContent, []),
      }),
    };
  }

  if (context.action.kind === "close") {
    return { ok: true, action: "close", panel: null };
  }

  const selectedPersonality = context.selectedItemIds[0];
  if (!selectedPersonality) {
    throw new Error("Choose a personality before saving Oracle preferences.");
  }

  await storeOraclePersonality(context.userId, selectedPersonality as OraclePersonalityId);

  return {
    ok: true,
    action: "update",
    panel: createValidatedSidecarPanel({
      panelId: context.panel.panelId,
      title: context.panel.title,
      content: {
        type: "markdown",
        markdown: `## Oracle personality saved\n\nDefault personality is now **${getOraclePersonality(selectedPersonality as OraclePersonalityId).label}**. This preference is stored in explicit user memory under oracle_bot_personality.`,
      },
    }),
  };
});

registerSidecarInteractionHandler("oracle.market.select", async (context) => {
  ensureOracleEnabled();

  if (context.action.kind === "toggle") {
    return {
      ok: true,
      action: "update",
      panel: createValidatedSidecarPanel({
        panelId: context.panel.panelId,
        title: context.panel.title,
        content: cloneSelectionContent(context.panel.content as SidecarSelectionContent, context.selectedItemIds),
      }),
    };
  }

  if (context.action.kind === "clear") {
    return {
      ok: true,
      action: "update",
      panel: createValidatedSidecarPanel({
        panelId: context.panel.panelId,
        title: context.panel.title,
        content: cloneSelectionContent(context.panel.content as SidecarSelectionContent, []),
      }),
    };
  }

  if (context.action.kind === "close") {
    return { ok: true, action: "close", panel: null };
  }

  const marketId = context.selectedItemIds[0];
  if (!marketId) {
    throw new Error("Choose a market before requesting an Oracle verdict.");
  }

  const market = await getPolymarketMarket(marketId);
  const personality = await resolveOraclePersonality(context.userId);
  const verdict = buildOracleVerdict(market, personality);

  return buildVerdictPanel(context.panel, verdict, market);
});

export const oraclePlugin = {
  tools: [
    registerTool(defineTool({
      name: "oracle_open_personality_selector",
      description: "Open a generic Sidecar selection panel so the user can choose Oracle's default market personality. Uses explicit user memory for persistence.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async (_args: Record<string, never>, context) => {
        ensureOracleEnabled();
        const userId = resolveAgentUserId(context.userId);
        const storedPersonality = await getStoredOraclePersonality(userId);
        return buildPersonalityPanel(storedPersonality ? [storedPersonality] : []);
      },
    } satisfies ToolDefinition<Record<string, never>, SidecarToolResult>)),
    registerTool(defineTool({
      name: "oracle_search_markets",
      description: "Search public Polymarket and Kalshi markets in read-only mode. When interactive=true, open a generic Sidecar selection panel instead of plain text-only output.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", default: 5 },
          interactive: { type: "boolean", default: false },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async ({ query, limit, interactive }: OracleSearchMarketsArgs) => {
        ensureOracleEnabled();
        const perSource = Math.max(1, Math.min(limit ?? 5, 10));
        const syntheticTarget = {
          rawPrompt: query,
          normalizedPrompt: query.toLowerCase(),
          assetAliases: [],
          canonicalQuestion: query,
          searchQueries: [query],
        };
        const [polyResult, kalshiResult] = await Promise.allSettled([
          searchPolymarketMarkets(query, perSource),
          searchKalshiOracleSource(syntheticTarget as Parameters<typeof searchKalshiOracleSource>[0], { queryOverride: query, limit: perSource }),
        ]);
        const polyMarkets = polyResult.status === "fulfilled" ? polyResult.value.markets : [];
        const kalshiMarkets = kalshiResult.status === "fulfilled" ? kalshiResult.value.markets : [];
        const seenIds = new Set<string>();
        const normalizedPolyMarkets = polyMarkets.map((market) => normalizePolymarketMarket(market));
        const allMarkets = [...normalizedPolyMarkets, ...kalshiMarkets].filter((market) => {
          const key = `${market.source}:${market.sourceMarketId}`;
          if (seenIds.has(key)) {
            return false;
          }
          seenIds.add(key);
          return true;
        });
        if (interactive && polyMarkets.length > 0) {
          return buildMarketSelectionPanel(query, polyMarkets);
        }

        const summary = allMarkets.length > 0
          ? allMarkets.map((market, index) => formatNormalizedOracleMarketSummary(market, index)).join("\n")
          : `No markets found for "${query}" on Polymarket or Kalshi.`;
        return { query, markets: allMarkets, summary };
      },
    } satisfies ToolDefinition<OracleSearchMarketsArgs, SidecarToolResult | { query: string; markets: OracleNormalizedMarket[]; summary: string }>)),
    registerTool(defineTool({
      name: "oracle_get_market_verdict",
      description: "Get a read-only Oracle verdict for a specific Polymarket market using the stored or provided Oracle personality.",
      parameters: {
        type: "object",
        properties: {
          marketId: { type: "string" },
          personality: {
            type: "string",
            enum: listOraclePersonalities().map((personality) => personality.id),
          },
        },
        required: ["marketId"],
        additionalProperties: false,
      },
      execute: async ({ marketId, personality }: OracleMarketVerdictArgs, context) => {
        ensureOracleEnabled();
        const userId = resolveAgentUserId(context.userId);
        const market = await getPolymarketMarket(marketId);
        const resolvedPersonality = await resolveOraclePersonality(userId, personality);
        const verdict = buildOracleVerdict(market, resolvedPersonality);

        return {
          market,
          verdict,
          summary: `${verdict.headline} ${verdict.summary}`,
        };
      },
    } satisfies ToolDefinition<OracleMarketVerdictArgs, { market: Awaited<ReturnType<typeof getPolymarketMarket>>; verdict: ReturnType<typeof buildOracleVerdict>; summary: string }>)),
    registerTool(defineTool({
      name: "oracle_analyze_prediction",
      description: "Resolve a user prediction target using parallel swarm workers: prediction markets, adjacent market research, and market-interest signals. Returns an evidence packet with structured Oracle analysis.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          limit: { type: "number", default: 12 },
          personality: {
            type: "string",
            enum: listOraclePersonalities().map((personality) => personality.id),
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
      execute: async ({ prompt, limit, personality }: OracleAnalyzePredictionArgs, context) => {
        return analyzeOraclePrediction({ prompt, limit, personality }, context);
      },
    } satisfies ToolDefinition<OracleAnalyzePredictionArgs, OracleAnalyzePredictionResult & { _sidecar: SidecarToolResult }>)),
    registerTool(defineTool({
      name: "oracle_watch_prediction",
      description: "Analyze a prediction target and persist it as an actively watched Oracle prediction for the current user.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          limit: { type: "number", default: 12 },
          personality: {
            type: "string",
            enum: listOraclePersonalities().map((personality) => personality.id),
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
      execute: async ({ prompt, limit, personality }: OracleWatchPredictionArgs, context) => {
        return analyzeOraclePrediction({ prompt, limit, personality }, context, true);
      },
    } satisfies ToolDefinition<OracleWatchPredictionArgs, OracleAnalyzePredictionResult & { _sidecar: SidecarToolResult }>)),
    registerTool(defineTool({
      name: "oracle_list_predictions",
      description: "List persisted Oracle prediction logs for the current user, optionally restricted to actively watched predictions.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", default: 10 },
          watchedOnly: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
      execute: async ({ limit, watchedOnly }: OracleListPredictionsArgs, context) => {
        ensureOracleEnabled();
        const userId = resolveAgentUserId(context.userId);
        const predictions = await listOraclePredictions({ userId, limit, watchedOnly });
        return {
          predictions,
          summary: buildPredictionListSummary(predictions, watchedOnly ?? false),
        };
      },
    } satisfies ToolDefinition<OracleListPredictionsArgs, { predictions: OraclePredictionRecord[]; summary: string }>)),
  ],
};