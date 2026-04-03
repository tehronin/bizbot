import { isJsonValue, type JsonValue } from "@/lib/agent/tools";
import type {
  SidecarAction,
  SidecarContent,
  SidecarPanel,
  SidecarStreamEvent,
  SidecarToolResult,
} from "@/lib/sidecar/types";
import { SIDECAR_ALLOWED_IMAGE_HOSTS } from "@/lib/sidecar/types";

const MAX_IMAGE_DATA_URL_CHARS = 200_000;

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
  return {
    title: normalizeTitle(input.title),
    content: validateSidecarContent(input.content),
  };
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
    runId: input.runId,
    conversationId: input.conversationId,
    round: input.round,
    toolCallId: input.toolCallId,
    name: input.name,
  };
}
