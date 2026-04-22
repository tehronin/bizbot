"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageMarkdown } from "@/components/chat/MessageMarkdown";
import type { JsonValue } from "@/lib/agent/tools";
import { applySidecarActionToPanels } from "@/lib/sidecar/stack";
import type {
  SidecarContent,
  SidecarContextSnapshot,
  SidecarDiffContent,
  SidecarInteractionEventDetail,
  SidecarInteractionStateEventDetail,
  SidecarKeyValueContent,
  SidecarPanel,
  SidecarProgressContent,
  SidecarSelectionActionDefinition,
  SidecarSelectionContent,
  SidecarStreamEventDetail,
  SidecarTableContent,
} from "@/lib/sidecar/types";
import {
  BIZBOT_SIDECAR_EVENT,
  BIZBOT_SIDECAR_INTERACTION_EVENT,
  BIZBOT_SIDECAR_INTERACTION_STATE_EVENT,
} from "@/lib/sidecar/types";

const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const SIDECAR_WIDTH_STORAGE_KEY = "bizbot:sidecar:width";
const SIDECAR_EXPANDED_STORAGE_KEY = "bizbot:sidecar:expanded";
const SELECTED_CONVERSATION_STORAGE_KEY = "bizbot:selected-chat-conversation-id";
const SIDECAR_STATE_SYNC_INTERVAL_MS = 2000;

function clampWidth(value: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, value));
}

function readStoredWidth(): number {
  if (typeof window === "undefined") {
    return DEFAULT_WIDTH;
  }

  const stored = window.localStorage?.getItem(SIDECAR_WIDTH_STORAGE_KEY);
  const parsed = stored ? Number.parseInt(stored, 10) : Number.NaN;
  return Number.isFinite(parsed) ? clampWidth(parsed) : DEFAULT_WIDTH;
}

function readStoredExpanded(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage?.getItem(SIDECAR_EXPANDED_STORAGE_KEY) === "true";
}

function persistWidth(width: number): void {
  if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") {
    return;
  }

  window.localStorage.setItem(SIDECAR_WIDTH_STORAGE_KEY, String(width));
}

function persistExpanded(isExpanded: boolean): void {
  if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") {
    return;
  }

  window.localStorage.setItem(SIDECAR_EXPANDED_STORAGE_KEY, String(isExpanded));
}

function readSelectedConversationId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const selectedConversationId = window.localStorage?.getItem(SELECTED_CONVERSATION_STORAGE_KEY)?.trim();
  return selectedConversationId ? selectedConversationId : null;
}

function dispatchSidecarInteraction(detail: SidecarInteractionEventDetail): void {
  window.dispatchEvent(new CustomEvent(BIZBOT_SIDECAR_INTERACTION_EVENT, { detail }));
}

function dispatchSidecarEvent(detail: SidecarStreamEventDetail): void {
  window.dispatchEvent(new CustomEvent(BIZBOT_SIDECAR_EVENT, { detail }));
}

const CONTEXT_PLACEHOLDER_PATTERN = /\{\{\s*([a-z0-9._:-]{1,120})\s*\}\}/gi;

function getReadableContextValue(
  contextBinding: SidecarPanel["context"],
  contextSnapshot: SidecarContextSnapshot | null,
  contextKey: string | undefined,
): unknown {
  if (!contextKey || !contextBinding || !contextSnapshot || contextSnapshot.contextId !== contextBinding.contextId) {
    return undefined;
  }

  if (contextBinding.readKeys && !contextBinding.readKeys.includes(contextKey) && contextBinding.selectionKey !== contextKey) {
    return undefined;
  }

  return contextSnapshot.values[contextKey];
}

function formatContextValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  return JSON.stringify(value);
}

function interpolateContextString(
  template: string,
  contextBinding: SidecarPanel["context"],
  contextSnapshot: SidecarContextSnapshot | null,
): string {
  return template.replace(CONTEXT_PLACEHOLDER_PATTERN, (_match, contextKey: string) => formatContextValue(getReadableContextValue(contextBinding, contextSnapshot, contextKey)));
}

function resolveContextJsonValue(
  value: JsonValue,
  contextBinding: SidecarPanel["context"],
  contextSnapshot: SidecarContextSnapshot | null,
): JsonValue {
  if (typeof value === "string") {
    return interpolateContextString(value, contextBinding, contextSnapshot);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveContextJsonValue(entry, contextBinding, contextSnapshot));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, resolveContextJsonValue(entryValue, contextBinding, contextSnapshot)]),
    ) as Record<string, JsonValue>;
  }
  return value;
}

function getContextSelectedItemIds(
  content: SidecarSelectionContent,
  contextBinding: SidecarPanel["context"],
  contextSnapshot: SidecarContextSnapshot | null,
): string[] {
  if (!contextBinding?.selectionKey) {
    return [...(content.selectedItemIds ?? [])];
  }

  const contextValue = getReadableContextValue(contextBinding, contextSnapshot, contextBinding.selectionKey);
  if (content.selectionMode === "single") {
    return typeof contextValue === "string" && contextValue.length > 0 ? [contextValue] : [];
  }

  return Array.isArray(contextValue)
    ? contextValue.filter((value): value is string => typeof value === "string")
    : [];
}

function buildSelectionContextPatch(
  content: SidecarSelectionContent,
  contextBinding: SidecarPanel["context"],
  selectedItemIds: string[],
): SidecarInteractionEventDetail["contextPatch"] {
  if (!contextBinding?.selectionKey) {
    return undefined;
  }

  return {
    contextId: contextBinding.contextId,
    values: {
      [contextBinding.selectionKey]: content.selectionMode === "single"
        ? selectedItemIds[0] ?? null
        : [...selectedItemIds],
    },
  };
}

function TableContentView({ content }: { content: SidecarTableContent }) {
  return (
    <div className="overflow-auto border border-border-sub bg-raised">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border-sub bg-surface">
            {content.columns.map((column) => (
              <th key={column} className="px-3 py-2 text-left text-xs uppercase tracking-[0.16em] text-muted">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {content.rows.map((row, index) => (
            <tr key={`row-${index}`} className="border-b border-border-sub last:border-b-0">
              {(row as unknown[]).map((cell, cellIndex) => (
                <td key={`cell-${index}-${cellIndex}`} className="px-3 py-2 align-top text-primary">
                  {typeof cell === "string" ? cell : JSON.stringify(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function resolveContextValue(
  fallbackValue: unknown,
  contextKey: string | undefined,
  contextBinding: SidecarPanel["context"],
  contextSnapshot: SidecarContextSnapshot | null,
): unknown {
  if (!contextKey) {
    return fallbackValue;
  }

  return getReadableContextValue(contextBinding, contextSnapshot, contextKey) ?? fallbackValue;
}

function KeyValueContentView({
  content,
  contextBinding,
  contextSnapshot,
}: {
  content: SidecarKeyValueContent;
  contextBinding?: SidecarPanel["context"];
  contextSnapshot: SidecarContextSnapshot | null;
}) {
  return (
    <div className="space-y-3">
      {content.entries.map((entry) => (
        <div key={entry.label} className="border border-border-sub bg-raised px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted">{entry.label}</div>
          <div className="mt-2 text-sm text-primary whitespace-pre-wrap break-words">
            {(() => {
              const resolvedValue = resolveContextValue(entry.value, entry.contextKey, contextBinding, contextSnapshot);
              return typeof resolvedValue === "string" ? resolvedValue : JSON.stringify(resolvedValue, null, 2);
            })()}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProgressContentView({ content }: { content: SidecarProgressContent }) {
  return (
    <div className="space-y-4">
      <div className="text-sm font-medium text-primary">{content.title}</div>
      <div className="space-y-3">
        {content.items.map((item) => (
          <div key={item.id} className="border border-border-sub bg-raised px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-primary">{item.label}</div>
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted">{item.status}</div>
            </div>
            {item.detail ? <div className="mt-2 text-sm leading-6 text-dim">{item.detail}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function DiffContentView({ content }: { content: SidecarDiffContent }) {
  return (
    <div className="space-y-4">
      {content.sections.map((section, index) => (
        <div key={`${section.label ?? "diff"}-${index}`} className="space-y-3 border border-border-sub bg-raised p-4">
          {section.label ? <div className="text-sm font-medium text-primary">{section.label}</div> : null}
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-muted">before</div>
              <pre className="overflow-auto border border-border-sub bg-surface p-3 text-xs leading-6 whitespace-pre-wrap break-words"><code>{section.before}</code></pre>
            </div>
            <div>
              <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-muted">after</div>
              <pre className="overflow-auto border border-border-sub bg-surface p-3 text-xs leading-6 whitespace-pre-wrap break-words"><code>{section.after}</code></pre>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SidecarContentView({
  content,
  contextBinding,
  contextSnapshot,
}: {
  content: SidecarContent;
  contextBinding?: SidecarPanel["context"];
  contextSnapshot: SidecarContextSnapshot | null;
}) {
  switch (content.type) {
    case "markdown":
      return <MessageMarkdown markdown={interpolateContextString(content.markdown, contextBinding, contextSnapshot)} />;
    case "code":
      return (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted">{content.language ?? "code"}</div>
          <pre className="overflow-auto border border-border-sub bg-raised text-primary p-3 text-xs leading-6 whitespace-pre-wrap break-words">
            <code>{interpolateContextString(content.code, contextBinding, contextSnapshot)}</code>
          </pre>
        </div>
      );
    case "json":
      return (
        <pre className="overflow-auto border border-border-sub bg-raised text-primary p-3 text-xs leading-6 whitespace-pre-wrap break-words">
          <code>{JSON.stringify(content.value, null, 2)}</code>
        </pre>
      );
    case "image":
      return (
        <figure className="space-y-3">
          {/* Sidecar intentionally renders validated transient image payloads directly. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={content.url} alt={content.alt} className="max-w-full border border-border-sub" />
          <figcaption className="text-xs leading-6 text-dim">{content.alt}</figcaption>
        </figure>
      );
    case "selection":
      return null;
    case "table":
      return <TableContentView content={{
        ...content,
        columns: content.columns.map((column) => interpolateContextString(column, contextBinding, contextSnapshot)),
        rows: content.rows.map((row) => Array.isArray(row)
          ? row.map((cell) => resolveContextJsonValue(cell, contextBinding, contextSnapshot))
          : row),
      }} />;
    case "key_value":
      return <KeyValueContentView content={content} contextBinding={contextBinding} contextSnapshot={contextSnapshot} />;
    case "progress":
      return <ProgressContentView content={content} />;
    case "diff":
      return <DiffContentView content={content} />;
  }
}

function SidecarSelectionView({
  panelId,
  content,
  contextBinding,
  contextSnapshot,
  stackRevision,
  pending,
  error,
}: {
  panelId: string;
  content: SidecarSelectionContent;
  contextBinding?: SidecarPanel["context"];
  contextSnapshot: SidecarContextSnapshot | null;
  stackRevision: number;
  pending: boolean;
  error: string | null;
}) {
  const effectiveSelectedItemIds = getContextSelectedItemIds(content, contextBinding, contextSnapshot);
  const selectedIds = new Set(effectiveSelectedItemIds);
  const toggleAction = content.actions.find((action) => action.kind === "toggle");
  const footerActions = content.actions.filter((action) => action.kind !== "toggle");
  const currentSelectionLabel = effectiveSelectedItemIds
    .map((itemId) => content.items.find((item) => item.id === itemId)?.title ?? itemId)
    .join(", ");

  function getNextSelectedIds(itemId: string): string[] {
    if (content.selectionMode === "single") {
      return selectedIds.has(itemId) ? [] : [itemId];
    }

    const next = new Set(selectedIds);
    if (next.has(itemId)) {
      next.delete(itemId);
    } else {
      next.add(itemId);
    }
    return [...next];
  }

  function onItemClick(itemId: string): void {
    if (!toggleAction || pending) {
      return;
    }

    dispatchSidecarInteraction({
      panelId,
      actionId: toggleAction.id,
      selectedItemIds: getNextSelectedIds(itemId),
      expectedStackRevision: stackRevision,
      contextPatch: buildSelectionContextPatch(content, contextBinding, getNextSelectedIds(itemId)),
    });
  }

  function onFooterAction(action: SidecarSelectionActionDefinition): void {
    if (pending) {
      return;
    }

    dispatchSidecarInteraction({
      panelId,
      actionId: action.id,
      selectedItemIds: effectiveSelectedItemIds,
      expectedStackRevision: stackRevision,
      contextPatch: buildSelectionContextPatch(content, contextBinding, effectiveSelectedItemIds),
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-sm font-medium text-primary">{content.title}</div>
        {content.description ? <p className="text-sm leading-6 text-dim">{content.description}</p> : null}
        {contextBinding?.selectionKey ? <div className="text-xs uppercase tracking-[0.18em] text-muted">Current selection: {currentSelectionLabel || "none"}</div> : null}
        {pending ? <div className="text-xs uppercase tracking-[0.18em] text-accent">Working...</div> : null}
        {error ? <div className="text-sm leading-6 text-danger">{error}</div> : null}
      </div>

      <div className="space-y-3">
        {content.items.map((item) => {
          const selected = selectedIds.has(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onItemClick(item.id)}
              disabled={pending}
              className={`w-full border p-4 text-left transition-colors disabled:opacity-60 ${
                selected ? "border-accent bg-accent-glow text-primary" : "border-border bg-raised text-primary"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2 min-w-0 flex-1">
                  <div className={`text-xs uppercase tracking-[0.18em] ${selected ? "text-accent" : "text-muted"}`}>{item.id}</div>
                  <div className="text-sm font-medium break-words">{item.title}</div>
                  {item.description ? <div className="text-sm leading-6 text-dim">{item.description}</div> : null}
                </div>
                <div className={`text-[11px] uppercase tracking-[0.18em] ${selected ? "text-accent" : "text-dim"}`}>
                  {selected ? "selected" : content.selectionMode === "multiple" ? "add" : "choose"}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {footerActions.length > 0 ? (
        <div className="flex flex-wrap gap-2 pt-2">
          {footerActions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => onFooterAction(action)}
              disabled={pending || (action.kind === "apply" && selectedIds.size === 0)}
              className="px-3 py-2 border border-border text-primary text-xs uppercase tracking-[0.18em] disabled:opacity-50"
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SidecarPanelContentView({
  panel,
  contextSnapshot,
  stackRevision,
  pending,
  error,
}: {
  panel: SidecarPanel;
  contextSnapshot: SidecarContextSnapshot | null;
  stackRevision: number;
  pending: boolean;
  error: string | null;
}) {
  if (panel.content.type === "selection") {
    return <SidecarSelectionView panelId={panel.panelId} content={panel.content} contextBinding={panel.context} contextSnapshot={contextSnapshot} stackRevision={stackRevision} pending={pending} error={error} />;
  }

  return <SidecarContentView content={panel.content} contextBinding={panel.context} contextSnapshot={contextSnapshot} />;
}

function SidecarEmptyState() {
  return (
    <div className="space-y-3 text-sm leading-6 text-dim">
      <div className="text-sm font-medium text-primary">No active sidecar panel</div>
      <p>Leave this split view open and the agent can fill it automatically when a task benefits from structured review.</p>
      <p>You can also collapse the split view with the chevron rail and reopen it later without using a popup.</p>
    </div>
  );
}

export default function SidecarHost() {
  const [panels, setPanels] = useState<SidecarPanel[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeContext, setActiveContext] = useState<SidecarContextSnapshot | null>(null);
  const [stackRevision, setStackRevision] = useState(0);
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [isExpanded, setIsExpanded] = useState(false);
  const [interactionPending, setInteractionPending] = useState(false);
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [hasHydratedPersistence, setHasHydratedPersistence] = useState(false);

  const activePanel = useMemo(() => panels[panels.length - 1] ?? null, [panels]);

  useEffect(() => {
    setWidth(readStoredWidth());
    setIsExpanded(readStoredExpanded());
    setHasHydratedPersistence(true);
  }, []);

  useEffect(() => {
    if (!hasHydratedPersistence) {
      return;
    }

    persistWidth(width);
  }, [hasHydratedPersistence, width]);

  useEffect(() => {
    if (!hasHydratedPersistence) {
      return;
    }

    persistExpanded(isExpanded);
  }, [hasHydratedPersistence, isExpanded]);

  useEffect(() => {
    if (!hasHydratedPersistence) {
      return;
    }

    let cancelled = false;

    const pollAuthoritativeState = async () => {
      const selectedConversationId = readSelectedConversationId();
      if (!selectedConversationId) {
        return;
      }

      try {
        const response = await fetch(`/api/sidecar/state?conversationId=${encodeURIComponent(selectedConversationId)}`, {
          cache: "no-store",
        });
        const payload = await response.json() as {
          error?: string;
          activePanel: SidecarPanel | null;
          stack: { panels: SidecarPanel[]; activePanelId: string | null; stackRevision: number };
          context?: SidecarContextSnapshot | null;
        };

        if (!response.ok || cancelled) {
          return;
        }

        const nextPanelId = payload.activePanel?.panelId ?? null;
        const currentPanelId = activePanel?.panelId ?? null;
        const currentConversationKey = activeConversationId ?? null;
        const hasChanged = currentConversationKey !== selectedConversationId
          || stackRevision !== payload.stack.stackRevision
          || currentPanelId !== nextPanelId
          || panels.length !== payload.stack.panels.length;

        if (!hasChanged) {
          return;
        }

        dispatchSidecarEvent({
          action: payload.activePanel ? "open" : "close",
          panel: payload.activePanel,
          stack: payload.stack,
          ...(payload.context !== undefined ? { context: payload.context } : {}),
          conversationId: selectedConversationId,
        });
      } catch {
        // Ignore transient poll failures; local interaction paths stay authoritative.
      }
    };

    void pollAuthoritativeState();
    const intervalId = window.setInterval(() => void pollAuthoritativeState(), SIDECAR_STATE_SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeConversationId, activePanel?.panelId, hasHydratedPersistence, panels.length, stackRevision]);

  useEffect(() => {
    const handleSidecarEvent = (event: Event) => {
      const detail = (event as CustomEvent<SidecarStreamEventDetail>).detail;
      if (!detail) {
        return;
      }

      if (detail.conversationId) {
        setActiveConversationId(detail.conversationId);
      }

      setCloseError(null);

      if (detail.context !== undefined) {
        setActiveContext(detail.context);
      } else if (detail.action === "close") {
        setActiveContext(null);
      }

      if (detail.stack) {
        setPanels(detail.stack.panels);
        setStackRevision(detail.stack.stackRevision);
      } else {
        setPanels((current) => applySidecarActionToPanels({
          action: detail.action,
          panel: detail.panel,
          panels: current,
        }));
        setStackRevision((current) => current + 1);
      }

      if (detail.action === "close") {
        setInteractionPending(false);
        setInteractionError(null);
        setIsExpanded(false);
        return;
      }

      if (detail.panel || (detail.stack && detail.stack.panels.length > 0)) {
        setInteractionPending(false);
        setInteractionError(null);
        setIsExpanded(true);
      }
    };

    window.addEventListener(BIZBOT_SIDECAR_EVENT, handleSidecarEvent as EventListener);
    return () => window.removeEventListener(BIZBOT_SIDECAR_EVENT, handleSidecarEvent as EventListener);
  }, []);

  useEffect(() => {
    const handleInteractionState = (event: Event) => {
      const detail = (event as CustomEvent<SidecarInteractionStateEventDetail>).detail;
      if (!detail || detail.panelId !== activePanel?.panelId) {
        return;
      }

      setInteractionPending(detail.pending);
      setInteractionError(detail.error ?? null);
    };

    window.addEventListener(BIZBOT_SIDECAR_INTERACTION_STATE_EVENT, handleInteractionState as EventListener);
    return () => window.removeEventListener(BIZBOT_SIDECAR_INTERACTION_STATE_EVENT, handleInteractionState as EventListener);
  }, [activePanel?.panelId]);

  function toggleExpanded(): void {
    setIsExpanded((current) => !current);
  }

  function collapsePanel(): void {
    setIsExpanded(false);
  }

  async function requestSidecarState(operation: "back" | "close" | "activate", panelId?: string): Promise<void> {
    if (!activeConversationId) {
      return;
    }

    setCloseError(null);
    setIsClosing(true);
    try {
      const response = await fetch("/api/sidecar/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeConversationId,
          operation,
          expectedStackRevision: stackRevision,
          ...(panelId ? { panelId } : {}),
        }),
      });
      const payload = await response.json() as { error?: string; action?: "close" | "update"; panel: SidecarPanel | null; stack?: { panels: SidecarPanel[]; activePanelId: string | null; stackRevision: number }; context?: SidecarContextSnapshot | null };
      if (response.status === 409 && payload.stack) {
        dispatchSidecarEvent({
          action: payload.panel ? "update" : "close",
          panel: payload.panel,
          stack: payload.stack,
          ...(payload.context !== undefined ? { context: payload.context } : {}),
          conversationId: activeConversationId,
        });
        setCloseError(payload.error ?? "Sidecar state changed while you were navigating. Review the latest stack and retry.");
        return;
      }

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to navigate Sidecar stack.");
      }

      const nextAction = payload.action ?? (payload.panel ? "update" : "close");

      dispatchSidecarEvent({
        action: nextAction,
        panel: payload.panel,
        ...(payload.stack ? { stack: payload.stack } : {}),
        ...(payload.context !== undefined ? { context: payload.context } : {}),
        conversationId: activeConversationId,
      });
    } catch (error) {
      setCloseError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsClosing(false);
    }
  }

  async function closePanel(): Promise<void> {
    if (!activePanel) {
      setIsExpanded(false);
      return;
    }

    if (!activeConversationId) {
      setPanels([]);
      setActiveContext(null);
      setStackRevision(0);
      setInteractionPending(false);
      setInteractionError(null);
      setIsExpanded(false);
      return;
    }

    await requestSidecarState("close");
  }

  async function goBack(): Promise<void> {
    if (!activeConversationId || panels.length <= 1) {
      return;
    }

    await requestSidecarState("back");
  }

  async function activatePanel(panelId: string): Promise<void> {
    if (!activeConversationId || activePanel?.panelId === panelId || isClosing) {
      return;
    }

    await requestSidecarState("activate", panelId);
  }

  function beginResize(event: React.PointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;

    const onMove = (moveEvent: PointerEvent) => {
      setWidth(clampWidth(startWidth + (startX - moveEvent.clientX)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  return (
    <div className="relative z-40 flex h-full max-w-full shrink-0" aria-label="Sidecar split view">
      {isExpanded ? (
        <button
          type="button"
          aria-label="Resize sidecar"
          className="hidden md:block w-3 cursor-col-resize"
          onPointerDown={beginResize}
          style={{ background: "linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.16) 50%, transparent 100%)" }}
        />
      ) : null}

      {isExpanded ? (
        <aside className="flex h-full min-w-0 flex-col border-l border-border bg-surface shadow-[0_0_24px_rgba(0,0,0,0.12)]" style={{ width: `min(${width}px, calc(100vw - 40px))` }}>
          <div className="sticky top-0 z-10 border-b border-border bg-surface px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2 min-w-0 flex-1">
                {activePanel ? <div className="text-sm font-medium break-words text-primary">{activePanel.title}</div> : null}
                {activePanel ? <div className="text-[11px] uppercase tracking-[0.16em] text-dim">{activePanel.content.type}</div> : null}
                {panels.length > 1 ? (
                  <div className="text-[11px] uppercase tracking-[0.16em] text-dim">stack {panels.length}</div>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {panels.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => void goBack()}
                    disabled={isClosing}
                    className="px-3 py-2 border border-border text-primary text-xs uppercase tracking-[0.18em] disabled:opacity-50"
                  >
                    back
                  </button>
                ) : null}
              </div>
            </div>
            {panels.length > 1 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {panels.map((panel, index) => (
                  <button
                    key={panel.panelId}
                    type="button"
                    onClick={() => void activatePanel(panel.panelId)}
                    disabled={isClosing || index === panels.length - 1}
                    className={`px-2 py-1 text-[11px] uppercase tracking-[0.16em] border disabled:cursor-default disabled:opacity-100 ${index === panels.length - 1 ? "border-accent text-accent" : "border-border text-dim hover:border-primary hover:text-primary"}`}
                    aria-label={index === panels.length - 1 ? `${panel.title} active panel` : `Open ${panel.title} panel`}
                  >
                    {panel.title}
                  </button>
                ))}
              </div>
            ) : null}
            {closeError ? <div className="pt-3 text-sm leading-6 text-danger">{closeError}</div> : null}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-5">
            {activePanel ? <SidecarPanelContentView panel={activePanel} contextSnapshot={activeContext} stackRevision={stackRevision} pending={interactionPending} error={interactionError} /> : <SidecarEmptyState />}
          </div>
        </aside>
      ) : null}

      <div className="flex h-full w-10 shrink-0 border-l border-border bg-surface/95 backdrop-blur">
        <button
          type="button"
          onClick={toggleExpanded}
          aria-label={isExpanded ? "Collapse sidecar" : "Expand sidecar"}
          className="flex h-full w-full items-center justify-center text-lg text-primary transition-colors hover:bg-raised"
        >
          {isExpanded ? ">" : "<"}
        </button>
      </div>
    </div>
  );
}