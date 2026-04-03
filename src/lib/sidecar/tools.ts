import { defineTool, registerTool, type ToolDefinition, type ToolPropertySchema } from "@/lib/agent/tools";
import { validateSidecarPanel } from "@/lib/sidecar/validation";
import type { SidecarContent, SidecarPanel, SidecarToolResult } from "@/lib/sidecar/types";

interface SidecarPanelArgs {
  title: string;
  content: SidecarContent;
}

const sidecarContentSchema: ToolPropertySchema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["markdown", "code", "json", "image"],
      description: "The BizBot-owned Sidecar renderer to use.",
    },
    markdown: { type: "string", description: "Markdown content. Raw HTML is rejected." },
    code: { type: "string", description: "Code content rendered read-only." },
    language: { type: "string", description: "Optional code language hint." },
    value: { type: "json", description: "Structured JSON value to render." },
    url: { type: "string", description: "Image data URL or explicitly allowed remote URL." },
    alt: { type: "string", description: "Required image alt text." },
  },
  required: ["type"],
  additionalProperties: false,
};

const sidecarPanelSchema: ToolPropertySchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "Panel title shown in the Sidecar header." },
    content: sidecarContentSchema,
  },
  required: ["title", "content"],
  additionalProperties: false,
};

function buildResult(action: "open" | "update", input: SidecarPanel): SidecarToolResult {
  return {
    ok: true,
    action,
    panel: validateSidecarPanel(input),
  };
}

export const sidecarTools = [
  registerTool(defineTool({
    name: "sidecar_open",
    description: "Open or replace the BizBot Sidecar panel with validated rich content.",
    parameters: {
      type: "object",
      properties: {
        title: sidecarPanelSchema.properties!.title,
        content: sidecarPanelSchema.properties!.content,
      },
      required: ["title", "content"],
      additionalProperties: false,
    },
    execute: async ({ title, content }: SidecarPanelArgs) => buildResult("open", { title, content }),
  } satisfies ToolDefinition<SidecarPanelArgs, SidecarToolResult>)),
  registerTool(defineTool({
    name: "sidecar_update",
    description: "Update the active BizBot Sidecar panel with validated rich content.",
    parameters: {
      type: "object",
      properties: {
        title: sidecarPanelSchema.properties!.title,
        content: sidecarPanelSchema.properties!.content,
      },
      required: ["title", "content"],
      additionalProperties: false,
    },
    execute: async ({ title, content }: SidecarPanelArgs) => buildResult("update", { title, content }),
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
