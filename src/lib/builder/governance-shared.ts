import type { BuilderProjectCommandInput } from "@/lib/builder/command-types";

export type BuilderGovernanceSourceSurface = "dashboard" | "api" | "plugin_tool";

export type BuilderGovernanceCommandInput = Extract<BuilderProjectCommandInput,
  | { action: "reconcile_mcp_policy" }
  | { action: "resolve_mcp_contract_drift" }
  | { action: "resolve_dependency_contract_drift" }
  | { action: "resolve_file_topology_contract_drift" }
>;

export interface ParsedBuilderGovernanceCommandPayload {
  command: BuilderGovernanceCommandInput;
  sourceSurface: BuilderGovernanceSourceSurface;
}

type GovernancePayload = BuilderGovernanceCommandInput & { sourceSurface?: BuilderGovernanceSourceSurface };

function normalizeGovernanceReason(reason: unknown, actionLabel: string): string {
  const normalized = typeof reason === "string" ? reason.trim() : "";
  if (!normalized) {
    throw new Error(`${actionLabel} requires a non-empty approval reason.`);
  }
  return normalized;
}

function normalizeGovernanceConfirmation(confirmed: unknown, actionLabel: string): true {
  if (confirmed !== true) {
    throw new Error(`${actionLabel} requires explicit operator confirmation.`);
  }
  return true;
}

function normalizeSourceSurface(sourceSurface: unknown): BuilderGovernanceSourceSurface {
  return sourceSurface === "dashboard" || sourceSurface === "plugin_tool"
    ? sourceSurface
    : "api";
}

export function isBuilderGovernanceAction(action: unknown): action is BuilderGovernanceCommandInput["action"] {
  return action === "reconcile_mcp_policy"
    || action === "resolve_mcp_contract_drift"
    || action === "resolve_dependency_contract_drift"
    || action === "resolve_file_topology_contract_drift";
}

export function parseBuilderGovernanceCommandPayload(value: object | null): ParsedBuilderGovernanceCommandPayload | null {
  if (!value || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (!isBuilderGovernanceAction(candidate.action)) {
    return null;
  }

  const sourceSurface = normalizeSourceSurface(candidate.sourceSurface);

  if (candidate.action === "reconcile_mcp_policy") {
    return {
      command: {
        action: "reconcile_mcp_policy",
        confirmed: normalizeGovernanceConfirmation(candidate.confirmed, "Builder MCP policy reconciliation"),
        reason: normalizeGovernanceReason(candidate.reason, "Builder MCP policy reconciliation"),
      },
      sourceSurface,
    };
  }

  if (typeof candidate.runId !== "string" || !candidate.runId.trim()) {
    throw new Error(`${String(candidate.action).replaceAll("_", " ")} requires a runId.`);
  }

  const decision = candidate.decision === "approve" || candidate.decision === "reject"
    ? candidate.decision
    : null;
  if (!decision) {
    const label = candidate.action === "resolve_mcp_contract_drift"
      ? "Builder MCP contract drift resolution"
      : candidate.action === "resolve_dependency_contract_drift"
        ? "Builder dependency contract drift resolution"
        : "Builder file topology contract drift resolution";
    throw new Error(`${label} requires decision=approve|reject.`);
  }

  return {
    command: {
      action: candidate.action,
      runId: candidate.runId.trim(),
      decision,
      confirmed: normalizeGovernanceConfirmation(candidate.confirmed, String(candidate.action).replaceAll("_", " ")),
      reason: normalizeGovernanceReason(candidate.reason, String(candidate.action).replaceAll("_", " ")),
    } as BuilderGovernanceCommandInput,
    sourceSurface,
  };
}

export function buildBuilderGovernanceCommandPayload(input: GovernancePayload): GovernancePayload {
  const parsed = parseBuilderGovernanceCommandPayload(input);
  if (!parsed) {
    throw new Error("Unsupported Builder governance command action.");
  }

  return {
    ...parsed.command,
    ...(input.sourceSurface ? { sourceSurface: parsed.sourceSurface } : {}),
  };
}