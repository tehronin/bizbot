import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";
import { resolveAgentUserId } from "@/lib/agent/user-context";
import { isBuiltinPluginEnabled } from "@/lib/agent/plugins/settings";
import { getPolymarketMarket, searchPolymarketMarkets } from "@/lib/polymarket/service";
import { resolveOraclePredictionEvidence, type OracleEvidenceBundle, type OracleMarketCandidate } from "@/lib/oracle/evidence";
import { parseOraclePredictionTarget } from "@/lib/oracle/intent";
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
      description: "Search public Polymarket markets in read-only mode. When interactive=true, open a generic Sidecar selection panel instead of plain text-only output.",
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
        const result = await searchPolymarketMarkets(query, limit ?? 5);
        if (interactive && result.markets.length > 0) {
          return buildMarketSelectionPanel(query, result.markets);
        }

        return {
          query: result.query,
          markets: result.markets,
          summary: result.markets.length > 0
            ? result.markets.map((market, index) => `${index + 1}. ${formatMarketSummary(market)}`).join("\n")
            : `No Polymarket markets found for \"${result.query}\".`,
        };
      },
    } satisfies ToolDefinition<OracleSearchMarketsArgs, SidecarToolResult | { query: string; markets: Awaited<ReturnType<typeof searchPolymarketMarkets>>["markets"]; summary: string }>)),
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
      description: "Resolve a user prediction target against Polymarket, score exact versus adjacent markets, and return an odds-and-sentiment evidence packet for Oracle narration.",
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
        ensureOracleEnabled();
        const userId = resolveAgentUserId(context.userId);
        const target = parseOraclePredictionTarget(prompt);
        if (!target) {
          throw new Error("Oracle prediction analysis requires a non-empty prompt.");
        }

        const resolvedPersonality = await resolveOraclePersonality(userId, personality);
        const evidence = await resolveOraclePredictionEvidence(target, { limit });
        return {
          target: evidence.target,
          personality: resolvedPersonality,
          personalityLabel: getOraclePersonality(resolvedPersonality).label,
          evidenceMode: evidence.evidenceMode,
          impliedProbability: evidence.inferredProbability,
          confidence: evidence.confidence,
          sentiment: evidence.overallSentiment,
          sourceBlend: {
            ...evidence.sourceBlend,
            sources: evidence.sourceProbabilities,
          },
          exactMatch: evidence.exactMatch ? summarizeCandidate(evidence.exactMatch) : null,
          adjacentMatches: evidence.adjacentMatches.map((candidate) => summarizeCandidate(candidate)),
          summaryPacket: formatOracleEvidencePacket(evidence, resolvedPersonality),
          fallbackReply: buildOracleFallbackReply(evidence, resolvedPersonality),
        } satisfies OracleAnalyzePredictionResult;
      },
    } satisfies ToolDefinition<OracleAnalyzePredictionArgs, OracleAnalyzePredictionResult>)),
  ],
};