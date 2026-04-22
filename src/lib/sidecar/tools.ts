import { defineTool, registerTool, type ToolDefinition, type ToolPropertySchema } from "@/lib/agent/tools";
import { createValidatedSidecarPanel } from "@/lib/sidecar/validation";
import type { SidecarContent, SidecarPanel, SidecarPanelPersistence, SidecarToolResult } from "@/lib/sidecar/types";

interface SidecarPanelArgs {
  panelId?: string;
  title: string;
  content: SidecarContent;
  persistence?: SidecarPanelPersistence;
}

const selectionItemSchema: ToolPropertySchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Stable selection item id." },
    title: { type: "string", description: "Selection item title." },
    description: { type: "string", description: "Optional selection item description." },
    label: { type: "string", description: "Progress item label." },
    detail: { type: "string", description: "Optional progress item detail." },
    status: {
      type: "string",
      enum: ["pending", "active", "done", "error"],
      description: "Progress item status.",
    },
  },
  required: ["id"],
  additionalProperties: false,
};

const selectionActionSchema: ToolPropertySchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Stable selection action id." },
    label: { type: "string", description: "User-facing action label." },
    kind: {
      type: "string",
      enum: ["apply", "toggle", "clear", "close"],
      description: "Bounded BizBot-owned interaction kind.",
    },
  },
  required: ["id", "label", "kind"],
  additionalProperties: false,
};

const sidecarContentSchema: ToolPropertySchema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["markdown", "code", "json", "image", "selection", "table", "key_value", "progress", "diff"],
      description: "The BizBot-owned Sidecar renderer to use.",
    },
    markdown: { type: "string", description: "Markdown content. Raw HTML is rejected." },
    code: { type: "string", description: "Code content rendered read-only." },
    language: { type: "string", description: "Optional code language hint." },
    value: { type: "json", description: "Structured JSON value to render." },
    url: { type: "string", description: "Image data URL or explicitly allowed remote URL." },
    alt: { type: "string", description: "Required image alt text." },
    persistence: {
      type: "string",
      enum: ["ephemeral", "sticky", "workflow"],
      description: "Optional panel persistence policy for Sidecar lifecycle behavior.",
    },
    title: { type: "string", description: "Selection surface title for interactive cards." },
    description: { type: "string", description: "Optional selection surface description." },
    selectionMode: { type: "string", enum: ["single", "multiple"], description: "Whether the selection surface allows one or multiple items." },
    items: { type: "array", items: selectionItemSchema, description: "Selectable items rendered by the Sidecar." },
    selectedItemIds: { type: "array", items: { type: "string" }, description: "Currently selected item ids." },
    columns: { type: "array", items: { type: "string" }, description: "Table columns for the Sidecar table renderer." },
    rows: { type: "array", items: { type: "array", items: { type: "json" } }, description: "Table rows for the Sidecar table renderer." },
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Key label." },
          value: { type: "json", description: "Structured value." },
        },
        required: ["label", "value"],
        additionalProperties: false,
      },
      description: "Key/value entries for the Sidecar key-value renderer.",
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Optional diff section label." },
          before: { type: "string", description: "Original content." },
          after: { type: "string", description: "Updated content." },
          language: { type: "string", description: "Optional language hint." },
        },
        required: ["before", "after"],
        additionalProperties: false,
      },
      description: "Diff sections for the Sidecar diff renderer.",
    },
    actions: { type: "array", items: selectionActionSchema, description: "Bounded BizBot-owned actions available for the selection surface." },
    interaction: {
      type: "object",
      properties: {
        routeKey: { type: "string", description: "Registered BizBot interaction route key." },
      },
      required: ["routeKey"],
      additionalProperties: false,
    },
    status: { type: "string", enum: ["pending", "active", "done", "error"], description: "Progress item status." },
  },
  required: ["type"],
  additionalProperties: false,
};

const sidecarPanelSchema: ToolPropertySchema = {
  type: "object",
  properties: {
    panelId: { type: "string", description: "Optional stable panel id. Generated automatically when omitted." },
    title: { type: "string", description: "Panel title shown in the Sidecar header." },
    persistence: sidecarContentSchema.properties!.persistence,
    content: sidecarContentSchema,
  },
  required: ["title", "content"],
  additionalProperties: false,
};

function buildResult(action: "open" | "update", input: SidecarPanel): SidecarToolResult {
  return {
    ok: true,
    action,
    panel: createValidatedSidecarPanel(input),
  };
}

export const sidecarTools = [
  registerTool(defineTool({
    name: "sidecar_open",
    description: "Open or replace the BizBot Sidecar panel with validated rich content.",
    parameters: {
      type: "object",
      properties: {
        panelId: sidecarPanelSchema.properties!.panelId,
        title: sidecarPanelSchema.properties!.title,
        persistence: sidecarPanelSchema.properties!.persistence,
        content: sidecarPanelSchema.properties!.content,
      },
      required: ["title", "content"],
      additionalProperties: false,
    },
    execute: async ({ panelId, title, content, persistence }: SidecarPanelArgs) => buildResult("open", { panelId: panelId ?? "", title, content, persistence }),
  } satisfies ToolDefinition<SidecarPanelArgs, SidecarToolResult>)),
  registerTool(defineTool({
    name: "sidecar_update",
    description: "Update the active BizBot Sidecar panel with validated rich content.",
    parameters: {
      type: "object",
      properties: {
        panelId: sidecarPanelSchema.properties!.panelId,
        title: sidecarPanelSchema.properties!.title,
        persistence: sidecarPanelSchema.properties!.persistence,
        content: sidecarPanelSchema.properties!.content,
      },
      required: ["title", "content"],
      additionalProperties: false,
    },
    execute: async ({ panelId, title, content, persistence }: SidecarPanelArgs) => buildResult("update", { panelId: panelId ?? "", title, content, persistence }),
  } satisfies ToolDefinition<SidecarPanelArgs, SidecarToolResult>)),
  registerTool(defineTool({
    name: "sidecar_close",
    description: "Close the BizBot Sidecar panel and clear transient content.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: async () => ({ ok: true, action: "close", panel: null }),
  } satisfies ToolDefinition<Record<string, never>, SidecarToolResult>)),
];
