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
  activeRun: ChatConversationUsageSummary;
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