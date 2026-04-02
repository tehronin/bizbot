import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";
import { db } from "@/lib/db";
import { createBizBotPlugin } from "@/lib/agent/plugins/contracts";
import {
  CONVERSATION_PROJECT_RELATIONSHIPS,
  CONVERSATION_SCOPE,
} from "@/lib/ontology/constants";
import {
  createOntologyEvidence,
  ensureOntologyEntity,
  ensureOntologyRelation,
  ensureUserOntologyEntity,
  getOntologyTypeVocabulary,
} from "@/lib/ontology/service";
import { normalizeOntologyToken } from "@/lib/ontology/validation";

interface InspectConversationArgs {
  conversationId: string;
  includeMessages?: boolean;
  messageLimit?: number;
}

interface SyncConversationOntologyArgs {
  conversationId: string;
  projectId?: string;
  relationType?: string;
}

interface ReviewPendingApprovalsArgs {
  conversationId: string;
  limit?: number;
}

interface BridgeConversationSnapshot {
  id: string;
  title: string | null;
  userId: string;
  userName: string | null;
  promptSummary: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: string;
  }>;
}

const BRIDGE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "be",
  "for",
  "from",
  "into",
  "need",
  "that",
  "the",
  "this",
  "with",
  "your",
]);

const DEFAULT_MESSAGE_LIMIT = 8;

function normalizeMessageLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MESSAGE_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(value ?? DEFAULT_MESSAGE_LIMIT), 1), 12);
}

function compactText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function buildConversationCorpus(conversation: BridgeConversationSnapshot): string {
  return [
    conversation.title,
    conversation.promptSummary,
    ...conversation.messages.map((message) => message.content),
  ].map((entry) => compactText(entry)).filter(Boolean).join(" ");
}

function extractKeywords(text: string, limit = 6): string[] {
  const scores = new Map<string, number>();

  for (const rawToken of text.toLowerCase().split(/[^a-z0-9]+/)) {
    const token = rawToken.trim();
    if (token.length < 4 || BRIDGE_STOP_WORDS.has(token)) {
      continue;
    }
    scores.set(token, (scores.get(token) ?? 0) + 1);
  }

  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

function collectIntentSignals(text: string): string[] {
  const normalized = text.toLowerCase();
  const signals: string[] = [];

  if (/\b(builder|project|workspace|plugin|repo|implement|code|test|scaffold)\b/.test(normalized)) {
    signals.push("builder");
  }
  if (/\b(approval|approve|pending|publish|post|queue|review)\b/.test(normalized)) {
    signals.push("approval");
  }
  if (/\b(ontology|entity|relation|workflow|preference|constraint|goal|memory)\b/.test(normalized)) {
    signals.push("ontology");
  }

  return signals;
}

function scoreKeywordOverlap(haystack: string, keywords: string[]): number {
  const normalized = haystack.toLowerCase();
  return keywords.reduce((score, keyword) => score + (normalized.includes(keyword) ? 1 : 0), 0);
}

async function loadConversationSnapshot(conversationId: string, messageLimit: number): Promise<BridgeConversationSnapshot> {
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
        },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: messageLimit,
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
        },
      },
    },
  });

  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  return {
    id: conversation.id,
    title: conversation.title,
    userId: conversation.userId,
    userName: conversation.user?.name ?? null,
    promptSummary: conversation.promptSummary,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    messages: [...conversation.messages]
      .reverse()
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      })),
  };
}

async function findProjectMatches(keywords: string[]) {
  if (keywords.length === 0) {
    return [];
  }

  const projects = await db.builderProject.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      relativePath: true,
      template: true,
      latestSessionSummary: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 25,
  });

  return projects
    .map((project) => {
      const score = scoreKeywordOverlap([
        project.name,
        project.slug,
        project.relativePath,
        project.template,
        project.latestSessionSummary ?? "",
      ].join(" "), keywords);

      return {
        id: project.id,
        name: project.name,
        slug: project.slug,
        relativePath: project.relativePath,
        template: project.template,
        latestSessionSummary: project.latestSessionSummary,
        updatedAt: project.updatedAt.toISOString(),
        score,
      };
    })
    .filter((project) => project.score > 0)
    .sort((left, right) => right.score - left.score || left.slug.localeCompare(right.slug))
    .slice(0, 5);
}

async function findRelevantApprovals(keywords: string[], limit: number) {
  const pendingCount = await db.postApproval.count({ where: { status: "PENDING" } });
  const approvals = await db.postApproval.findMany({
    where: { status: "PENDING" },
    include: {
      post: {
        include: {
          platform: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 20),
  });

  return {
    pendingCount,
    approvals: approvals
      .map((approval) => ({
        approvalId: approval.id,
        postId: approval.postId,
        notes: approval.notes,
        createdAt: approval.createdAt.toISOString(),
        platform: approval.post.platform.displayName,
        postStatus: approval.post.status,
        excerpt: compactText(approval.post.content).slice(0, 180),
        score: scoreKeywordOverlap(`${approval.notes ?? ""} ${approval.post.content}`, keywords),
      }))
      .filter((approval) => approval.score > 0 || keywords.length === 0)
      .sort((left, right) => right.score - left.score || left.createdAt.localeCompare(right.createdAt)),
  };
}

function ensureAllowedProjectRelationship(value: string | undefined): string {
  const relationType = value ?? CONVERSATION_PROJECT_RELATIONSHIPS[0];
  if (!CONVERSATION_PROJECT_RELATIONSHIPS.includes(relationType as (typeof CONVERSATION_PROJECT_RELATIONSHIPS)[number])) {
    throw new Error(`Unsupported conversation project relationship: ${relationType}`);
  }
  return relationType;
}

export const conversationBridgePlugin = createBizBotPlugin({
  metadata: {
    id: "conversation-bridge",
    displayName: "Conversation Bridge",
    description: "Inspect live conversations and bridge them deterministically into ontology context, Builder project matches, and approval-queue review.",
    tags: ["conversation", "bridge", "ontology", "builder", "approval"],
  },
  tools: [
    registerTool(defineTool({
      name: "conversation_bridge_inspect",
      description: "Inspect a conversation and synthesize deterministic cross-system context including ontology vocabulary, Builder project matches, and relevant pending approvals.",
      parameters: {
        type: "object",
        properties: {
          conversationId: { type: "string" },
          includeMessages: { type: "boolean", default: false },
          messageLimit: { type: "number", default: DEFAULT_MESSAGE_LIMIT },
        },
        required: ["conversationId"],
        additionalProperties: false,
      },
      execute: async ({ conversationId, includeMessages, messageLimit }: InspectConversationArgs) => {
        const conversation = await loadConversationSnapshot(conversationId, normalizeMessageLimit(messageLimit));
        const corpus = buildConversationCorpus(conversation);
        const keywords = extractKeywords(corpus);
        const [ontologyVocabulary, projectMatches, approvalReview] = await Promise.all([
          getOntologyTypeVocabulary(),
          findProjectMatches(keywords),
          findRelevantApprovals(keywords, 10),
        ]);

        return {
          conversation: includeMessages ? conversation : { ...conversation, messages: [] },
          keywords,
          intentSignals: collectIntentSignals(corpus),
          ontologyVocabulary,
          builderProjects: projectMatches,
          approvals: approvalReview,
        };
      },
    } satisfies ToolDefinition<InspectConversationArgs, Record<string, unknown>>)),
    registerTool(defineTool({
      name: "conversation_bridge_sync_ontology",
      description: "Create or refresh runtime ontology entities and relations for a conversation, and optionally link the thread to a Builder project.",
      parameters: {
        type: "object",
        properties: {
          conversationId: { type: "string" },
          projectId: { type: "string" },
          relationType: {
            type: "string",
            enum: [...CONVERSATION_PROJECT_RELATIONSHIPS],
            default: CONVERSATION_PROJECT_RELATIONSHIPS[0],
          },
        },
        required: ["conversationId"],
        additionalProperties: false,
      },
      execute: async ({ conversationId, projectId, relationType }: SyncConversationOntologyArgs) => {
        const conversation = await loadConversationSnapshot(conversationId, DEFAULT_MESSAGE_LIMIT);
        const corpus = buildConversationCorpus(conversation);
        const keywords = extractKeywords(corpus);
        const projectRelationship = ensureAllowedProjectRelationship(relationType);
        const userEntity = await ensureUserOntologyEntity(conversation.userId, conversation.userName ?? conversation.title ?? undefined);
        const conversationEntity = await ensureOntologyEntity({
          scope: CONVERSATION_SCOPE,
          type: "conversation",
          canonicalKey: `conversation_${normalizeOntologyToken(conversation.id)}`,
          displayName: conversation.title?.trim() || `Conversation ${conversation.id.slice(-6)}`,
          description: conversation.promptSummary ? compactText(conversation.promptSummary).slice(0, 280) : null,
          attributes: {
            conversationId: conversation.id,
            userId: conversation.userId,
            keywords,
          },
          source: "system",
          confidence: 0.9,
        });
        const participantRelation = await ensureOntologyRelation({
          scope: CONVERSATION_SCOPE,
          type: "participates_in_conversation",
          subjectEntityId: userEntity.id,
          objectEntityId: conversationEntity.id,
          attributes: {
            conversationId: conversation.id,
          },
          source: "system",
          confidence: 0.9,
        });
        const conversationEvidence = await createOntologyEvidence({
          entityId: conversationEntity.id,
          sourceKind: "system",
          sourceRef: `conversation:${conversation.id}`,
          note: "Conversation Bridge synchronized this thread into ontology context.",
        });

        const relationIds = [participantRelation.id];
        const evidenceIds = [conversationEvidence.id];
        const entityIds = [userEntity.id, conversationEntity.id];
        let projectLink: null | { projectId: string; projectEntityId: string; relationId: string; evidenceId: string; relationType: string } = null;

        if (projectId) {
          const project = await db.builderProject.findUnique({
            where: { id: projectId },
            select: {
              id: true,
              name: true,
              slug: true,
              relativePath: true,
              template: true,
            },
          });

          if (!project) {
            throw new Error(`Builder project not found: ${projectId}`);
          }

          const projectEntity = await ensureOntologyEntity({
            scope: CONVERSATION_SCOPE,
            type: "project",
            canonicalKey: `project_${normalizeOntologyToken(project.slug)}`,
            displayName: project.name,
            description: project.relativePath,
            attributes: {
              projectId: project.id,
              slug: project.slug,
              relativePath: project.relativePath,
              template: project.template,
            },
            source: "system",
            confidence: 0.85,
          });
          const projectRelation = await ensureOntologyRelation({
            scope: CONVERSATION_SCOPE,
            type: projectRelationship,
            subjectEntityId: conversationEntity.id,
            objectEntityId: projectEntity.id,
            attributes: {
              conversationId: conversation.id,
              projectId: project.id,
            },
            source: "system",
            confidence: 0.85,
          });
          const projectEvidence = await createOntologyEvidence({
            relationId: projectRelation.id,
            sourceKind: "system",
            sourceRef: `conversation:${conversation.id}`,
            note: `Conversation Bridge linked conversation ${conversation.id} to Builder project ${project.slug}.`,
          });

          entityIds.push(projectEntity.id);
          relationIds.push(projectRelation.id);
          evidenceIds.push(projectEvidence.id);
          projectLink = {
            projectId: project.id,
            projectEntityId: projectEntity.id,
            relationId: projectRelation.id,
            evidenceId: projectEvidence.id,
            relationType: projectRelationship,
          };
        }

        return {
          synchronized: true,
          scope: CONVERSATION_SCOPE,
          entityIds,
          relationIds,
          evidenceIds,
          projectLink,
          keywords,
        };
      },
    } satisfies ToolDefinition<SyncConversationOntologyArgs, Record<string, unknown>>)),
    registerTool(defineTool({
      name: "conversation_bridge_review_pending_approvals",
      description: "Rank pending approvals against the active conversation so the operator can quickly inspect approval-queue items that match the current thread.",
      parameters: {
        type: "object",
        properties: {
          conversationId: { type: "string" },
          limit: { type: "number", default: 10 },
        },
        required: ["conversationId"],
        additionalProperties: false,
      },
      execute: async ({ conversationId, limit }: ReviewPendingApprovalsArgs) => {
        const conversation = await loadConversationSnapshot(conversationId, DEFAULT_MESSAGE_LIMIT);
        const keywords = extractKeywords(buildConversationCorpus(conversation));
        return findRelevantApprovals(keywords, Math.min(Math.max(limit ?? 10, 1), 20));
      },
    } satisfies ToolDefinition<ReviewPendingApprovalsArgs, Record<string, unknown>>)),
  ],
});
