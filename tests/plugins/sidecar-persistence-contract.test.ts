import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/memory/service", () => ({
  getActiveMemoryFacts: vi.fn(),
  setMemoryFact: vi.fn(),
}));

vi.mock("@/lib/oracle/predictions", () => ({
  persistOraclePrediction: vi.fn(async ({ userId, conversationId, target, personality, evidenceMode, impliedProbability, calibratedProbability, confidence, sentiment, headline, summary, summaryPacket, sourceBlend, evidenceGaps, verdict, isWatched }) => ({
    id: "prediction-1",
    userId,
    conversationId: conversationId ?? null,
    rawPrompt: target.rawPrompt,
    normalizedPrompt: target.normalizedPrompt,
    canonicalQuestion: target.canonicalQuestion,
    asset: target.asset ?? null,
    personality,
    isWatched: isWatched ?? false,
    analysisCount: 1,
    lastEvidenceMode: evidenceMode,
    lastImpliedProbability: impliedProbability,
    lastCalibratedProbability: calibratedProbability,
    lastConfidence: confidence,
    lastSentiment: sentiment,
    lastHeadline: headline,
    lastSummary: summary,
    lastSummaryPacket: summaryPacket,
    lastSourceBlend: sourceBlend,
    lastEvidenceGaps: evidenceGaps,
    lastVerdict: verdict,
    lastAnalyzedAt: "2026-04-17T00:00:00.000Z",
    createdAt: "2026-04-17T00:00:00.000Z",
    updatedAt: "2026-04-17T00:00:00.000Z",
  })),
  listOraclePredictions: vi.fn(async () => []),
}));

vi.mock("@/lib/oracle/swarm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/oracle/swarm")>();
  const { resolveOraclePredictionEvidence } = await import("@/lib/oracle/evidence");
  return {
    ...actual,
    resolveOracleSwarmEvidence: vi.fn(async (target, options) => {
      const market = await resolveOraclePredictionEvidence(target, options);
      return {
        market,
        webResearch: [],
        trendSignals: [],
        evidenceGaps: [],
        swarmTrace: { planId: "test-plan", durationMs: 50, workerCount: 1, completedCount: 1, failedCount: 0 },
      };
    }),
  };
});

vi.mock("@/lib/creeper/profiles", () => ({
  listCreeperCompanyProfiles: vi.fn(async () => ([
    { id: "company-1", name: "Acme", sourceCount: 2, planCount: 1, status: "active" },
  ])),
  getCreeperCompanyProfile: vi.fn(async () => ({
    id: "company-1",
    name: "Acme",
    status: "active",
    description: "Widgets",
    retrievalConfig: {},
    ontologyConfig: {},
    sources: [{ id: "source-1" }],
    ingestionPlans: [{ id: "plan-1" }],
  })),
}));

vi.mock("@/lib/creeper/plans", () => ({
  getCreeperPlan: vi.fn(async () => ({
    id: "plan-1",
    version: 2,
    status: "draft",
    businessGoal: "Find revenue signals",
    source: { label: "Warehouse" },
    companyProfile: { name: "Acme" },
    selectedTables: [
      {
        id: "public_orders",
        estimatedRowCount: 1200,
        ingestionScore: 0.9,
        selectedColumns: ["id", "amount"],
      },
    ],
  })),
  updateCreeperPlan: vi.fn(async ({ planId, selectedTableIds }: { planId: string; selectedTableIds?: string[] }) => ({
    id: planId,
    version: 2,
    status: "DRAFT",
    businessGoal: "Find revenue signals",
    source: { label: "Warehouse" },
    companyProfile: { name: "Acme" },
    selectedTables: [
      {
        id: (selectedTableIds && selectedTableIds[0]) || "public_orders",
        estimatedRowCount: 1200,
        ingestionScore: 0.9,
        selectedColumns: ["id", "amount"],
      },
    ],
  })),
  approveCreeperPlan: vi.fn(async (planId: string) => ({
    id: planId,
    version: 2,
    status: "APPROVED",
    businessGoal: "Find revenue signals",
    source: { label: "Warehouse" },
    companyProfile: { name: "Acme" },
    selectedTables: [
      {
        id: "public_orders",
        estimatedRowCount: 1200,
        ingestionScore: 0.9,
        selectedColumns: ["id", "amount"],
      },
    ],
  })),
  startCreeperIngestionRun: vi.fn(async () => ({
    id: "run-1",
  })),
}));

vi.mock("@/lib/builder/orchestrator", () => ({
  planBuilderProject: vi.fn(async (projectId: string, input: { title?: string }) => ({
    project: { id: projectId },
    brief: { title: input.title || "Builder Demo" },
    overview: "overview",
    nextRecommendedStep: "Ship it",
    milestones: [],
    decisions: [],
    deliverables: [],
    risks: [],
  })),
}));

import { executeTool } from "@/lib/agent/plugins";
import { getActiveMemoryFacts } from "@/lib/agent/memory/service";
import { routeSidecarInteraction } from "@/lib/sidecar/router";
import { getActiveSidecarContextForConversation, resetActiveSidecarPanelsForTests, syncActiveSidecarPanel } from "@/lib/sidecar/state";
import {
  buildCreeperCompanyBriefReviewSidecar,
  buildCreeperCompanyProfileSelectorSidecar,
  buildCreeperPlanReviewSidecar,
} from "@/lib/creeper/sidecar";
import type { SidecarPanel } from "@/lib/sidecar/types";

const mockedGetActiveMemoryFacts = vi.mocked(getActiveMemoryFacts);

describe("sidecar persistence contracts", () => {
  beforeEach(() => {
    process.env.BIZBOT_PLUGIN_ORACLE_ENABLED = "true";
    resetActiveSidecarPanelsForTests();
    vi.unstubAllGlobals();
    mockedGetActiveMemoryFacts.mockReset();
    mockedGetActiveMemoryFacts.mockResolvedValue([] as never);
  });

  it("keeps Oracle personality selection sticky", async () => {
    const result = await executeTool("oracle_open_personality_selector", {}, {
      access: { agentProfile: "general_operator", userId: "user-1" },
    });

    expect(result).toEqual(expect.objectContaining({
      panel: expect.objectContaining({
        persistence: "sticky",
      }),
    }));
  });

  it("uses workflow persistence for Oracle interactive shortlists and ephemeral persistence for resulting verdicts", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/markets?")) {
        return {
          ok: true,
          json: async () => ([
            {
              id: "market-1",
              question: "Will BTC hit 150k?",
              active: true,
              closed: false,
              outcomes: ["Yes", "No"],
              outcomePrices: [0.41, 0.59],
            },
          ]),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          id: "market-1",
          question: "Will BTC hit 150k?",
          active: true,
          closed: false,
          endDate: "2026-12-31",
          outcomes: ["Yes", "No"],
          outcomePrices: [0.41, 0.59],
        }),
      } as Response;
    }));

    const result = await executeTool("oracle_search_markets", {
      query: "btc",
      interactive: true,
    }, {
      access: { agentProfile: "research_operator", userId: "user-1" },
    });

    expect(result).toEqual(expect.objectContaining({
      panel: expect.objectContaining({
        persistence: "workflow",
      }),
    }));

    const sidecarResult = result as { panel: SidecarPanel };
    syncActiveSidecarPanel({
      action: "open",
      panel: sidecarResult.panel,
      conversationId: "conversation-1",
      userId: "user-1",
    });

    const interactionResult = await routeSidecarInteraction({
      panelId: sidecarResult.panel.panelId,
      actionId: "oracle_market_apply",
      selectedItemIds: ["market-1"],
      conversationId: "conversation-1",
      userId: "user-1",
    });

    expect(interactionResult).toEqual(expect.objectContaining({
      panel: expect.objectContaining({
        persistence: "ephemeral",
      }),
    }));
  });

  it("uses sticky Creeper brief panels and workflow Creeper selector and plan panels", async () => {
    const selector = await buildCreeperCompanyProfileSelectorSidecar();
    const brief = await buildCreeperCompanyBriefReviewSidecar("company-1");
    const plan = await buildCreeperPlanReviewSidecar("plan-1");

    expect(selector).toEqual(expect.objectContaining({
      panel: expect.objectContaining({ persistence: "workflow" }),
    }));
    expect(brief).toEqual(expect.objectContaining({
      panel: expect.objectContaining({ persistence: "sticky" }),
    }));
    expect(plan).toEqual(expect.objectContaining({
      panel: expect.objectContaining({ persistence: "workflow" }),
    }));
  });

  it("opens a context-backed Creeper ingestion summary outside the Oracle workflow", async () => {
    const result = await buildCreeperPlanReviewSidecar("plan-1");

    expect(result).toEqual(expect.objectContaining({
      panel: expect.objectContaining({
        persistence: "workflow",
        context: expect.objectContaining({
          contextId: "creeper.plan.review",
          selectionKey: "selectedTableIds",
        }),
      }),
    }));

    const sidecarResult = result as { panel: SidecarPanel };
    syncActiveSidecarPanel({
      action: "open",
      panel: sidecarResult.panel,
      conversationId: "conversation-1",
      userId: "user-1",
    });

    const interactionResult = await routeSidecarInteraction({
      panelId: sidecarResult.panel.panelId,
      actionId: "creeper_plan_start",
      selectedItemIds: ["public_orders"],
      expectedStackRevision: 1,
      contextPatch: {
        contextId: "creeper.plan.review",
        values: {
          selectedTableIds: ["public_orders"],
        },
      },
      conversationId: "conversation-1",
      userId: "user-1",
    });

    expect(interactionResult).toEqual(expect.objectContaining({
      ok: true,
      action: "open",
      panel: expect.objectContaining({
        persistence: "ephemeral",
        context: {
          contextId: "creeper.plan.review",
          readKeys: [
            "selectedTableIds",
            "selectedTableCount",
            "selectedTableSummary",
            "companyName",
            "sourceLabel",
            "planVersion",
            "planStatus",
            "ingestionRunId",
          ],
        },
        content: expect.objectContaining({
          type: "markdown",
          markdown: expect.stringContaining("{{ingestionRunId}}"),
        }),
      }),
      context: expect.objectContaining({
        contextId: "creeper.plan.review",
        values: expect.objectContaining({
          companyName: "Acme",
          sourceLabel: "Warehouse",
          planVersion: 2,
          planStatus: "APPROVED",
          ingestionRunId: "run-1",
          selectedTableCount: 1,
          selectedTableSummary: "public_orders",
        }),
      }),
    }));

    expect(getActiveSidecarContextForConversation("conversation-1")).toEqual(expect.objectContaining({
      contextId: "creeper.plan.review",
      values: expect.objectContaining({
        ingestionRunId: "run-1",
        selectedTableSummary: "public_orders",
      }),
    }));
  });

  it("uses workflow persistence for Builder planning sidecars", async () => {
    const result = await executeTool("builder_plan_project", {
      projectId: "project-1",
      title: "Builder Demo",
    }, {
      access: { agentProfile: "builder_operator", userId: "user-1" },
    });

    expect(result).toEqual(expect.objectContaining({
      _sidecar: expect.objectContaining({
        panel: expect.objectContaining({
          persistence: "workflow",
        }),
      }),
    }));
  });
});