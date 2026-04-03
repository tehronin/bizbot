import type { SidecarAction, SidecarPanel } from "@/lib/sidecar/types";

export interface ActiveSidecarPanelRecord {
  panel: SidecarPanel;
  conversationId: string;
  runId?: string;
  userId?: string;
  toolName?: string;
  updatedAt: string;
}

const panelById = new Map<string, ActiveSidecarPanelRecord>();
const panelIdByConversation = new Map<string, string>();

export function syncActiveSidecarPanel(input: {
  action: SidecarAction;
  panel: SidecarPanel | null;
  conversationId: string;
  runId?: string;
  userId?: string;
  toolName?: string;
}): ActiveSidecarPanelRecord | null {
  const activePanelId = panelIdByConversation.get(input.conversationId);

  if (input.action === "close" || input.panel === null) {
    if (activePanelId) {
      panelById.delete(activePanelId);
      panelIdByConversation.delete(input.conversationId);
    }
    return null;
  }

  if (activePanelId && activePanelId !== input.panel.panelId) {
    panelById.delete(activePanelId);
  }

  const record: ActiveSidecarPanelRecord = {
    panel: input.panel,
    conversationId: input.conversationId,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.toolName ? { toolName: input.toolName } : {}),
    updatedAt: new Date().toISOString(),
  };

  panelById.set(input.panel.panelId, record);
  panelIdByConversation.set(input.conversationId, input.panel.panelId);
  return record;
}

export function getActiveSidecarPanel(panelId: string): ActiveSidecarPanelRecord | null {
  return panelById.get(panelId) ?? null;
}

export function getActiveSidecarPanelForConversation(conversationId: string): ActiveSidecarPanelRecord | null {
  const panelId = panelIdByConversation.get(conversationId);
  if (!panelId) {
    return null;
  }

  return panelById.get(panelId) ?? null;
}

export function resetActiveSidecarPanelsForTests(): void {
  panelById.clear();
  panelIdByConversation.clear();
}