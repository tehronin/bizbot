"use client";

import type { SidecarThinkingChunk, SidecarThinkingSnapshot } from "@/lib/sidecar/types";

const COLLAPSED_RAIL_HEIGHT = 36;

function getThinkingStatusTone(status: SidecarThinkingSnapshot["status"]): string {
  switch (status) {
    case "streaming":
      return "bg-amber-500";
    case "complete":
      return "bg-emerald-500";
    case "error":
      return "bg-rose-500";
    case "idle":
      return "bg-slate-400";
  }
}

function getThinkingStatusLabel(status: SidecarThinkingSnapshot["status"]): string {
  switch (status) {
    case "streaming":
      return "streaming";
    case "complete":
      return "complete";
    case "error":
      return "error";
    case "idle":
      return "idle";
  }
}

function getChunkClasses(chunk: SidecarThinkingChunk): string {
  switch (chunk.kind) {
    case "tool_call":
      return "border-sky-200 bg-sky-50 text-sky-900";
    case "tool_result":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "error":
      return "border-rose-200 bg-rose-50 text-rose-900";
    case "plan":
      return "border-violet-200 bg-violet-50 text-violet-900";
    case "status":
      return "border-slate-200 bg-slate-50 text-slate-900";
    case "note":
      return "border-border-sub bg-raised text-primary";
  }
}

export interface SidecarThinkingDockProps {
  snapshot: SidecarThinkingSnapshot | null;
  expanded: boolean;
  height: number;
  onToggle: () => void;
}

export default function SidecarThinkingDock({ snapshot, expanded, height, onToggle }: SidecarThinkingDockProps) {
  const title = snapshot?.title?.trim() || "thinking";

  return (
    <div className="border-t border-border bg-raised/70 backdrop-blur">
      <div
        className="flex items-center justify-between gap-3 px-4"
        style={{ minHeight: `${COLLAPSED_RAIL_HEIGHT}px` }}
      >
        <div className="min-w-0 flex items-center gap-3 text-[11px] uppercase tracking-[0.16em] text-dim">
          <button
            type="button"
            onClick={onToggle}
            aria-label={expanded ? "Collapse thinking dock" : "Expand thinking dock"}
            className="flex h-7 w-7 items-center justify-center border border-border text-primary transition-colors hover:bg-surface"
          >
            {expanded ? "v" : "^"}
          </button>
          <span className="truncate">{title}</span>
          {snapshot ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-border px-2 py-1">
              <span className={`h-2 w-2 rounded-full ${getThinkingStatusTone(snapshot.status)}`} aria-hidden="true" />
              {getThinkingStatusLabel(snapshot.status)}
            </span>
          ) : null}
        </div>
        {snapshot ? <div className="text-[11px] uppercase tracking-[0.16em] text-dim">rev {snapshot.revision}</div> : null}
      </div>
      {expanded ? (
        <div className="min-h-0 overflow-auto border-t border-border px-4 py-3" style={{ height: `${height}px` }}>
          {snapshot ? (
            <div className="space-y-2">
              {snapshot.summary ? <div className="text-xs leading-6 text-dim">{snapshot.summary}</div> : null}
              {snapshot.chunks.length > 0 ? (
                <div className="space-y-2">
                  {snapshot.chunks.map((chunk) => (
                    <div key={chunk.id} className={`rounded border px-3 py-2 ${getChunkClasses(chunk)}`}>
                      <div className="mb-1 text-[10px] uppercase tracking-[0.16em] opacity-75">{chunk.kind.replaceAll("_", " ")}</div>
                      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6">{chunk.text}</pre>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs leading-6 text-dim">&nbsp;</div>
              )}
            </div>
          ) : (
            <div className="text-xs leading-6 text-dim">&nbsp;</div>
          )}
        </div>
      ) : null}
    </div>
  );
}