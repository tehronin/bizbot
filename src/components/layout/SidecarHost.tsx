"use client";

import { useEffect, useMemo, useState } from "react";
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

function SidecarMarkdownRenderer({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => {
    const lines = markdown.split(/\r?\n/);
    const nodes: Array<{ kind: "heading" | "paragraph" | "list" | "code"; level?: number; lines: string[]; language?: string }> = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];

      if (line.startsWith("```")) {
        const language = line.slice(3).trim() || undefined;
        const codeLines: string[] = [];
        index += 1;
        while (index < lines.length && !lines[index].startsWith("```")) {
          codeLines.push(lines[index]);
          index += 1;
        }
        nodes.push({ kind: "code", lines: codeLines, language });
        index += 1;
        continue;
      }

      if (!line.trim()) {
        index += 1;
        continue;
      }

      const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
      if (headingMatch) {
        nodes.push({ kind: "heading", level: headingMatch[1].length, lines: [headingMatch[2].trim()] });
        index += 1;
        continue;
      }

      if (/^[-*]\s+/.test(line)) {
        const items: string[] = [];
        while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
          items.push(lines[index].replace(/^[-*]\s+/, "").trim());
          index += 1;
        }
        nodes.push({ kind: "list", lines: items });
        continue;
      }

      const paragraph: string[] = [line.trim()];
      index += 1;
      while (index < lines.length && lines[index].trim() && !lines[index].startsWith("```") && !/^(#{1,3})\s+/.test(lines[index]) && !/^[-*]\s+/.test(lines[index])) {
        paragraph.push(lines[index].trim());
        index += 1;
      }
      nodes.push({ kind: "paragraph", lines: [paragraph.join(" ")] });
    }

    return nodes;
  }, [markdown]);

  return (
    <div className="space-y-4 text-sm leading-7">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          const className = block.level === 1 ? "text-xl font-semibold" : block.level === 2 ? "text-lg font-semibold" : "text-base font-semibold uppercase tracking-[0.12em]";
          return <div key={index} className={className} style={{ color: "var(--text-primary)" }}>{block.lines[0]}</div>;
        }
        if (block.kind === "list") {
          return (
            <ul key={index} className="space-y-2 pl-5 list-disc" style={{ color: "var(--text-primary)" }}>
              {block.lines.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
            </ul>
          );
        }
        if (block.kind === "code") {
          return (
            <div key={index} className="space-y-2">
              {block.language ? <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>{block.language}</div> : null}
              <pre className="overflow-auto border p-3 text-xs leading-6 whitespace-pre-wrap break-words" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)", color: "var(--text-primary)" }}>
                <code>{block.lines.join("\n")}</code>
              </pre>
            </div>
          );
        }
        return <p key={index} style={{ color: "var(--text-primary)" }}>{block.lines[0]}</p>;
      })}
    </div>
  );
}

function SidecarContentView({ content }: { content: SidecarContent }) {
  switch (content.type) {
    case "markdown":
      return <SidecarMarkdownRenderer markdown={content.markdown} />;
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
      <aside className="h-full w-full border-l shadow-2xl" style={{ width: `min(${width}px, 100vw)`, borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div className="sticky top-0 z-10 border-b px-5 py-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2 min-w-0">
              <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>sidecar</div>
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
