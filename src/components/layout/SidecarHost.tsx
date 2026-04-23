"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageMarkdown } from "@/components/chat/MessageMarkdown";
import SidecarThinkingDock from "@/components/layout/SidecarThinkingDock";
import type { JsonValue } from "@/lib/agent/tools";
import { applySidecarActionToPanels } from "@/lib/sidecar/stack";
import type { SidecarThinkingSnapshot } from "@/lib/sidecar/types";
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
  BIZBOT_SELECTED_CONVERSATION_EVENT,
  BIZBOT_SIDECAR_EVENT,
  BIZBOT_SIDECAR_INTERACTION_EVENT,
  BIZBOT_SIDECAR_INTERACTION_STATE_EVENT,
} from "@/lib/sidecar/types";

const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const DEFAULT_THINKING_DOCK_HEIGHT = 180;
const MIN_THINKING_DOCK_HEIGHT = 120;
const MAX_THINKING_DOCK_HEIGHT = 320;
const SIDECAR_WIDTH_STORAGE_KEY = "bizbot:sidecar:width";
const SIDECAR_EXPANDED_STORAGE_KEY = "bizbot:sidecar:expanded";
const SIDECAR_THINKING_EXPANDED_STORAGE_KEY = "bizbot:sidecar:thinking:expanded";
const SIDECAR_THINKING_HEIGHT_STORAGE_KEY = "bizbot:sidecar:thinking:height";
const SELECTED_CONVERSATION_STORAGE_KEY = "bizbot:selected-chat-conversation-id";
const IS_DEV_MODE = process.env.NODE_ENV !== "production";
const THINKING_POLL_STREAMING_INTERVAL_MS = 1500;
const THINKING_POLL_STABLE_INTERVAL_MS = 15_000;

type SidecarSyncState = "synced" | "updating" | "conflict" | "error";

function clampWidth(value: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, value));
}

function clampThinkingDockHeight(value: number): number {
  return Math.max(MIN_THINKING_DOCK_HEIGHT, Math.min(MAX_THINKING_DOCK_HEIGHT, value));
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

function readStoredThinkingExpanded(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage?.getItem(SIDECAR_THINKING_EXPANDED_STORAGE_KEY) === "true";
}

function readStoredThinkingHeight(): number {
  if (typeof window === "undefined") {
    return DEFAULT_THINKING_DOCK_HEIGHT;
  }

  const stored = window.localStorage?.getItem(SIDECAR_THINKING_HEIGHT_STORAGE_KEY);
  const parsed = stored ? Number.parseInt(stored, 10) : Number.NaN;
  return Number.isFinite(parsed) ? clampThinkingDockHeight(parsed) : DEFAULT_THINKING_DOCK_HEIGHT;
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

function persistThinkingExpanded(isExpanded: boolean): void {
  if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") {
    return;
  }

  window.localStorage.setItem(SIDECAR_THINKING_EXPANDED_STORAGE_KEY, String(isExpanded));
}

function persistThinkingHeight(height: number): void {
  if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") {
    return;
  }

  window.localStorage.setItem(SIDECAR_THINKING_HEIGHT_STORAGE_KEY, String(height));
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
const CONTEXT_PLACEHOLDER_OR_ESCAPE_PATTERN = /(\\)?\{\{\s*([a-z0-9._:-]{1,120})\s*\}\}/gi;

function classifySyncState(message: string): SidecarSyncState {
  return /changed while/i.test(message) ? "conflict" : "error";
}

function getSyncStateTone(syncState: SidecarSyncState): string {
  switch (syncState) {
    case "synced":
      return "bg-emerald-500";
    case "updating":
      return "bg-amber-500";
    case "conflict":
      return "bg-rose-500";
    case "error":
      return "bg-rose-500";
  }
}

function getSyncStateLabel(syncState: SidecarSyncState): string {
  switch (syncState) {
    case "synced":
      return "synced";
    case "updating":
      return "updating";
    case "conflict":
      return "conflict detected";
    case "error":
      return "sync error";
  }
}

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
  return template.replace(CONTEXT_PLACEHOLDER_OR_ESCAPE_PATTERN, (_match, escapePrefix: string | undefined, contextKey: string) => {
    if (escapePrefix) {
      return `{{${contextKey}}}`;
    }

    return formatContextValue(getReadableContextValue(contextBinding, contextSnapshot, contextKey));
  });
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

function getExpectedContextRevision(
  contextBinding: SidecarPanel["context"],
  contextSnapshot: SidecarContextSnapshot | null,
): number | undefined {
  if (!contextBinding || !contextSnapshot || contextSnapshot.contextId !== contextBinding.contextId) {
    return undefined;
  }

  return contextSnapshot.contextRevision;
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
          ? row.map((cell) => typeof cell === "string" ? interpolateContextString(cell, contextBinding, contextSnapshot) : cell)
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
  const expectedContextRevision = getExpectedContextRevision(contextBinding, contextSnapshot);

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
      ...(typeof expectedContextRevision === "number" ? { expectedContextRevision } : {}),
      contextPatch: buildSelectionContextPatch(content, contextBinding, getNextSelectedIds(itemId)),
    });
  }

  function onFooterAction(action: SidecarSelectionActionDefinition): void {
    if (pending) {
      return;
    }

    if (action.kind === "clear" && effectiveSelectedItemIds.length === 0) {
      return;
    }

    dispatchSidecarInteraction({
      panelId,
      actionId: action.id,
      selectedItemIds: effectiveSelectedItemIds,
      expectedStackRevision: stackRevision,
      ...(typeof expectedContextRevision === "number" ? { expectedContextRevision } : {}),
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
              disabled={pending || (action.kind === "apply" && selectedIds.size === 0) || (action.kind === "clear" && selectedIds.size === 0)}
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
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SidecarSyncState>("synced");
  const [lastRefreshReason, setLastRefreshReason] = useState<string | null>(null);
  const [lastSuccessfulSyncAt, setLastSuccessfulSyncAt] = useState<string | null>(null);
  const [lastConflictReason, setLastConflictReason] = useState<string | null>(null);
  const [thinkingSnapshot, setThinkingSnapshot] = useState<SidecarThinkingSnapshot | null>(null);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [thinkingDockHeight, setThinkingDockHeight] = useState(DEFAULT_THINKING_DOCK_HEIGHT);
  const [thinkingPollingEnabled, setThinkingPollingEnabled] = useState(false);

  const activePanel = useMemo(() => panels[panels.length - 1] ?? null, [panels]);
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);
  const thinkingRefreshInFlightRef = useRef(false);
  const activeConversationIdRef = useRef<string | null>(null);
  const activePanelIdRef = useRef<string | null>(null);
  const panelsLengthRef = useRef(0);
  const stackRevisionRef = useRef(0);
  const contextRevisionRef = useRef(0);
  const selectedConversationIdRef = useRef<string | null>(null);
  const thinkingSnapshotRef = useRef<SidecarThinkingSnapshot | null>(null);
  const thinkingSnapshotConversationIdRef = useRef<string | null>(null);
  const manuallyCollapsedThinkingSessionIdRef = useRef<string | null>(null);
  const autoOpenedThinkingSessionIdRef = useRef<string | null>(null);

  function clearThinkingState(): void {
    setThinkingSnapshot(null);
    setThinkingPollingEnabled(false);
    thinkingSnapshotConversationIdRef.current = null;
  }

  function armThinkingPolling(): void {
    setThinkingPollingEnabled(true);
  }

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
    activePanelIdRef.current = activePanel?.panelId ?? null;
    panelsLengthRef.current = panels.length;
    stackRevisionRef.current = stackRevision;
    contextRevisionRef.current = activeContext?.contextRevision ?? 0;
    selectedConversationIdRef.current = selectedConversationId;
    thinkingSnapshotRef.current = thinkingSnapshot;
  }, [activeConversationId, activeContext?.contextRevision, activePanel?.panelId, panels.length, selectedConversationId, stackRevision, thinkingSnapshot]);

  async function refreshAuthoritativeState(reason: string): Promise<void> {
    const nextSelectedConversationId = readSelectedConversationId();
    if (nextSelectedConversationId !== selectedConversationIdRef.current) {
      selectedConversationIdRef.current = nextSelectedConversationId;
      if (mountedRef.current) {
        setSelectedConversationId(nextSelectedConversationId);
      }
    }

    if (!nextSelectedConversationId || refreshInFlightRef.current) {
      return;
    }

    refreshInFlightRef.current = true;
    if (mountedRef.current) {
      setSyncState("updating");
      setLastRefreshReason(reason);
    }

    try {
      const response = await fetch(`/api/sidecar/state?conversationId=${encodeURIComponent(nextSelectedConversationId)}`, {
        cache: "no-store",
      });
      const payload = await response.json() as {
        error?: string;
        activePanel: SidecarPanel | null;
        stack: { panels: SidecarPanel[]; activePanelId: string | null; stackRevision: number };
        context?: SidecarContextSnapshot | null;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to refresh authoritative Sidecar state.");
      }

      const nextPanelId = payload.activePanel?.panelId ?? null;
      const nextContextRevision = payload.context?.contextRevision ?? 0;
      const hasChanged = activeConversationIdRef.current !== nextSelectedConversationId
        || stackRevisionRef.current !== payload.stack.stackRevision
        || activePanelIdRef.current !== nextPanelId
        || panelsLengthRef.current !== payload.stack.panels.length
        || contextRevisionRef.current !== nextContextRevision;

      if (hasChanged) {
        dispatchSidecarEvent({
          action: payload.activePanel ? "open" : "close",
          panel: payload.activePanel,
          stack: payload.stack,
          ...(payload.context !== undefined ? { context: payload.context } : {}),
          conversationId: nextSelectedConversationId,
        });
      }

      if (mountedRef.current) {
        setSyncState("synced");
        setLastSuccessfulSyncAt(new Date().toISOString());
        setLastConflictReason(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (mountedRef.current) {
        setSyncState(classifySyncState(message));
        if (classifySyncState(message) === "conflict") {
          setLastConflictReason(message);
        }
      }
    } finally {
      refreshInFlightRef.current = false;
    }
  }

  async function refreshThinkingState(reason: string): Promise<void> {
    const nextSelectedConversationId = readSelectedConversationId();
    if (!nextSelectedConversationId) {
      clearThinkingState();
      return;
    }

    if (thinkingRefreshInFlightRef.current) {
      return;
    }

    thinkingRefreshInFlightRef.current = true;
    if (mountedRef.current) {
      setLastRefreshReason((current) => current ?? reason);
    }

    try {
      const response = await fetch(`/api/sidecar/thinking?conversationId=${encodeURIComponent(nextSelectedConversationId)}`, {
        cache: "no-store",
      });
      const payload = await response.json() as { error?: string; snapshot: SidecarThinkingSnapshot | null };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to refresh Sidecar thinking state.");
      }

      const previousSnapshot = thinkingSnapshotRef.current;
      const nextSnapshot = payload.snapshot;
      setThinkingSnapshot(nextSnapshot);
      thinkingSnapshotConversationIdRef.current = nextSnapshot ? nextSelectedConversationId : null;

      if (nextSnapshot?.sessionId && nextSnapshot.sessionId !== previousSnapshot?.sessionId) {
        if (manuallyCollapsedThinkingSessionIdRef.current !== nextSnapshot.sessionId && autoOpenedThinkingSessionIdRef.current !== nextSnapshot.sessionId) {
          setThinkingExpanded(true);
          autoOpenedThinkingSessionIdRef.current = nextSnapshot.sessionId;
        }
      }

      if (nextSnapshot?.status === "streaming") {
        armThinkingPolling();
      } else {
        setThinkingPollingEnabled(false);
      }
    } catch {
      // Thinking is additive UI state; refresh failures must not disrupt the main Sidecar flow.
    } finally {
      thinkingRefreshInFlightRef.current = false;
    }
  }

  useEffect(() => {
    setWidth(readStoredWidth());
    setIsExpanded(readStoredExpanded());
    setThinkingExpanded(readStoredThinkingExpanded());
    setThinkingDockHeight(readStoredThinkingHeight());
    setSelectedConversationId(readSelectedConversationId());
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

    persistThinkingExpanded(thinkingExpanded);
  }, [hasHydratedPersistence, thinkingExpanded]);

  useEffect(() => {
    if (!hasHydratedPersistence) {
      return;
    }

    persistThinkingHeight(thinkingDockHeight);
  }, [hasHydratedPersistence, thinkingDockHeight]);

  useEffect(() => {
    if (!hasHydratedPersistence) {
      return;
    }

    void refreshAuthoritativeState("hydrate");
    void refreshThinkingState("hydrate-thinking");
  }, [hasHydratedPersistence]);

  useEffect(() => {
    if (!hasHydratedPersistence || !isExpanded) {
      return;
    }

    void refreshAuthoritativeState("expand");
    void refreshThinkingState("expand-thinking");
  }, [hasHydratedPersistence, isExpanded]);

  useEffect(() => {
    if (!hasHydratedPersistence || !selectedConversationId) {
      return;
    }

    void refreshAuthoritativeState("conversation-change");
    void refreshThinkingState("thinking-conversation-change");
  }, [hasHydratedPersistence, selectedConversationId]);

  useEffect(() => {
    if (!hasHydratedPersistence) {
      return;
    }

    const snapshotConversationId = thinkingSnapshotConversationIdRef.current;
    if (!selectedConversationId) {
      clearThinkingState();
      return;
    }

    if (snapshotConversationId && snapshotConversationId !== selectedConversationId) {
      clearThinkingState();
      armThinkingPolling();
    }
  }, [hasHydratedPersistence, selectedConversationId]);

  useEffect(() => {
    if (!hasHydratedPersistence || !isExpanded || !selectedConversationId || !thinkingPollingEnabled) {
      return;
    }

    const shouldPoll = typeof document === "undefined" || document.visibilityState === "visible";
    if (!shouldPoll) {
      return;
    }

    const pollIntervalMs = thinkingSnapshot?.status === "streaming"
      ? THINKING_POLL_STREAMING_INTERVAL_MS
      : THINKING_POLL_STABLE_INTERVAL_MS;
    const intervalId = window.setInterval(() => {
      void refreshThinkingState("thinking-poll");
    }, pollIntervalMs);

    return () => window.clearInterval(intervalId);
  }, [hasHydratedPersistence, isExpanded, selectedConversationId, thinkingPollingEnabled, thinkingSnapshot?.status]);

  useEffect(() => {
    if (!hasHydratedPersistence) {
      return;
    }

    const handleFocus = () => {
      armThinkingPolling();
      void refreshAuthoritativeState("window-focus");
      void refreshThinkingState("thinking-window-focus");
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        armThinkingPolling();
        void refreshAuthoritativeState("document-visible");
        void refreshThinkingState("thinking-document-visible");
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== SELECTED_CONVERSATION_STORAGE_KEY) {
        return;
      }

      const nextConversationId = readSelectedConversationId();
      setSelectedConversationId(nextConversationId);
      if (document.visibilityState === "visible") {
        armThinkingPolling();
        void refreshAuthoritativeState("storage-change");
        void refreshThinkingState("thinking-storage-change");
      }
    };
    const handleSelectedConversation = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId: string | null }>).detail;
      const nextConversationId = detail?.conversationId?.trim() || null;
      setSelectedConversationId(nextConversationId);
      armThinkingPolling();
      void refreshAuthoritativeState("selected-conversation-event");
      void refreshThinkingState("thinking-selected-conversation-event");
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("storage", handleStorage);
    window.addEventListener(BIZBOT_SELECTED_CONVERSATION_EVENT, handleSelectedConversation as EventListener);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(BIZBOT_SELECTED_CONVERSATION_EVENT, handleSelectedConversation as EventListener);
    };
  }, [hasHydratedPersistence]);

  useEffect(() => {
    const handleSidecarEvent = (event: Event) => {
      const detail = (event as CustomEvent<SidecarStreamEventDetail>).detail;
      if (!detail) {
        return;
      }

      if (detail.conversationId) {
        setActiveConversationId(detail.conversationId);
        setSelectedConversationId(detail.conversationId);
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
        setSyncState("synced");
        setLastSuccessfulSyncAt(new Date().toISOString());
        setIsExpanded(false);
        return;
      }

      if (detail.panel || (detail.stack && detail.stack.panels.length > 0)) {
        setInteractionPending(false);
        setInteractionError(null);
        setSyncState("synced");
        setLastSuccessfulSyncAt(new Date().toISOString());
        setLastConflictReason(null);
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
      if (detail.pending) {
        setSyncState("updating");
        return;
      }

      if (detail.error) {
        const nextSyncState = classifySyncState(detail.error);
        setSyncState(nextSyncState);
        if (nextSyncState === "conflict") {
          setLastConflictReason(detail.error);
        }
      }
    };

    window.addEventListener(BIZBOT_SIDECAR_INTERACTION_STATE_EVENT, handleInteractionState as EventListener);
    return () => window.removeEventListener(BIZBOT_SIDECAR_INTERACTION_STATE_EVENT, handleInteractionState as EventListener);
  }, [activePanel?.panelId]);

  function toggleExpanded(): void {
    setIsExpanded((current) => !current);
  }

  function toggleThinkingExpanded(): void {
    setThinkingExpanded((current) => {
      const nextValue = !current;
      if (!nextValue && thinkingSnapshotRef.current?.sessionId) {
        manuallyCollapsedThinkingSessionIdRef.current = thinkingSnapshotRef.current.sessionId;
      }
      return nextValue;
    });
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
        const errorMessage = payload.error ?? "Sidecar state changed while you were navigating. Review the latest stack and retry.";
        setCloseError(errorMessage);
        setSyncState("conflict");
        setLastConflictReason(errorMessage);
        void refreshAuthoritativeState("navigation-conflict");
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
      setSyncState("synced");
      setLastSuccessfulSyncAt(new Date().toISOString());
      setLastConflictReason(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCloseError(message);
      setSyncState(classifySyncState(message));
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
                {IS_DEV_MODE ? (
                  <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-dim">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border-sub px-1.5 py-0.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${getSyncStateTone(syncState)}`} aria-hidden="true" />
                      {getSyncStateLabel(syncState)}
                    </span>
                  </div>
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
            {IS_DEV_MODE && syncState === "conflict" ? (
              <div className="mt-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-800">
                <div className="font-medium uppercase tracking-[0.12em]">Sidecar conflict detected</div>
                <div>{lastConflictReason ?? "The browser reconciled to a newer authoritative Sidecar state."}</div>
              </div>
            ) : null}
            {IS_DEV_MODE && syncState === "error" && !closeError ? (
              <div className="mt-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-800">
                <div className="font-medium uppercase tracking-[0.12em]">Sidecar sync error</div>
                <div>{lastConflictReason ?? "Refreshing authoritative Sidecar state failed."}</div>
              </div>
            ) : null}
            {closeError ? <div className="pt-3 text-sm leading-6 text-danger">{closeError}</div> : null}
          </div>
          <div className="min-h-0 flex flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-auto p-5">
              {activePanel ? <SidecarPanelContentView panel={activePanel} contextSnapshot={activeContext} stackRevision={stackRevision} pending={interactionPending} error={interactionError} /> : <SidecarEmptyState />}
            </div>
            <SidecarThinkingDock
              snapshot={thinkingSnapshot}
              expanded={thinkingExpanded}
              height={thinkingDockHeight}
              onToggle={toggleThinkingExpanded}
            />
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