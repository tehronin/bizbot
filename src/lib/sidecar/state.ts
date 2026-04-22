import { applySidecarActionToPanels, buildRestorableSidecarStackSnapshot, buildSidecarStackSnapshot, getRestorableActiveSidecarPanel } from "@/lib/sidecar/stack";
import type { SidecarAction, SidecarPanel, SidecarStackSnapshot } from "@/lib/sidecar/types";

export interface ActiveSidecarPanelRecord {
  panel: SidecarPanel;
  conversationId: string;
  runId?: string;
  userId?: string;
  toolName?: string;
  updatedAt: string;
}

const panelById = new Map<string, ActiveSidecarPanelRecord>();
const stackByConversation = new Map<string, SidecarPanel[]>();

export function syncActiveSidecarPanel(input: {
  action: SidecarAction;
  panel: SidecarPanel | null;
  conversationId: string;
  runId?: string;
  userId?: string;
  toolName?: string;
}): ActiveSidecarPanelRecord | null {
  const currentPanels = stackByConversation.get(input.conversationId) ?? [];
  const nextPanels = applySidecarActionToPanels({
    action: input.action,
    panel: input.panel,
    panels: currentPanels,
  });

  for (const existingPanel of currentPanels) {
    if (!nextPanels.some((panel) => panel.panelId === existingPanel.panelId)) {
      panelById.delete(existingPanel.panelId);
    }
  }

  if (nextPanels.length === 0) {
    stackByConversation.delete(input.conversationId);
    return null;
  }

  stackByConversation.set(input.conversationId, nextPanels);
  const updatedAt = new Date().toISOString();

  for (const panel of nextPanels) {
    panelById.set(panel.panelId, {
      panel,
      conversationId: input.conversationId,
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.toolName ? { toolName: input.toolName } : {}),
      updatedAt,
    });
  }

  const activePanel = nextPanels[nextPanels.length - 1] ?? null;
  return activePanel ? panelById.get(activePanel.panelId) ?? null : null;
}

export function getActiveSidecarPanel(panelId: string): ActiveSidecarPanelRecord | null {
  return panelById.get(panelId) ?? null;
}

export function getActiveSidecarPanelForConversation(conversationId: string): ActiveSidecarPanelRecord | null {
  const panels = stackByConversation.get(conversationId);
  if (!panels || panels.length === 0) {
    return null;
  }

  const activePanel = panels[panels.length - 1];
  return activePanel ? panelById.get(activePanel.panelId) ?? null : null;
}

export function getActiveSidecarStackForConversation(conversationId: string): SidecarStackSnapshot {
  return buildSidecarStackSnapshot(stackByConversation.get(conversationId) ?? []);
}

export function getRestorableActiveSidecarPanelForConversation(conversationId: string): ActiveSidecarPanelRecord | null {
  const panels = stackByConversation.get(conversationId) ?? [];
  const restorablePanel = getRestorableActiveSidecarPanel(panels);
  return restorablePanel ? panelById.get(restorablePanel.panelId) ?? null : null;
}

export function getRestorableSidecarStackForConversation(conversationId: string): SidecarStackSnapshot {
  return buildRestorableSidecarStackSnapshot(stackByConversation.get(conversationId) ?? []);
}

export function popActiveSidecarPanelForConversation(conversationId: string): SidecarStackSnapshot {
  const panels = stackByConversation.get(conversationId) ?? [];
  if (panels.length <= 1) {
    closeActiveSidecarPanelForConversation(conversationId);
    return { panels: [], activePanelId: null };
  }

  const nextPanels = panels.slice(0, -1);
  const removedPanels = panels.slice(nextPanels.length);
  for (const panel of removedPanels) {
    panelById.delete(panel.panelId);
  }
  stackByConversation.set(conversationId, nextPanels);
  return buildSidecarStackSnapshot(nextPanels);
}

export function activateSidecarPanelForConversation(conversationId: string, panelId: string): SidecarStackSnapshot {
  const panels = stackByConversation.get(conversationId) ?? [];
  const targetIndex = panels.findIndex((panel) => panel.panelId === panelId);
  if (targetIndex === -1) {
    throw new Error(`Sidecar panel '${panelId}' was not found for conversation '${conversationId}'.`);
  }

  if (targetIndex === panels.length - 1) {
    return buildSidecarStackSnapshot(panels);
  }

  const nextPanels = panels.slice(0, targetIndex + 1);
  const removedPanels = panels.slice(nextPanels.length);
  for (const panel of removedPanels) {
    panelById.delete(panel.panelId);
  }

  stackByConversation.set(conversationId, nextPanels);
  return buildSidecarStackSnapshot(nextPanels);
}

export function closeActiveSidecarPanelForConversation(conversationId: string): void {
  const panels = stackByConversation.get(conversationId);
  if (!panels || panels.length === 0) {
    return;
  }

  for (const panel of panels) {
    panelById.delete(panel.panelId);
  }
  stackByConversation.delete(conversationId);
}

export function resetActiveSidecarPanelsForTests(): void {
  panelById.clear();
  stackByConversation.clear();
}