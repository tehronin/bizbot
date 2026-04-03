import type { JsonValue } from "@/lib/agent/tools";

export const BIZBOT_SIDECAR_EVENT = "bizbot:sidecar";
export const BIZBOT_SIDECAR_INTERACTION_EVENT = "bizbot:sidecar:interaction";
export const SIDECAR_ALLOWED_IMAGE_HOSTS = new Set<string>([]);

export type SidecarContentType = "markdown" | "code" | "json" | "image" | "selection";
export type SidecarAction = "open" | "update" | "close";
export type SidecarSelectionMode = "single" | "multiple";
export type SidecarSelectionActionKind = "apply" | "toggle" | "clear" | "close";

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

export type SidecarContent = SidecarMarkdownContent | SidecarCodeContent | SidecarJsonContent | SidecarImageContent | SidecarSelectionContent;

export interface SidecarPanel {
  panelId: string;
  title: string;
  content: SidecarContent;
}

export interface SidecarToolResult {
  ok: true;
  action: SidecarAction;
  panel: SidecarPanel | null;
}

export interface SidecarStreamEventDetail {
  action: SidecarAction;
  panel: SidecarPanel | null;
  conversationId?: string;
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
}

export interface SidecarInteractionRequest extends SidecarInteractionEventDetail {
  conversationId: string;
  userId?: string;
}

export interface SidecarInteractionResult {
  ok: true;
  action: SidecarAction;
  panel: SidecarPanel | null;
}
