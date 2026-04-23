import { applySidecarActionToPanels, buildRestorableSidecarStackSnapshot, buildSidecarStackSnapshot, getRestorableActiveSidecarPanel } from "@/lib/sidecar/stack";
import type { JsonValue } from "@/lib/agent/tools";
import type { SidecarAction, SidecarContextPatch, SidecarContextSnapshot, SidecarPanel, SidecarStackSnapshot } from "@/lib/sidecar/types";

export class SidecarContextConflictError extends Error {
  readonly currentRevision: number;
  readonly expectedRevision: number;

  constructor(expectedRevision: number, currentRevision: number) {
    super("Sidecar context changed while you were interacting. Review the latest context and retry.");
    this.name = "SidecarContextConflictError";
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
  }
}

export interface ActiveSidecarPanelRecord {
  panel: SidecarPanel;
  conversationId: string;
  runId?: string;
  userId?: string;
  toolName?: string;
  updatedAt: string;
}

interface SidecarStateStore {
  panelById: Map<string, ActiveSidecarPanelRecord>;
  stackByConversation: Map<string, SidecarPanel[]>;
  stackRevisionByConversation: Map<string, number>;
  contextByConversation: Map<string, SidecarContextSnapshot>;
}

function getSidecarStateStore(): SidecarStateStore {
  const globalStore = globalThis as typeof globalThis & {
    __bizbotSidecarStateStore__?: SidecarStateStore;
  };

  if (!globalStore.__bizbotSidecarStateStore__) {
    globalStore.__bizbotSidecarStateStore__ = {
      panelById: new Map<string, ActiveSidecarPanelRecord>(),
      stackByConversation: new Map<string, SidecarPanel[]>(),
      stackRevisionByConversation: new Map<string, number>(),
      contextByConversation: new Map<string, SidecarContextSnapshot>(),
    };
  }

  return globalStore.__bizbotSidecarStateStore__;
}

const stateStore = getSidecarStateStore();
const panelById = stateStore.panelById;
const stackByConversation = stateStore.stackByConversation;
const stackRevisionByConversation = stateStore.stackRevisionByConversation;
const contextByConversation = stateStore.contextByConversation;

function deriveSelectionContextValue(panel: SidecarPanel): JsonValue | undefined {
  if (panel.content.type !== "selection" || !panel.context?.selectionKey) {
    return undefined;
  }

  if (panel.content.selectionMode === "single") {
    return panel.content.selectedItemIds?.[0] ?? null;
  }

  return [...(panel.content.selectedItemIds ?? [])];
}

function deriveInitialContextValues(panel: SidecarPanel): Record<string, JsonValue> {
  const selectionKey = panel.context?.selectionKey;
  const selectionValue = deriveSelectionContextValue(panel);
  if (!selectionKey || selectionValue === undefined) {
    return {};
  }

  return {
    [selectionKey]: selectionValue,
  };
}

function cloneContextValues(values: Record<string, JsonValue>): Record<string, JsonValue> {
  return structuredClone(values);
}

function cloneContextSnapshot(snapshot: SidecarContextSnapshot): SidecarContextSnapshot {
  return {
    ...snapshot,
    values: cloneContextValues(snapshot.values),
  };
}

function jsonValueEquals(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getContextRevision(conversationId: string): number {
  return contextByConversation.get(conversationId)?.contextRevision ?? 0;
}

function buildContextBaseline(input: {
  conversationId: string;
  panel: SidecarPanel;
  existing?: SidecarContextSnapshot;
  stackRevision: number;
}): SidecarContextSnapshot {
  const binding = input.panel.context;
  if (!binding) {
    throw new Error("Sidecar panel does not declare a context binding.");
  }

  const reusesContext = input.existing?.contextId === binding.contextId;
  const existingContext = reusesContext ? input.existing : undefined;

  return {
    contextId: binding.contextId,
    conversationId: input.conversationId,
    rootPanelId: reusesContext
      ? existingContext!.rootPanelId
      : binding.parentPanelId ?? input.panel.panelId,
    activePanelId: getActiveSidecarPanelForConversation(input.conversationId)?.panel.panelId ?? input.panel.panelId,
    contextLineageId: reusesContext
      ? existingContext!.contextLineageId
      : crypto.randomUUID(),
    contextRevision: reusesContext
      ? existingContext!.contextRevision
      : 0,
    stackRevision: input.stackRevision,
    values: reusesContext
      ? cloneContextValues(existingContext!.values)
      : deriveInitialContextValues(input.panel),
  };
}

function assertContextPatchWritable(panel: SidecarPanel, contextPatch: SidecarContextPatch): void {
  const binding = panel.context;
  if (!binding) {
    throw new Error("Sidecar panel does not declare a context binding.");
  }
  if (binding.contextId !== contextPatch.contextId) {
    throw new Error("Sidecar context patch does not match the active panel context.");
  }

  const writableKeys = new Set(binding.writeKeys ?? []);
  if (writableKeys.size === 0) {
    throw new Error("Sidecar panel does not allow context writes.");
  }

  for (const key of Object.keys(contextPatch.values)) {
    if (!writableKeys.has(key)) {
      throw new Error(`Sidecar context key '${key}' is not writable from this panel.`);
    }
  }
}

function getStackRevision(conversationId: string): number {
  return stackRevisionByConversation.get(conversationId) ?? 0;
}

function setNextStackRevision(conversationId: string): number {
  const nextRevision = getStackRevision(conversationId) + 1;
  stackRevisionByConversation.set(conversationId, nextRevision);
  return nextRevision;
}

function syncContextSnapshotWithStack(conversationId: string, panels: SidecarPanel[], stackRevision: number): SidecarContextSnapshot | null {
  if (panels.length === 0) {
    contextByConversation.delete(conversationId);
    return null;
  }

  const activePanel = panels[panels.length - 1] ?? null;
  if (!activePanel) {
    contextByConversation.delete(conversationId);
    return null;
  }

  const existingContext = contextByConversation.get(conversationId);
  const rootStillPresent = existingContext ? panels.some((panel) => panel.panelId === existingContext.rootPanelId) : false;
  const retainedContext = rootStillPresent ? existingContext : undefined;
  const binding = activePanel.context;

  if (!binding && !retainedContext) {
    contextByConversation.delete(conversationId);
    return null;
  }

  const nextContext: SidecarContextSnapshot = binding
    ? {
        contextId: binding.contextId,
        conversationId,
        rootPanelId: retainedContext?.contextId === binding.contextId
          ? retainedContext.rootPanelId
          : binding.parentPanelId ?? activePanel.panelId,
        activePanelId: activePanel.panelId,
        contextLineageId: retainedContext?.contextId === binding.contextId
          ? retainedContext.contextLineageId
          : crypto.randomUUID(),
        contextRevision: retainedContext?.contextId === binding.contextId
          ? retainedContext.contextRevision
          : 0,
        stackRevision,
        values: retainedContext?.contextId === binding.contextId
          ? cloneContextValues(retainedContext.values)
          : deriveInitialContextValues(activePanel),
      }
    : {
        ...(retainedContext as SidecarContextSnapshot),
        activePanelId: activePanel.panelId,
        stackRevision,
        values: cloneContextValues(retainedContext!.values),
      };

  contextByConversation.set(conversationId, nextContext);
  return cloneContextSnapshot(nextContext);
}

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

  setNextStackRevision(input.conversationId);

  if (nextPanels.length === 0) {
    stackByConversation.delete(input.conversationId);
    contextByConversation.delete(input.conversationId);
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

  syncContextSnapshotWithStack(input.conversationId, nextPanels, getStackRevision(input.conversationId));

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
  return buildSidecarStackSnapshot(stackByConversation.get(conversationId) ?? [], getStackRevision(conversationId));
}

export function getRestorableActiveSidecarPanelForConversation(conversationId: string): ActiveSidecarPanelRecord | null {
  const panels = stackByConversation.get(conversationId) ?? [];
  const restorablePanel = getRestorableActiveSidecarPanel(panels);
  return restorablePanel ? panelById.get(restorablePanel.panelId) ?? null : null;
}

export function getRestorableSidecarStackForConversation(conversationId: string): SidecarStackSnapshot {
  return buildRestorableSidecarStackSnapshot(stackByConversation.get(conversationId) ?? [], getStackRevision(conversationId));
}

export function getRestorableSidecarContextForConversation(conversationId: string): SidecarContextSnapshot | null {
  const snapshot = contextByConversation.get(conversationId);
  if (!snapshot) {
    return null;
  }

  const stack = buildRestorableSidecarStackSnapshot(stackByConversation.get(conversationId) ?? [], getStackRevision(conversationId));
  if (stack.panels.length === 0 || !stack.panels.some((panel) => panel.panelId === snapshot.rootPanelId)) {
    return null;
  }

  return cloneContextSnapshot({
    ...snapshot,
    activePanelId: stack.activePanelId,
    stackRevision: stack.stackRevision,
  });
}

export function getActiveSidecarContextForConversation(conversationId: string): SidecarContextSnapshot | null {
  const snapshot = contextByConversation.get(conversationId);
  return snapshot ? cloneContextSnapshot(snapshot) : null;
}

export function getActiveSidecarContextRevisionForConversation(conversationId: string): number {
  return getContextRevision(conversationId);
}

export function applySidecarContextMutationForConversation(input: {
  conversationId: string;
  panel: SidecarPanel;
  expectedContextRevision?: number;
  transportContextPatch?: SidecarContextPatch;
  resolvedContextPatch?: SidecarContextPatch;
}): SidecarContextSnapshot {
  const currentRevision = getContextRevision(input.conversationId);
  if (typeof input.expectedContextRevision === "number" && input.expectedContextRevision !== currentRevision) {
    throw new SidecarContextConflictError(input.expectedContextRevision, currentRevision);
  }

  const patches = [input.transportContextPatch, input.resolvedContextPatch].filter((patch): patch is SidecarContextPatch => Boolean(patch));
  if (patches.length === 0) {
    const existing = contextByConversation.get(input.conversationId);
    if (!existing) {
      throw new Error("Sidecar context mutation requires an active context snapshot.");
    }

    return cloneContextSnapshot(existing);
  }

  for (const patch of patches) {
    assertContextPatchWritable(input.panel, patch);
  }

  const stackRevision = getStackRevision(input.conversationId);
  const existing = contextByConversation.get(input.conversationId);
  const baseContext = buildContextBaseline({
    conversationId: input.conversationId,
    panel: input.panel,
    existing,
    stackRevision,
  });
  const nextValues = cloneContextValues(baseContext.values);
  let hasMeaningfulChange = !existing || existing.contextId !== baseContext.contextId;

  for (const patch of patches) {
    for (const [key, value] of Object.entries(patch.values)) {
      if (!jsonValueEquals(nextValues[key], value)) {
        hasMeaningfulChange = true;
      }
      nextValues[key] = structuredClone(value);
    }
  }

  const nextContext: SidecarContextSnapshot = {
    ...baseContext,
    stackRevision,
    values: nextValues,
    contextRevision: hasMeaningfulChange
      ? baseContext.contextRevision + 1
      : baseContext.contextRevision,
  };

  contextByConversation.set(input.conversationId, nextContext);
  return cloneContextSnapshot(nextContext);
}

export function applySidecarContextPatchForConversation(input: {
  conversationId: string;
  panel: SidecarPanel;
  contextPatch: SidecarContextPatch;
}): SidecarContextSnapshot {
  return applySidecarContextMutationForConversation({
    conversationId: input.conversationId,
    panel: input.panel,
    resolvedContextPatch: input.contextPatch,
  });
}

export function popActiveSidecarPanelForConversation(conversationId: string): SidecarStackSnapshot {
  const panels = stackByConversation.get(conversationId) ?? [];
  if (panels.length <= 1) {
    closeActiveSidecarPanelForConversation(conversationId);
    return buildSidecarStackSnapshot([], getStackRevision(conversationId));
  }

  const nextPanels = panels.slice(0, -1);
  const removedPanels = panels.slice(nextPanels.length);
  for (const panel of removedPanels) {
    panelById.delete(panel.panelId);
  }
  stackByConversation.set(conversationId, nextPanels);
  const stackRevision = setNextStackRevision(conversationId);
  syncContextSnapshotWithStack(conversationId, nextPanels, stackRevision);
  return buildSidecarStackSnapshot(nextPanels, stackRevision);
}

export function activateSidecarPanelForConversation(conversationId: string, panelId: string): SidecarStackSnapshot {
  const panels = stackByConversation.get(conversationId) ?? [];
  const targetIndex = panels.findIndex((panel) => panel.panelId === panelId);
  if (targetIndex === -1) {
    throw new Error(`Sidecar panel '${panelId}' was not found for conversation '${conversationId}'.`);
  }

  if (targetIndex === panels.length - 1) {
    return buildSidecarStackSnapshot(panels, getStackRevision(conversationId));
  }

  const nextPanels = panels.slice(0, targetIndex + 1);
  const removedPanels = panels.slice(nextPanels.length);
  for (const panel of removedPanels) {
    panelById.delete(panel.panelId);
  }

  stackByConversation.set(conversationId, nextPanels);
  const stackRevision = setNextStackRevision(conversationId);
  syncContextSnapshotWithStack(conversationId, nextPanels, stackRevision);
  return buildSidecarStackSnapshot(nextPanels, stackRevision);
}

export function closeActiveSidecarPanelForConversation(conversationId: string): void {
  const panels = stackByConversation.get(conversationId);
  if (panels && panels.length > 0) {
    for (const panel of panels) {
      panelById.delete(panel.panelId);
    }
  }

  setNextStackRevision(conversationId);
  stackByConversation.delete(conversationId);
  contextByConversation.delete(conversationId);
}

export function getActiveSidecarStackRevisionForConversation(conversationId: string): number {
  return getStackRevision(conversationId);
}

export function resetActiveSidecarPanelsForTests(): void {
  panelById.clear();
  stackByConversation.clear();
  stackRevisionByConversation.clear();
  contextByConversation.clear();
}