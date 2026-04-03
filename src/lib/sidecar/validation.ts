import { isJsonValue, type JsonValue } from "@/lib/agent/tools";
import type {
  SidecarAction,
  SidecarContent,
  SidecarInteractionRequest,
  SidecarPanel,
  SidecarSelectionActionDefinition,
  SidecarSelectionContent,
  SidecarSelectionItem,
  SidecarStreamEvent,
  SidecarToolResult,
} from "@/lib/sidecar/types";
import { SIDECAR_ALLOWED_IMAGE_HOSTS } from "@/lib/sidecar/types";

const MAX_IMAGE_DATA_URL_CHARS = 200_000;

function normalizeText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${field} must be ${maxLength} characters or fewer.`);
  }
  return normalized;
}

function normalizeTitle(value: string): string {
  const title = value.trim();
  if (!title) {
    throw new Error("Sidecar title is required.");
  }
  if (title.length > 120) {
    throw new Error("Sidecar title must be 120 characters or fewer.");
  }
  return title;
}

function containsRawHtml(markdown: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(markdown);
}

function validateLanguage(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const language = value.trim();
  if (!language) {
    return undefined;
  }
  if (!/^[a-z0-9.+#_-]{1,32}$/i.test(language)) {
    throw new Error("Sidecar code language must be alphanumeric and 32 characters or fewer.");
  }
  return language;
}

function validateImageUrl(value: string): string {
  const url = value.trim();
  if (!url) {
    throw new Error("Sidecar image url is required.");
  }

  if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(url)) {
    if (url.length > MAX_IMAGE_DATA_URL_CHARS) {
      throw new Error("Sidecar image data URL exceeds the maximum allowed size.");
    }
    return url;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Sidecar image url must be a data URL or an allowed absolute URL.");
  }

  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("Sidecar image url must use http, https, or data.");
  }
  if (!SIDECAR_ALLOWED_IMAGE_HOSTS.has(parsed.hostname)) {
    throw new Error(`Sidecar image host '${parsed.hostname}' is not allowed.`);
  }
  return parsed.toString();
}

function validateSelectionItem(input: SidecarSelectionItem, seenIds: Set<string>): SidecarSelectionItem {
  const id = normalizeText(input.id, "Sidecar selection item id", 80);
  if (!/^[a-z0-9:_-]{1,80}$/i.test(id)) {
    throw new Error("Sidecar selection item id must be alphanumeric and 80 characters or fewer.");
  }
  if (seenIds.has(id)) {
    throw new Error(`Duplicate Sidecar selection item id '${id}'.`);
  }
  seenIds.add(id);

  const title = normalizeText(input.title, "Sidecar selection item title", 120);
  const description = input.description?.trim();
  if (description !== undefined && description.length > 280) {
    throw new Error("Sidecar selection item description must be 280 characters or fewer.");
  }

  return {
    id,
    title,
    ...(description ? { description } : {}),
  };
}

function validateSelectionAction(input: SidecarSelectionActionDefinition, seenIds: Set<string>): SidecarSelectionActionDefinition {
  const id = normalizeText(input.id, "Sidecar selection action id", 80);
  if (!/^[a-z0-9:_-]{1,80}$/i.test(id)) {
    throw new Error("Sidecar selection action id must be alphanumeric and 80 characters or fewer.");
  }
  if (seenIds.has(id)) {
    throw new Error(`Duplicate Sidecar selection action id '${id}'.`);
  }
  seenIds.add(id);

  return {
    id,
    label: normalizeText(input.label, "Sidecar selection action label", 80),
    kind: input.kind,
  };
}

function validateSelectionContent(input: SidecarSelectionContent): SidecarSelectionContent {
  const title = normalizeText(input.title, "Sidecar selection title", 120);
  const description = input.description?.trim();
  if (description !== undefined && description.length > 280) {
    throw new Error("Sidecar selection description must be 280 characters or fewer.");
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("Sidecar selection content requires at least one item.");
  }
  if (input.items.length > 24) {
    throw new Error("Sidecar selection content supports at most 24 items.");
  }

  if (!Array.isArray(input.actions) || input.actions.length === 0) {
    throw new Error("Sidecar selection content requires at least one action.");
  }
  if (input.actions.length > 6) {
    throw new Error("Sidecar selection content supports at most 6 actions.");
  }

  const routeKey = normalizeText(input.interaction.routeKey, "Sidecar interaction route key", 120);
  if (!/^[a-z0-9._:-]{1,120}$/i.test(routeKey)) {
    throw new Error("Sidecar interaction route key must be alphanumeric and 120 characters or fewer.");
  }

  const itemIds = new Set<string>();
  const items = input.items.map((item) => validateSelectionItem(item, itemIds));
  const selectedItemIds = Array.isArray(input.selectedItemIds)
    ? input.selectedItemIds.map((itemId) => normalizeText(itemId, "Sidecar selected item id", 80))
    : [];

  for (const itemId of selectedItemIds) {
    if (!itemIds.has(itemId)) {
      throw new Error(`Unknown Sidecar selected item id '${itemId}'.`);
    }
  }

  if (input.selectionMode === "single" && selectedItemIds.length > 1) {
    throw new Error("Single-select Sidecar content accepts only one selected item.");
  }

  const actionIds = new Set<string>();
  const actions = input.actions.map((action) => validateSelectionAction(action, actionIds));

  return {
    type: "selection",
    title,
    selectionMode: input.selectionMode,
    items,
    actions,
    interaction: { routeKey },
    ...(description ? { description } : {}),
    ...(selectedItemIds.length > 0 ? { selectedItemIds } : {}),
  };
}

export function validateSidecarContent(input: SidecarContent): SidecarContent {
  switch (input.type) {
    case "markdown": {
      const markdown = input.markdown.trim();
      if (!markdown) {
        throw new Error("Sidecar markdown content is required.");
      }
      if (containsRawHtml(markdown)) {
        throw new Error("Sidecar markdown does not allow raw HTML.");
      }
      return { type: "markdown", markdown };
    }
    case "code": {
      const code = input.code;
      if (!code.trim()) {
        throw new Error("Sidecar code content is required.");
      }
      return {
        type: "code",
        code,
        ...(validateLanguage(input.language) ? { language: validateLanguage(input.language) } : {}),
      };
    }
    case "json": {
      if (typeof input.value === "string") {
        const trimmed = input.value.trim();
        if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && !isJsonValue(safelyParseJson(trimmed))) {
          throw new Error("Sidecar JSON string payload must be valid JSON.");
        }
      }
      if (!isJsonValue(input.value)) {
        throw new Error("Sidecar JSON content must be valid JSON.");
      }
      return {
        type: "json",
        value: input.value,
      };
    }
    case "image": {
      const alt = input.alt.trim();
      if (!alt) {
        throw new Error("Sidecar image alt text is required.");
      }
      if (alt.length > 200) {
        throw new Error("Sidecar image alt text must be 200 characters or fewer.");
      }
      return {
        type: "image",
        url: validateImageUrl(input.url),
        alt,
      };
    }
    case "selection": {
      return validateSelectionContent(input);
    }
  }
}

function safelyParseJson(value: string): JsonValue | object | undefined {
  try {
    return JSON.parse(value) as JsonValue | object;
  } catch {
    return undefined;
  }
}

export function validateSidecarPanel(input: SidecarPanel): SidecarPanel {
  const panelId = normalizeText(input.panelId, "Sidecar panel id", 80);
  if (!/^[a-z0-9:_-]{1,80}$/i.test(panelId)) {
    throw new Error("Sidecar panel id must be alphanumeric and 80 characters or fewer.");
  }

  return {
    panelId,
    title: normalizeTitle(input.title),
    content: validateSidecarContent(input.content),
  };
}

export function createValidatedSidecarPanel(input: Omit<SidecarPanel, "panelId"> & { panelId?: string }): SidecarPanel {
  return validateSidecarPanel({
    panelId: input.panelId?.trim() || crypto.randomUUID(),
    title: input.title,
    content: input.content,
  });
}

export function isSidecarToolResult(value: unknown): value is SidecarToolResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<SidecarToolResult>;
  if (candidate.ok !== true) {
    return false;
  }
  if (!["open", "update", "close"].includes(String(candidate.action))) {
    return false;
  }
  if (candidate.action === "close") {
    return candidate.panel === null;
  }
  if (!candidate.panel || typeof candidate.panel !== "object") {
    return false;
  }

  try {
    validateSidecarPanel(candidate.panel as SidecarPanel);
    return true;
  } catch {
    return false;
  }
}

export function buildSidecarStreamEvent(input: {
  action: SidecarAction;
  panel: SidecarPanel | null;
  runId: string;
  conversationId: string;
  round: number;
  toolCallId: string;
  name: string;
}): SidecarStreamEvent {
  return {
    type: "sidecar",
    action: input.action,
    panel: input.panel ? validateSidecarPanel(input.panel) : null,
    conversationId: input.conversationId,
    runId: input.runId,
    round: input.round,
    toolCallId: input.toolCallId,
    name: input.name,
  };
}

export function validateSidecarInteractionRequest(input: SidecarInteractionRequest): SidecarInteractionRequest {
  const panelId = normalizeText(input.panelId, "Sidecar interaction panel id", 80);
  const actionId = normalizeText(input.actionId, "Sidecar interaction action id", 80);
  const conversationId = normalizeText(input.conversationId, "Sidecar interaction conversation id", 120);
  const selectedItemIds = Array.isArray(input.selectedItemIds)
    ? input.selectedItemIds.map((itemId) => normalizeText(itemId, "Sidecar interaction selected item id", 80))
    : [];

  return {
    panelId,
    actionId,
    conversationId,
    selectedItemIds,
    ...(input.userId ? { userId: input.userId.trim() } : {}),
  };
}
