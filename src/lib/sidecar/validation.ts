import { isJsonValue, type JsonValue } from "@/lib/agent/tools";
import type {
  SidecarAction,
  SidecarContent,
  SidecarContextPatch,
  SidecarDiffContent,
  SidecarInteractionRequest,
  SidecarKeyValueContent,
  SidecarPanel,
  SidecarPanelContextBinding,
  SidecarPanelPersistence,
  SidecarProgressContent,
  SidecarSelectionActionDefinition,
  SidecarSelectionContent,
  SidecarSelectionItem,
  SidecarStreamEvent,
  SidecarTableContent,
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

function validateContextKey(value: string, field: string): string {
  const normalized = normalizeText(value, field, 120);
  if (!/^[a-z0-9._:-]{1,120}$/i.test(normalized)) {
    throw new Error(`${field} must be alphanumeric and 120 characters or fewer.`);
  }
  return normalized;
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

function validateTableContent(input: SidecarTableContent): SidecarTableContent {
  if (!Array.isArray(input.columns) || input.columns.length === 0) {
    throw new Error("Sidecar table content requires at least one column.");
  }
  if (input.columns.length > 12) {
    throw new Error("Sidecar table content supports at most 12 columns.");
  }
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new Error("Sidecar table content requires at least one row.");
  }
  if (input.rows.length > 50) {
    throw new Error("Sidecar table content supports at most 50 rows.");
  }

  const columns = input.columns.map((column) => normalizeText(column, "Sidecar table column", 80));
  for (const row of input.rows) {
    if (!Array.isArray(row)) {
      throw new Error("Sidecar table rows must be arrays.");
    }
    if (row.length !== columns.length) {
      throw new Error("Sidecar table rows must match the number of columns.");
    }
    for (const cell of row) {
      if (!isJsonValue(cell)) {
        throw new Error("Sidecar table cells must be valid JSON values.");
      }
    }
  }

  return {
    type: "table",
    columns,
    rows: input.rows,
  };
}

function validateKeyValueContent(input: SidecarKeyValueContent): SidecarKeyValueContent {
  if (!Array.isArray(input.entries) || input.entries.length === 0) {
    throw new Error("Sidecar key_value content requires at least one entry.");
  }
  if (input.entries.length > 24) {
    throw new Error("Sidecar key_value content supports at most 24 entries.");
  }

  return {
    type: "key_value",
    entries: input.entries.map((entry) => ({
      label: normalizeText(entry.label, "Sidecar key_value label", 80),
      value: isJsonValue(entry.value) ? entry.value : null,
      ...(entry.contextKey ? { contextKey: validateContextKey(entry.contextKey, "Sidecar key_value context key") } : {}),
    })),
  };
}

function validateProgressContent(input: SidecarProgressContent): SidecarProgressContent {
  const title = normalizeText(input.title, "Sidecar progress title", 120);
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("Sidecar progress content requires at least one item.");
  }
  if (input.items.length > 24) {
    throw new Error("Sidecar progress content supports at most 24 items.");
  }

  return {
    type: "progress",
    title,
    items: input.items.map((item) => ({
      id: normalizeText(item.id, "Sidecar progress item id", 80),
      label: normalizeText(item.label, "Sidecar progress item label", 120),
      status: item.status,
      ...(item.detail?.trim() ? { detail: item.detail.trim().slice(0, 280) } : {}),
    })),
  };
}

function validateDiffContent(input: SidecarDiffContent): SidecarDiffContent {
  if (!Array.isArray(input.sections) || input.sections.length === 0) {
    throw new Error("Sidecar diff content requires at least one section.");
  }
  if (input.sections.length > 12) {
    throw new Error("Sidecar diff content supports at most 12 sections.");
  }

  return {
    type: "diff",
    sections: input.sections.map((section) => {
      const before = section.before;
      const after = section.after;
      if (!before.trim() && !after.trim()) {
        throw new Error("Sidecar diff sections must include before or after content.");
      }

      return {
        ...(section.label?.trim() ? { label: section.label.trim().slice(0, 120) } : {}),
        before,
        after,
        ...(validateLanguage(section.language) ? { language: validateLanguage(section.language) } : {}),
      };
    }),
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
    case "table": {
      return validateTableContent(input);
    }
    case "key_value": {
      return validateKeyValueContent(input);
    }
    case "progress": {
      return validateProgressContent(input);
    }
    case "diff": {
      return validateDiffContent(input);
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

function validatePersistence(value: SidecarPanelPersistence | undefined): SidecarPanelPersistence | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value !== "ephemeral" && value !== "sticky" && value !== "workflow") {
    throw new Error("Sidecar persistence must be one of: ephemeral, sticky, workflow.");
  }

  return value;
}

function validatePanelContextBinding(value: SidecarPanelContextBinding | undefined): SidecarPanelContextBinding | undefined {
  if (value === undefined) {
    return undefined;
  }

  const contextId = validateContextKey(value.contextId, "Sidecar context id");
  const parentPanelId = value.parentPanelId?.trim();
  if (parentPanelId !== undefined && !/^[a-z0-9:_-]{1,80}$/i.test(parentPanelId)) {
    throw new Error("Sidecar parent panel id must be alphanumeric and 80 characters or fewer.");
  }

  function validateKeys(keys: string[] | undefined, field: string): string[] | undefined {
    if (keys === undefined) {
      return undefined;
    }
    if (!Array.isArray(keys)) {
      throw new Error(`${field} must be an array.`);
    }
    if (keys.length > 24) {
      throw new Error(`${field} supports at most 24 keys.`);
    }
    const seen = new Set<string>();
    const normalizedKeys = keys.map((key) => validateContextKey(key, field));
    for (const key of normalizedKeys) {
      if (seen.has(key)) {
        throw new Error(`Duplicate Sidecar context key '${key}'.`);
      }
      seen.add(key);
    }
    return normalizedKeys;
  }

  const readKeys = validateKeys(value.readKeys, "Sidecar context read key");
  const writeKeys = validateKeys(value.writeKeys, "Sidecar context write key");
  const selectionKey = value.selectionKey ? validateContextKey(value.selectionKey, "Sidecar selection context key") : undefined;
  const returnChannel = value.returnChannel ? validateContextKey(value.returnChannel, "Sidecar return channel") : undefined;

  return {
    contextId,
    ...(parentPanelId ? { parentPanelId } : {}),
    ...(readKeys ? { readKeys } : {}),
    ...(writeKeys ? { writeKeys } : {}),
    ...(selectionKey ? { selectionKey } : {}),
    ...(returnChannel ? { returnChannel } : {}),
  };
}

function validateContextPatch(value: SidecarContextPatch | undefined): SidecarContextPatch | undefined {
  if (value === undefined) {
    return undefined;
  }

  const contextId = validateContextKey(value.contextId, "Sidecar context patch id");
  if (!value.values || typeof value.values !== "object" || Array.isArray(value.values)) {
    throw new Error("Sidecar context patch values must be an object.");
  }

  const entries = Object.entries(value.values);
  if (entries.length === 0) {
    throw new Error("Sidecar context patch requires at least one value.");
  }
  if (entries.length > 24) {
    throw new Error("Sidecar context patch supports at most 24 values.");
  }

  const nextValues: Record<string, JsonValue> = {};
  for (const [key, entryValue] of entries) {
    const normalizedKey = validateContextKey(key, "Sidecar context patch key");
    if (!isJsonValue(entryValue)) {
      throw new Error(`Sidecar context patch value for '${normalizedKey}' must be valid JSON.`);
    }
    nextValues[normalizedKey] = entryValue;
  }

  return {
    contextId,
    values: nextValues,
  };
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
    ...(validatePersistence(input.persistence) ? { persistence: validatePersistence(input.persistence) } : {}),
    ...(validatePanelContextBinding(input.context) ? { context: validatePanelContextBinding(input.context) } : {}),
  };
}

export function createValidatedSidecarPanel(input: Omit<SidecarPanel, "panelId"> & { panelId?: string }): SidecarPanel {
  return validateSidecarPanel({
    panelId: input.panelId?.trim() || crypto.randomUUID(),
    title: input.title,
    content: input.content,
    ...(input.persistence ? { persistence: input.persistence } : {}),
    ...(input.context ? { context: input.context } : {}),
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
  const expectedStackRevision = input.expectedStackRevision;
  if (expectedStackRevision !== undefined && (!Number.isInteger(expectedStackRevision) || expectedStackRevision < 0)) {
    throw new Error("Sidecar expected stack revision must be a non-negative integer.");
  }
  const expectedContextRevision = input.expectedContextRevision;
  if (expectedContextRevision !== undefined && (!Number.isInteger(expectedContextRevision) || expectedContextRevision < 0)) {
    throw new Error("Sidecar expected context revision must be a non-negative integer.");
  }
  const contextPatch = validateContextPatch(input.contextPatch);

  return {
    panelId,
    actionId,
    conversationId,
    selectedItemIds,
    ...(typeof expectedStackRevision === "number" ? { expectedStackRevision } : {}),
    ...(typeof expectedContextRevision === "number" ? { expectedContextRevision } : {}),
    ...(contextPatch ? { contextPatch } : {}),
    ...(input.userId ? { userId: input.userId.trim() } : {}),
  };
}
