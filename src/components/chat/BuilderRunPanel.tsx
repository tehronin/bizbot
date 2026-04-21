"use client";

import type { BuilderChatCardProgress } from "@/lib/chat/types";

interface BuilderRunPanelProps {
  progress: BuilderChatCardProgress;
}

const PHASE_LABELS: Record<string, string> = {
  planning: "Planning",
  acting: "Applying",
  verifying: "Verifying",
  reviewing: "Reviewing",
  complete: "Complete",
};

const PHASE_COLORS: Record<string, string> = {
  planning: "rgba(56,189,248,0.15)",
  acting: "rgba(168,85,247,0.15)",
  verifying: "rgba(34,197,94,0.15)",
  reviewing: "rgba(251,191,36,0.15)",
  complete: "rgba(34,197,94,0.20)",
};

const PHASE_TEXT_COLORS: Record<string, string> = {
  planning: "rgb(56,189,248)",
  acting: "rgb(168,85,247)",
  verifying: "rgb(34,197,94)",
  reviewing: "rgb(251,191,36)",
  complete: "rgb(34,197,94)",
};

export function BuilderRunPanel({ progress }: BuilderRunPanelProps) {
  const phase = progress.loopPhase ?? "planning";
  const phaseLabel = PHASE_LABELS[phase] ?? phase;
  const phaseColor = PHASE_COLORS[phase] ?? "rgba(255,255,255,0.06)";
  const phaseTextColor = PHASE_TEXT_COLORS[phase] ?? "var(--text-muted)";

  const hasIterations =
    progress.currentIteration !== null && progress.maxIterations !== null;

  return (
    <div
      className="border px-4 py-3 space-y-3 border-border bg-raised"
    >
      <div className="flex items-center gap-3">
        <div
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs uppercase tracking-[0.16em] font-medium"
          style={{ background: phaseColor, color: phaseTextColor }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: phaseTextColor }}
          />
          {phaseLabel}
        </div>

        {hasIterations ? (
          <div className="text-xs text-muted">
            Iteration {progress.currentIteration} / {progress.maxIterations}
          </div>
        ) : null}
      </div>

      {progress.latestLoopSummary ? (
        <div
          className="text-sm leading-6 break-words text-dim"
        >
          {progress.latestLoopSummary}
        </div>
      ) : (
        <div className="text-sm text-muted">
          Builder task running...
        </div>
      )}

      {hasIterations && progress.maxIterations! > 0 ? (
        <div
          className="h-1 rounded-full overflow-hidden bg-border-sub"
        >
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.min(100, ((progress.currentIteration ?? 0) / progress.maxIterations!) * 100)}%`,
              background: phaseTextColor,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
