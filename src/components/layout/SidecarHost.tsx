"use client";

import { useEffect, useState } from "react";
import { MessageMarkdown } from "@/components/chat/MessageMarkdown";
import type {
  SidecarContent,
  SidecarInteractionEventDetail,
  SidecarPanel,
  SidecarSelectionActionDefinition,
  SidecarSelectionContent,
  SidecarStreamEventDetail,
} from "@/lib/sidecar/types";
import {
  BIZBOT_SIDECAR_EVENT,
  BIZBOT_SIDECAR_INTERACTION_EVENT,
} from "@/lib/sidecar/types";

const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 320;
const MAX_WIDTH = 720;

function clampWidth(value: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, value));
}

function dispatchSidecarInteraction(detail: SidecarInteractionEventDetail): void {
  window.dispatchEvent(new CustomEvent(BIZBOT_SIDECAR_INTERACTION_EVENT, { detail }));
}

function SidecarContentView({ content }: { content: SidecarContent }) {
  switch (content.type) {
    case "markdown":
      return <MessageMarkdown markdown={content.markdown} />;
    case "code":
      return (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>{content.language ?? "code"}</div>
          <pre className="overflow-auto border p-3 text-xs leading-6 whitespace-pre-wrap break-words" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)", color: "var(--text-primary)" }}>
            <code>{content.code}</code>
          </pre>
        </div>
      );
    case "json":
      return (
        <pre className="overflow-auto border p-3 text-xs leading-6 whitespace-pre-wrap break-words" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)", color: "var(--text-primary)" }}>
          <code>{JSON.stringify(content.value, null, 2)}</code>
        </pre>
      );
    case "image":
      return (
        <figure className="space-y-3">
          {/* Sidecar intentionally renders validated transient image payloads directly. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={content.url} alt={content.alt} className="max-w-full border" style={{ borderColor: "var(--border-sub)" }} />
          <figcaption className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{content.alt}</figcaption>
        </figure>
      );
    case "selection":
      return null;
  }
}

function SidecarSelectionView({ panelId, content }: { panelId: string; content: SidecarSelectionContent }) {
  const selectedIds = new Set(content.selectedItemIds ?? []);
  const toggleAction = content.actions.find((action) => action.kind === "toggle");
  const footerActions = content.actions.filter((action) => action.kind !== "toggle");

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
    if (!toggleAction) {
      return;
    }

    dispatchSidecarInteraction({
      panelId,
      actionId: toggleAction.id,
      selectedItemIds: getNextSelectedIds(itemId),
    });
  }

  function onFooterAction(action: SidecarSelectionActionDefinition): void {
    dispatchSidecarInteraction({
      panelId,
      actionId: action.id,
      selectedItemIds: [...selectedIds],
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{content.title}</div>
        {content.description ? <p className="text-sm leading-6" style={{ color: "var(--text-dim)" }}>{content.description}</p> : null}
      </div>

      <div className="space-y-3">
        {content.items.map((item) => {
          const selected = selectedIds.has(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onItemClick(item.id)}
              className="w-full border p-4 text-left transition-colors"
              style={{
                borderColor: selected ? "var(--accent)" : "var(--border)",
                background: selected ? "var(--accent-glow)" : "var(--bg-raised)",
                color: "var(--text-primary)",
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2 min-w-0 flex-1">
                  <div className="text-xs uppercase tracking-[0.18em]" style={{ color: selected ? "var(--accent)" : "var(--text-muted)" }}>{item.id}</div>
                  <div className="text-sm font-medium break-words">{item.title}</div>
                  {item.description ? <div className="text-sm leading-6" style={{ color: "var(--text-dim)" }}>{item.description}</div> : null}
                </div>
                <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: selected ? "var(--accent)" : "var(--text-dim)" }}>
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
              disabled={action.kind === "apply" && selectedIds.size === 0}
              className="px-3 py-2 border text-xs uppercase tracking-[0.18em] disabled:opacity-50"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SidecarPanelContentView({ panel }: { panel: SidecarPanel }) {
  if (panel.content.type === "selection") {
    return <SidecarSelectionView panelId={panel.panelId} content={panel.content} />;
  }

  return <SidecarContentView content={panel.content} />;
}

export default function SidecarHost() {
  const [panel, setPanel] = useState<SidecarPanel | null>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  useEffect(() => {
    const handleSidecarEvent = (event: Event) => {
      const detail = (event as CustomEvent<SidecarStreamEventDetail>).detail;
      if (!detail) {
        return;
      }
      if (detail.action === "close") {
        setPanel(null);
        return;
      }
      if (detail.panel) {
        setPanel(detail.panel);
      }
    };

    window.addEventListener(BIZBOT_SIDECAR_EVENT, handleSidecarEvent as EventListener);
    return () => window.removeEventListener(BIZBOT_SIDECAR_EVENT, handleSidecarEvent as EventListener);
  }, []);

  function closePanel(): void {
    setPanel(null);
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

  if (!panel) {
    return null;
  }

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex max-w-full" aria-label="Sidecar panel">
      <button
        type="button"
        aria-label="Resize sidecar"
        className="hidden md:block w-2 cursor-col-resize"
        onPointerDown={beginResize}
        style={{ background: "linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.12) 50%, transparent 100%)" }}
      />
      <aside className="h-full w-full border-l" style={{ width: `min(${width}px, 100vw)`, borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div className="sticky top-0 z-10 border-b px-5 py-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2 min-w-0">
              <div className="text-xs font-mono uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>sidecar</div>
              <div className="text-sm font-medium break-words" style={{ color: "var(--text-primary)" }}>{panel.title}</div>
              <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-dim)" }}>{panel.content.type}</div>
            </div>
            <button type="button" onClick={closePanel} className="px-3 py-2 border text-xs uppercase tracking-[0.18em]" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
              close
            </button>
          </div>
        </div>
        <div className="h-[calc(100vh-92px)] overflow-auto p-5">
          <SidecarPanelContentView panel={panel} />
        </div>
      </aside>
    </div>
  );
}
