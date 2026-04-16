"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AgenticSetupDrawer } from "@/components/chat/AgenticSetupDrawer";
import { PaginationControls } from "@/components/layout/PaginationControls";
import { useChat, type ChatEntry, type UseChatResult } from "@/hooks/useChat";
import type {
  BuilderChatCard,
  BuilderOnboardingSpec,
  BuilderOnboardingStep,
  ChatBuilderProjectSummary,
  ChatBuilderStackPresetSummary,
  ChatBuilderTemplateSummary,
  ChatExecutionMode,
  ChatMessageAttachment,
} from "@/lib/chat/types";
import { MEMORY_FACT_CATEGORIES, type MemoryFactCategory } from "@/lib/agent/memory/facts";
import { getResolvedUsageLedgerModelPricing } from "@/lib/agent/usage-ledger-pricing";
import { getOraclePredictionIntent } from "@/lib/oracle/intent";

type PanelMode = "chat" | "history";

interface ChatWorkspaceContentProps {
  chat: UseChatResult;
  setupOpen: boolean;
  closeSetupHref: string;
}

interface KnowledgeDashboardFile {
  path: string;
  name: string;
  status: "indexed" | "pending" | "skipped";
}

interface KnowledgeDashboardResponse {
  files: KnowledgeDashboardFile[];
}

function inferCategoryFromText(content: string): MemoryFactCategory {
  const lower = content.toLowerCase();
  if (/name|call me|i am|i'm/.test(lower)) return "identity";
  if (/prefer|timezone|style|voice|tone/.test(lower)) return "preference";
  if (/workflow|process|when replying|steps/.test(lower)) return "workflow";
  if (/never|don't|do not|must not|avoid|constraint/.test(lower)) return "constraint";
  if (/default|setting|lane|operator/.test(lower)) return "operator_setting";
  return "other";
}

function inferKeyFromText(content: string): string {
  return content
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "remembered_fact";
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "No messages yet";
  }

  return new Date(value).toLocaleString();
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function BuilderCardList({
  cards,
  disabled,
  onAction,
}: {
  cards: BuilderChatCard[];
  disabled?: boolean;
  onAction?: (interactionId: string, action: "approve" | "reject" | "reconcile") => void;
}) {
  if (cards.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {cards.map((card) => (
        <div
          key={card.id}
          className="border p-3 space-y-3"
          style={{
            borderColor: card.status === "pending" ? "var(--warning)" : "var(--border)",
            background: card.status === "pending"
              ? "color-mix(in srgb, var(--warning) 8%, var(--bg-raised))"
              : "var(--bg-raised)",
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
                builder • {card.projectName}
              </div>
              <div className="text-sm mt-1" style={{ color: "var(--text-primary)" }}>{card.title}</div>
            </div>
            <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: card.status === "pending" ? "var(--warning)" : "var(--text-dim)" }}>
              {card.status.replaceAll("_", " ")}
            </div>
          </div>
          <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>{card.summary}</div>
          {card.recommendations.length > 0 ? (
            <div className="flex flex-wrap gap-2 text-[11px]" style={{ color: "var(--text-dim)" }}>
              {card.recommendations.map((recommendation) => (
                <span key={`${card.id}-${recommendation}`} className="border px-2 py-1" style={{ borderColor: "var(--border-sub)", background: "var(--bg-surface)" }}>
                  {recommendation}
                </span>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
            <span>{card.projectRelativePath}</span>
            <span>state: {card.state.replaceAll("_", " ")}</span>
          </div>
          {card.resolutionReason ? (
            <div className="text-xs" style={{ color: "var(--text-dim)" }}>Reason: {card.resolutionReason}</div>
          ) : null}
          {card.actions.length > 0 && onAction ? (
            <div className="flex flex-wrap gap-2">
              {card.actions.map((action) => (
                <button
                  key={`${card.id}-${action.id}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => onAction(card.interactionId, action.id)}
                  className="px-3 py-2 border text-[11px] uppercase tracking-[0.16em] disabled:opacity-50"
                  style={{
                    borderColor: action.variant === "danger" ? "var(--danger)" : action.variant === "primary" ? "var(--warning)" : "var(--border)",
                    color: action.variant === "danger" ? "var(--danger)" : action.variant === "primary" ? "var(--warning)" : "var(--text-primary)",
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function BuilderWelcome({
  projects,
  onSelectProject,
  onNewProject,
}: {
  projects: ChatBuilderProjectSummary[];
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
}) {
  return (
    <div className="space-y-4" data-testid="builder-welcome">
      <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>
        builder
      </div>
      <div className="text-sm" style={{ color: "var(--text-dim)" }}>
        Start a new project or select an existing one to continue building.
      </div>
      <button
        type="button"
        onClick={onNewProject}
        className="w-full border p-4 text-left hover:bg-[--bg-hover] transition-colors"
        style={{ borderColor: "rgba(167,139,250,0.34)", background: "rgba(167,139,250,0.06)" }}
        data-testid="builder-new-project"
      >
        <div className="text-sm" style={{ color: "#a78bfa" }}>New Project</div>
        <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
          Start from scratch with guided stack and configuration selection.
        </div>
      </button>
      {projects.length > 0 ? (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
            existing projects
          </div>
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => onSelectProject(project.id)}
              className="w-full border p-3 text-left hover:bg-[--bg-hover] transition-colors"
              style={{ borderColor: "var(--border)" }}
              data-testid={`builder-project-${project.id}`}
            >
              <div className="text-sm" style={{ color: "var(--text-primary)" }}>{project.name}</div>
              <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>{project.relativePath}</div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BuilderOnboarding({
  step,
  spec,
  stackPresets,
  templates,
  onUpdateSpec,
  onSetStep,
  onConfirm,
  onCancel,
  disabled,
  error,
}: {
  step: BuilderOnboardingStep;
  spec: BuilderOnboardingSpec;
  stackPresets: ChatBuilderStackPresetSummary[];
  templates: ChatBuilderTemplateSummary[];
  onUpdateSpec: (updates: Partial<BuilderOnboardingSpec>) => void;
  onSetStep: (step: BuilderOnboardingStep) => void;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
  error?: string | null;
}) {
  const [nameInput, setNameInput] = useState(spec.name);
  const [descInput, setDescInput] = useState(spec.description);

  function commitName(): void {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      return;
    }
    onUpdateSpec({ name: trimmed, description: descInput.trim() });
    onSetStep("stack");
  }

  function selectStack(presetKey: string): void {
    const preset = stackPresets.find((p) => p.key === presetKey);
    if (preset) {
      onUpdateSpec({
        stackPresetKey: preset.key,
        template: preset.template,
        packageManager: preset.packageManager,
      });
    } else {
      onUpdateSpec({ stackPresetKey: "" });
    }
    onSetStep("configuring");
  }

  function skipStack(): void {
    onUpdateSpec({ stackPresetKey: "" });
    onSetStep("configuring");
  }

  return (
    <div className="space-y-4" data-testid="builder-onboarding">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "#a78bfa" }}>
          new project setup
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] border disabled:opacity-50"
          style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
        >
          Cancel
        </button>
      </div>

      {step === "naming" ? (
        <div className="border p-4 space-y-3" style={{ borderColor: "rgba(167,139,250,0.34)", background: "rgba(167,139,250,0.06)" }}>
          <div className="text-sm" style={{ color: "var(--text-primary)" }}>What are you building?</div>
          <div className="text-xs" style={{ color: "var(--text-dim)" }}>
            Give your project a name and an optional one-liner description.
          </div>
          <label className="block space-y-1.5">
            <span className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>project name</span>
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitName(); } }}
              placeholder="my-app"
              autoFocus
              className="w-full border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-primary)" }}
              data-testid="onboarding-name-input"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>description</span>
            <input
              value={descInput}
              onChange={(e) => setDescInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitName(); } }}
              placeholder="A brief description of what you're building"
              className="w-full border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-primary)" }}
              data-testid="onboarding-desc-input"
            />
          </label>
          <button
            type="button"
            onClick={commitName}
            disabled={!nameInput.trim() || disabled}
            className="px-4 py-2 text-xs uppercase tracking-[0.18em] border disabled:opacity-50"
            style={{ borderColor: "#a78bfa", color: "#a78bfa" }}
            data-testid="onboarding-name-next"
          >
            Next
          </button>
        </div>
      ) : null}

      {step === "stack" ? (
        <div className="border p-4 space-y-3" style={{ borderColor: "rgba(167,139,250,0.34)", background: "rgba(167,139,250,0.06)" }}>
          <div className="text-sm" style={{ color: "var(--text-primary)" }}>
            Pick a stack for <span style={{ color: "#a78bfa" }}>{spec.name}</span>
          </div>
          <div className="text-xs" style={{ color: "var(--text-dim)" }}>
            Choose a preset or skip to configure manually.
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {stackPresets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => selectStack(preset.key)}
                disabled={disabled}
                className="border p-3 text-left hover:bg-[--bg-hover] transition-colors disabled:opacity-50"
                style={{
                  borderColor: spec.stackPresetKey === preset.key ? "#a78bfa" : "var(--border)",
                  background: spec.stackPresetKey === preset.key ? "rgba(167,139,250,0.12)" : "transparent",
                }}
                data-testid={`onboarding-stack-${preset.key}`}
              >
                <div className="text-sm" style={{ color: "var(--text-primary)" }}>{preset.displayName}</div>
                <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>{preset.description}</div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {preset.tags.map((tag) => (
                    <span key={tag} className="text-[10px] px-1.5 py-0.5 border" style={{ borderColor: "var(--border-sub)", color: "var(--text-muted)" }}>{tag}</span>
                  ))}
                </div>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={skipStack}
              disabled={disabled}
              className="px-4 py-2 text-xs uppercase tracking-[0.18em] border disabled:opacity-50"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              Skip — configure manually
            </button>
            <button
              type="button"
              onClick={() => onSetStep("naming")}
              disabled={disabled}
              className="px-4 py-2 text-xs uppercase tracking-[0.18em] border disabled:opacity-50"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              Back
            </button>
          </div>
        </div>
      ) : null}

      {step === "configuring" ? (
        <div className="border p-4 space-y-3" style={{ borderColor: "rgba(167,139,250,0.34)", background: "rgba(167,139,250,0.06)" }}>
          <div className="text-sm" style={{ color: "var(--text-primary)" }}>
            Fine-tune configuration for <span style={{ color: "#a78bfa" }}>{spec.name}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>template</span>
              <select
                value={spec.template}
                onChange={(e) => onUpdateSpec({ template: e.target.value, stackPresetKey: "" })}
                disabled={disabled}
                className="w-full bg-transparent border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                data-testid="onboarding-template"
              >
                {templates.map((t) => (
                  <option key={t.key} value={t.key}>{t.displayName}</option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>package manager</span>
              <select
                value={spec.packageManager}
                onChange={(e) => onUpdateSpec({ packageManager: e.target.value, stackPresetKey: "" })}
                disabled={disabled}
                className="w-full bg-transparent border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                data-testid="onboarding-pm"
              >
                <option value="NPM">NPM</option>
                <option value="PNPM">PNPM</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: "var(--text-primary)" }}>
              <input
                type="checkbox"
                checked={spec.docker}
                onChange={(e) => onUpdateSpec({ docker: e.target.checked })}
                disabled={disabled}
                data-testid="onboarding-docker"
              />
              Docker setup
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: "var(--text-primary)" }}>
              <input
                type="checkbox"
                checked={spec.git}
                onChange={(e) => onUpdateSpec({ git: e.target.checked })}
                disabled={disabled}
                data-testid="onboarding-git"
              />
              Initialize git
            </label>
          </div>
          {spec.stackPresetKey ? (
            <div className="text-xs" style={{ color: "var(--text-dim)" }}>
              Using stack preset: <span style={{ color: "#a78bfa" }}>{stackPresets.find((p) => p.key === spec.stackPresetKey)?.displayName ?? spec.stackPresetKey}</span>
            </div>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onSetStep("confirming")}
              disabled={disabled}
              className="px-4 py-2 text-xs uppercase tracking-[0.18em] border disabled:opacity-50"
              style={{ borderColor: "#a78bfa", color: "#a78bfa" }}
              data-testid="onboarding-review"
            >
              Review &amp; Confirm
            </button>
            <button
              type="button"
              onClick={() => onSetStep("stack")}
              disabled={disabled}
              className="px-4 py-2 text-xs uppercase tracking-[0.18em] border disabled:opacity-50"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              Back
            </button>
          </div>
        </div>
      ) : null}

      {step === "confirming" ? (
        <div className="border p-4 space-y-3" style={{ borderColor: "rgba(167,139,250,0.34)", background: "rgba(167,139,250,0.06)" }}>
          <div className="text-sm" style={{ color: "var(--text-primary)" }}>
            Ready to create <span style={{ color: "#a78bfa" }}>{spec.name}</span>?
          </div>
          <div className="border p-3 space-y-2 text-xs" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
            {spec.description ? (
              <div style={{ color: "var(--text-dim)" }}>{spec.description}</div>
            ) : null}
            <div className="grid gap-1" style={{ color: "var(--text-primary)" }}>
              <div><span style={{ color: "var(--text-muted)" }}>Template:</span> {templates.find((t) => t.key === spec.template)?.displayName ?? spec.template}</div>
              <div><span style={{ color: "var(--text-muted)" }}>Package manager:</span> {spec.packageManager}</div>
              {spec.stackPresetKey ? (
                <div><span style={{ color: "var(--text-muted)" }}>Stack preset:</span> {stackPresets.find((p) => p.key === spec.stackPresetKey)?.displayName ?? spec.stackPresetKey}</div>
              ) : null}
              <div><span style={{ color: "var(--text-muted)" }}>Docker:</span> {spec.docker ? "Yes" : "No"}</div>
              <div><span style={{ color: "var(--text-muted)" }}>Git:</span> {spec.git ? "Yes" : "No"}</div>
            </div>
          </div>
          {error ? (
            <div className="text-xs" style={{ color: "var(--danger)" }}>{error}</div>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onConfirm}
              disabled={disabled}
              className="px-4 py-2 text-xs uppercase tracking-[0.18em] border disabled:opacity-50"
              style={{ borderColor: "#a78bfa", color: "#a78bfa" }}
              data-testid="onboarding-confirm"
            >
              {disabled ? "Creating..." : "Create Project"}
            </button>
            <button
              type="button"
              onClick={() => onSetStep("configuring")}
              disabled={disabled}
              className="px-4 py-2 text-xs uppercase tracking-[0.18em] border disabled:opacity-50"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={disabled}
              className="px-4 py-2 text-xs uppercase tracking-[0.18em] border disabled:opacity-50"
              style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MessageGroups({
  messages,
  onPromote,
  emptyHint,
}: {
  messages: ChatEntry[];
  onPromote?: (message: ChatEntry) => void;
  emptyHint?: string;
}) {
  const [expandedBadges, setExpandedBadges] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const groups: Array<{ kind: "message"; entry: ChatEntry } | { kind: "badges"; entries: ChatEntry[] }> = [];
    for (const message of messages) {
      if (message.role === "user" || message.role === "assistant") {
        groups.push({ kind: "message", entry: message });
        continue;
      }

      const last = groups.at(-1);
      if (last && last.kind === "badges") {
        last.entries.push(message);
      } else {
        groups.push({ kind: "badges", entries: [message] });
      }
    }

    return groups;
  }, [messages]);

  function toggleBadge(id: string): void {
    setExpandedBadges((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function renderExecutionChips(entry: ChatEntry) {
    const hasMetadata = Boolean(entry.chatMode || entry.chatPluginId || (entry.attachments && entry.attachments.length > 0));
    if (!hasMetadata) {
      return null;
    }

    return (
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
        {entry.chatMode ? (
          <span className="border px-2 py-1" style={{ borderColor: "var(--border-sub)", background: "var(--bg-surface)" }}>
            {entry.chatMode}
          </span>
        ) : null}
        {entry.chatPluginId ? (
          <span className="border px-2 py-1" style={{ borderColor: "var(--border-sub)", background: "var(--bg-surface)" }}>
            {entry.chatPluginId}
          </span>
        ) : null}
        {entry.attachments?.map((attachment) => (
          <span key={`${entry.id}-${attachment.path}`} className="border px-2 py-1" style={{ borderColor: "var(--border-sub)", background: "var(--bg-surface)" }}>
            doc: {attachment.label}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {messages.length === 0 && (
        <div className="text-sm" style={{ color: "var(--text-muted)" }}>
          {emptyHint ?? "Ask BizBot to draft, schedule, inspect analytics, or recall brand context."}
        </div>
      )}
      {grouped.map((group, groupIndex) => (
        group.kind === "message" ? (
          <div
            key={group.entry.id}
            data-testid={`chat-message-${group.entry.role}`}
            className="border px-4 py-3 whitespace-pre-wrap"
            style={{
              borderColor: group.entry.role === "user" ? "var(--accent-dim)" : "var(--border)",
              background: group.entry.role === "user" ? "rgba(56,189,248,0.08)" : "var(--bg-raised)",
            }}
          >
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>
                {group.entry.role}
              </div>
              {onPromote ? (
                <button
                  type="button"
                  onClick={() => onPromote(group.entry)}
                  className="px-2 py-1 border text-xs uppercase tracking-[0.18em]"
                  style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                >
                  promote to memory
                </button>
              ) : null}
            </div>
            {group.entry.content}
            {renderExecutionChips(group.entry)}
            {group.entry.builderCards && group.entry.builderCards.length > 0 ? (
              <div className="mt-3">
                <BuilderCardList cards={group.entry.builderCards} />
              </div>
            ) : null}
          </div>
        ) : (
          <div key={`badge-group-${groupIndex}`} className="flex flex-wrap gap-1.5 py-1">
            {group.entries.map((entry) => {
              const isExpanded = expandedBadges.has(entry.id);
              const badgeColor = entry.role === "meta"
                ? { bg: "rgba(34,197,94,0.10)", border: "rgba(34,197,94,0.30)", dot: "rgb(34,197,94)" }
                : entry.role === "tool"
                  ? { bg: "rgba(56,189,248,0.08)", border: "rgba(56,189,248,0.22)", dot: "rgb(56,189,248)" }
                  : { bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.10)", dot: "rgba(255,255,255,0.35)" };
              const label = entry.role === "meta"
                ? (entry.profileLabel ? `Routed -> ${entry.profileLabel}` : "Routed")
                : entry.role === "tool"
                  ? (entry.name ?? "tool call")
                  : entry.content;

              return (
                <div key={entry.id} className="inline-flex flex-col">
                  <button
                    type="button"
                    onClick={() => toggleBadge(entry.id)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
                    style={{
                      background: badgeColor.bg,
                      border: `1px solid ${badgeColor.border}`,
                      color: "var(--text-dim)",
                    }}
                  >
                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: badgeColor.dot }} />
                    {label}
                    <span className="text-[9px]" style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
                  </button>
                  {isExpanded && (
                    <div
                      className="mt-1 px-3 py-2 rounded text-xs whitespace-pre-wrap overflow-auto max-h-48"
                      style={{
                        background: badgeColor.bg,
                        border: `1px solid ${badgeColor.border}`,
                        color: "var(--text-dim)",
                      }}
                    >
                      {entry.content}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ))}
    </div>
  );
}

export function ChatWorkspaceContent({ chat, setupOpen, closeSetupHref }: ChatWorkspaceContentProps) {
  const [input, setInput] = useState("");
  const [panelMode, setPanelMode] = useState<PanelMode>("chat");
  const [actionError, setActionError] = useState<string | null>(null);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeDashboardFile[]>([]);
  const [knowledgeState, setKnowledgeState] = useState<"idle" | "loading" | "ready" | "error" | "uploading">("idle");
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);
  const [selectedAttachments, setSelectedAttachments] = useState<ChatMessageAttachment[]>([]);
  const [memoryDraft, setMemoryDraft] = useState<{
    messageId: string;
    category: MemoryFactCategory;
    key: string;
    value: string;
  } | null>(null);
  const [memoryState, setMemoryState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [historySearchDraft, setHistorySearchDraft] = useState(chat.historyFilters.search);
  const [historyFromDraft, setHistoryFromDraft] = useState(chat.historyFilters.from ?? "");
  const [historyToDraft, setHistoryToDraft] = useState(chat.historyFilters.to ?? "");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentConversation = chat.currentConversation;
  const hasHistoryFilters = Boolean(chat.historyFilters.search || chat.historyFilters.from || chat.historyFilters.to);
  const executionCatalog = chat.executionCatalog ?? {
    defaults: {
      mode: "ask" as const,
      pluginId: "just-chatting",
    },
    plugins: [],
  };
  const executionMode = chat.executionMode ?? executionCatalog.defaults.mode;
  const executionPluginId = chat.executionPluginId ?? executionCatalog.defaults.pluginId;
  const setExecutionMode = chat.setExecutionMode ?? (() => undefined);
  const setExecutionPluginId = chat.setExecutionPluginId ?? (() => undefined);
  const setSelectedBuilderProjectId = chat.setSelectedBuilderProjectId ?? (() => undefined);
  const activePlugin = executionCatalog.plugins.find((plugin) => plugin.id === executionPluginId)
    ?? {
      id: "just-chatting",
      displayName: "Just Chatting",
      description: "Full-context chat and planning without tool execution.",
      accentColor: "#38bdf8",
      accentSurface: "rgba(56,189,248,0.12)",
      accentBorder: "rgba(56,189,248,0.36)",
      toollessInAsk: true,
      toollessInAgent: true,
    };
  const activeRunCostEstimate = useMemo(() => {
    const pricing = getResolvedUsageLedgerModelPricing(
      chat.activeRun.model ?? "",
      chat.activeRun.provider ?? undefined,
      chat.modelPricing,
    );

    return ((chat.activeRun.promptTokens / 1_000_000) * pricing.promptUsdPerMillion)
      + ((chat.activeRun.completionTokens / 1_000_000) * pricing.completionUsdPerMillion);
  }, [chat.activeRun.completionTokens, chat.activeRun.model, chat.activeRun.promptTokens, chat.activeRun.provider, chat.modelPricing]);
  const builderProjects = chat.builderProjects ?? [];
  const builderStackPresets = chat.builderStackPresets ?? [];
  const builderTemplates = chat.builderTemplates ?? [];
  const selectedBuilderProjectId = chat.selectedBuilderProjectId;
  const builderPluginActive = executionPluginId === "builder" && executionMode === "agent";
  const builderAskMode = executionPluginId === "builder" && executionMode === "ask";
  const builderOnboarding = chat.builderOnboarding;
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const showBuilderWelcome = builderPluginActive && !builderOnboarding && chat.messages.length === 0 && !chat.isBootstrapping;

  useEffect(() => {
    setHistorySearchDraft(chat.historyFilters.search);
    setHistoryFromDraft(chat.historyFilters.from ?? "");
    setHistoryToDraft(chat.historyFilters.to ?? "");
  }, [chat.historyFilters]);

  async function loadKnowledgeFiles(): Promise<void> {
    setKnowledgeState("loading");
    setKnowledgeError(null);
    try {
      const response = await fetch("/api/knowledge");
      const payload = await response.json() as KnowledgeDashboardResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load knowledge docs.");
      }

      setKnowledgeFiles(payload.files.filter((file) => file.status !== "skipped"));
      setKnowledgeState("ready");
    } catch (error) {
      setKnowledgeState("error");
      setKnowledgeError(error instanceof Error ? error.message : String(error));
    }
  }

  function toggleAttachmentMenu(): void {
    setAttachmentMenuOpen((current) => {
      const next = !current;
      if (next && knowledgeState === "idle") {
        void loadKnowledgeFiles();
      }
      return next;
    });
  }

  function toggleKnowledgeAttachment(file: KnowledgeDashboardFile): void {
    setSelectedAttachments((current) => {
      const existing = current.find((attachment) => attachment.path === file.path);
      if (existing) {
        return current.filter((attachment) => attachment.path !== file.path);
      }

      return [...current, {
        type: "knowledge-doc",
        path: file.path,
        label: file.name,
      }];
    });
  }

  async function uploadKnowledgeFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) {
      return;
    }

    setKnowledgeState("uploading");
    setKnowledgeError(null);
    try {
      const formData = new FormData();
      for (const file of Array.from(files)) {
        formData.append("files", file);
      }

      const response = await fetch("/api/knowledge", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json() as {
        uploaded?: { saved: Array<{ path: string }> };
        dashboard?: KnowledgeDashboardResponse;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Knowledge upload failed.");
      }

      const dashboardFiles = payload.dashboard?.files.filter((file) => file.status !== "skipped") ?? [];
      setKnowledgeFiles(dashboardFiles);
      setSelectedAttachments((current) => {
        const existingPaths = new Set(current.map((attachment) => attachment.path));
        const uploadedAttachments = (payload.uploaded?.saved ?? [])
          .map((saved) => dashboardFiles.find((file) => file.path === saved.path))
          .filter((file): file is KnowledgeDashboardFile => Boolean(file))
          .filter((file) => !existingPaths.has(file.path))
          .map((file) => ({
            type: "knowledge-doc" as const,
            path: file.path,
            label: file.name,
          }));

        return [...current, ...uploadedAttachments];
      });
      setKnowledgeState("ready");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      setKnowledgeState("error");
      setKnowledgeError(error instanceof Error ? error.message : String(error));
    }
  }

  function clearSelectedAttachments(): void {
    setSelectedAttachments([]);
  }

  function paginationRange(page: { currentPage: number; pageSize: number; totalItems: number }) {
    if (page.totalItems === 0) {
      return { startItem: 0, endItem: 0 };
    }

    const startItem = (page.currentPage - 1) * page.pageSize + 1;
    return {
      startItem,
      endItem: Math.min(startItem + page.pageSize - 1, page.totalItems),
    };
  }

  const recentRange = paginationRange(chat.recentPagination);
  const archivedRange = paginationRange(chat.archivedPagination);

  async function promoteToMemory(): Promise<void> {
    if (!memoryDraft) {
      return;
    }

    setMemoryState("saving");
    setMemoryError(null);
    try {
      const response = await fetch("/api/user-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: memoryDraft.category,
          key: memoryDraft.key,
          value: memoryDraft.value,
          source: "user",
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to store explicit memory fact.");
      }
      setMemoryState("saved");
      setMemoryDraft(null);
    } catch (error) {
      setMemoryState("error");
      setMemoryError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleArchiveConversation(nextConversationId: string): Promise<void> {
    setActionError(null);
    try {
      await chat.archiveConversation(nextConversationId);
      setPanelMode("history");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleSwitchConversation(nextConversationId: string): Promise<void> {
    setActionError(null);
    try {
      await chat.loadConversation(nextConversationId);
      setPanelMode("chat");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleOpenArchivedConversation(nextConversationId: string): Promise<void> {
    setActionError(null);
    try {
      await chat.openHistoryConversation(nextConversationId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleRestoreConversation(nextConversationId: string): Promise<void> {
    setActionError(null);
    try {
      await chat.restoreConversation(nextConversationId);
      setPanelMode("chat");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleDeleteConversation(nextConversationId: string): Promise<void> {
    const conversation = chat.recentConversations.find((entry) => entry.id === nextConversationId)
      ?? chat.archivedConversations.find((entry) => entry.id === nextConversationId)
      ?? null;
    const label = conversation?.label ?? "this conversation";
    const stateLabel = conversation?.archivedAt ? "archived" : "active";

    if (typeof window !== "undefined" && !window.confirm(`Delete ${stateLabel} conversation "${label}"? This removes it from history.`)) {
      return;
    }

    setActionError(null);
    try {
      await chat.deleteConversation(nextConversationId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleApplyHistoryFilters(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setActionError(null);
    try {
      await chat.applyHistoryFilters({
        search: historySearchDraft,
        from: historyFromDraft || null,
        to: historyToDraft || null,
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleClearHistoryFilters(): Promise<void> {
    setActionError(null);
    setHistorySearchDraft("");
    setHistoryFromDraft("");
    setHistoryToDraft("");
    try {
      await chat.clearHistoryFilters();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleBuilderInteraction(interactionId: string, action: "approve" | "reject" | "reconcile"): Promise<void> {
    setActionError(null);
    try {
      await chat.resolveBuilderInteraction(interactionId, action);
      setPanelMode("chat");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  const composerAccent = activePlugin.accentColor;
  const composerAccentSurface = activePlugin.accentSurface;
  const composerAccentBorder = activePlugin.accentBorder;

  return (
    <>
      <div className="grid gap-3 h-full" style={{ gridTemplateRows: "auto 1fr auto auto" }}>
        <section className="flex flex-col gap-1.5 px-1">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="text-[11px] uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>
                {panelMode === "chat" ? "active conversation" : "conversation history"}
              </div>
              {panelMode === "chat" ? (
                <div className="text-sm truncate" style={{ color: "var(--text-primary)" }}>
                  {currentConversation?.label ?? "New chat"}
                </div>
              ) : null}
            </div>

            {/* Plugin-contextual actions — shown between conversation label and chat buttons */}
            {panelMode === "chat" && builderPluginActive ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    chat.startBuilderOnboarding();
                    setOnboardingError(null);
                  }}
                  className="px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] border hover:brightness-125 transition-colors"
                  style={{ borderColor: activePlugin.accentBorder, color: activePlugin.accentColor, background: activePlugin.accentSurface }}
                  data-testid="header-builder-new"
                >
                  New Build
                </button>
                {chat.selectedBuilderProjectId ? (
                  <button
                    type="button"
                    onClick={() => chat.conversationId ? void handleArchiveConversation(chat.conversationId) : undefined}
                    disabled={!chat.conversationId || chat.isPending || chat.isBootstrapping}
                    className="px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] border disabled:opacity-50 hover:brightness-125 transition-colors"
                    style={{ borderColor: activePlugin.accentBorder, color: activePlugin.accentColor, background: activePlugin.accentSurface }}
                    data-testid="header-builder-archive"
                  >
                    Archive Build
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  chat.startNewChat();
                  setPanelMode("chat");
                  setActionError(null);
                }}
                className="px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] border hover:bg-[--bg-hover] transition-colors"
                style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
              >
                New Chat
              </button>
              <button
                type="button"
                onClick={() => chat.conversationId ? void handleArchiveConversation(chat.conversationId) : undefined}
                disabled={!chat.conversationId || chat.isPending || chat.isBootstrapping}
                className="px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] border disabled:opacity-50 hover:bg-[--bg-hover] transition-colors"
                style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
              >
                Archive Chat
              </button>
              <button
                type="button"
                aria-label="Open history"
                onClick={() => setPanelMode((current) => current === "chat" ? "history" : "chat")}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] border hover:bg-[--bg-hover] transition-colors"
                style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
              >
                <HistoryIcon />
                History
              </button>
            </div>
          </div>
          {panelMode === "chat" ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px]" style={{ color: "var(--text-dim)" }}>
              <span><span style={{ color: "var(--text-muted)" }}>requests</span> {formatNumber(chat.activeRun.requestCount)}</span>
              <span><span style={{ color: "var(--text-muted)" }}>tokens</span> {formatNumber(chat.activeRun.totalTokens)}</span>
              <span><span style={{ color: "var(--text-muted)" }}>prompt</span> {formatNumber(chat.activeRun.promptTokens)}</span>
              <span><span style={{ color: "var(--text-muted)" }}>completion</span> {formatNumber(chat.activeRun.completionTokens)}</span>
              <span><span style={{ color: "var(--text-muted)" }}>cost</span> {formatUsd(activeRunCostEstimate)}</span>
              {chat.activeRun.cachedPromptTokens > 0 ? <span><span style={{ color: "var(--text-muted)" }}>cached</span> {formatNumber(chat.activeRun.cachedPromptTokens)}</span> : null}
            </div>
          ) : null}
        </section>

        <section className="border p-4 overflow-auto" style={{ borderColor: "var(--border)", background: "var(--bg-surface)", minHeight: 500 }}>
          {panelMode === "chat" ? (
            <>
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>
                  agent console
                </div>
                {chat.isBootstrapping && (
                  <div className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>
                    loading chat
                  </div>
                )}
              </div>
              {builderAskMode ? (
                <div
                  className="mb-4 border px-4 py-3 text-xs leading-6"
                  style={{ borderColor: "rgba(167,139,250,0.34)", background: "rgba(167,139,250,0.06)", color: "var(--text-dim)" }}
                  data-testid="builder-ask-hint"
                >
                  <span className="uppercase tracking-[0.16em]" style={{ color: "#a78bfa" }}>Builder is in Ask mode</span>
                  {" — chat will answer questions about building but won\u2019t execute tools or launch tasks. Switch to "}
                  <button
                    type="button"
                    onClick={() => {
                      chat.setExecutionMode("agent");
                    }}
                    className="underline"
                    style={{ color: "#a78bfa" }}
                  >
                    Agent mode
                  </button>
                  {" to scaffold projects and run builds."}
                </div>
              ) : null}
              {chat.builderInbox.length > 0 ? (
                <div className="mb-4 space-y-3">
                  <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--warning)" }}>
                    builder inbox
                  </div>
                  <BuilderCardList
                    cards={chat.builderInbox}
                    disabled={chat.isPending || chat.isBootstrapping}
                    onAction={(interactionId, action) => {
                      void handleBuilderInteraction(interactionId, action);
                    }}
                  />
                </div>
              ) : null}
              {showBuilderWelcome ? (
                <div className="mb-4">
                  <BuilderWelcome
                    projects={builderProjects}
                    onSelectProject={(id) => {
                      chat.setSelectedBuilderProjectId(id);
                    }}
                    onNewProject={() => {
                      chat.startBuilderOnboarding();
                      setOnboardingError(null);
                    }}
                  />
                </div>
              ) : null}
              {builderOnboarding ? (
                <div className="mb-4">
                  <BuilderOnboarding
                    step={builderOnboarding.step}
                    spec={builderOnboarding.spec}
                    stackPresets={builderStackPresets}
                    templates={builderTemplates}
                    onUpdateSpec={chat.updateBuilderOnboardingSpec}
                    onSetStep={chat.setBuilderOnboardingStep}
                    onConfirm={() => {
                      setOnboardingBusy(true);
                      setOnboardingError(null);
                      void chat.confirmBuilderOnboarding()
                        .catch((error) => {
                          setOnboardingError(error instanceof Error ? error.message : String(error));
                        })
                        .finally(() => setOnboardingBusy(false));
                    }}
                    onCancel={() => {
                      chat.cancelBuilderOnboarding();
                      setOnboardingError(null);
                      setOnboardingBusy(false);
                    }}
                    disabled={onboardingBusy}
                    error={onboardingError}
                  />
                </div>
              ) : null}
              <div className="space-y-3">
                <MessageGroups
                  messages={chat.messages}
                  emptyHint={builderPluginActive ? "Select a project and describe what to build. Builder will scaffold, generate, and run tasks in the workspace." : undefined}
                  onPromote={(message) => {
                    if (message.role !== "user" && message.role !== "assistant") {
                      return;
                    }

                    setMemoryDraft({
                      messageId: message.id,
                      category: inferCategoryFromText(message.content),
                      key: inferKeyFromText(message.content),
                      value: message.content,
                    });
                    setMemoryState("idle");
                    setMemoryError(null);
                  }}
                />
              </div>
            </>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] h-full">
              <div className="space-y-4 min-w-0">
                <form onSubmit={(event) => void handleApplyHistoryFilters(event)} className="border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>history filters</div>
                      <div className="text-xs mt-2" style={{ color: "var(--text-dim)" }}>Search titles and messages, then narrow both lists by updated date.</div>
                    </div>
                    {chat.isLoadingHistoryLists ? (
                      <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-dim)" }}>refreshing</div>
                    ) : null}
                  </div>
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,180px))_auto]">
                    <label className="space-y-1.5">
                      <span className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>search</span>
                      <input
                        aria-label="history search"
                        value={historySearchDraft}
                        onChange={(event) => setHistorySearchDraft(event.target.value)}
                        placeholder="Search titles, summaries, or messages"
                        className="w-full border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-primary)" }}
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>updated from</span>
                      <input
                        aria-label="updated from"
                        type="date"
                        value={historyFromDraft}
                        onChange={(event) => setHistoryFromDraft(event.target.value)}
                        className="w-full border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-primary)" }}
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>updated to</span>
                      <input
                        aria-label="updated to"
                        type="date"
                        value={historyToDraft}
                        onChange={(event) => setHistoryToDraft(event.target.value)}
                        className="w-full border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-primary)" }}
                      />
                    </label>
                    <div className="flex gap-2 items-end">
                      <button
                        type="submit"
                        disabled={chat.isLoadingHistoryLists}
                        className="px-3 py-2 text-xs uppercase tracking-[0.18em] border disabled:opacity-50"
                        style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleClearHistoryFilters()}
                        disabled={!hasHistoryFilters && !historySearchDraft && !historyFromDraft && !historyToDraft}
                        className="px-3 py-2 text-xs uppercase tracking-[0.18em] border disabled:opacity-50"
                        style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </form>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                    <div className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>recent chats</div>
                    <div className="mt-2 text-xl" style={{ color: "var(--text-primary)" }}>{chat.recentPagination.totalItems}</div>
                    <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>{hasHistoryFilters ? "Matching active conversations after filters." : "Active conversations you can preview, open, archive, or delete."}</div>
                  </div>
                  <div className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>
                    <div className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>archived chats</div>
                    <div className="mt-2 text-xl" style={{ color: "var(--text-primary)" }}>{chat.archivedPagination.totalItems}</div>
                    <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>{hasHistoryFilters ? "Matching archived conversations after filters." : "Archived conversations remain inspectable, restorable, and deletable."}</div>
                  </div>
                </div>

                <div className="grid gap-4 2xl:grid-cols-2">
                  <div className="border p-4 space-y-3 min-w-0" style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>Recent</div>
                      <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-dim)" }}>{chat.recentPagination.totalItems} total</div>
                    </div>
                    <div className="space-y-2">
                    {chat.recentPagination.totalItems === 0 ? (
                      <div className="border p-3 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                        {hasHistoryFilters ? "No active chats match the current filters." : "No active chats yet."}
                      </div>
                    ) : chat.recentConversations.map((conversation) => (
                      <div key={conversation.id} className="border p-3" style={{ borderColor: conversation.id === chat.conversationId ? "var(--accent)" : "var(--border)" }}>
                        <div className="text-sm" style={{ color: "var(--text-primary)" }}>{conversation.label}</div>
                        <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>{conversation.preview ?? "No messages yet"}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
                          <span className="border px-2 py-1" style={{ borderColor: "var(--border-sub)", background: "var(--bg-surface)" }}>{conversation.defaultMode}</span>
                          <span className="border px-2 py-1" style={{ borderColor: "var(--border-sub)", background: "var(--bg-surface)" }}>{conversation.defaultPluginId}</span>
                        </div>
                        <div className="text-[11px] mt-2 flex items-center justify-between gap-3" style={{ color: "var(--text-muted)" }}>
                          <span>{formatTimestamp(conversation.lastMessageAt)}</span>
                          <span>{conversation.messageCount} messages</span>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-3">
                          <button
                            type="button"
                            onClick={() => void handleOpenArchivedConversation(conversation.id)}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border"
                            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                          >
                            Preview
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleSwitchConversation(conversation.id)}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border"
                            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                          >
                            Open Chat
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleArchiveConversation(conversation.id)}
                            disabled={chat.isPending || chat.isBootstrapping}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border disabled:opacity-50"
                            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                          >
                            Archive
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteConversation(conversation.id)}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border"
                            style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                    </div>
                    <PaginationControls
                      currentPage={chat.recentPagination.currentPage}
                      totalPages={chat.recentPagination.totalPages}
                      startItem={recentRange.startItem}
                      endItem={recentRange.endItem}
                      totalItems={chat.recentPagination.totalItems}
                      setCurrentPage={chat.setRecentHistoryPage}
                    />
                  </div>

                  <div className="border p-4 space-y-3 min-w-0" style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "var(--text-muted)" }}>Archived</div>
                      <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-dim)" }}>{chat.archivedPagination.totalItems} total</div>
                    </div>
                    <div className="space-y-2">
                    {chat.archivedPagination.totalItems === 0 ? (
                      <div className="border p-3 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                        {hasHistoryFilters ? "No archived chats match the current filters." : "No archived chats yet."}
                      </div>
                    ) : chat.archivedConversations.map((conversation) => (
                      <div key={conversation.id} className="border p-3" style={{ borderColor: chat.historyConversation?.id === conversation.id ? "var(--accent)" : "var(--border)" }}>
                        <div className="text-sm" style={{ color: "var(--text-primary)" }}>{conversation.label}</div>
                        <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>{conversation.preview ?? "No messages yet"}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
                          <span className="border px-2 py-1" style={{ borderColor: "var(--border-sub)", background: "var(--bg-surface)" }}>{conversation.defaultMode}</span>
                          <span className="border px-2 py-1" style={{ borderColor: "var(--border-sub)", background: "var(--bg-surface)" }}>{conversation.defaultPluginId}</span>
                        </div>
                        <div className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>
                          Archived {formatTimestamp(conversation.archivedAt)}
                        </div>
                        <div className="flex flex-wrap gap-2 mt-3">
                          <button
                            type="button"
                            onClick={() => void handleOpenArchivedConversation(conversation.id)}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border"
                            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                          >
                            Preview
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRestoreConversation(conversation.id)}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border"
                            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                          >
                            Restore
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteConversation(conversation.id)}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border"
                            style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                    </div>
                    <PaginationControls
                      currentPage={chat.archivedPagination.currentPage}
                      totalPages={chat.archivedPagination.totalPages}
                      startItem={archivedRange.startItem}
                      endItem={archivedRange.endItem}
                      totalItems={chat.archivedPagination.totalItems}
                      setCurrentPage={chat.setArchivedHistoryPage}
                    />
                  </div>
                </div>
              </div>

              <div className="border p-4 overflow-auto min-w-0" style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}>
                {chat.isLoadingHistoryConversation ? (
                  <div className="text-sm" style={{ color: "var(--text-muted)" }}>Loading conversation...</div>
                ) : chat.historyConversation ? (
                  <div className="space-y-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.24em] mb-2" style={{ color: "var(--text-muted)" }}>History preview</div>
                      <div className="text-lg" style={{ color: "var(--text-primary)" }}>{chat.historyConversation.label}</div>
                      <div className="text-xs mt-2" style={{ color: "var(--text-dim)" }}>
                        {chat.historyConversation.archivedAt ? `Archived ${formatTimestamp(chat.historyConversation.archivedAt)}` : "Active"}
                      </div>
                      <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
                        {chat.historyConversation.messageCount} messages · last updated {formatTimestamp(chat.historyConversation.lastMessageAt)}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {chat.historyConversation.archivedAt ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleRestoreConversation(chat.historyConversation!.id)}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border"
                            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                          >
                            Restore
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteConversation(chat.historyConversation!.id)}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border"
                            style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                          >
                            Delete
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleSwitchConversation(chat.historyConversation!.id)}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border"
                            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                          >
                            Open Chat
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteConversation(chat.historyConversation!.id)}
                            className="px-3 py-2 text-xs uppercase tracking-[0.18em] border"
                            style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                    <MessageGroups messages={chat.historyConversation.messages.map((message) => (
                      message.role === "USER"
                        ? { id: message.id, role: "user", content: message.content }
                        : message.role === "ASSISTANT"
                          ? { id: message.id, role: "assistant", content: message.content }
                          : message.role === "TOOL"
                            ? { id: message.id, role: "tool", content: message.content }
                            : { id: message.id, role: "meta", content: message.content }
                    ))} />
                  </div>
                ) : (
                  <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                    Select a recent or archived chat to preview it, then archive, restore, open, or delete it from here.
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {memoryDraft ? (
          <section className="border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.24em] mb-2" style={{ color: "var(--text-muted)" }}>promote message to explicit memory</div>
                <div className="text-sm" style={{ color: "var(--text-dim)" }}>
                  Convert a stable fact from chat into durable user memory. Edit the category, key, and value before saving.
                </div>
              </div>
              <div className="text-xs uppercase tracking-[0.16em]" style={{ color: memoryState === "saved" ? "var(--success)" : memoryState === "error" ? "var(--danger)" : "var(--text-dim)" }}>{memoryState}</div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>category</label>
                <select value={memoryDraft.category} onChange={(event) => setMemoryDraft((current) => current ? { ...current, category: event.target.value as MemoryFactCategory } : current)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                  {MEMORY_FACT_CATEGORIES.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>key</label>
                <input value={memoryDraft.key} onChange={(event) => setMemoryDraft((current) => current ? { ...current, key: event.target.value } : current)} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
              </div>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-[0.16em] mb-1" style={{ color: "var(--text-muted)" }}>value</label>
              <textarea value={memoryDraft.value} onChange={(event) => setMemoryDraft((current) => current ? { ...current, value: event.target.value } : current)} rows={5} className="w-full bg-transparent border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div className="text-xs leading-6" style={{ color: "var(--text-dim)" }}>
              Use this only for durable, user-approved facts. Do not promote temporary requests, guesses, secrets, or tool noise.
            </div>
            {memoryError ? <div className="text-xs leading-6" style={{ color: "var(--danger)" }}>{memoryError}</div> : null}
            <div className="flex gap-2">
              <button onClick={() => void promoteToMemory()} disabled={memoryState === "saving" || !memoryDraft.key.trim() || !memoryDraft.value.trim()} className="px-4 py-2 text-sm uppercase tracking-[0.18em] border disabled:opacity-50" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                {memoryState === "saving" ? "Saving" : "save memory fact"}
              </button>
              <button onClick={() => { setMemoryDraft(null); setMemoryState("idle"); setMemoryError(null); }} className="px-4 py-2 text-sm uppercase tracking-[0.18em] border" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                cancel
              </button>
            </div>
          </section>
        ) : null}

        <form
          className="border overflow-hidden"
          style={{ borderColor: composerAccentBorder, background: "var(--bg-surface)" }}
          onSubmit={(event) => {
            event.preventDefault();
            setActionError(null);
            const oracleIntent = getOraclePredictionIntent(input);
            const useOraclePlugin = oracleIntent.matched && executionPluginId !== "oracle";
            if (useOraclePlugin) {
              setExecutionMode("agent");
              setExecutionPluginId("oracle");
            }
            const submitMode = useOraclePlugin ? "agent" : executionMode;
            const submitPlugin = useOraclePlugin ? "oracle" : executionPluginId;
            const submit = builderPluginActive
              ? chat.launchBuilderTaskFromChat(input, { projectId: selectedBuilderProjectId })
              : chat.sendMessage(input, {
                  mode: submitMode,
                  pluginId: submitPlugin,
                  attachments: selectedAttachments,
                });
            void submit
              .then(() => {
                setInput("");
                clearSelectedAttachments();
                setAttachmentMenuOpen(false);
              })
              .catch((error) => {
                setActionError(error instanceof Error ? error.message : String(error));
              });
          }}
        >
          <div className="p-3">
            <textarea
              data-testid="chat-input"
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
              }}
              onInput={(event) => {
                const el = event.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
              }}
              placeholder={builderPluginActive ? "Describe what to build or change in the selected project..." : "Draft a launch thread about our product update..."}
              rows={1}
              className="w-full bg-transparent text-sm resize-none leading-relaxed px-1 py-1"
              style={{ color: "var(--text-primary)", minHeight: "2.5rem", outline: "none", border: "none" }}
              disabled={panelMode === "history"}
            />
            {selectedAttachments.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {selectedAttachments.map((attachment) => (
                  <button
                    key={attachment.path}
                    type="button"
                    onClick={() => setSelectedAttachments((current) => current.filter((item) => item.path !== attachment.path))}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] tracking-wide border"
                    style={{ borderColor: composerAccentBorder, color: composerAccent, background: composerAccentSurface }}
                  >
                    <span>{attachment.label}</span>
                    <span className="opacity-60">×</span>
                  </button>
                ))}
              </div>
            ) : null}
            {panelMode === "chat" && builderPluginActive ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                <label className="uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
                  Builder project
                </label>
                <select
                  value={selectedBuilderProjectId ?? ""}
                  onChange={(event) => setSelectedBuilderProjectId(event.target.value || null)}
                  disabled={chat.isPending || builderProjects.length === 0}
                  className="bg-transparent border px-3 py-2 text-xs min-w-[220px]"
                  style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                >
                  {builderProjects.length === 0 ? <option value="">No active Builder projects</option> : null}
                  {builderProjects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name} · {project.relativePath}</option>
                  ))}
                </select>
                {builderProjects.length === 0 ? (
                  <div style={{ color: "var(--warning)" }}>
                    Create a project first using <strong>New Build</strong> above.
                  </div>
                ) : (
                  <div style={{ color: "var(--text-dim)" }}>
                    Tasks launch into chat cards and inbox.
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {attachmentMenuOpen ? (
            <div className="border-t px-3 py-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}>
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>knowledge docs</div>
                <div className="flex items-center gap-1.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    hidden
                    onChange={(event) => void uploadKnowledgeFiles(event.target.files)}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={knowledgeState === "uploading"}
                    className="px-2 py-1 text-[11px] uppercase tracking-[0.16em] border disabled:opacity-50"
                    style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                  >
                    {knowledgeState === "uploading" ? "Uploading" : "Upload"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadKnowledgeFiles()}
                    disabled={knowledgeState === "loading" || knowledgeState === "uploading"}
                    className="px-2 py-1 text-[11px] uppercase tracking-[0.16em] border disabled:opacity-50"
                    style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                  >
                    Refresh
                  </button>
                </div>
              </div>
              {knowledgeError ? <div className="text-[11px]" style={{ color: "var(--danger)" }}>{knowledgeError}</div> : null}
              <div className="grid gap-1.5 max-h-40 overflow-y-auto">
                {knowledgeFiles.length === 0 && knowledgeState === "ready" ? (
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>No indexed docs yet.</div>
                ) : knowledgeFiles.map((file) => {
                  const attached = selectedAttachments.some((attachment) => attachment.path === file.path);
                  return (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => toggleKnowledgeAttachment(file)}
                      className="border px-3 py-2 text-left"
                      style={{
                        borderColor: attached ? composerAccentBorder : "var(--border)",
                        background: attached ? composerAccentSurface : "transparent",
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs" style={{ color: "var(--text-primary)" }}>{file.name}</span>
                        <span className="text-[10px] uppercase tracking-[0.16em]" style={{ color: attached ? composerAccent : "var(--text-muted)" }}>
                          {attached ? "attached" : file.status}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-0.5 px-2 py-1.5 border-t" style={{ borderColor: "var(--border)" }}>
            <button
              type="button"
              onClick={toggleAttachmentMenu}
              disabled={panelMode === "history" || chat.isPending}
              title="Attach knowledge doc"
              className="inline-flex items-center justify-center w-7 h-7 disabled:opacity-40 hover:bg-[--bg-hover] transition-colors"
              style={{ color: "var(--text-dim)" }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <path d="M8 3v10M3 8h10" />
              </svg>
            </button>

            <div className="w-px h-4 mx-0.5" style={{ background: "var(--border)" }} />

            <select
              value={executionMode}
              disabled={panelMode === "history" || chat.isPending}
              onChange={(event) => setExecutionMode(event.target.value as ChatExecutionMode)}
              className="bg-transparent text-xs px-1.5 py-1 outline-none cursor-pointer"
              style={{ color: "var(--text-primary)", border: "none" }}
            >
              <option value="ask">Ask</option>
              <option value="agent">Agent</option>
            </select>

            <div className="w-px h-4 mx-0.5" style={{ background: "var(--border)" }} />

            <select
              value={executionPluginId}
              disabled={panelMode === "history" || chat.isPending}
              onChange={(event) => {
                setExecutionPluginId(event.target.value);
                setActionError(null);
              }}
              title={activePlugin.description}
              className="bg-transparent text-xs px-1.5 py-1 outline-none cursor-pointer max-w-[200px] truncate"
              style={{ color: "var(--text-dim)", border: "none" }}
            >
              {executionCatalog.plugins.map((plugin) => (
                <option key={plugin.id} value={plugin.id}>{plugin.displayName}</option>
              ))}
            </select>

            <div className="flex-1" />

            <button
              type="submit"
              disabled={panelMode === "history" || chat.isPending || !input.trim()}
              className="inline-flex items-center justify-center w-7 h-7 disabled:opacity-30 transition-colors"
              style={{ color: composerAccent }}
              title={chat.isPending ? "Running" : executionMode === "ask" ? "Ask" : "Send"}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 12V4M8 4L4 8M8 4l4 4" />
              </svg>
            </button>
          </div>
        </form>

        {actionError ? (
          <div className="text-xs" style={{ color: "var(--danger)" }}>{actionError}</div>
        ) : null}
      </div>
      <AgenticSetupDrawer open={setupOpen} closeHref={closeSetupHref} />
    </>
  );
}

export function ChatWorkspace(props: Omit<ChatWorkspaceContentProps, "chat">) {
  const chat = useChat();
  return <ChatWorkspaceContent {...props} chat={chat} />;
}