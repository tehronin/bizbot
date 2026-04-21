"use client";

import { usePathname } from "next/navigation";
import { useEffect, useReducer, useRef, useState, useTransition } from "react";
import type {
  BuilderChatCard,
  BuilderChatCardProgress,
  BuilderOnboardingSpec,
  BuilderOnboardingStep,
  ChatBuilderProjectSummary,
  ChatCreeperCompanyProfileSummary,
  ChatBuilderStackPresetSummary,
  ChatBuilderTemplateSummary,
  ChatConversationBootstrap,
  ChatConversationDetail,
  ChatExecutionCatalog,
  ChatExecutionMode,
  ChatConversationHistoryFilters,
  ChatMessageAttachment,
  ChatConversationMessage,
  ChatConversationPagination,
  ChatConversationSummary,
  ChatConversationUsageSummary,
  ChatVerbosity,
} from "@/lib/chat/types";
import { CHAT_VERBOSITY_SETTING_KEY } from "@/lib/chat/types";
import type { UsageLedgerModelPricing } from "@/lib/agent/usage-ledger-pricing";
import {
  BIZBOT_SIDECAR_EVENT,
  BIZBOT_SIDECAR_INTERACTION_EVENT,
} from "@/lib/sidecar/types";
import type {
  SidecarAction,
  SidecarInteractionEventDetail,
  SidecarInteractionResult,
  SidecarPanel,
} from "@/lib/sidecar/types";

export interface ChatEntry {
  id: string;
  role: "user" | "assistant" | "status" | "tool" | "meta";
  content: string;
  chatMode?: ChatExecutionMode;
  chatPluginId?: string;
  attachments?: ChatMessageAttachment[];
  runId?: string;
  profile?: string;
  profileLabel?: string;
  provider?: string;
  model?: string;
  name?: string;
  args?: string;
  result?: string;
  round?: number;
  phase?: "call" | "result";
  builderCards?: BuilderChatCard[];
}

export interface PendingAssistantTurn {
  id: string;
  conversationId: string | null;
  runId: string | null;
  chatMode?: ChatExecutionMode;
  chatPluginId?: string;
  builderProjectId: string | null;
  builderTaskId: string | null;
  content: string;
  activityEntries: ChatEntry[];
  builderProgress: BuilderChatCardProgress | null;
}

interface AgentResponse {
  reply: string;
  conversationId: string;
  runId: string;
}

interface AgentStreamEvent {
  type: "meta" | "usage" | "status" | "tool_call" | "tool_result" | "sidecar" | "assistant_message" | "done" | "error";
  conversationId?: string;
  runId?: string;
  profile?: string;
  profileLabel?: string;
  provider?: string;
  model?: string;
  round?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedPromptTokens?: number;
  requestCount?: number;
  content?: string;
  message?: string;
  reply?: string;
  error?: string;
  name?: string;
  args?: object;
  result?: string;
  action?: SidecarAction;
  panel?: SidecarPanel | null;
}

export interface ActiveRunState {
  conversationId: string | null;
  runId: string | null;
  profile: string | null;
  profileLabel: string | null;
  provider: string | null;
  model: string | null;
  startedAt: string | null;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
}

export interface PendingResumePrompt {
  runId: string;
  summary: string;
  mode: ChatExecutionMode;
  pluginId: string;
}

export interface UseChatResult {
  messages: ChatEntry[];
  pendingResumePrompt: PendingResumePrompt | null;
  pendingAssistantTurn: PendingAssistantTurn | null;
  builderInbox: BuilderChatCard[];
  builderProjects: ChatBuilderProjectSummary[];
  builderProjectConversations: ChatConversationSummary[];
  creeperCompanyProfiles: ChatCreeperCompanyProfileSummary[];
  builderStackPresets: ChatBuilderStackPresetSummary[];
  builderTemplates: ChatBuilderTemplateSummary[];
  builderOnboarding: { step: BuilderOnboardingStep; spec: BuilderOnboardingSpec } | null;
  selectedBuilderProjectId: string | null;
  selectedCreeperCompanyProfileId: string | null;
  conversationId: string | null;
  currentConversation: ChatConversationDetail | null;
  recentConversations: ChatConversationSummary[];
  archivedConversations: ChatConversationSummary[];
  recentPagination: ChatConversationPagination;
  archivedPagination: ChatConversationPagination;
  historyFilters: ChatConversationHistoryFilters;
  historyConversation: ChatConversationDetail | null;
  isPending: boolean;
  isBootstrapping: boolean;
  isLoadingHistoryConversation: boolean;
  isLoadingHistoryLists: boolean;
  activeRun: ActiveRunState;
  activeBuilderProgress: BuilderChatCardProgress | null;
  modelPricing: Record<string, UsageLedgerModelPricing>;
  executionCatalog: ChatExecutionCatalog;
  executionMode: ChatExecutionMode;
  executionPluginId: string;
  chatVerbosity: ChatVerbosity;
  setExecutionMode: React.Dispatch<React.SetStateAction<ChatExecutionMode>>;
  setExecutionPluginId: React.Dispatch<React.SetStateAction<string>>;
  setChatVerbosity: (value: ChatVerbosity) => Promise<void>;
  setSelectedBuilderProjectId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedCreeperCompanyProfileId: React.Dispatch<React.SetStateAction<string | null>>;
  startBuilderOnboarding: () => void;
  updateBuilderOnboardingSpec: (updates: Partial<BuilderOnboardingSpec>) => void;
  setBuilderOnboardingStep: (step: BuilderOnboardingStep) => void;
  cancelBuilderOnboarding: () => void;
  confirmBuilderOnboarding: () => Promise<void>;
  resolveBuilderInteraction: (interactionId: string, action: "approve" | "reject" | "reconcile") => Promise<void>;
  launchBuilderTaskFromChat: (request: string, options?: { projectId?: string | null; retryFailed?: boolean }) => Promise<void>;
  sendMessage: (input: string, options?: { mode?: ChatExecutionMode; pluginId?: string; attachments?: ChatMessageAttachment[] }) => Promise<void>;
  sendOraclePrediction: (input: string, options?: { attachments?: ChatMessageAttachment[] }) => Promise<void>;
  resolvePendingResumePrompt: (decision: "resume" | "dismiss") => Promise<void>;
  startNewChat: () => void;
  loadConversation: (nextConversationId: string) => Promise<void>;
  archiveConversation: (nextConversationId: string) => Promise<void>;
  archiveCurrentConversation: () => Promise<void>;
  openHistoryConversation: (nextConversationId: string) => Promise<void>;
  restoreConversation: (nextConversationId: string) => Promise<void>;
  deleteConversation: (nextConversationId: string) => Promise<void>;
  applyHistoryFilters: (nextFilters: ChatConversationHistoryFilters) => Promise<void>;
  clearHistoryFilters: () => Promise<void>;
  setRecentHistoryPage: React.Dispatch<React.SetStateAction<number>>;
  setArchivedHistoryPage: React.Dispatch<React.SetStateAction<number>>;
}

const SELECTED_CONVERSATION_STORAGE_KEY = "bizbot:selected-chat-conversation-id";
const EXECUTION_MODE_STORAGE_KEY = "bizbot:chat-execution-mode";
const EXECUTION_PLUGIN_STORAGE_KEY = "bizbot:chat-execution-plugin";

interface InternalActiveRunState extends ActiveRunState {
  runBaseRequestCount: number;
  runBasePromptTokens: number;
  runBaseCompletionTokens: number;
  runBaseTotalTokens: number;
  runBaseCachedPromptTokens: number;
}

interface ExecutionSelection {
  mode: ChatExecutionMode;
  pluginId: string;
}

interface BootstrapRequestOptions {
  selectedConversationId?: string | null;
  selectedBuilderProjectId?: string | null;
  selectedCreeperCompanyProfileId?: string | null;
  replaceCurrent?: boolean;
  recentPage?: number;
  archivedPage?: number;
  historyFilters?: ChatConversationHistoryFilters;
}

interface ScheduledBootstrapRequest {
  id: number;
  options?: BootstrapRequestOptions;
  showPending: boolean;
}

type PendingAssistantTurnAction =
  | {
    type: "start";
    conversationId?: string | null;
    runId?: string | null;
    chatMode?: ChatExecutionMode;
    chatPluginId?: string;
    builderProjectId?: string | null;
  }
  | {
    type: "append-activity";
    entry: ChatEntry;
    conversationId?: string | null;
    runId?: string | null;
  }
  | {
    type: "set-content";
    content: string;
    conversationId?: string | null;
    runId?: string | null;
  }
  | {
    type: "set-builder-progress";
    progress: BuilderChatCardProgress | null;
    taskId?: string | null;
    builderProjectId?: string | null;
    conversationId?: string | null;
  }
  | {
    type: "sync";
    conversationId?: string | null;
    runId?: string | null;
    chatMode?: ChatExecutionMode;
    chatPluginId?: string;
    builderProjectId?: string | null;
  }
  | { type: "clear" };

const IDLE_ACTIVE_RUN: InternalActiveRunState = {
  conversationId: null,
  runId: null,
  profile: null,
  profileLabel: null,
  provider: null,
  model: null,
  startedAt: null,
  requestCount: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cachedPromptTokens: 0,
  runBaseRequestCount: 0,
  runBasePromptTokens: 0,
  runBaseCompletionTokens: 0,
  runBaseTotalTokens: 0,
  runBaseCachedPromptTokens: 0,
};

const DEFAULT_HISTORY_FILTERS: ChatConversationHistoryFilters = {
  search: "",
  from: null,
  to: null,
};

const DEFAULT_HISTORY_PAGINATION: ChatConversationPagination = {
  currentPage: 1,
  pageSize: 6,
  totalItems: 0,
  totalPages: 1,
};

const EMPTY_EXECUTION_CATALOG: ChatExecutionCatalog = {
  defaults: {
    mode: "ask",
    pluginId: "just-chatting",
  },
  plugins: [{
    id: "just-chatting",
    displayName: "Just Chatting",
    description: "Full-context chat and planning without tool execution.",
    accentColor: "#38bdf8",
    accentSurface: "rgba(56,189,248,0.12)",
    accentBorder: "rgba(56,189,248,0.36)",
    toollessInAsk: true,
    toollessInAgent: true,
  }],
};

function getStoredSelectedConversationId(): string | null {
  if (typeof window === "undefined" || typeof window.localStorage?.getItem !== "function") {
    return null;
  }

  return window.localStorage.getItem(SELECTED_CONVERSATION_STORAGE_KEY);
}

function persistSelectedConversationId(nextConversationId: string | null): void {
  if (
    typeof window === "undefined"
    || typeof window.localStorage?.setItem !== "function"
    || typeof window.localStorage?.removeItem !== "function"
  ) {
    return;
  }

  if (nextConversationId) {
    window.localStorage.setItem(SELECTED_CONVERSATION_STORAGE_KEY, nextConversationId);
    return;
  }

  window.localStorage.removeItem(SELECTED_CONVERSATION_STORAGE_KEY);
}

function getStoredExecutionPreference(): { mode: ChatExecutionMode; pluginId: string } | null {
  if (typeof window === "undefined" || typeof window.localStorage?.getItem !== "function") {
    return null;
  }

  const mode = window.localStorage.getItem(EXECUTION_MODE_STORAGE_KEY);
  const pluginId = window.localStorage.getItem(EXECUTION_PLUGIN_STORAGE_KEY);
  if ((mode !== "ask" && mode !== "agent") || !pluginId) {
    return null;
  }

  return { mode, pluginId };
}

function persistExecutionPreference(preference: { mode: ChatExecutionMode; pluginId: string }): void {
  if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") {
    return;
  }

  window.localStorage.setItem(EXECUTION_MODE_STORAGE_KEY, preference.mode);
  window.localStorage.setItem(EXECUTION_PLUGIN_STORAGE_KEY, preference.pluginId);
}

function toPublicActiveRun(state: InternalActiveRunState): ActiveRunState {
  return {
    conversationId: state.conversationId,
    runId: state.runId,
    profile: state.profile,
    profileLabel: state.profileLabel,
    provider: state.provider,
    model: state.model,
    startedAt: state.startedAt,
    requestCount: state.requestCount,
    promptTokens: state.promptTokens,
    completionTokens: state.completionTokens,
    totalTokens: state.totalTokens,
    cachedPromptTokens: state.cachedPromptTokens,
  };
}

function createInternalActiveRun(state?: ChatConversationUsageSummary | ActiveRunState | null): InternalActiveRunState {
  if (!state) {
    return { ...IDLE_ACTIVE_RUN };
  }

  return {
    ...state,
    runBaseRequestCount: state.requestCount,
    runBasePromptTokens: state.promptTokens,
    runBaseCompletionTokens: state.completionTokens,
    runBaseTotalTokens: state.totalTokens,
    runBaseCachedPromptTokens: state.cachedPromptTokens,
  };
}

function createEntry(
  role: ChatEntry["role"],
  content: string,
  metadata?: Partial<Pick<ChatEntry, "chatMode" | "chatPluginId" | "attachments" | "builderCards">>,
): ChatEntry {
  return {
    id: `${role}-${crypto.randomUUID()}`,
    role,
    content,
    ...(metadata ?? {}),
  };
}

function createPendingAssistantTurn(options?: {
  conversationId?: string | null;
  runId?: string | null;
  chatMode?: ChatExecutionMode;
  chatPluginId?: string;
  builderProjectId?: string | null;
}): PendingAssistantTurn {
  return {
    id: `pending-assistant-${crypto.randomUUID()}`,
    conversationId: options?.conversationId ?? null,
    runId: options?.runId ?? null,
    chatMode: options?.chatMode,
    chatPluginId: options?.chatPluginId,
    builderProjectId: options?.builderProjectId ?? null,
    builderTaskId: null,
    content: "",
    activityEntries: [],
    builderProgress: null,
  };
}

function ensurePendingAssistantTurn(
  state: PendingAssistantTurn | null,
  options?: {
    conversationId?: string | null;
    runId?: string | null;
    chatMode?: ChatExecutionMode;
    chatPluginId?: string;
    builderProjectId?: string | null;
  },
): PendingAssistantTurn {
  if (!state) {
    return createPendingAssistantTurn(options);
  }

  return {
    ...state,
    conversationId: options?.conversationId ?? state.conversationId,
    runId: options?.runId ?? state.runId,
    chatMode: options?.chatMode ?? state.chatMode,
    chatPluginId: options?.chatPluginId ?? state.chatPluginId,
    builderProjectId: options?.builderProjectId ?? state.builderProjectId,
  };
}

function pendingAssistantTurnReducer(
  state: PendingAssistantTurn | null,
  action: PendingAssistantTurnAction,
): PendingAssistantTurn | null {
  switch (action.type) {
    case "start":
      return createPendingAssistantTurn(action);
    case "append-activity": {
      const next = ensurePendingAssistantTurn(state, action);
      return {
        ...next,
        activityEntries: [...next.activityEntries, action.entry],
      };
    }
    case "set-content": {
      const next = ensurePendingAssistantTurn(state, action);
      return {
        ...next,
        content: action.content,
      };
    }
    case "set-builder-progress": {
      const next = ensurePendingAssistantTurn(state, {
        conversationId: action.conversationId,
        builderProjectId: action.builderProjectId,
        chatPluginId: "builder",
      });
      return {
        ...next,
        builderTaskId: action.taskId ?? next.builderTaskId,
        builderProgress: action.progress,
      };
    }
    case "sync":
      return ensurePendingAssistantTurn(state, action);
    case "clear":
      return null;
    default:
      return state;
  }
}

function mapStreamEventToActivityEntry(event: AgentStreamEvent): ChatEntry | null {
  switch (event.type) {
    case "meta":
      return {
        id: `meta-${event.runId ?? crypto.randomUUID()}`,
        role: "meta",
        content: `${event.profileLabel ?? event.profile ?? "Agent"} routed this request.`,
        runId: event.runId,
        profile: event.profile,
        profileLabel: event.profileLabel,
        provider: event.provider,
        model: event.model,
      };
    case "status":
      return createEntry("status", event.message ?? "Working...");
    case "tool_call":
      return {
        id: `tool-call-${event.runId ?? crypto.randomUUID()}-${event.name ?? "tool"}-${event.round ?? 0}`,
        role: "tool",
        content: `Calling ${event.name ?? "tool"}`,
        name: event.name,
        args: event.args ? JSON.stringify(event.args, null, 2) : undefined,
        round: event.round,
        phase: "call",
      };
    case "tool_result":
      return {
        id: `tool-result-${event.runId ?? crypto.randomUUID()}-${event.name ?? "tool"}-${event.round ?? 0}`,
        role: "tool",
        content: `${event.name ?? "tool"} completed.`,
        name: event.name,
        result: event.result,
        round: event.round,
        phase: "result",
      };
    default:
      return null;
  }
}

function parseSsePayload(buffer: string): {
  events: AgentStreamEvent[];
  remainder: string;
} {
  const blocks = buffer.split("\n\n");
  const remainder = blocks.pop() ?? "";
  const events: AgentStreamEvent[] = [];

  for (const block of blocks) {
    const dataLine = block
      .split("\n")
      .find((line) => line.startsWith("data: "));
    if (!dataLine) {
      continue;
    }

    try {
      events.push(JSON.parse(dataLine.slice(6)) as AgentStreamEvent);
    } catch {
      // ignore malformed event
    }
  }

  return { events, remainder };
}

function mapConversationMessageToEntry(message: ChatConversationMessage): ChatEntry {
  const metadata = message.metadata ?? {};

  if (message.role === "USER") {
    return {
      id: message.id,
      role: "user",
      content: message.content,
      ...metadata,
    };
  }

  if (message.role === "ASSISTANT") {
    return {
      id: message.id,
      role: "assistant",
      content: message.content,
      ...metadata,
    };
  }

  if (message.role === "TOOL") {
    return {
      id: message.id,
      role: "tool",
      content: message.content,
      ...metadata,
    };
  }

  return {
    id: message.id,
    role: "meta",
    content: message.content,
    ...metadata,
  };
}

function mapConversationMessages(messages: ChatConversationMessage[]): ChatEntry[] {
  return messages.map(mapConversationMessageToEntry);
}

function haveEquivalentChatEntries(current: ChatEntry[], next: ChatEntry[]): boolean {
  return JSON.stringify(current) === JSON.stringify(next);
}

async function readJson<T>(response: Response): Promise<T> {
  if (typeof response.text !== "function") {
    if (typeof response.json === "function") {
      return response.json() as Promise<T>;
    }

    return {} as T;
  }

  const payloadText = await response.text();
  if (!payloadText.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(payloadText) as T;
  } catch (error) {
    if (!response.ok) {
      return { error: `Request failed with status ${response.status}.` } as T;
    }

    throw error instanceof Error
      ? error
      : new Error(`Invalid JSON response from ${response.url || "request"}.`);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function shouldIgnoreCancelledRequest(error: unknown, signal?: AbortSignal): boolean {
  if (isAbortError(error)) {
    return true;
  }

  return Boolean(signal?.aborted);
}

function summarizeResumeFailure(message: string): string {
  const normalized = message.replace(/^Request failed:\s*/i, "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "the run stopped unexpectedly";
  }

  return normalized.length > 160 ? `${normalized.slice(0, 157).trimEnd()}...` : normalized;
}

function buildResumePromptMessage(summary: string): string {
  return `I can try to resume the last run from its last stable checkpoint. It stopped because ${summary}. Reply yes to resume or no to skip.`;
}

function mergeBootstrapMessages(
  current: ChatEntry[],
  next: ChatEntry[],
  pendingPrompt: PendingResumePrompt | null,
): ChatEntry[] {
  if (!pendingPrompt) {
    return next;
  }

  const promptMessage = buildResumePromptMessage(pendingPrompt.summary);
  const nextAlreadyHasPrompt = next.some((entry) => entry.role === "assistant" && entry.content === promptMessage);
  if (nextAlreadyHasPrompt) {
    return next;
  }

  const existingPrompt = current.find((entry) => entry.role === "assistant" && entry.content === promptMessage)
    ?? createEntry("assistant", promptMessage);

  return [...next, existingPrompt];
}

export function useChat(): UseChatResult {
  const pathname = usePathname();
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [pendingResumePrompt, setPendingResumePrompt] = useState<PendingResumePrompt | null>(null);
  const [pendingAssistantTurn, dispatchPendingAssistantTurn] = useReducer(pendingAssistantTurnReducer, null);
  const [builderInbox, setBuilderInbox] = useState<BuilderChatCard[]>([]);
  const [builderProjects, setBuilderProjects] = useState<ChatBuilderProjectSummary[]>([]);
  const [builderProjectConversations, setBuilderProjectConversations] = useState<ChatConversationSummary[]>([]);
  const [creeperCompanyProfiles, setCreeperCompanyProfiles] = useState<ChatCreeperCompanyProfileSummary[]>([]);
  const [builderStackPresets, setBuilderStackPresets] = useState<ChatBuilderStackPresetSummary[]>([]);
  const [builderTemplates, setBuilderTemplates] = useState<ChatBuilderTemplateSummary[]>([]);
  const [builderOnboarding, setBuilderOnboarding] = useState<{ step: BuilderOnboardingStep; spec: BuilderOnboardingSpec } | null>(null);
  const [selectedBuilderProjectId, setSelectedBuilderProjectIdState] = useState<string | null>(null);
  const [selectedCreeperCompanyProfileId, setSelectedCreeperCompanyProfileIdState] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [currentConversation, setCurrentConversation] = useState<ChatConversationDetail | null>(null);
  const [recentConversations, setRecentConversations] = useState<ChatConversationSummary[]>([]);
  const [archivedConversations, setArchivedConversations] = useState<ChatConversationSummary[]>([]);
  const [recentPagination, setRecentPagination] = useState<ChatConversationPagination>(DEFAULT_HISTORY_PAGINATION);
  const [archivedPagination, setArchivedPagination] = useState<ChatConversationPagination>(DEFAULT_HISTORY_PAGINATION);
  const [historyFilters, setHistoryFilters] = useState<ChatConversationHistoryFilters>(DEFAULT_HISTORY_FILTERS);
  const [historyConversation, setHistoryConversation] = useState<ChatConversationDetail | null>(null);
  const [activeRun, setActiveRun] = useState<InternalActiveRunState>(IDLE_ACTIVE_RUN);
  const [modelPricing, setModelPricing] = useState<Record<string, UsageLedgerModelPricing>>({});
  const [executionCatalog, setExecutionCatalog] = useState<ChatExecutionCatalog>(EMPTY_EXECUTION_CATALOG);
  const [executionMode, setExecutionModeState] = useState<ChatExecutionMode>(EMPTY_EXECUTION_CATALOG.defaults.mode);
  const [executionPluginId, setExecutionPluginIdState] = useState<string>(EMPTY_EXECUTION_CATALOG.defaults.pluginId);
  const [chatVerbosity, setChatVerbosityState] = useState<ChatVerbosity>("concise");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isExecutionPreferenceHydrated, setIsExecutionPreferenceHydrated] = useState(false);
  const [isLoadingHistoryConversation, setIsLoadingHistoryConversation] = useState(false);
  const [isLoadingHistoryLists, setIsLoadingHistoryLists] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [activeBuilderTaskId, setActiveBuilderTaskId] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  isMountedRef.current = true;
  const completionPublishedTaskIdsRef = useRef<Set<string>>(new Set());
  const syncedExecutionDefaultsRef = useRef<string | null>(null);
  const shouldSyncExecutionDefaultsRef = useRef(false);
  const bootstrapAbortControllerRef = useRef<AbortController | null>(null);
  const bootstrapRequestIdRef = useRef(0);
  const bootstrapRequestKeyRef = useRef<string | null>(null);
  const bootstrapPromiseRef = useRef<Promise<void> | null>(null);
  const bootstrapScheduleIdRef = useRef(0);
  const bootstrapPendingResolversRef = useRef(new Map<number, { resolve: () => void; reject: (error: unknown) => void }>());
  const passiveBootstrapKeyRef = useRef<string | null>(null);
  const hasLoadedBootstrapRef = useRef(false);
  const creeperSelectionAbortControllerRef = useRef<AbortController | null>(null);
  const creeperSelectionRequestIdRef = useRef(0);
  const sidecarInteractionAbortControllerRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const pendingResumePromptRef = useRef(pendingResumePrompt);
  pendingResumePromptRef.current = pendingResumePrompt;
  const activeRunRef = useRef(activeRun);
  activeRunRef.current = activeRun;
  const selectedBuilderProjectIdRef = useRef(selectedBuilderProjectId);
  selectedBuilderProjectIdRef.current = selectedBuilderProjectId;
  const selectedCreeperCompanyProfileIdRef = useRef(selectedCreeperCompanyProfileId);
  selectedCreeperCompanyProfileIdRef.current = selectedCreeperCompanyProfileId;
  const previousCreeperCompanyProfileIdRef = useRef(selectedCreeperCompanyProfileId);
  const [scheduledBootstrapRequest, setScheduledBootstrapRequest] = useState<ScheduledBootstrapRequest | null>(null);

  function applyExecutionSelection(nextSelection: ExecutionSelection, options?: {
    syncConversation?: boolean;
    conversationId?: string | null;
  }): void {
    shouldSyncExecutionDefaultsRef.current = options?.syncConversation ?? false;
    syncedExecutionDefaultsRef.current = options?.conversationId
      ? `${options.conversationId}:${nextSelection.mode}:${nextSelection.pluginId}`
      : null;
    setExecutionModeState(nextSelection.mode);
    setExecutionPluginIdState(nextSelection.pluginId);
  }

  const setExecutionMode: React.Dispatch<React.SetStateAction<ChatExecutionMode>> = (value) => {
    shouldSyncExecutionDefaultsRef.current = true;
    syncedExecutionDefaultsRef.current = null;
    setExecutionModeState(value);
  };

  const setExecutionPluginId: React.Dispatch<React.SetStateAction<string>> = (value) => {
    shouldSyncExecutionDefaultsRef.current = true;
    syncedExecutionDefaultsRef.current = null;
    setExecutionPluginIdState(value);
  };

  const setSelectedBuilderProjectId: React.Dispatch<React.SetStateAction<string | null>> = (value) => {
    setSelectedBuilderProjectIdState(value);
  };

  const setSelectedCreeperCompanyProfileId: React.Dispatch<React.SetStateAction<string | null>> = (value) => {
    setSelectedCreeperCompanyProfileIdState(value);
  };

  useEffect(() => {
    if (previousCreeperCompanyProfileIdRef.current === selectedCreeperCompanyProfileId) {
      return;
    }
    previousCreeperCompanyProfileIdRef.current = selectedCreeperCompanyProfileId;

    if (pathname !== "/chat") {
      creeperSelectionAbortControllerRef.current?.abort();
      return;
    }

    const currentConversationId = conversationIdRef.current;
    if (!currentConversationId) {
      return;
    }

    const nextCompanyProfileId = selectedCreeperCompanyProfileId;
    const controller = new AbortController();
    const requestId = creeperSelectionRequestIdRef.current + 1;
    creeperSelectionRequestIdRef.current = requestId;
    creeperSelectionAbortControllerRef.current?.abort();
    creeperSelectionAbortControllerRef.current = controller;

    void fetch(`/api/chat/conversations/${currentConversationId}/company`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ companyProfileId: nextCompanyProfileId }),
    })
      .then(async (response) => {
        const payload = await readJson<{ error?: string }>(response);
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to update chat company selection.");
        }

        if (
          controller.signal.aborted
          || requestId !== creeperSelectionRequestIdRef.current
          || pathname !== "/chat"
          || conversationIdRef.current !== currentConversationId
          || selectedCreeperCompanyProfileIdRef.current !== nextCompanyProfileId
        ) {
          return;
        }

        await requestBootstrap({
          selectedConversationId: currentConversationId,
          selectedCreeperCompanyProfileId: nextCompanyProfileId,
          replaceCurrent: true,
        });
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          console.error("[chat creeper selection]", error);
        }
      })
      .finally(() => {
        if (creeperSelectionAbortControllerRef.current === controller) {
          creeperSelectionAbortControllerRef.current = null;
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, selectedCreeperCompanyProfileId]);

  useEffect(() => () => {
    isMountedRef.current = false;
    bootstrapAbortControllerRef.current?.abort();
    creeperSelectionAbortControllerRef.current?.abort();
    sidecarInteractionAbortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    // Restore stored preference on client-only mount (SSR-safe: runs after hydration)
    const stored = getStoredExecutionPreference();
    if (stored) {
      applyExecutionSelection(stored);
    }
    setIsExecutionPreferenceHydrated(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isExecutionPreferenceHydrated) {
      return;
    }

    persistExecutionPreference({ mode: executionMode, pluginId: executionPluginId });
  }, [executionMode, executionPluginId, isExecutionPreferenceHydrated]);

  useEffect(() => {
    if (!conversationId || isBootstrapping || !shouldSyncExecutionDefaultsRef.current) {
      return;
    }

    const key = `${conversationId}:${executionMode}:${executionPluginId}`;
    if (syncedExecutionDefaultsRef.current === key) {
      shouldSyncExecutionDefaultsRef.current = false;
      return;
    }

    syncedExecutionDefaultsRef.current = key;
    shouldSyncExecutionDefaultsRef.current = false;
    void fetch(`/api/chat/conversations/${conversationId}/defaults`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: executionMode, pluginId: executionPluginId }),
    }).catch(() => {
      syncedExecutionDefaultsRef.current = null;
      shouldSyncExecutionDefaultsRef.current = true;
    });
  }, [conversationId, executionMode, executionPluginId, isBootstrapping]);

  useEffect(() => {
    if (!activeBuilderTaskId) return;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/builder/tasks/${activeBuilderTaskId}/progress`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          taskId: string;
          status: string;
          currentIteration: number | null;
          maxIterations: number | null;
          loopPhase: string | null;
          latestLoopSummary: string | null;
        };
        if (!cancelled && isMountedRef.current) {
          const currentConvId = conversationIdRef.current;
          const currentProjectId = selectedBuilderProjectIdRef.current;
          dispatchPendingAssistantTurn({
            type: "set-builder-progress",
            progress: {
              currentIteration: data.currentIteration ?? null,
              maxIterations: data.maxIterations ?? null,
              loopPhase: data.loopPhase ?? null,
              latestLoopSummary: data.latestLoopSummary ?? null,
            },
            taskId: data.taskId,
            builderProjectId: currentProjectId,
            conversationId: currentConvId,
          });
          if (data.status !== "RUNNING") {
            setActiveBuilderTaskId(null);
            if (currentConvId && !completionPublishedTaskIdsRef.current.has(data.taskId)) {
              completionPublishedTaskIdsRef.current.add(data.taskId);
              await fetch(`/api/chat/builder/tasks/${data.taskId}/complete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversationId: currentConvId }),
              }).catch(() => undefined);
            }
            if (currentConvId) {
              await loadBootstrap({
                selectedConversationId: currentConvId,
                replaceCurrent: true,
              });
            }
            if (isMountedRef.current) {
              dispatchPendingAssistantTurn({ type: "clear" });
            }
          }
        }
      } catch {
        // ignore transient fetch errors
      }
    };

    void poll();
    const intervalId = setInterval(() => void poll(), 3000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [activeBuilderTaskId]);

  async function loadBootstrap(options?: BootstrapRequestOptions): Promise<void> {
    const replaceCurrent = options?.replaceCurrent ?? false;
    const nextConversationId = options?.selectedConversationId ?? conversationId;
    const nextBuilderProjectId = options?.selectedBuilderProjectId !== undefined
      ? options.selectedBuilderProjectId
      : selectedBuilderProjectId;
    const nextCreeperCompanyProfileId = options?.selectedCreeperCompanyProfileId !== undefined
      ? options.selectedCreeperCompanyProfileId
      : selectedCreeperCompanyProfileId;
    const nextRecentPage = options?.recentPage ?? recentPagination.currentPage;
    const nextArchivedPage = options?.archivedPage ?? archivedPagination.currentPage;
    const nextFilters = options?.historyFilters ?? historyFilters;
    const params = new URLSearchParams();
    if (nextConversationId) {
      params.set("selectedId", nextConversationId);
    }
    if (nextBuilderProjectId) {
      params.set("selectedBuilderProjectId", nextBuilderProjectId);
    }
    if (nextCreeperCompanyProfileId) {
      params.set("selectedCreeperCompanyProfileId", nextCreeperCompanyProfileId);
    }
    params.set("recentPage", String(nextRecentPage));
    params.set("archivedPage", String(nextArchivedPage));
    params.set("historyPageSize", String(recentPagination.pageSize || DEFAULT_HISTORY_PAGINATION.pageSize));
    if (nextFilters.search) {
      params.set("historySearch", nextFilters.search);
    }
    if (nextFilters.from) {
      params.set("historyFrom", nextFilters.from);
    }
    if (nextFilters.to) {
      params.set("historyTo", nextFilters.to);
    }

    const requestKey = params.toString();
    if (
      bootstrapAbortControllerRef.current
      && bootstrapRequestKeyRef.current === requestKey
      && bootstrapPromiseRef.current
    ) {
      return bootstrapPromiseRef.current;
    }

    const controller = new AbortController();
    const requestId = bootstrapRequestIdRef.current + 1;
    bootstrapRequestIdRef.current = requestId;
    bootstrapAbortControllerRef.current?.abort();
    bootstrapAbortControllerRef.current = controller;
    bootstrapRequestKeyRef.current = requestKey;

    let bootstrapPromise: Promise<void> | null = null;
    bootstrapPromise = (async () => {
      try {
        let response: Response;
        try {
          response = await fetch(`/api/chat/conversations${params.toString() ? `?${params.toString()}` : ""}`, {
            signal: controller.signal,
          });
        } catch (error) {
          if (shouldIgnoreCancelledRequest(error, controller.signal) || !isMountedRef.current) {
            return;
          }

          throw error;
        }

        let payload: ChatConversationBootstrap & { error?: string };
        try {
          payload = await readJson<ChatConversationBootstrap & { error?: string }>(response);
        } catch (error) {
          if (shouldIgnoreCancelledRequest(error, controller.signal) || !isMountedRef.current) {
            return;
          }

          throw error;
        }

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load chat conversations.");
        }

        if (controller.signal.aborted || !isMountedRef.current || requestId !== bootstrapRequestIdRef.current) {
          return;
        }

        setRecentConversations(payload.recentConversations);
        setArchivedConversations(payload.archivedConversations);
        setRecentPagination(payload.recentPagination);
        setArchivedPagination(payload.archivedPagination);
        setHistoryFilters(payload.historyFilters);
        setModelPricing(payload.modelPricing);
        setChatVerbosityState(payload.chatVerbosity);
        setExecutionCatalog(payload.executionCatalog);
        const storedExecutionPreference = getStoredExecutionPreference();
        const preferredExecutionDefaults = payload.currentConversation
          ? payload.executionDefaults
          : storedExecutionPreference ?? payload.executionDefaults;
        applyExecutionSelection(preferredExecutionDefaults, {
          conversationId: payload.currentConversationId,
        });
        setBuilderProjects(payload.builderProjects);
        setBuilderProjectConversations(payload.builderProjectConversations ?? []);
        setCreeperCompanyProfiles(payload.creeperCompanyProfiles ?? []);
        setBuilderStackPresets(payload.builderStackPresets ?? []);
        setBuilderTemplates(payload.builderTemplates ?? []);
        setSelectedBuilderProjectIdState((current) => {
          if (options?.selectedBuilderProjectId !== undefined) {
            return options.selectedBuilderProjectId && payload.builderProjects.some((project) => project.id === options.selectedBuilderProjectId)
              ? options.selectedBuilderProjectId
              : null;
          }

          return payload.currentConversation?.builderProjectId && payload.builderProjects.some((project) => project.id === payload.currentConversation?.builderProjectId)
            ? payload.currentConversation.builderProjectId
            : current && payload.builderProjects.some((project) => project.id === current)
              ? current
              : null;
        });
        setSelectedCreeperCompanyProfileIdState((current) => {
          if (options?.selectedCreeperCompanyProfileId !== undefined) {
            return options.selectedCreeperCompanyProfileId && payload.creeperCompanyProfiles.some((profile) => profile.id === options.selectedCreeperCompanyProfileId)
              ? options.selectedCreeperCompanyProfileId
              : null;
          }

          return payload.selectedCreeperCompanyProfileId && payload.creeperCompanyProfiles.some((profile) => profile.id === payload.selectedCreeperCompanyProfileId)
            ? payload.selectedCreeperCompanyProfileId
            : current && payload.creeperCompanyProfiles.some((profile) => profile.id === current)
              ? current
              : null;
        });
        setBuilderInbox(payload.builderInbox);
        setConversationId(payload.currentConversationId);
        setCurrentConversation(payload.currentConversation);
        persistSelectedConversationId(payload.currentConversationId);
        hasLoadedBootstrapRef.current = true;

        if (replaceCurrent) {
          const nextMessages = payload.currentConversation ? mapConversationMessages(payload.currentConversation.messages) : [];
          setMessages((current) => {
            const mergedMessages = mergeBootstrapMessages(current, nextMessages, pendingResumePromptRef.current);
            return haveEquivalentChatEntries(current, mergedMessages) ? current : mergedMessages;
          });
          setActiveRun(createInternalActiveRun(payload.activeRun));
          if (!activeBuilderTaskId) {
            dispatchPendingAssistantTurn({ type: "clear" });
          }
        }

        setHistoryConversation((current) => {
          if (!current) {
            return current;
          }

          const stillVisible = payload.archivedConversations.some((conversation) => conversation.id === current.id)
            || payload.recentConversations.some((conversation) => conversation.id === current.id);

          return stillVisible ? current : null;
        });
      } finally {
        if (bootstrapAbortControllerRef.current === controller) {
          bootstrapAbortControllerRef.current = null;
        }
        if (bootstrapRequestKeyRef.current === requestKey) {
          bootstrapRequestKeyRef.current = null;
        }
        if (bootstrapPromise && bootstrapPromiseRef.current === bootstrapPromise) {
          bootstrapPromiseRef.current = null;
        }
      }
    })();

    bootstrapPromiseRef.current = bootstrapPromise;
    return bootstrapPromise;
  }

  function createPassiveBootstrapKey(options: BootstrapRequestOptions): string {
    const params = new URLSearchParams();
    if (options.selectedConversationId) {
      params.set("selectedConversationId", options.selectedConversationId);
    }
    if (options.selectedBuilderProjectId) {
      params.set("selectedBuilderProjectId", options.selectedBuilderProjectId);
    }
    if (options.selectedCreeperCompanyProfileId) {
      params.set("selectedCreeperCompanyProfileId", options.selectedCreeperCompanyProfileId);
    }

    return params.toString() || "__initial__";
  }

  function requestBootstrap(options?: BootstrapRequestOptions, controls?: { showPending?: boolean }): Promise<void> {
    const id = bootstrapScheduleIdRef.current + 1;
    bootstrapScheduleIdRef.current = id;

    return new Promise<void>((resolve, reject) => {
      bootstrapPendingResolversRef.current.set(id, { resolve, reject });
      setScheduledBootstrapRequest({
        id,
        options,
        showPending: controls?.showPending ?? false,
      });
    });
  }

  useEffect(() => {
    if (pathname !== "/chat") {
      passiveBootstrapKeyRef.current = null;
      return;
    }

    const storedConversationId = getStoredSelectedConversationId();
    const selectedConversationId = conversationId ?? storedConversationId;
    const passiveRequest: BootstrapRequestOptions = {
      selectedConversationId,
      selectedBuilderProjectId,
      selectedCreeperCompanyProfileId,
      replaceCurrent: true,
    };

    if (!selectedConversationId && !selectedBuilderProjectId && !selectedCreeperCompanyProfileId && hasLoadedBootstrapRef.current) {
      passiveBootstrapKeyRef.current = null;
      if (!scheduledBootstrapRequest?.showPending && isMountedRef.current) {
        setIsBootstrapping(false);
      }
      return;
    }

    const desiredKey = createPassiveBootstrapKey(passiveRequest);
    const initialBootstrapPending = !selectedConversationId
      && !selectedBuilderProjectId
      && !selectedCreeperCompanyProfileId
      && !hasLoadedBootstrapRef.current;
    const currentConversationReady = !selectedConversationId
      ? !initialBootstrapPending
      : conversationId === selectedConversationId && (currentConversation !== null || messages.length > 0);
    const currentBuilderReady = selectedBuilderProjectId === (currentConversation?.builderProjectId ?? selectedBuilderProjectId);
    const currentCreeperReady = selectedCreeperCompanyProfileId === (currentConversation?.companyProfileId ?? selectedCreeperCompanyProfileId);

    if (currentConversationReady && currentBuilderReady && currentCreeperReady) {
      passiveBootstrapKeyRef.current = null;
      if (!scheduledBootstrapRequest?.showPending && isMountedRef.current) {
        setIsBootstrapping(false);
      }
      return;
    }

    if (scheduledBootstrapRequest?.showPending && passiveBootstrapKeyRef.current === desiredKey) {
      return;
    }

    passiveBootstrapKeyRef.current = desiredKey;
    void requestBootstrap(passiveRequest, { showPending: true })
      .catch((error) => {
        if (!isAbortError(error)) {
          console.error("[chat bootstrap coordinator]", error);
        }
      })
      .finally(() => {
        if (passiveBootstrapKeyRef.current === desiredKey) {
          passiveBootstrapKeyRef.current = null;
        }
      });
  }, [
    conversationId,
    currentConversation,
    messages.length,
    pathname,
    scheduledBootstrapRequest?.showPending,
    selectedBuilderProjectId,
    selectedCreeperCompanyProfileId,
  ]);

  useEffect(() => {
    if (pathname !== "/chat" || !scheduledBootstrapRequest) {
      return;
    }

    const { id, options, showPending } = scheduledBootstrapRequest;
    let active = true;

    if (showPending && isMountedRef.current) {
      setIsBootstrapping(true);
    }

    void loadBootstrap(options)
      .then(() => {
        if (!active) {
          return;
        }
        bootstrapPendingResolversRef.current.get(id)?.resolve();
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        if (shouldIgnoreCancelledRequest(error)) {
          bootstrapPendingResolversRef.current.get(id)?.resolve();
          return;
        }

        bootstrapPendingResolversRef.current.get(id)?.reject(error);
      })
      .finally(() => {
        bootstrapPendingResolversRef.current.delete(id);
        if (active) {
          setScheduledBootstrapRequest((current) => (current?.id === id ? null : current));
          if (showPending && isMountedRef.current) {
            setIsBootstrapping(false);
          }
        }
      });

    return () => {
      active = false;
    };
  }, [pathname, scheduledBootstrapRequest]);

  useEffect(() => {
    const handleSidecarInteraction = (event: Event) => {
      const detail = (event as CustomEvent<SidecarInteractionEventDetail>).detail;
      if (!detail || !conversationId) {
        return;
      }

      sidecarInteractionAbortControllerRef.current?.abort();
      const controller = new AbortController();
      sidecarInteractionAbortControllerRef.current = controller;

      void fetch("/api/sidecar/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          panelId: detail.panelId,
          actionId: detail.actionId,
          selectedItemIds: detail.selectedItemIds,
          conversationId,
        }),
      })
        .then(async (response) => {
          const payload = await readJson<SidecarInteractionResult & { error?: string }>(response);
          if (!response.ok) {
            throw new Error(payload.error ?? "Sidecar interaction failed.");
          }

          if (controller.signal.aborted || !isMountedRef.current) {
            return;
          }

          window.dispatchEvent(new CustomEvent(BIZBOT_SIDECAR_EVENT, {
            detail: {
              action: payload.action,
              panel: payload.panel,
              conversationId,
            },
          }));
        })
        .catch((error: Error) => {
          if (isAbortError(error)) {
            return;
          }
          console.error("[sidecar interaction]", error);
        })
        .finally(() => {
          if (sidecarInteractionAbortControllerRef.current === controller) {
            sidecarInteractionAbortControllerRef.current = null;
          }
        });
    };

    window.addEventListener(BIZBOT_SIDECAR_INTERACTION_EVENT, handleSidecarInteraction as EventListener);
    return () => {
      window.removeEventListener(BIZBOT_SIDECAR_INTERACTION_EVENT, handleSidecarInteraction as EventListener);
    };
  }, [conversationId]);

  async function loadConversation(nextConversationId: string): Promise<void> {
    dispatchPendingAssistantTurn({ type: "clear" });
    await requestBootstrap({ selectedConversationId: nextConversationId, replaceCurrent: true }, { showPending: true });
  }

  function startNewChat(): void {
    setConversationId(null);
    setCurrentConversation(null);
    setMessages([]);
    setActiveRun(IDLE_ACTIVE_RUN);
    dispatchPendingAssistantTurn({ type: "clear" });
    setHistoryConversation(null);
    persistSelectedConversationId(null);
  }

  async function openHistoryConversation(nextConversationId: string): Promise<void> {
    setIsLoadingHistoryConversation(true);
    try {
      const response = await fetch(`/api/chat/conversations/${nextConversationId}`);
      const payload = await readJson<{ conversation?: ChatConversationDetail; error?: string }>(response);

      if (!response.ok || !payload.conversation) {
        throw new Error(payload.error ?? "Failed to load conversation.");
      }

      setHistoryConversation(payload.conversation);
    } finally {
      setIsLoadingHistoryConversation(false);
    }
  }

  async function archiveConversation(nextConversationId: string): Promise<void> {
    const response = await fetch(`/api/chat/conversations/${nextConversationId}/archive`, { method: "POST" });
    const payload = await readJson<{ error?: string }>(response);

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to archive conversation.");
    }

    setHistoryConversation((current) => current?.id === nextConversationId ? null : current);
    const nextSelectedConversationId = conversationId === nextConversationId ? null : conversationId;
    await requestBootstrap({
      selectedConversationId: nextSelectedConversationId,
      replaceCurrent: conversationId === nextConversationId,
    }, { showPending: true });
  }

  async function archiveCurrentConversation(): Promise<void> {
    if (!conversationId) {
      return;
    }

    await archiveConversation(conversationId);
  }

  async function restoreConversation(nextConversationId: string): Promise<void> {
    const response = await fetch(`/api/chat/conversations/${nextConversationId}/restore`, { method: "POST" });
    const payload = await readJson<{ error?: string }>(response);

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to restore conversation.");
    }

    setHistoryConversation(null);
    await requestBootstrap({ selectedConversationId: nextConversationId, replaceCurrent: true }, { showPending: true });
  }

  async function deleteConversation(nextConversationId: string): Promise<void> {
    const response = await fetch(`/api/chat/conversations/${nextConversationId}`, { method: "DELETE" });
    const payload = await readJson<{ error?: string }>(response);

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to delete conversation.");
    }

    setHistoryConversation((current) => current?.id === nextConversationId ? null : current);
    const nextSelectedConversationId = conversationId === nextConversationId ? null : conversationId;
    await requestBootstrap({
      selectedConversationId: nextSelectedConversationId,
      replaceCurrent: true,
    }, { showPending: true });
  }

  async function applyHistoryFilters(nextFilters: ChatConversationHistoryFilters): Promise<void> {
    setIsLoadingHistoryLists(true);
    try {
      await requestBootstrap({
        selectedConversationId: conversationId,
        replaceCurrent: false,
        recentPage: 1,
        archivedPage: 1,
        historyFilters: nextFilters,
      });
    } finally {
      setIsLoadingHistoryLists(false);
    }
  }

  async function clearHistoryFilters(): Promise<void> {
    await applyHistoryFilters(DEFAULT_HISTORY_FILTERS);
  }

  const setRecentHistoryPage: React.Dispatch<React.SetStateAction<number>> = async (value) => {
    const nextPage = Math.max(
      1,
      Math.min(
        typeof value === "function" ? value(recentPagination.currentPage) : value,
        recentPagination.totalPages,
      ),
    );

    setIsLoadingHistoryLists(true);
    try {
      await requestBootstrap({
        selectedConversationId: conversationId,
        replaceCurrent: false,
        recentPage: nextPage,
      });
    } finally {
      setIsLoadingHistoryLists(false);
    }
  };

  const setArchivedHistoryPage: React.Dispatch<React.SetStateAction<number>> = async (value) => {
    const nextPage = Math.max(
      1,
      Math.min(
        typeof value === "function" ? value(archivedPagination.currentPage) : value,
        archivedPagination.totalPages,
      ),
    );

    setIsLoadingHistoryLists(true);
    try {
      await requestBootstrap({
        selectedConversationId: conversationId,
        replaceCurrent: false,
        archivedPage: nextPage,
      });
    } finally {
      setIsLoadingHistoryLists(false);
    }
  };

  function startBuilderOnboarding(): void {
    setBuilderOnboarding({
      step: "naming",
      spec: {
        name: "",
        description: "",
        stackPresetKey: "",
        template: "node-cli",
        packageManager: "NPM",
        docker: true,
        git: true,
      },
    });
  }

  function updateBuilderOnboardingSpec(updates: Partial<BuilderOnboardingSpec>): void {
    setBuilderOnboarding((current) =>
      current ? { ...current, spec: { ...current.spec, ...updates } } : current,
    );
  }

  function setBuilderOnboardingStep(step: BuilderOnboardingStep): void {
    setBuilderOnboarding((current) => (current ? { ...current, step } : current));
  }

  function cancelBuilderOnboarding(): void {
    setBuilderOnboarding(null);
  }

  async function confirmBuilderOnboarding(): Promise<void> {
    if (!builderOnboarding) {
      return;
    }

    const { spec } = builderOnboarding;
    const response = await fetch("/api/chat/builder/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...spec,
        conversationId: conversationId ?? undefined,
      }),
    });
    const payload = await readJson<{ error?: string; projectId?: string; conversationId?: string }>(response);

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to create project from onboarding.");
    }

    setBuilderOnboarding(null);
    setSelectedBuilderProjectId(payload.projectId ?? null);

    await requestBootstrap({
      selectedConversationId: payload.conversationId ?? conversationId,
      replaceCurrent: true,
    });
  }

  async function resolveBuilderInteraction(interactionId: string, action: "approve" | "reject" | "reconcile"): Promise<void> {
    const response = await fetch(`/api/chat/builder/interactions/${interactionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, conversationId }),
    });
    const payload = await readJson<{ error?: string }>(response);

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to resolve Builder interaction.");
    }

    await requestBootstrap({
      selectedConversationId: conversationId,
      replaceCurrent: true,
    });
  }

  async function launchBuilderTaskFromChat(request: string, options?: { projectId?: string | null; retryFailed?: boolean }): Promise<void> {
    const trimmed = request.trim();
    if (!trimmed) {
      return;
    }

    const projectId = options?.projectId ?? selectedBuilderProjectId;
    if (!projectId) {
      throw new Error("Select a Builder project before launching a task from chat.");
    }

    applyExecutionSelection({ mode: "agent", pluginId: "builder" }, {
      conversationId,
    });

    setMessages((current) => [...current, createEntry("user", trimmed, {
      chatMode: "agent",
      chatPluginId: "builder",
    })]);
    dispatchPendingAssistantTurn({
      type: "start",
      conversationId,
      chatMode: "agent",
      chatPluginId: "builder",
      builderProjectId: projectId,
    });
    dispatchPendingAssistantTurn({
      type: "append-activity",
      entry: createEntry("status", "Builder task started."),
      conversationId,
    });

    const response = await fetch("/api/chat/builder/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: conversationId ?? undefined,
        projectId,
        request: trimmed,
        retryFailed: options?.retryFailed ?? false,
      }),
    });
    const payload = await readJson<{ error?: string; conversationId?: string; execution?: { status?: string; taskId?: string | null } }>(response);

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to launch Builder task from chat.");
    }

    const nextConversationId = payload.conversationId ?? conversationId;
    applyExecutionSelection({ mode: "agent", pluginId: "builder" }, {
      conversationId: nextConversationId,
    });
    if (payload.execution?.status === "RUNNING" && typeof payload.execution.taskId === "string") {
      setActiveBuilderTaskId(payload.execution.taskId);
      dispatchPendingAssistantTurn({
        type: "set-builder-progress",
        progress: null,
        taskId: payload.execution.taskId,
        builderProjectId: projectId,
        conversationId: nextConversationId,
      });
    }
    await requestBootstrap({
      selectedConversationId: nextConversationId,
      replaceCurrent: true,
    });
  }

  function publishResumePrompt(runId: string | null | undefined, reason: string, mode: ChatExecutionMode, pluginId: string): boolean {
    if (!runId) {
      return false;
    }

    const summary = summarizeResumeFailure(reason);
    setPendingResumePrompt({ runId, summary, mode, pluginId });
    setMessages((current) => [...current, createEntry("assistant", buildResumePromptMessage(summary))]);
    return true;
  }

  async function streamAgentRequest(input: string, options?: {
    oraclePrediction?: boolean;
    mode?: ChatExecutionMode;
    pluginId?: string;
    attachments?: ChatMessageAttachment[];
    resumeRunId?: string;
  }): Promise<void> {
    const trimmed = input.trim();
    const resumeRunId = options?.resumeRunId;
    if (!trimmed && !resumeRunId) return;

    const mode = options?.mode ?? executionMode;
    const pluginId = options?.pluginId ?? executionPluginId;
    const attachments = options?.attachments ?? [];

    setPendingResumePrompt(null);

    if (trimmed) {
      setMessages((current) => [...current, createEntry("user", trimmed, {
        chatMode: mode,
        chatPluginId: pluginId,
        attachments,
      })]);
    }
    dispatchPendingAssistantTurn({
      type: "start",
      conversationId,
      chatMode: mode,
      chatPluginId: pluginId,
      builderProjectId: pluginId === "builder" ? selectedBuilderProjectId : null,
    });

    startTransition(() => {
      fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed || undefined,
          resumeRunId,
          conversationId: conversationId ?? undefined,
          mode,
          pluginId,
          companyProfileId: pluginId === "creeper" ? selectedCreeperCompanyProfileIdRef.current ?? undefined : undefined,
          attachments,
          stream: true,
          ...(options?.oraclePrediction ? { oraclePrediction: true } : {}),
        }),
      })
        .then(async (res) => {
          let nextConversationId = conversationId;
          let builderTaskIdFromStream: string | null = null;

          if (!res.ok || !res.body) {
            const payload = await readJson<Partial<AgentResponse> & { error?: string }>(res);
            throw new Error(payload.error ?? "Request failed");
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const parsed = parseSsePayload(buffer);
            buffer = parsed.remainder;

            for (const event of parsed.events) {
              if (event.conversationId) {
                nextConversationId = event.conversationId;
                if (isMountedRef.current) {
                  setConversationId(event.conversationId);
                  persistSelectedConversationId(event.conversationId);
                  dispatchPendingAssistantTurn({
                    type: "sync",
                    conversationId: event.conversationId,
                  });
                }
              }
              if (event.type === "meta") {
                if (isMountedRef.current) {
                  setActiveRun((current) => {
                    const nextConversationId = event.conversationId ?? current.conversationId ?? conversationId;
                    const baseline = current.conversationId === nextConversationId ? current : IDLE_ACTIVE_RUN;

                    return {
                      ...baseline,
                      conversationId: nextConversationId,
                      runId: event.runId ?? null,
                      profile: event.profile ?? baseline.profile,
                      profileLabel: event.profileLabel ?? baseline.profileLabel,
                      provider: event.provider ?? baseline.provider,
                      model: event.model ?? baseline.model,
                      startedAt: new Date().toISOString(),
                      runBaseRequestCount: baseline.requestCount,
                      runBasePromptTokens: baseline.promptTokens,
                      runBaseCompletionTokens: baseline.completionTokens,
                      runBaseTotalTokens: baseline.totalTokens,
                      runBaseCachedPromptTokens: baseline.cachedPromptTokens,
                    };
                  });
                  const metaEntry = mapStreamEventToActivityEntry(event);
                  if (metaEntry) {
                    dispatchPendingAssistantTurn({
                      type: "append-activity",
                      entry: metaEntry,
                      conversationId: event.conversationId ?? nextConversationId,
                      runId: event.runId,
                    });
                  }
                  dispatchPendingAssistantTurn({
                    type: "sync",
                    conversationId: event.conversationId ?? nextConversationId,
                    runId: event.runId,
                    chatMode: mode,
                    chatPluginId: pluginId,
                    builderProjectId: pluginId === "builder" ? selectedBuilderProjectId : null,
                  });
                }
              } else if (event.type === "usage") {
                if (isMountedRef.current) {
                  setActiveRun((current) => ({
                    ...current,
                    conversationId: event.conversationId ?? current.conversationId,
                    runId: event.runId ?? current.runId,
                    requestCount: current.runBaseRequestCount + (event.requestCount ?? 0),
                    promptTokens: current.runBasePromptTokens + (event.promptTokens ?? 0),
                    completionTokens: current.runBaseCompletionTokens + (event.completionTokens ?? 0),
                    totalTokens: current.runBaseTotalTokens + (event.totalTokens ?? 0),
                    cachedPromptTokens: current.runBaseCachedPromptTokens + (event.cachedPromptTokens ?? 0),
                  }));
                }
              } else if (event.type === "sidecar" && event.action) {
                window.dispatchEvent(new CustomEvent(BIZBOT_SIDECAR_EVENT, {
                  detail: {
                    action: event.action,
                    panel: event.panel ?? null,
                    conversationId: event.conversationId,
                  },
                }));
              } else if (
                event.type === "tool_result" &&
                (event.name === "builder_plan_task" || event.name === "builder_continue_task")
              ) {
                if (isMountedRef.current) {
                  try {
                    const parsed = event.result ? (JSON.parse(event.result) as { status?: string; taskId?: string }) : null;
                    if (parsed?.status === "RUNNING" && typeof parsed?.taskId === "string") {
                      builderTaskIdFromStream = parsed.taskId;
                      setActiveBuilderTaskId(parsed.taskId);
                      dispatchPendingAssistantTurn({
                        type: "set-builder-progress",
                        progress: null,
                        taskId: parsed.taskId,
                        builderProjectId: selectedBuilderProjectId,
                        conversationId: event.conversationId ?? nextConversationId,
                      });
                    }
                  } catch {
                    // ignore malformed result
                  }
                }
              }
              if (isMountedRef.current) {
                if (event.type === "assistant_message") {
                  dispatchPendingAssistantTurn({
                    type: "set-content",
                    content: event.content ?? "",
                    conversationId: event.conversationId ?? nextConversationId,
                    runId: event.runId,
                  });
                } else if (event.type === "meta") {
                  // Meta events are already appended above when active-run state is initialized.
                } else if (event.type === "error") {
                  dispatchPendingAssistantTurn({ type: "clear" });
                  if (!publishResumePrompt(event.runId ?? activeRunRef.current.runId, event.error ?? "Unknown error", mode, pluginId)) {
                    setMessages((current) => [
                      ...current,
                      createEntry("assistant", `Request failed: ${event.error ?? "Unknown error"}`),
                    ]);
                  }
                } else {
                  const activityEntry = mapStreamEventToActivityEntry(event);
                  if (activityEntry) {
                    dispatchPendingAssistantTurn({
                      type: "append-activity",
                      entry: activityEntry,
                      conversationId: event.conversationId ?? nextConversationId,
                      runId: event.runId,
                    });
                  }
                }
              }
            }
          }

          if (nextConversationId) {
            await requestBootstrap({ selectedConversationId: nextConversationId, replaceCurrent: true });
          }

          if (!builderTaskIdFromStream && isMountedRef.current) {
            dispatchPendingAssistantTurn({ type: "clear" });
          }
        })
        .catch((error: Error) => {
          if (isAbortError(error) || !isMountedRef.current) {
            return;
          }
          dispatchPendingAssistantTurn({ type: "clear" });
          if (!publishResumePrompt(activeRunRef.current.runId, error.message, mode, pluginId)) {
            setMessages((current) => [
              ...current,
              createEntry("assistant", `Request failed: ${error.message}`),
            ]);
          }
        });
    });
  }

  async function sendMessage(input: string, options?: { mode?: ChatExecutionMode; pluginId?: string; attachments?: ChatMessageAttachment[] }): Promise<void> {
    const isOracle = (options?.pluginId ?? executionPluginId) === "oracle";
    await streamAgentRequest(input, {
      ...options,
      ...(isOracle ? { mode: "agent", pluginId: "oracle" } : {}),
    });
  }

  async function sendOraclePrediction(input: string, options?: { attachments?: ChatMessageAttachment[] }): Promise<void> {
    await streamAgentRequest(input, {
      oraclePrediction: true,
      mode: "agent",
      pluginId: "oracle",
      attachments: options?.attachments,
    });
  }

  async function resolvePendingResumePrompt(decision: "resume" | "dismiss"): Promise<void> {
    const prompt = pendingResumePrompt;
    if (!prompt) {
      return;
    }

    setPendingResumePrompt(null);
    setMessages((current) => [...current, createEntry("user", decision === "resume" ? "yes" : "no")]);

    if (decision === "dismiss") {
      setMessages((current) => [...current, createEntry("assistant", "Okay. I won't resume that run.")]);
      return;
    }

    await streamAgentRequest("", {
      mode: prompt.mode,
      pluginId: prompt.pluginId,
      resumeRunId: prompt.runId,
    });
  }

  async function setChatVerbosity(value: ChatVerbosity): Promise<void> {
    if (value === chatVerbosity) {
      return;
    }

    const previous = chatVerbosity;
    setChatVerbosityState(value);

    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: [{
          key: CHAT_VERBOSITY_SETTING_KEY,
          value,
        }],
      }),
    });
    const payload = await readJson<{ error?: string }>(response);

    if (!response.ok) {
      setChatVerbosityState(previous);
      throw new Error(payload.error ?? "Failed to save chat verbosity.");
    }
  }

  return {
    messages,
    pendingResumePrompt,
    pendingAssistantTurn,
    builderInbox,
    builderProjects,
    builderProjectConversations,
    creeperCompanyProfiles,
    builderStackPresets,
    builderTemplates,
    builderOnboarding,
    selectedBuilderProjectId,
    selectedCreeperCompanyProfileId,
    conversationId,
    currentConversation,
    recentConversations,
    archivedConversations,
    recentPagination,
    archivedPagination,
    historyFilters,
    historyConversation,
    isPending,
    isBootstrapping,
    isLoadingHistoryConversation,
    isLoadingHistoryLists,
    activeRun: toPublicActiveRun(activeRun),
    activeBuilderProgress: pendingAssistantTurn?.builderProgress ?? null,
    modelPricing,
    executionCatalog,
    executionMode,
    executionPluginId,
    chatVerbosity,
    setExecutionMode,
    setExecutionPluginId,
    setChatVerbosity,
    setSelectedBuilderProjectId,
    setSelectedCreeperCompanyProfileId,
    startBuilderOnboarding,
    updateBuilderOnboardingSpec,
    setBuilderOnboardingStep,
    cancelBuilderOnboarding,
    confirmBuilderOnboarding,
    resolveBuilderInteraction,
    launchBuilderTaskFromChat,
    sendMessage,
    sendOraclePrediction,
    resolvePendingResumePrompt,
    startNewChat,
    loadConversation,
    archiveConversation,
    archiveCurrentConversation,
    openHistoryConversation,
    restoreConversation,
    deleteConversation,
    applyHistoryFilters,
    clearHistoryFilters,
    setRecentHistoryPage,
    setArchivedHistoryPage,
  };
}
