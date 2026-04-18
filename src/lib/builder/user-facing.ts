import type { BuilderChatCard } from "@/lib/chat/types";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function getBuilderReviewLabel(idOrLabel: string): string {
  switch (idOrLabel) {
    case "mcp":
    case "MCP contract":
      return "Tools and prompts";
    case "dependency":
    case "Dependency contract":
      return "Packages and scripts";
    case "file_topology":
    case "File topology contract":
      return "Files and folders";
    default:
      return idOrLabel;
  }
}

export function getBuilderTaskCardTitle(args: {
  status: BuilderChatCard["status"];
  state: string;
  title: string;
}): string {
  const state = args.state.toLowerCase();

  if (args.status === "planned") {
    return "I mapped out the next step";
  }

  if (args.status === "running") {
    if (state.includes("plan")) {
      return "I'm planning the next step";
    }
    if (state.includes("verif")) {
      return "I'm checking the work";
    }
    if (state.includes("review")) {
      return "I'm reviewing the changes";
    }
    return "I'm working through the changes";
  }

  if (args.status === "pending") {
    return "The next step is queued";
  }

  if (args.status === "succeeded") {
    return "I finished that step";
  }

  if (args.status === "failed") {
    return "I hit a blocker";
  }

  if (args.status === "cancelled") {
    return "This step was stopped";
  }

  return args.title;
}

export function getBuilderInteractionTitle(kind: BuilderChatCard["kind"]): string {
  switch (kind) {
    case "preflight_review":
      return "I need your go-ahead before I continue";
    case "mcp_policy_reconciliation":
      return "I need to refresh my tool baseline";
    case "mcp_contract_drift":
      return "Please review the tool and prompt changes";
    case "dependency_contract_drift":
      return "Please review the package and script changes";
    case "file_topology_contract_drift":
      return "Please review the file and folder changes";
    default:
      return "Project update";
  }
}

export function getBuilderInteractionSummary(kind: BuilderChatCard["kind"], summary?: string | null): string {
  const trimmed = normalizeWhitespace(summary ?? "");

  if (kind === "mcp_policy_reconciliation") {
    if (!trimmed || /reconcil|baseline/i.test(trimmed)) {
      return "My available tools changed. I need to refresh the baseline before I continue with the current toolset.";
    }
    return trimmed;
  }

  if (kind === "mcp_contract_drift") {
    if (!trimmed || /mcp contract drift|explicit decision|blocking execution/i.test(trimmed)) {
      return "I noticed tool or prompt changes that could affect this run. Please review them before I continue.";
    }
    return trimmed;
  }

  if (kind === "dependency_contract_drift") {
    if (!trimmed || /dependency contract drift|explicit decision/i.test(trimmed)) {
      return "I noticed package or script changes that could affect the project. Please review them before I continue.";
    }
    return trimmed;
  }

  if (kind === "file_topology_contract_drift") {
    if (!trimmed || /file topology contract drift|explicit decision/i.test(trimmed)) {
      return "I noticed file or folder changes that could affect the project structure. Please review them before I continue.";
    }
    return trimmed;
  }

  return trimmed;
}

export function getBuilderPreflightSummary(surfaceCount: number, firstSurfaceLabel?: string): string {
  if (surfaceCount <= 1) {
    const label = firstSurfaceLabel ? getBuilderReviewLabel(firstSurfaceLabel) : "A project review";
    return `${label} changed in a way that needs your review before I continue.`;
  }

  return `${surfaceCount} project reviews need your input before I continue.`;
}

export function formatBuilderUserFacingError(message: string): string {
  const normalized = normalizeWhitespace(message);

  if (
    /Builder project brief required before project advancement/i.test(normalized)
    || /planning requires a brief title and summary/i.test(normalized)
  ) {
    return "Builder needs a short project brief before it can start. Open the Builder dashboard, add the goal and scope, then try again.";
  }

  if (/Builder project plan was generated/i.test(normalized)) {
    return "Builder finished the project plan. Review it in the Builder dashboard, then run the next step when you're ready.";
  }

  if (/No runnable Builder task spec is available because the project is blocked/i.test(normalized)) {
    return "Builder is waiting on a project review before it can continue. Open the Builder dashboard, resolve the blocking review, then try again.";
  }

  if (/No runnable Builder task spec is available yet/i.test(normalized)) {
    return "Builder is still getting the project ready. Check the Builder dashboard for the latest planning status, then try again.";
  }

  if (/Builder project is complete/i.test(normalized)) {
    return "This Builder project is already complete.";
  }

  if (/Builder preflight review is no longer pending/i.test(normalized)) {
    return "That review is already resolved.";
  }

  if (/Builder interaction has already been resolved/i.test(normalized)) {
    return "That Builder review has already been handled.";
  }

  if (/Builder interaction not found/i.test(normalized)) {
    return "Builder couldn't find that review item anymore.";
  }

  return normalized;
}