import type { JsonValue } from "@/lib/agent/tools";

export const BIZBOT_SIDECAR_EVENT = "bizbot:sidecar";
export const SIDECAR_ALLOWED_IMAGE_HOSTS = new Set<string>([]);

export type SidecarContentType = "markdown" | "code" | "json" | "image";
export type SidecarAction = "open" | "update" | "close";

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

export type SidecarContent = SidecarMarkdownContent | SidecarCodeContent | SidecarJsonContent | SidecarImageContent;

export interface SidecarPanel {
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
}

export interface SidecarStreamEvent extends SidecarStreamEventDetail {
  type: "sidecar";
  runId: string;
  conversationId: string;
  round: number;
  toolCallId: string;
  name: string;
}
