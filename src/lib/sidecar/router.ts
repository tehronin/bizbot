import { resolveAgentUserId } from "@/lib/agent/user-context";
import {
  getActiveSidecarPanel,
  syncActiveSidecarPanel,
} from "@/lib/sidecar/state";
import type {
  SidecarAction,
  SidecarInteractionRequest,
  SidecarInteractionResult,
  SidecarPanel,
  SidecarSelectionActionDefinition,
  SidecarSelectionContent,
} from "@/lib/sidecar/types";
import {
  createValidatedSidecarPanel,
  validateSidecarInteractionRequest,
} from "@/lib/sidecar/validation";

export interface SidecarInteractionContext {
  action: SidecarSelectionActionDefinition;
  conversationId: string;
  panel: SidecarPanel;
  selectedItemIds: string[];
  userId: string;
}

type SidecarInteractionHandler = (context: SidecarInteractionContext) => Promise<SidecarInteractionResult>;

const handlerRegistry = new Map<string, SidecarInteractionHandler>();

function cloneSelectionContent(content: SidecarSelectionContent, selectedItemIds: string[]): SidecarSelectionContent {
  return {
    ...content,
    items: content.items.map((item) => ({ ...item })),
    actions: content.actions.map((action) => ({ ...action })),
    interaction: { ...content.interaction },
    selectedItemIds,
  };
}

function applySelectionActionToPanel(
  panel: SidecarPanel,
  selectedItemIds: string[],
  action: SidecarAction,
): SidecarInteractionResult {
  if (panel.content.type !== "selection") {
    throw new Error("Selection actions require selection content.");
  }

  const nextPanel = createValidatedSidecarPanel({
    panelId: panel.panelId,
    title: panel.title,
    content: cloneSelectionContent(panel.content, selectedItemIds),
  });

  return {
    ok: true,
    action,
    panel: nextPanel,
  };
}

registerSidecarInteractionHandler("sidecar.selection.apply", async (context) => {
  switch (context.action.kind) {
    case "toggle":
      return applySelectionActionToPanel(context.panel, context.selectedItemIds, "update");
    case "clear":
      return applySelectionActionToPanel(context.panel, [], "update");
    case "close":
      return { ok: true, action: "close", panel: null };
    case "apply":
      return applySelectionActionToPanel(context.panel, context.selectedItemIds, "update");
  }
});

export function registerSidecarInteractionHandler(routeKey: string, handler: SidecarInteractionHandler): void {
  if (handlerRegistry.has(routeKey)) {
    throw new Error(`Duplicate Sidecar interaction route: ${routeKey}`);
  }
  handlerRegistry.set(routeKey, handler);
}

export function getSidecarInteractionHandler(routeKey: string): SidecarInteractionHandler | null {
  return handlerRegistry.get(routeKey) ?? null;
}

export async function routeSidecarInteraction(input: SidecarInteractionRequest): Promise<SidecarInteractionResult> {
  const request = validateSidecarInteractionRequest(input);
  const record = getActiveSidecarPanel(request.panelId);
  if (!record) {
    throw new Error("Sidecar panel is no longer active.");
  }
  if (record.conversationId !== request.conversationId) {
    throw new Error("Sidecar panel does not belong to the active conversation.");
  }
  if (record.panel.content.type !== "selection") {
    throw new Error("Sidecar panel does not support interactive selection.");
  }

  const content = record.panel.content;
  const action = content.actions.find((candidate) => candidate.id === request.actionId);
  if (!action) {
    throw new Error(`Unknown Sidecar action '${request.actionId}'.`);
  }

  const validItemIds = new Set(content.items.map((item) => item.id));
  for (const itemId of request.selectedItemIds) {
    if (!validItemIds.has(itemId)) {
      throw new Error(`Unknown Sidecar selection item '${itemId}'.`);
    }
  }

  if (content.selectionMode === "single" && request.selectedItemIds.length > 1) {
    throw new Error("Single-select Sidecar panels accept only one selected item.");
  }

  const handler = getSidecarInteractionHandler(content.interaction.routeKey);
  if (!handler) {
    throw new Error(`No Sidecar interaction handler registered for '${content.interaction.routeKey}'.`);
  }

  const result = await handler({
    action,
    conversationId: request.conversationId,
    panel: record.panel,
    selectedItemIds: [...request.selectedItemIds],
    userId: resolveAgentUserId(request.userId ?? record.userId),
  });

  syncActiveSidecarPanel({
    action: result.action,
    panel: result.panel,
    conversationId: request.conversationId,
    runId: record.runId,
    userId: resolveAgentUserId(request.userId ?? record.userId),
    toolName: "sidecar_interaction",
  });

  return result;
}

export function resetSidecarInteractionHandlersForTests(): void {
  handlerRegistry.clear();
  registerSidecarInteractionHandler("sidecar.selection.apply", async (context) => {
    switch (context.action.kind) {
      case "toggle":
        return applySelectionActionToPanel(context.panel, context.selectedItemIds, "update");
      case "clear":
        return applySelectionActionToPanel(context.panel, [], "update");
      case "close":
        return { ok: true, action: "close", panel: null };
      case "apply":
        return applySelectionActionToPanel(context.panel, context.selectedItemIds, "update");
    }
  });
}