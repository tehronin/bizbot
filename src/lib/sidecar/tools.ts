import { defineTool, registerTool, type ToolDefinition, type ToolPropertySchema } from "@/lib/agent/tools";
import {
  activateSidecarPanelForConversation,
  closeActiveSidecarPanelForConversation,
  getActiveSidecarContextForConversation,
  getActiveSidecarPanelForConversation,
  getActiveSidecarStackRevisionForConversation,
  getActiveSidecarStackForConversation,
  popActiveSidecarPanelForConversation,
  getRestorableActiveSidecarPanelForConversation,
  getRestorableSidecarContextForConversation,
  getRestorableSidecarStackForConversation,
  syncActiveSidecarPanel,
} from "@/lib/sidecar/state";
import { routeSidecarInteraction } from "@/lib/sidecar/router";
import { createValidatedSidecarPanel } from "@/lib/sidecar/validation";
import type { SidecarContent, SidecarInteractionResult, SidecarPanel, SidecarPanelContextBinding, SidecarPanelPersistence, SidecarToolResult } from "@/lib/sidecar/types";

interface SidecarPanelArgs {
  panelId?: string;
  title: string;
  content: SidecarContent;
  persistence?: SidecarPanelPersistence;
  context?: SidecarPanelContextBinding;
  conversationId?: string;
}

interface SidecarGetStateArgs {
  conversationId?: string;
}

interface SidecarInteractArgs {
  panelId: string;
  actionId: string;
  selectedItemIds?: string[];
  expectedStackRevision?: number;
  contextPatch?: {
    contextId: string;
    values: Record<string, unknown>;
  };
  conversationId?: string;
  userId?: string;
}

interface SidecarNavigateArgs {
  operation: "back" | "activate" | "close";
  panelId?: string;
  expectedStackRevision?: number;
  conversationId?: string;
}

const contextBindingSchema: ToolPropertySchema = {
  type: "object",
  properties: {
    contextId: { type: "string", description: "Stable Sidecar context id for parent-child data flow." },
    parentPanelId: { type: "string", description: "Optional parent panel id anchoring this panel into an existing context lineage." },
    readKeys: { type: "array", items: { type: "string" }, description: "Optional context keys this panel reads." },
    writeKeys: { type: "array", items: { type: "string" }, description: "Optional context keys this panel is allowed to write through interactions." },
    selectionKey: { type: "string", description: "Optional context key that mirrors the active selection for selection panels." },
    returnChannel: { type: "string", description: "Optional named return channel for structured child-to-parent actions." },
  },
  required: ["contextId"],
  additionalProperties: false,
};

const contextPatchSchema: ToolPropertySchema = {
  type: "object",
  properties: {
    contextId: { type: "string", description: "Stable Sidecar context id to patch." },
    values: {
      type: "object",
      properties: {},
      additionalProperties: true,
      description: "Bounded JSON object of context values to apply.",
    },
  },
  required: ["contextId", "values"],
  additionalProperties: false,
};

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
          contextKey: { type: "string", description: "Optional context key used to render the value from the active Sidecar context snapshot." },
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
    conversationId: { type: "string", description: "Optional conversation id. Required when mutating authoritative Sidecar state through MCP or other direct tool execution." },
    persistence: sidecarContentSchema.properties!.persistence,
    context: contextBindingSchema,
    content: sidecarContentSchema,
  },
  required: ["title", "content"],
  additionalProperties: false,
};

function shouldPersistAuthoritativeSidecarState(context: { agentProfile?: string }): boolean {
  return context.agentProfile === "mcp_operator";
}

function resolveConversationId(providedConversationId: string | undefined, context: { conversationId?: string }): string {
  return providedConversationId?.trim() || context.conversationId?.trim() || "";
}

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
        conversationId: sidecarPanelSchema.properties!.conversationId,
        persistence: sidecarPanelSchema.properties!.persistence,
        context: sidecarPanelSchema.properties!.context,
        content: sidecarPanelSchema.properties!.content,
      },
      required: ["title", "content"],
      additionalProperties: false,
    },
    execute: async ({ panelId, title, content, persistence, context, conversationId }: SidecarPanelArgs, toolContext) => {
      const result = buildResult("open", { panelId: panelId ?? "", title, content, persistence, ...(context ? { context } : {}) });
      if (!shouldPersistAuthoritativeSidecarState(toolContext)) {
        return result;
      }

      const resolvedConversationId = resolveConversationId(conversationId, toolContext);
      if (!resolvedConversationId) {
        throw new Error("A conversation id is required to open authoritative Sidecar state.");
      }

      syncActiveSidecarPanel({
        action: result.action,
        panel: result.panel,
        conversationId: resolvedConversationId,
        ...(toolContext.runId ? { runId: toolContext.runId } : {}),
        ...(toolContext.userId ? { userId: toolContext.userId } : {}),
        toolName: "sidecar_open",
      });

      return {
        ...result,
        stack: getActiveSidecarStackForConversation(resolvedConversationId),
        context: getActiveSidecarContextForConversation(resolvedConversationId),
      };
    },
  } satisfies ToolDefinition<SidecarPanelArgs, SidecarToolResult | {
    ok: true;
    action: "open";
    panel: SidecarPanel;
    stack: ReturnType<typeof getActiveSidecarStackForConversation>;
    context: ReturnType<typeof getActiveSidecarContextForConversation>;
  }>)),
  registerTool(defineTool({
    name: "sidecar_update",
    description: "Update the active BizBot Sidecar panel with validated rich content.",
    parameters: {
      type: "object",
      properties: {
        panelId: sidecarPanelSchema.properties!.panelId,
        title: sidecarPanelSchema.properties!.title,
        conversationId: sidecarPanelSchema.properties!.conversationId,
        persistence: sidecarPanelSchema.properties!.persistence,
        context: sidecarPanelSchema.properties!.context,
        content: sidecarPanelSchema.properties!.content,
      },
      required: ["title", "content"],
      additionalProperties: false,
    },
    execute: async ({ panelId, title, content, persistence, context, conversationId }: SidecarPanelArgs, toolContext) => {
      const result = buildResult("update", { panelId: panelId ?? "", title, content, persistence, ...(context ? { context } : {}) });
      if (!shouldPersistAuthoritativeSidecarState(toolContext)) {
        return result;
      }

      const resolvedConversationId = resolveConversationId(conversationId, toolContext);
      if (!resolvedConversationId) {
        throw new Error("A conversation id is required to update authoritative Sidecar state.");
      }

      syncActiveSidecarPanel({
        action: result.action,
        panel: result.panel,
        conversationId: resolvedConversationId,
        ...(toolContext.runId ? { runId: toolContext.runId } : {}),
        ...(toolContext.userId ? { userId: toolContext.userId } : {}),
        toolName: "sidecar_update",
      });

      return {
        ...result,
        stack: getActiveSidecarStackForConversation(resolvedConversationId),
        context: getActiveSidecarContextForConversation(resolvedConversationId),
      };
    },
  } satisfies ToolDefinition<SidecarPanelArgs, SidecarToolResult | {
    ok: true;
    action: "update";
    panel: SidecarPanel;
    stack: ReturnType<typeof getActiveSidecarStackForConversation>;
    context: ReturnType<typeof getActiveSidecarContextForConversation>;
  }>)),
  registerTool(defineTool({
    name: "sidecar_close",
    description: "Close the BizBot Sidecar panel and clear transient content.",
    parameters: {
      type: "object",
      properties: {
        conversationId: { type: "string", description: "Optional conversation id. Required when closing authoritative Sidecar state through MCP or other direct tool execution." },
      },
      additionalProperties: false,
    },
    execute: async ({ conversationId }: SidecarGetStateArgs, toolContext) => {
      if (!shouldPersistAuthoritativeSidecarState(toolContext)) {
        return { ok: true, action: "close", panel: null };
      }

      const resolvedConversationId = resolveConversationId(conversationId, toolContext);
      if (!resolvedConversationId) {
        throw new Error("A conversation id is required to close authoritative Sidecar state.");
      }

      closeActiveSidecarPanelForConversation(resolvedConversationId);
      return {
        ok: true,
        action: "close",
        panel: null,
        stack: getActiveSidecarStackForConversation(resolvedConversationId),
        context: getActiveSidecarContextForConversation(resolvedConversationId),
      };
    },
  } satisfies ToolDefinition<SidecarGetStateArgs, SidecarToolResult | {
    ok: true;
    action: "close";
    panel: null;
    stack: ReturnType<typeof getActiveSidecarStackForConversation>;
    context: ReturnType<typeof getActiveSidecarContextForConversation>;
  }>)),
  registerTool(defineTool({
    name: "sidecar_get_state",
    description: "Return the active and restorable BizBot Sidecar state for a conversation, including stack and shared context snapshots.",
    parameters: {
      type: "object",
      properties: {
        conversationId: { type: "string", description: "Optional conversation id. Defaults to the active tool execution conversation." },
      },
      additionalProperties: false,
    },
    execute: async ({ conversationId }: SidecarGetStateArgs, context) => {
      const resolvedConversationId = conversationId?.trim() || context.conversationId?.trim() || "";
      if (!resolvedConversationId) {
        throw new Error("A conversation id is required to inspect Sidecar state.");
      }

      return {
        conversationId: resolvedConversationId,
        activePanel: getActiveSidecarPanelForConversation(resolvedConversationId)?.panel ?? null,
        stack: getActiveSidecarStackForConversation(resolvedConversationId),
        context: getActiveSidecarContextForConversation(resolvedConversationId),
        restorablePanel: getRestorableActiveSidecarPanelForConversation(resolvedConversationId)?.panel ?? null,
        restorableStack: getRestorableSidecarStackForConversation(resolvedConversationId),
        restorableContext: getRestorableSidecarContextForConversation(resolvedConversationId),
      };
    },
  } satisfies ToolDefinition<SidecarGetStateArgs, {
    conversationId: string;
    activePanel: SidecarPanel | null;
    stack: ReturnType<typeof getActiveSidecarStackForConversation>;
    context: ReturnType<typeof getActiveSidecarContextForConversation>;
    restorablePanel: SidecarPanel | null;
    restorableStack: ReturnType<typeof getRestorableSidecarStackForConversation>;
    restorableContext: ReturnType<typeof getRestorableSidecarContextForConversation>;
  }>)),
  registerTool(defineTool({
    name: "sidecar_interact",
    description: "Execute a bounded BizBot Sidecar selection interaction and return the authoritative stack and context snapshot.",
    parameters: {
      type: "object",
      properties: {
        panelId: { type: "string", description: "Active Sidecar panel id receiving the interaction." },
        actionId: { type: "string", description: "Stable Sidecar action id to invoke." },
        selectedItemIds: { type: "array", items: { type: "string" }, description: "Selection item ids representing the intended next selection state." },
        expectedStackRevision: { type: "number", description: "Optional optimistic concurrency key for rejecting stale interactions." },
        contextPatch: contextPatchSchema,
        conversationId: { type: "string", description: "Optional conversation id. Defaults to the active tool execution conversation." },
        userId: { type: "string", description: "Optional explicit user id override for the interaction." },
      },
      required: ["panelId", "actionId"],
      additionalProperties: false,
    },
    execute: async ({ panelId, actionId, selectedItemIds, expectedStackRevision, contextPatch, conversationId, userId }: SidecarInteractArgs, context) => {
      const resolvedConversationId = conversationId?.trim() || context.conversationId?.trim() || "";
      if (!resolvedConversationId) {
        throw new Error("A conversation id is required to execute a Sidecar interaction.");
      }

      const currentStackRevision = getActiveSidecarStackRevisionForConversation(resolvedConversationId);
      if (typeof expectedStackRevision === "number" && expectedStackRevision !== currentStackRevision) {
        const stack = getActiveSidecarStackForConversation(resolvedConversationId);
        return {
          ok: false,
          conflict: true,
          error: "Sidecar state changed while you were interacting. Review the latest panel stack and retry.",
          panel: stack.panels.at(-1) ?? null,
          stack,
          context: getActiveSidecarContextForConversation(resolvedConversationId),
        };
      }

      const result = await routeSidecarInteraction({
        panelId,
        actionId,
        selectedItemIds: [...(selectedItemIds ?? [])],
        ...(typeof expectedStackRevision === "number" ? { expectedStackRevision } : {}),
        ...(contextPatch ? { contextPatch: contextPatch as { contextId: string; values: Record<string, never> } } : {}),
        conversationId: resolvedConversationId,
        ...(userId?.trim() || context.userId?.trim() ? { userId: userId?.trim() || context.userId?.trim() } : {}),
      });

      return result satisfies SidecarInteractionResult;
    },
  } satisfies ToolDefinition<SidecarInteractArgs, ({ ok: true } & SidecarInteractionResult) | {
    ok: false;
    conflict: true;
    error: string;
    panel: SidecarPanel | null;
    stack: ReturnType<typeof getActiveSidecarStackForConversation>;
    context: ReturnType<typeof getActiveSidecarContextForConversation>;
  }>)),
  registerTool(defineTool({
    name: "sidecar_navigate",
    description: "Navigate or close the authoritative BizBot Sidecar stack for a conversation and return the resulting stack and context snapshot.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["back", "activate", "close"],
          description: "Stack navigation operation to apply.",
        },
        panelId: { type: "string", description: "Required when operation is activate; selects the panel to make active by truncating the stack to it." },
        expectedStackRevision: { type: "number", description: "Optional optimistic concurrency key for rejecting stale navigation requests." },
        conversationId: { type: "string", description: "Optional conversation id. Defaults to the active tool execution conversation." },
      },
      required: ["operation"],
      additionalProperties: false,
    },
    execute: async ({ operation, panelId, expectedStackRevision, conversationId }: SidecarNavigateArgs, context) => {
      const resolvedConversationId = conversationId?.trim() || context.conversationId?.trim() || "";
      if (!resolvedConversationId) {
        throw new Error("A conversation id is required to navigate Sidecar state.");
      }

      const currentStackRevision = getActiveSidecarStackRevisionForConversation(resolvedConversationId);
      if (typeof expectedStackRevision === "number" && expectedStackRevision !== currentStackRevision) {
        const stack = getActiveSidecarStackForConversation(resolvedConversationId);
        return {
          ok: false,
          conflict: true,
          error: "Sidecar state changed while you were navigating. Review the latest panel stack and retry.",
          panel: stack.panels.at(-1) ?? null,
          stack,
          context: getActiveSidecarContextForConversation(resolvedConversationId),
        };
      }

      if (operation === "back") {
        const stack = popActiveSidecarPanelForConversation(resolvedConversationId);
        const panel = stack.panels.at(-1) ?? null;
        return {
          ok: true,
          action: panel ? "update" : "close",
          panel,
          stack,
          context: getActiveSidecarContextForConversation(resolvedConversationId),
        };
      }

      if (operation === "activate") {
        const resolvedPanelId = panelId?.trim() || "";
        if (!resolvedPanelId) {
          throw new Error("A panel id is required to activate a Sidecar panel.");
        }

        const stack = activateSidecarPanelForConversation(resolvedConversationId, resolvedPanelId);
        const panel = stack.panels.at(-1) ?? null;
        return {
          ok: true,
          action: panel ? "update" : "close",
          panel,
          stack,
          context: getActiveSidecarContextForConversation(resolvedConversationId),
        };
      }

      closeActiveSidecarPanelForConversation(resolvedConversationId);
      return {
        ok: true,
        action: "close",
        panel: null,
        stack: getActiveSidecarStackForConversation(resolvedConversationId),
        context: getActiveSidecarContextForConversation(resolvedConversationId),
      };
    },
  } satisfies ToolDefinition<SidecarNavigateArgs, ({ ok: true } & SidecarInteractionResult) | {
    ok: false;
    conflict: true;
    error: string;
    panel: SidecarPanel | null;
    stack: ReturnType<typeof getActiveSidecarStackForConversation>;
    context: ReturnType<typeof getActiveSidecarContextForConversation>;
  }>)),
];
