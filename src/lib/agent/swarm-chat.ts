import crypto from "crypto";
import type { BuildContextResult } from "@/lib/agent/memory";
import type { AgentProfile } from "@/lib/agent/profiles";
import type { SwarmExecutionPlan, SwarmWorkItem, SwarmWorkerResult } from "@/lib/swarm/types";
import type { ChatSwarmClaim, ChatSwarmSourceFinding } from "@/lib/agent/swarm-workers";

export interface ChatSwarmSourceUnit {
  id: string;
  sourceKind: "conversation_summary" | "recent_conversation" | "semantic_recall" | "graph" | "knowledge_docs" | "explicit_user_text";
  title: string;
  text: string;
}

export interface ChatSwarmClassification {
  activate: boolean;
  reason: string;
  plannerConfidence: number;
  auditRequested: boolean;
  indicators: string[];
}

function chunkText(value: string, maxChars = 1_600, overlap = 200): string[] {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    const nextCursor = Math.min(normalized.length, cursor + maxChars);
    chunks.push(normalized.slice(cursor, nextCursor));
    if (nextCursor >= normalized.length) {
      break;
    }
    cursor = Math.max(0, nextCursor - overlap);
  }

  return chunks;
}

function buildBlockSourceUnits(context: BuildContextResult): ChatSwarmSourceUnit[] {
  const sources: Array<ChatSwarmSourceUnit | null> = [
    context.blocks.conversationSummary
      ? { id: "conversation_summary", sourceKind: "conversation_summary", title: "Conversation summary", text: context.blocks.conversationSummary }
      : null,
    context.blocks.recentConversation
      ? { id: "recent_conversation", sourceKind: "recent_conversation", title: "Recent conversation", text: context.blocks.recentConversation }
      : null,
    context.blocks.semanticRecall
      ? { id: "semantic_recall", sourceKind: "semantic_recall", title: "Semantic recall", text: context.blocks.semanticRecall }
      : null,
    context.blocks.graph
      ? { id: "graph", sourceKind: "graph", title: "Graph context", text: context.blocks.graph }
      : null,
    context.blocks.knowledgeDocs
      ? { id: "knowledge_docs", sourceKind: "knowledge_docs", title: "Knowledge documents", text: context.blocks.knowledgeDocs }
      : null,
  ];

  return sources.filter((source): source is ChatSwarmSourceUnit => Boolean(source));
}

function extractExplicitUserTextUnits(message: string): ChatSwarmSourceUnit[] {
  const fencedBlocks = Array.from(message.matchAll(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g)).map((match) => match[1]?.trim() ?? "");
  const explicitText = fencedBlocks.join("\n\n").trim() || (message.length >= 1_200 ? message : "");
  if (!explicitText) {
    return [];
  }

  return chunkText(explicitText).map((chunk, index) => ({
    id: `explicit_user_text_${index + 1}`,
    sourceKind: "explicit_user_text",
    title: `Explicit user text ${index + 1}`,
    text: chunk,
  }));
}

export function collectChatSwarmSources(args: {
  message: string;
  context: BuildContextResult;
}): ChatSwarmSourceUnit[] {
  return [
    ...buildBlockSourceUnits(args.context),
    ...extractExplicitUserTextUnits(args.message),
  ];
}

export function classifyChatSwarmRequest(args: {
  message: string;
  profile: AgentProfile;
  context: BuildContextResult;
}): ChatSwarmClassification {
  const sources = collectChatSwarmSources({ message: args.message, context: args.context });
  const normalizedMessage = args.message.toLowerCase();
  const indicators: string[] = [];
  const asksForSummary = /\b(?:summari[sz]e|summary|digest|brief)\b/.test(normalizedMessage);
  const asksForComparison = /\b(?:compare|contrast|difference|differences|versus|vs\.?|contradiction|contradictions|conflict|conflicts|across sources)\b/.test(normalizedMessage);
  const asksForVerification = /\b(?:verify|verification|fact check|fact-check|audit|grounded|evidence|prove)\b/.test(normalizedMessage);
  const asksForMultiSource = /\b(?:sources|documents|docs|notes|transcript|files)\b/.test(normalizedMessage);
  const longInput = args.message.length >= 1_200;

  if (sources.length >= 3) {
    indicators.push(`source_count:${sources.length}`);
  }
  if (asksForSummary) {
    indicators.push("summary_request");
  }
  if (asksForComparison) {
    indicators.push("comparison_request");
  }
  if (asksForVerification) {
    indicators.push("verification_request");
  }
  if (asksForMultiSource) {
    indicators.push("multi_source_request");
  }
  if (longInput) {
    indicators.push("long_input");
  }

  const activate = sources.length >= 3 && (asksForSummary || asksForComparison || asksForVerification || asksForMultiSource || longInput)
    || longInput && sources.length >= 2 && (asksForSummary || asksForVerification)
    || asksForComparison && sources.length >= 2;

  const plannerConfidence = activate
    ? Math.min(0.95, 0.55 + (sources.length * 0.08) + (indicators.length * 0.05))
    : 0.2;

  return {
    activate,
    reason: activate
      ? `Core chat swarm activated for ${sources.length} source units with indicators: ${indicators.join(", ")}.`
      : "Request stays on the cheaper single-agent chat path.",
    plannerConfidence,
    auditRequested: asksForVerification || asksForComparison,
    indicators,
  };
}

function buildSourceSummaryWorkItem(source: ChatSwarmSourceUnit): SwarmWorkItem {
  return {
    id: `${source.id}:summary`,
    type: "source_summary",
    sourceId: source.id,
    sourceKind: source.sourceKind,
    operation: "summarize_source",
    instructions: ["Summarize the source in a bounded form."],
    constraints: {
      maxOutputChars: 320,
      allowToolCalls: false,
    },
    payload: {
      sourceText: source.text,
      sourceKind: source.sourceKind,
      title: source.title,
    },
  };
}

function buildSourceClaimWorkItem(source: ChatSwarmSourceUnit): SwarmWorkItem {
  return {
    id: `${source.id}:claims`,
    type: "source_claim_extraction",
    sourceId: source.id,
    sourceKind: source.sourceKind,
    operation: "extract_claims",
    instructions: ["Extract bounded claims and evidence refs from the source."],
    constraints: {
      mustIncludeEvidenceRefs: true,
      allowToolCalls: false,
    },
    payload: {
      sourceText: source.text,
      sourceKind: source.sourceKind,
      title: source.title,
    },
  };
}

export function buildChatSwarmPlan(args: {
  message: string;
  classification: ChatSwarmClassification;
  sources: ChatSwarmSourceUnit[];
}): SwarmExecutionPlan {
  return {
    id: `swarm_${crypto.randomUUID()}`,
    mode: "core_chat_swarm",
    reason: args.classification.reason,
    taskSummary: args.message.trim().slice(0, 240),
    workItems: args.sources.flatMap((source) => [
      buildSourceSummaryWorkItem(source),
      buildSourceClaimWorkItem(source),
    ]),
    aggregationStrategy: "chat_brain_synthesis",
    validationRules: [
      "all_work_items_completed",
      "structured_outputs_only",
      "evidence_required_for_claims",
      "deterministic_ordering",
    ],
    failurePolicy: "fallback_to_single_agent",
    plannerConfidence: args.classification.plannerConfidence,
    createdAt: new Date().toISOString(),
  };
}

export function aggregateChatSwarmFindings(args: {
  sources: ChatSwarmSourceUnit[];
  results: SwarmWorkerResult[];
}): ChatSwarmSourceFinding[] {
  return args.sources.map((source) => {
    const summaryResult = args.results.find((result) => result.workItemId === `${source.id}:summary`);
    const claimsResult = args.results.find((result) => result.workItemId === `${source.id}:claims`);
    const summary = typeof summaryResult?.output.summary === "string" ? summaryResult.output.summary : "";
    const claims = Array.isArray(claimsResult?.output.claims)
      ? claimsResult.output.claims.filter((claim): claim is ChatSwarmClaim => {
          if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
            return false;
          }
          return typeof (claim as { text?: unknown }).text === "string"
            && typeof (claim as { evidenceRef?: unknown }).evidenceRef === "string";
        })
      : [];

    return {
      sourceId: source.id,
      sourceKind: source.sourceKind,
      summary,
      claims,
      evidenceRefs: claims.map((claim) => claim.evidenceRef),
      gaps: [
        ...(summary ? [] : ["summary_missing"]),
        ...(claims.length > 0 ? [] : ["claims_missing"]),
      ],
    };
  });
}