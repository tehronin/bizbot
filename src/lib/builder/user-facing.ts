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
    return "Builder updated the plan";
  }

  if (args.status === "running") {
    if (state.includes("plan")) {
      return "Builder is planning the next step";
    }
    if (state.includes("verif")) {
      return "Builder is checking the work";
    }
    if (state.includes("review")) {
      return "Builder is reviewing the changes";
    }
    return "Builder is making changes";
  }

  if (args.status === "pending") {
    return "Builder queued the next step";
  }

  if (args.status === "succeeded") {
    return "Builder finished a step";
  }

  if (args.status === "failed") {
    return "Builder needs attention";
  }

  if (args.status === "cancelled") {
    return "Builder stopped this step";
  }

  return args.title;
}

export function getBuilderInteractionTitle(kind: BuilderChatCard["kind"]): string {
  switch (kind) {
    case "preflight_review":
      return "Your review is needed before Builder continues";
    case "mcp_policy_reconciliation":
      return "Refresh Builder's tool baseline";
    case "mcp_contract_drift":
      return "Review Builder tool and prompt changes";
    case "dependency_contract_drift":
      return "Review package and script changes";
    case "file_topology_contract_drift":
      return "Review file and folder changes";
    default:
      return "Builder update";
  }
}

export function getBuilderInteractionSummary(kind: BuilderChatCard["kind"], summary?: string | null): string {
  const trimmed = normalizeWhitespace(summary ?? "");

  if (kind === "mcp_policy_reconciliation") {
    if (!trimmed || /reconcil|baseline/i.test(trimmed)) {
      return "Builder's available tools changed. Refresh the baseline so future runs use the current toolset.";
    }
    return trimmed;
  }

  if (kind === "mcp_contract_drift") {
    if (!trimmed || /mcp contract drift|explicit decision|blocking execution/i.test(trimmed)) {
      return "Builder noticed tool or prompt changes that could affect how it works. Review them before continuing.";
    }
    return trimmed;
  }

  if (kind === "dependency_contract_drift") {
    if (!trimmed || /dependency contract drift|explicit decision/i.test(trimmed)) {
      return "Builder noticed package or script changes that could affect the project. Review them before continuing.";
    }
    return trimmed;
  }

  if (kind === "file_topology_contract_drift") {
    if (!trimmed || /file topology contract drift|explicit decision/i.test(trimmed)) {
      return "Builder noticed file or folder changes that could affect the project structure. Review them before continuing.";
    }
    return trimmed;
  }

  return trimmed;
}

export function getBuilderPreflightSummary(surfaceCount: number, firstSurfaceLabel?: string): string {
  if (surfaceCount <= 1) {
    const label = firstSurfaceLabel ? getBuilderReviewLabel(firstSurfaceLabel) : "A project review";
    return `${label} changed in a way that needs your review before Builder continues.`;
  }

  return `${surfaceCount} project reviews need your input before Builder continues.`;
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