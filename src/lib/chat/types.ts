import type { AgentProfile } from "@/lib/agent/profiles";
import type { LLMProvider } from "@/lib/agent/kernel";
import type { UsageLedgerModelPricing } from "@/lib/agent/usage-ledger-pricing";
import type {
  ChatExecutionCatalog,
  ChatExecutionMode,
  ChatMessageAttachment,
} from "@/lib/chat/execution";

export const CHAT_PREVIEW_MAX_CHARS = 80;
export const DEFAULT_CHAT_HISTORY_PAGE_SIZE = 6;
export const MAX_CHAT_HISTORY_PAGE_SIZE = 50;

export interface ChatConversationHistoryFilters {
  search: string;
  from: string | null;
  to: string | null;
}

export interface ChatBuilderProjectSummary {
  id: string;
  name: string;
  relativePath: string;
}

export interface ChatBuilderStackPresetSummary {
  key: string;
  displayName: string;
  description: string;
  template: string;
  packageManager: string;
  tags: string[];
}

export interface ChatBuilderTemplateSummary {
  key: string;
  displayName: string;
  description: string;
  defaultPackageManager: string;
}

export type BuilderOnboardingStep = "idle" | "naming" | "stack" | "configuring" | "confirming";

export interface BuilderOnboardingSpec {
  name: string;
  description: string;
  stackPresetKey: string;
  template: string;
  packageManager: string;
  docker: boolean;
  git: boolean;
}

export interface BuilderChatCardAction {
  id: "approve" | "reject" | "reconcile";
  label: string;
  variant: "primary" | "danger" | "neutral";
}

export interface BuilderChatCardProgress {
  currentIteration: number | null;
  maxIterations: number | null;
  loopPhase: string | null;
  latestLoopSummary: string | null;
}

export type BuilderChatCardSeverity = "baseline" | "benign" | "notable" | "breaking";

export interface BuilderChatCardDetailGroup {
  label: string;
  items: string[];
}

export interface BuilderChatCardDependencyDetails {
  severity: BuilderChatCardSeverity;
  reasons: string[];
  packageManagerChanged: boolean;
  lockfileChanged: boolean;
  packages: BuilderChatCardDetailGroup[];
  scripts: BuilderChatCardDetailGroup[];
}

export interface BuilderChatCardFileTopologyDetails {
  severity: BuilderChatCardSeverity;
  reasons: string[];
  directories: BuilderChatCardDetailGroup[];
  importantFiles: BuilderChatCardDetailGroup[];
  anchorsChanged: string[];
  classificationsChanged: string[];
  rulesChanged: string[];
}

export interface BuilderChatCardMcpDetails {
  severity: BuilderChatCardSeverity;
  classification: "breaking" | "non_breaking" | "internal_only";
  reasons: string[];
  changedSurfaces: string[];
  tools: BuilderChatCardDetailGroup[];
  prompts: BuilderChatCardDetailGroup[];
  resources: BuilderChatCardDetailGroup[];
  profileChanged: boolean;
  contractChanged: boolean;
}

export interface BuilderChatCardPreflightSurfaceSummary {
  id: "mcp" | "dependency" | "file_topology";
  label: string;
  severity: BuilderChatCardSeverity;
  state: string;
  summary: string;
  recommendations: string[];
}

export interface BuilderChatCardPreflightReviewDetails {
  surfaces: BuilderChatCardPreflightSurfaceSummary[];
}

export interface BuilderChatCardTaskExecutionDetails {
  changedFiles: string[];
  verificationStatus: "passed" | "failed" | "skipped" | "not_run";
  verificationSummary: string | null;
  verificationScripts: string[];
  failingScript: string | null;
  latestExcerpt: string | null;
  excerptLabel: string | null;
}

export interface BuilderChatCardDetails {
  preflightReview?: BuilderChatCardPreflightReviewDetails;
  mcpDrift?: BuilderChatCardMcpDetails;
  dependencyDrift?: BuilderChatCardDependencyDetails;
  fileTopologyDrift?: BuilderChatCardFileTopologyDetails;
  taskExecution?: BuilderChatCardTaskExecutionDetails;
}

export interface BuilderChatCard {
  id: string;
  interactionId: string;
  kind: "preflight_review" | "mcp_policy_reconciliation" | "mcp_contract_drift" | "dependency_contract_drift" | "file_topology_contract_drift" | "task_execution";
  status: "pending" | "approved" | "rejected" | "resolved" | "planned" | "running" | "succeeded" | "failed" | "cancelled";
  projectId: string;
  projectName: string;
  projectRelativePath: string;
  runId: string | null;
  taskId?: string | null;
  title: string;
  summary: string;
  state: string;
  severity?: BuilderChatCardSeverity;
  progress?: BuilderChatCardProgress;
  details?: BuilderChatCardDetails;
  badges?: string[];
  recommendations: string[];
  actions: BuilderChatCardAction[];
  updatedAt: string;
  resolvedAt: string | null;
  resolutionReason?: string | null;
}

export interface ChatConversationPagination {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface ChatConversationMessage {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
  content: string;
  createdAt: string;
  metadata?: {
    chatMode?: ChatExecutionMode;
    chatPluginId?: string;
    attachments?: ChatMessageAttachment[];
    builderCards?: BuilderChatCard[];
  } | null;
}

export interface ChatConversationSummary {
  id: string;
  title: string | null;
  label: string;
  preview: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  archivedAt: string | null;
  messageCount: number;
  defaultMode: ChatExecutionMode;
  defaultPluginId: string;
}

export interface ChatConversationDetail extends ChatConversationSummary {
  messages: ChatConversationMessage[];
}

export interface ChatExecutionDefaults {
  mode: ChatExecutionMode;
  pluginId: string;
}

export interface ChatConversationUsageSummary {
  conversationId: string | null;
  runId: string | null;
  profile: AgentProfile | null;
  profileLabel: string | null;
  provider: LLMProvider | null;
  model: string | null;
  startedAt: string | null;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
}

export interface ChatConversationBootstrap {
  currentConversationId: string | null;
  currentConversation: ChatConversationDetail | null;
  executionDefaults: ChatExecutionDefaults;
  executionCatalog: ChatExecutionCatalog;
  builderProjects: ChatBuilderProjectSummary[];
  builderStackPresets: ChatBuilderStackPresetSummary[];
  builderTemplates: ChatBuilderTemplateSummary[];
  activeRun: ChatConversationUsageSummary;
  builderInbox: BuilderChatCard[];
  modelPricing: Record<string, UsageLedgerModelPricing>;
  recentConversations: ChatConversationSummary[];
  archivedConversations: ChatConversationSummary[];
  recentPagination: ChatConversationPagination;
  archivedPagination: ChatConversationPagination;
  historyFilters: ChatConversationHistoryFilters;
}

export type { ChatExecutionCatalog, ChatExecutionMode, ChatMessageAttachment };

export function truncateChatPreview(value: string, maxChars = CHAT_PREVIEW_MAX_CHARS): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars - 1).trimEnd()}…`;
}

export function buildConversationLabel(options: {
  title?: string | null;
  firstUserMessage?: string | null;
}): string {
  const normalizedTitle = options.title?.trim();
  if (normalizedTitle) {
    return truncateChatPreview(normalizedTitle);
  }

  const fallback = options.firstUserMessage?.trim();
  if (fallback) {
    return truncateChatPreview(fallback);
  }

  return "New chat";
}