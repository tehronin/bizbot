export const CHAT_PREVIEW_MAX_CHARS = 80;

export interface ChatConversationMessage {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
  content: string;
  createdAt: string;
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
}

export interface ChatConversationDetail extends ChatConversationSummary {
  messages: ChatConversationMessage[];
}

export interface ChatConversationBootstrap {
  currentConversationId: string | null;
  currentConversation: ChatConversationDetail | null;
  recentConversations: ChatConversationSummary[];
  archivedConversations: ChatConversationSummary[];
}

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