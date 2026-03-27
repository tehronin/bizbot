import {
  InboxChannelType,
  LeadStage,
  PlatformType,
  Prisma,
  type CannedResponseTree,
} from "@prisma/client";
import { db } from "@/lib/db";

type JsonValue = Prisma.JsonValue;

function isJsonRecord(value: JsonValue): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface TreeOption {
  label: string;
  nextKey: string;
  containsAny?: string[];
}

interface TreeNode {
  key: string;
  title: string;
  message: string;
  leadStage?: LeadStage;
  terminal?: boolean;
  defaultNextKey?: string;
  options: TreeOption[];
}

interface MatchRules {
  includeAny?: string[];
  excludeAny?: string[];
  websiteUrl?: string;
}

export interface InboxDecisionContext {
  id: string;
  channelType: InboxChannelType;
  content: string;
  authorName: string | null;
  authorHandle: string | null;
  platform: {
    type: PlatformType;
  };
  cannedResponseTreeId: string | null;
  cannedResponseNodeKey: string | null;
  leadStage: LeadStage;
}

export interface DeterministicReplyDraft {
  replyContent: string;
  treeId: string;
  nodeKey: string;
  leadStage: LeadStage;
}

function defaultTreeNodes(): TreeNode[] {
  return [
    {
      key: "greeting",
      title: "Greeting",
      message:
        "Thanks for reaching out, {{firstName}}. I can help with pricing, availability, and next steps. Are you looking for a quote, more info, or a quick call?",
      leadStage: LeadStage.LEAD,
      defaultNextKey: "qualify",
      options: [
        { label: "pricing", nextKey: "qualify", containsAny: ["price", "pricing", "quote", "cost"] },
        { label: "availability", nextKey: "qualify", containsAny: ["available", "availability", "book", "schedule"] },
        { label: "not interested", nextKey: "close_out", containsAny: ["not interested", "stop", "no thanks"] },
      ],
    },
    {
      key: "qualify",
      title: "Qualify",
      message:
        "Great. To point you in the right direction, what service are you after and when are you hoping to get started? If it's easier, you can also review options here: {{websiteUrl}}",
      leadStage: LeadStage.QUALIFIED,
      defaultNextKey: "pitch",
      options: [
        { label: "ready now", nextKey: "pitch", containsAny: ["asap", "today", "this week", "ready"] },
        { label: "just browsing", nextKey: "pitch", containsAny: ["looking", "exploring", "browsing"] },
      ],
    },
    {
      key: "pitch",
      title: "Pitch",
      message:
        "Based on that, the fastest next step is to review the offer and request a callback through {{websiteUrl}}. If you want, send your phone or email here and we can follow up directly.",
      leadStage: LeadStage.CONTACTED,
      defaultNextKey: "handoff",
      options: [
        { label: "shares contact", nextKey: "handoff", containsAny: ["@", "phone", "call me", "reach me"] },
        { label: "wants website", nextKey: "handoff", containsAny: ["website", "link", "url"] },
      ],
    },
    {
      key: "handoff",
      title: "Handoff",
      message:
        "Perfect. We’ve got enough to continue. Use {{websiteUrl}} to book or send over your preferred contact details here and we’ll take it from there.",
      leadStage: LeadStage.CONTACTED,
      defaultNextKey: "converted",
      options: [
        { label: "booked", nextKey: "converted", containsAny: ["booked", "done", "submitted", "scheduled"] },
      ],
    },
    {
      key: "converted",
      title: "Converted",
      message: "Excellent. You're all set. If anything changes, reply here and we’ll help.",
      leadStage: LeadStage.CONVERTED,
      terminal: true,
      options: [],
    },
    {
      key: "close_out",
      title: "Close Out",
      message: "No problem. If anything changes, our website has the latest details: {{websiteUrl}}",
      leadStage: LeadStage.LOST,
      terminal: true,
      options: [],
    },
  ];
}

function serializeTreeNodes(nodes: TreeNode[]): Prisma.InputJsonArray {
  return nodes.map((node) => ({
    key: node.key,
    title: node.title,
    message: node.message,
    ...(node.leadStage ? { leadStage: node.leadStage } : {}),
    ...(node.terminal ? { terminal: true } : {}),
    ...(node.defaultNextKey ? { defaultNextKey: node.defaultNextKey } : {}),
    options: node.options.map((option) => ({
      label: option.label,
      nextKey: option.nextKey,
      ...(option.containsAny ? { containsAny: option.containsAny } : {}),
    })),
  }));
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function containsAny(haystack: string, needles: string[] | undefined): boolean {
  if (!needles || needles.length === 0) {
    return false;
  }

  return needles.some((needle) => haystack.includes(normalizeText(needle)));
}

function parseStringArray(value: JsonValue | undefined): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return entries.length > 0 ? entries : undefined;
}

function parseLeadStage(value: JsonValue | undefined): LeadStage | undefined {
  switch (value) {
    case LeadStage.NONE:
    case LeadStage.LEAD:
    case LeadStage.QUALIFIED:
    case LeadStage.CONTACTED:
    case LeadStage.CONVERTED:
    case LeadStage.LOST:
      return value;
    default:
      return undefined;
  }
}

function parseTreeOption(value: JsonValue): TreeOption | null {
  if (!isJsonRecord(value)) {
    return null;
  }

  if (typeof value.label !== "string" || typeof value.nextKey !== "string") {
    return null;
  }

  return {
    label: value.label,
    nextKey: value.nextKey,
    containsAny: parseStringArray(value.containsAny),
  };
}

function parseTreeNode(value: JsonValue): TreeNode | null {
  if (!isJsonRecord(value)) {
    return null;
  }

  if (typeof value.key !== "string" || typeof value.title !== "string" || typeof value.message !== "string") {
    return null;
  }

  const options = Array.isArray(value.options)
    ? value.options.map(parseTreeOption).filter((option): option is TreeOption => option !== null)
    : [];

  return {
    key: value.key,
    title: value.title,
    message: value.message,
    leadStage: parseLeadStage(value.leadStage),
    terminal: value.terminal === true,
    defaultNextKey: typeof value.defaultNextKey === "string" ? value.defaultNextKey : undefined,
    options,
  };
}

function parseTreeNodes(value: JsonValue): TreeNode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(parseTreeNode).filter((node): node is TreeNode => node !== null);
}

function parseMatchRules(value: JsonValue | null): MatchRules {
  if (!value || !isJsonRecord(value)) {
    return {};
  }

  return {
    includeAny: parseStringArray(value.includeAny),
    excludeAny: parseStringArray(value.excludeAny),
    websiteUrl: typeof value.websiteUrl === "string" ? value.websiteUrl : undefined,
  };
}

function findNode(nodes: TreeNode[], key: string): TreeNode | undefined {
  return nodes.find((node) => node.key === key);
}

function renderMessage(template: string, item: InboxDecisionContext, rules: MatchRules): string {
  const firstName = item.authorName?.split(" ")[0] ?? item.authorHandle ?? "there";
  const websiteUrl = rules.websiteUrl ?? "https://example.com";

  return template
    .replaceAll("{{firstName}}", firstName)
    .replaceAll("{{authorName}}", item.authorName ?? item.authorHandle ?? "there")
    .replaceAll("{{websiteUrl}}", websiteUrl);
}

function matchesTree(tree: CannedResponseTree, item: InboxDecisionContext): boolean {
  if (!tree.active) {
    return false;
  }
  if (tree.channelType && tree.channelType !== item.channelType) {
    return false;
  }
  if (tree.platformHint && tree.platformHint !== item.platform.type) {
    return false;
  }

  const rules = parseMatchRules(tree.matchRules);
  const haystack = normalizeText(item.content);
  if (containsAny(haystack, rules.excludeAny)) {
    return false;
  }
  if (rules.includeAny && !containsAny(haystack, rules.includeAny)) {
    return false;
  }

  return true;
}

function chooseNextNode(nodes: TreeNode[], currentNode: TreeNode, message: string): TreeNode {
  const haystack = normalizeText(message);
  const matchedOption = currentNode.options.find((option) => containsAny(haystack, option.containsAny));
  const fallbackKey = matchedOption?.nextKey ?? currentNode.defaultNextKey ?? currentNode.key;
  return findNode(nodes, fallbackKey) ?? currentNode;
}

export async function ensureDefaultCannedResponseTree(): Promise<CannedResponseTree> {
  const existing = await db.cannedResponseTree.findFirst({
    where: { name: "Default DM Qualification Funnel" },
  });

  if (existing) {
    return existing;
  }

  return db.cannedResponseTree.create({
    data: {
      name: "Default DM Qualification Funnel",
      description: "Greeting -> qualify -> pitch -> handoff -> conversion website funnel for direct messages.",
      active: true,
      channelType: InboxChannelType.DIRECT_MESSAGE,
      rootNodeKey: "greeting",
      nodes: serializeTreeNodes(defaultTreeNodes()),
      matchRules: {
        includeAny: ["quote", "pricing", "service", "help", "available", "book"],
        websiteUrl: "https://example.com",
      },
    },
  });
}

export async function listCannedResponseTrees(): Promise<CannedResponseTree[]> {
  await ensureDefaultCannedResponseTree();
  return db.cannedResponseTree.findMany({
    orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
  });
}

export async function updateCannedResponseTree(
  id: string,
  input: {
    name?: string;
    description?: string | null;
    active?: boolean;
    rootNodeKey?: string;
    nodes?: JsonValue;
    matchRules?: JsonValue | null;
  },
): Promise<CannedResponseTree> {
  return db.cannedResponseTree.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.rootNodeKey !== undefined ? { rootNodeKey: input.rootNodeKey } : {}),
      ...(input.nodes !== undefined && input.nodes !== null ? { nodes: input.nodes } : {}),
      ...(input.matchRules !== undefined
        ? { matchRules: input.matchRules === null ? Prisma.DbNull : input.matchRules }
        : {}),
    },
  });
}

async function selectTree(item: InboxDecisionContext): Promise<CannedResponseTree | null> {
  if (item.cannedResponseTreeId) {
    const existing = await db.cannedResponseTree.findUnique({ where: { id: item.cannedResponseTreeId } });
    if (existing) {
      return existing;
    }
  }

  const trees = await listCannedResponseTrees();
  return trees.find((tree) => matchesTree(tree, item)) ?? null;
}

export async function buildDeterministicReplyDraft(
  item: InboxDecisionContext,
): Promise<DeterministicReplyDraft | null> {
  if (item.channelType !== InboxChannelType.DIRECT_MESSAGE) {
    return null;
  }

  const tree = await selectTree(item);
  if (!tree) {
    return null;
  }

  const nodes = parseTreeNodes(tree.nodes);
  if (nodes.length === 0) {
    return null;
  }

  const rules = parseMatchRules(tree.matchRules);
  const currentNode = item.cannedResponseNodeKey
    ? findNode(nodes, item.cannedResponseNodeKey) ?? findNode(nodes, tree.rootNodeKey)
    : findNode(nodes, tree.rootNodeKey);

  if (!currentNode) {
    return null;
  }

  const targetNode = item.cannedResponseNodeKey
    ? chooseNextNode(nodes, currentNode, item.content)
    : currentNode;

  return {
    replyContent: renderMessage(targetNode.message, item, rules),
    treeId: tree.id,
    nodeKey: targetNode.key,
    leadStage: targetNode.leadStage ?? item.leadStage,
  };
}