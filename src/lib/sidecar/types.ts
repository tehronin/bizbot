import type { JsonValue } from "@/lib/agent/tools";

export const BIZBOT_SIDECAR_EVENT = "bizbot:sidecar";
export const BIZBOT_SIDECAR_INTERACTION_EVENT = "bizbot:sidecar:interaction";
export const BIZBOT_SIDECAR_INTERACTION_STATE_EVENT = "bizbot:sidecar:interaction-state";
export const BIZBOT_SELECTED_CONVERSATION_EVENT = "bizbot:chat:selected-conversation";
export const SIDECAR_ALLOWED_IMAGE_HOSTS = new Set<string>([]);

export type SidecarContentType = "markdown" | "code" | "json" | "image" | "selection" | "table" | "key_value" | "progress" | "diff";
export type SidecarAction = "open" | "update" | "close";
export type SidecarPanelPersistence = "ephemeral" | "sticky" | "workflow";
export type SidecarSelectionMode = "single" | "multiple";
export type SidecarSelectionActionKind = "apply" | "toggle" | "clear" | "close";
export type SidecarProgressStatus = "pending" | "active" | "done" | "error";
export type SidecarThinkingStatus = "idle" | "streaming" | "complete" | "error";
export type SidecarThinkingChunkKind = "status" | "note" | "plan" | "tool_call" | "tool_result" | "warning" | "error";

export interface SidecarPanelContextBinding {
  contextId: string;
  parentPanelId?: string;
  readKeys?: string[];
  writeKeys?: string[];
  selectionKey?: string;
  returnChannel?: string;
}

export interface SidecarContextPatch {
  contextId: string;
  values: Record<string, JsonValue>;
}

export interface SidecarContextSnapshot {
  contextId: string;
  conversationId: string;
  rootPanelId: string;
  activePanelId: string | null;
  contextLineageId: string;
  contextRevision: number;
  stackRevision: number;
  values: Record<string, JsonValue>;
}

export interface SidecarThinkingChunk {
  id: string;
  kind: SidecarThinkingChunkKind;
  text: string;
  timestamp: string;
  metadata?: Record<string, JsonValue>;
}

export interface SidecarThinkingSnapshot {
  conversationId: string;
  sessionId: string;
  status: SidecarThinkingStatus;
  title?: string;
  summary?: string;
  chunks: SidecarThinkingChunk[];
  updatedAt: string;
  revision: number;
}

export interface SidecarMarkdownContent {
  type: "markdown";
  markdown: string;
}

export interface SidecarCodeContent {
  type: "code";
  code: string;
  language?: string;
}

export interface SidecarJsonContent {
  type: "json";
  value: JsonValue;
}

export interface SidecarImageContent {
  type: "image";
  url: string;
  alt: string;
}

export interface SidecarSelectionItem {
  id: string;
  title: string;
  description?: string;
}

export interface SidecarSelectionActionDefinition {
  id: string;
  label: string;
  kind: SidecarSelectionActionKind;
}

export interface SidecarSelectionInteractionDefinition {
  routeKey: string;
}

export interface SidecarSelectionContent {
  type: "selection";
  title: string;
  description?: string;
  selectionMode: SidecarSelectionMode;
  items: SidecarSelectionItem[];
  selectedItemIds?: string[];
  actions: SidecarSelectionActionDefinition[];
  interaction: SidecarSelectionInteractionDefinition;
}

export interface SidecarTableContent {
  type: "table";
  columns: string[];
  rows: JsonValue[];
}

export interface SidecarKeyValueEntry {
  label: string;
  value: JsonValue;
  contextKey?: string;
}

export interface SidecarKeyValueContent {
  type: "key_value";
  entries: SidecarKeyValueEntry[];
}

export interface SidecarProgressItem {
  id: string;
  label: string;
  status: SidecarProgressStatus;
  detail?: string;
}

export interface SidecarProgressContent {
  type: "progress";
  title: string;
  items: SidecarProgressItem[];
}

export interface SidecarDiffSection {
  label?: string;
  before: string;
  after: string;
  language?: string;
}

export interface SidecarDiffContent {
  type: "diff";
  sections: SidecarDiffSection[];
}

export type SidecarContent =
  | SidecarMarkdownContent
  | SidecarCodeContent
  | SidecarJsonContent
  | SidecarImageContent
  | SidecarSelectionContent
  | SidecarTableContent
  | SidecarKeyValueContent
  | SidecarProgressContent
  | SidecarDiffContent;

export interface SidecarPanel {
  panelId: string;
  title: string;
  content: SidecarContent;
  persistence?: SidecarPanelPersistence;
  context?: SidecarPanelContextBinding;
}

export interface SidecarStackSnapshot {
  panels: SidecarPanel[];
  activePanelId: string | null;
  stackRevision: number;
}

export interface SidecarToolResult {
  ok: true;
  action: SidecarAction;
  panel: SidecarPanel | null;
}

export interface SidecarStreamEventDetail {
  action: SidecarAction;
  panel: SidecarPanel | null;
  stack?: SidecarStackSnapshot;
  context?: SidecarContextSnapshot | null;
  conversationId?: string;
  source?: "useChat";
}

export interface SidecarStreamEvent extends SidecarStreamEventDetail {
  type: "sidecar";
  runId: string;
  conversationId: string;
  round: number;
  toolCallId: string;
  name: string;
}

export interface SidecarInteractionEventDetail {
  panelId: string;
  actionId: string;
  selectedItemIds: string[];
  expectedStackRevision?: number;
  expectedContextRevision?: number;
  contextPatch?: SidecarContextPatch;
}

export interface SidecarInteractionStateEventDetail {
  panelId: string;
  pending: boolean;
  error?: string;
}

export interface SidecarInteractionRequest extends SidecarInteractionEventDetail {
  conversationId: string;
  userId?: string;
}

export interface SidecarInteractionResult {
  ok: true;
  action: SidecarAction;
  panel: SidecarPanel | null;
  stack: SidecarStackSnapshot;
  context: SidecarContextSnapshot | null;
}
