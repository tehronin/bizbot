import type { SidecarAction, SidecarPanel, SidecarPanelPersistence, SidecarStackSnapshot } from "@/lib/sidecar/types";

function getPanelPersistence(panel: SidecarPanel): SidecarPanelPersistence | "default" {
  return panel.persistence ?? "default";
}

function isEphemeralPanel(panel: SidecarPanel): boolean {
  return getPanelPersistence(panel) === "ephemeral";
}

function isWorkflowPanel(panel: SidecarPanel): boolean {
  const persistence = getPanelPersistence(panel);
  return persistence === "workflow" || persistence === "default";
}

function stripEphemeralPanels(panels: SidecarPanel[]): SidecarPanel[] {
  return panels.filter((panel) => !isEphemeralPanel(panel));
}

function dismissPanelsByPersistence(panels: SidecarPanel[]): SidecarPanel[] {
  if (panels.length === 0) {
    return [];
  }

  const activePanel = panels[panels.length - 1]!;
  if (isEphemeralPanel(activePanel)) {
    return panels.slice(0, -1);
  }

  if (isWorkflowPanel(activePanel)) {
    let keepUntil = panels.length - 1;
    while (keepUntil >= 0) {
      const candidate = panels[keepUntil]!;
      if (!isWorkflowPanel(candidate) && !isEphemeralPanel(candidate)) {
        break;
      }
      keepUntil -= 1;
    }
    return panels.slice(0, keepUntil + 1);
  }

  return panels.slice(0, -1);
}

function applyOpenPersistencePolicy(currentPanels: SidecarPanel[], incoming: SidecarPanel): SidecarPanel[] {
  const persistentPanels = stripEphemeralPanels(currentPanels);
  const withoutIncoming = persistentPanels.filter((panel) => panel.panelId !== incoming.panelId);

  if (incoming.persistence === "ephemeral") {
    return [...withoutIncoming, incoming];
  }

  return [...withoutIncoming, incoming];
}

export function buildSidecarStackSnapshot(panels: SidecarPanel[]): SidecarStackSnapshot {
  return {
    panels: panels.map((panel) => ({ ...panel })),
    activePanelId: panels.length > 0 ? panels[panels.length - 1]!.panelId : null,
  };
}

export function buildRestorableSidecarStackSnapshot(panels: SidecarPanel[]): SidecarStackSnapshot {
  return buildSidecarStackSnapshot(stripEphemeralPanels(panels));
}

export function getRestorableActiveSidecarPanel(panels: SidecarPanel[]): SidecarPanel | null {
  const restorablePanels = stripEphemeralPanels(panels);
  return restorablePanels[restorablePanels.length - 1] ?? null;
}

export function applySidecarActionToPanels(input: {
  action: SidecarAction;
  panel: SidecarPanel | null;
  panels: SidecarPanel[];
}): SidecarPanel[] {
  if (input.action === "close" || input.panel === null) {
    return dismissPanelsByPersistence(input.panels.map((panel) => ({ ...panel })));
  }

  const currentPanels = input.panels.map((panel) => ({ ...panel }));
  const incoming = { ...input.panel };
  const existingIndex = currentPanels.findIndex((panel) => panel.panelId === incoming.panelId);

  if (input.action === "open") {
    return applyOpenPersistencePolicy(currentPanels, incoming);
  }

  if (existingIndex >= 0) {
    currentPanels[existingIndex] = incoming;
    return currentPanels;
  }

  if (currentPanels.length === 0) {
    return [incoming];
  }

  currentPanels[currentPanels.length - 1] = incoming;
  return currentPanels;
}