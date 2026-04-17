import type {
  BuilderAdrAdjudicationState,
  BuilderAdrContextFocusState,
  BuilderAdrDecisionAdjudicationState,
  BuilderAdrFocusDecisionState,
  BuilderAdrRelevantFamily,
  BuilderArchitectureDecisionState,
  BuilderPlannerCritiqueState,
  BuilderPlanAdherenceState,
  BuilderProjectBriefState,
  BuilderRelevantDependencyContextState,
  BuilderRelevantFileTopologyContextState,
  BuilderRelevantMcpContextState,
  BuilderTaskSpecState,
} from "@/lib/builder/types";

const FAMILY_PATTERNS: Array<{ family: BuilderAdrRelevantFamily; pattern: RegExp }> = [
  { family: "planning", pattern: /\bbuilder\b|\bplanner\b|\bplanning\b|\bprojection\b|\bmilestone\b|\btask spec\b|\badr\b/ },
  { family: "runtime", pattern: /\bruntime\b|\bnode\b|\bnext\b|\bvite\b|\bcontainer\b|\bcompose\b|\btauri\b/ },
  { family: "service", pattern: /\bapi\b|\broute\b|\bendpoint\b|\bservice\b|\borchestrator\b|\bworker\b|\bplugin\b/ },
  { family: "dependency", pattern: /\bpackage\b|\bdependency\b|\blockfile\b|\bpnpm\b|\bnpm\b|\byarn\b|\binstall\b/ },
  { family: "database", pattern: /\bprisma\b|\bdatabase\b|\bschema\b|\bmigration\b|\bsqlite\b|\bpostgres\b|\bvector\b/ },
  { family: "topology", pattern: /\btopology\b|\bfile\b|\bfolder\b|\bsrc\b|\bapp router\b|\blayout\b|\bpath\b|\bstructure\b/ },
  { family: "governance", pattern: /\bmcp\b|\bpolicy\b|\bcontract\b|\bgovernance\b|\bapproval\b|\bpermission\b|\btool\b/ },
  { family: "verification", pattern: /\btest\b|\blint\b|\bverify\b|\bverification\b|\bvalidation\b|\bbuild\b/ },
  { family: "ui", pattern: /\bui\b|\bdashboard\b|\bpage\b|\bcomponent\b|\bview\b|\bchat\b/ },
];

const DECISION_KEY_FAMILY_PATTERNS: Array<{ family: BuilderAdrRelevantFamily; pattern: RegExp }> = [
  { family: "planning", pattern: /planning|projection|brief|milestone|task_spec|authority/ },
  { family: "runtime", pattern: /runtime|framework|container|compose|desktop|service_surface/ },
  { family: "service", pattern: /service|route|endpoint|api|worker|plugin/ },
  { family: "dependency", pattern: /dependency|package|lockfile|package_manager/ },
  { family: "database", pattern: /database|schema|migration|orm|prisma|sqlite|postgres|persistence/ },
  { family: "topology", pattern: /topology|path|src_root|app_root|lib_root|components_root|tests_root|placement/ },
  { family: "governance", pattern: /mcp|policy|contract|governance|approval/ },
  { family: "verification", pattern: /verification|validator|test|lint|build/ },
  { family: "ui", pattern: /ui|dashboard|page|component|chat/ },
];

const PROTECTED_BOUNDARY_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "control-plane contracts", pattern: /mcp|policy|contract|governance/ },
  { label: "dependency baseline", pattern: /dependency|package|lockfile|package_manager/ },
  { label: "database strategy", pattern: /database|schema|migration|orm|prisma|sqlite|postgres|persistence/ },
  { label: "workspace topology", pattern: /topology|path|src_root|app_root|lib_root|components_root|tests_root|projection/ },
  { label: "runtime boundary", pattern: /runtime|framework|container|compose|service_surface/ },
];

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function inferDecisionFamily(key: string, description?: string | null): BuilderAdrRelevantFamily | null {
  const source = `${key} ${description ?? ""}`.toLowerCase();
  for (const entry of DECISION_KEY_FAMILY_PATTERNS) {
    if (entry.pattern.test(source)) {
      return entry.family;
    }
  }
  return null;
}

function inferProtectedBoundary(key: string, description?: string | null): string | null {
  const source = `${key} ${description ?? ""}`.toLowerCase();
  for (const entry of PROTECTED_BOUNDARY_PATTERNS) {
    if (entry.pattern.test(source)) {
      return entry.label;
    }
  }
  return null;
}

function inferFamiliesFromSource(sourceTexts: string[], explicitKeys: string[]): BuilderAdrRelevantFamily[] {
  const source = `${sourceTexts.join(" ")} ${explicitKeys.join(" ")}`.toLowerCase();
  const matched = FAMILY_PATTERNS
    .filter((entry) => entry.pattern.test(source))
    .map((entry) => entry.family);
  const explicitFamilies = explicitKeys
    .map((key) => inferDecisionFamily(key))
    .filter((family): family is BuilderAdrRelevantFamily => family !== null);
  return unique([...matched, ...explicitFamilies]);
}

function buildFocusDecision(
  decision: BuilderArchitectureDecisionState,
  sourceStatus: "active" | "stale",
): BuilderAdrFocusDecisionState {
  const family = inferDecisionFamily(decision.key, decision.description);
  const protectedBoundary = inferProtectedBoundary(decision.key, decision.description) !== null;
  return {
    key: decision.key,
    sourceStatus,
    family,
    protectedBoundary,
    rationale: family
      ? `${sourceStatus} ADR ${decision.key} maps to ${family}.`
      : `${sourceStatus} ADR ${decision.key} remains available as background context.`,
  };
}

function pickRelevantDecisions(args: {
  decisions: BuilderArchitectureDecisionState[];
  sourceStatus: "active" | "stale";
  relevantFamilies: BuilderAdrRelevantFamily[];
  explicitKeys: string[];
}): BuilderAdrFocusDecisionState[] {
  return args.decisions.flatMap((decision) => {
    const focus = buildFocusDecision(decision, args.sourceStatus);
    if (args.explicitKeys.includes(decision.key)) {
      return [{
        ...focus,
        rationale: `${focus.rationale} Explicitly referenced by the current Builder work.`,
      }];
    }
    if (focus.family && args.relevantFamilies.includes(focus.family)) {
      return [{
        ...focus,
        rationale: `${focus.rationale} Relevant to the current Builder work family.`,
      }];
    }
    return [];
  });
}

export function buildBuilderAdrFocus(args: {
  phase: "planning" | "execution";
  sourceTexts: string[];
  activeArchitecture?: BuilderArchitectureDecisionState[];
  staleArchitecture?: BuilderArchitectureDecisionState[];
  explicitDecisionKeys?: string[];
  explicitStaleKeys?: string[];
}): BuilderAdrContextFocusState {
  const activeArchitecture = args.activeArchitecture ?? [];
  const staleArchitecture = args.staleArchitecture ?? [];
  const explicitKeys = unique([...(args.explicitDecisionKeys ?? []), ...(args.explicitStaleKeys ?? [])]);
  const relevantFamilies = inferFamiliesFromSource(args.sourceTexts, explicitKeys);
  const activeDecisions = pickRelevantDecisions({
    decisions: activeArchitecture,
    sourceStatus: "active",
    relevantFamilies,
    explicitKeys,
  });
  const staleDecisions = pickRelevantDecisions({
    decisions: staleArchitecture,
    sourceStatus: "stale",
    relevantFamilies,
    explicitKeys: unique([...(args.explicitStaleKeys ?? []), ...explicitKeys]),
  });
  const decisions = [...activeDecisions, ...staleDecisions];
  const protectedBoundariesTouched = unique(decisions.flatMap((decision) => {
    const label = inferProtectedBoundary(decision.key);
    return label ? [label] : [];
  }));

  return {
    phase: args.phase,
    relevant: decisions.length > 0,
    summary: decisions.length > 0
      ? `Focused ADR context on ${decisions.length} architecture decision${decisions.length === 1 ? "" : "s"} across ${relevantFamilies.join(", ") || "general"}.`
      : "No architecture-sensitive ADR context needs first-class adjudication for this Builder pass.",
    relevantFamilies,
    activeRelevantKeys: activeDecisions.map((decision) => decision.key),
    staleRelevantKeys: staleDecisions.map((decision) => decision.key),
    protectedBoundariesTouched,
    decisions,
  };
}

function buildDecisionMap(focus: BuilderAdrContextFocusState): Map<string, BuilderAdrFocusDecisionState> {
  return new Map(focus.decisions.map((decision) => [decision.key, decision]));
}

function buildPlanningDecisionAdjudications(args: {
  focus: BuilderAdrContextFocusState;
  critique: BuilderPlannerCritiqueState;
}): BuilderAdrDecisionAdjudicationState[] {
  const focusMap = buildDecisionMap(args.focus);
  const decisions: BuilderAdrDecisionAdjudicationState[] = [];

  for (const key of args.focus.activeRelevantKeys) {
    const focus = focusMap.get(key);
    if (!focus) {
      continue;
    }
    const deferred = args.critique.reconciliation.unreferencedActiveKeys.includes(key);
    decisions.push({
      key,
      sourceStatus: "active",
      family: focus.family,
      disposition: deferred ? "defer" : "reconfirm",
      protectedBoundary: focus.protectedBoundary,
      needsApproval: false,
      rationale: deferred
        ? `Active ADR ${key} stays as background context and does not need first-class planner changes.`
        : `Planner explicitly carried forward active ADR ${key}.`,
    });
  }

  for (const key of args.focus.staleRelevantKeys) {
    const focus = focusMap.get(key);
    if (!focus) {
      continue;
    }
    const conflicting = args.critique.reconciliation.conflictingDecisionKeys.includes(key);
    const retired = args.critique.reconciliation.retiredDecisionKeys.includes(key);
    const reconfirmed = args.critique.reconciliation.reconfirmedStaleKeys.includes(key);
    const deferred = args.critique.reconciliation.missingStaleKeys.includes(key);
    const disposition = conflicting
      ? "supersede"
      : retired
        ? "retire"
        : reconfirmed
          ? "reconfirm"
          : deferred
            ? "defer"
            : "defer";
    decisions.push({
      key,
      sourceStatus: "stale",
      family: focus.family,
      disposition,
      protectedBoundary: focus.protectedBoundary,
      needsApproval: focus.protectedBoundary && (retired || conflicting),
      rationale: conflicting
        ? `Planner both reconfirmed and retired stale ADR ${key}; treat this as a material supersession.`
        : retired
          ? `Planner intentionally retired stale ADR ${key}.`
          : reconfirmed
            ? `Planner reconfirmed stale ADR ${key}.`
            : `Planner left stale ADR ${key} deferred because it is not yet materially resolved.`,
    });
  }

  const knownKeys = new Set(decisions.map((decision) => decision.key));
  for (const key of args.critique.reconciliation.newDecisionKeys) {
    if (knownKeys.has(key)) {
      continue;
    }
    const family = inferDecisionFamily(key);
    if (!family || (args.focus.relevantFamilies.length > 0 && !args.focus.relevantFamilies.includes(family))) {
      continue;
    }
    const protectedBoundary = inferProtectedBoundary(key) !== null;
    decisions.push({
      key,
      sourceStatus: "new",
      family,
      disposition: "supersede",
      protectedBoundary,
      needsApproval: false,
      rationale: protectedBoundary
        ? `Planner introduced protected-boundary ADR ${key} as part of the current plan, but initial introduction remains non-blocking.`
        : `Planner introduced ADR ${key} as part of the current plan.`,
    });
  }

  return decisions;
}

export function adjudicateBuilderPlanningAdr(args: {
  focus: BuilderAdrContextFocusState;
  critique: BuilderPlannerCritiqueState;
}): BuilderAdrAdjudicationState {
  const decisions = buildPlanningDecisionAdjudications(args);
  const updateDecisionKeys = unique(decisions.flatMap((decision) => (
    decision.disposition === "reconfirm" || decision.disposition === "supersede"
      ? [decision.key]
      : []
  )));
  const retireDecisionKeys = unique(decisions.flatMap((decision) => (
    decision.disposition === "retire" ? [decision.key] : []
  )));
  const unresolvedRelevantStale = decisions.filter((decision) => decision.sourceStatus === "stale" && decision.disposition === "defer");
  const approvalNeeded = decisions.filter((decision) => decision.needsApproval);
  const escalationReason = approvalNeeded.length > 0
    ? `Material protected-boundary ADR changes require approval: ${approvalNeeded.map((decision) => decision.key).join(", ")}.`
    : null;
  const overallVerdict = escalationReason
    ? "escalate"
    : unresolvedRelevantStale.length > 0
      ? "block"
      : updateDecisionKeys.length > 0 || retireDecisionKeys.length > 0
        ? "proceed_with_update"
        : "proceed";

  return {
    phase: "planning",
    relevant: args.focus.relevant,
    summary: !args.focus.relevant
      ? "Planner ADR adjudication found no material architecture decisions to force into the plan."
      : overallVerdict === "escalate"
        ? escalationReason ?? "Planner ADR adjudication requires protected-boundary approval."
        : overallVerdict === "block"
          ? `Planner must still address relevant stale ADR keys: ${unresolvedRelevantStale.map((decision) => decision.key).join(", ")}.`
          : overallVerdict === "proceed_with_update"
            ? `Planner reconciled relevant ADR context and can update durable architecture memory for ${updateDecisionKeys.join(", ") || retireDecisionKeys.join(", ")}.`
            : "Planner ADR adjudication is advisory only for this pass.",
    overallVerdict,
    escalationReason,
    relevantFamilies: args.focus.relevantFamilies,
    activeRelevantKeys: args.focus.activeRelevantKeys,
    staleRelevantKeys: args.focus.staleRelevantKeys,
    protectedBoundariesTouched: args.focus.protectedBoundariesTouched,
    updateDecisionKeys,
    retireDecisionKeys,
    decisions,
  };
}

export function adjudicateBuilderExecutionAdr(args: {
  focus: BuilderAdrContextFocusState;
  taskSpec: BuilderTaskSpecState;
  adherence: BuilderPlanAdherenceState;
}): BuilderAdrAdjudicationState {
  const focusMap = buildDecisionMap(args.focus);
  const plannedDecisionKeys = unique(args.taskSpec.architecturalDecisionKeys);
  const decisions: BuilderAdrDecisionAdjudicationState[] = [];

  for (const key of args.focus.activeRelevantKeys) {
    const focus = focusMap.get(key);
    if (!focus) {
      continue;
    }
    const reconfirmed = plannedDecisionKeys.includes(key);
    decisions.push({
      key,
      sourceStatus: "active",
      family: focus.family,
      disposition: reconfirmed ? "reconfirm" : "defer",
      protectedBoundary: focus.protectedBoundary,
      needsApproval: false,
      rationale: reconfirmed
        ? `Current task spec explicitly carries active ADR ${key}.`
        : `Active ADR ${key} stays implicit background context for this execution step.`,
    });
  }

  for (const key of args.focus.staleRelevantKeys) {
    const focus = focusMap.get(key);
    if (!focus) {
      continue;
    }
    const reconfirmed = plannedDecisionKeys.includes(key);
    decisions.push({
      key,
      sourceStatus: "stale",
      family: focus.family,
      disposition: reconfirmed ? "reconfirm" : "defer",
      protectedBoundary: focus.protectedBoundary,
      needsApproval: false,
      rationale: reconfirmed
        ? `Current task spec is already responsible for reconfirming stale ADR ${key}.`
        : `Stale ADR ${key} remains advisory background context for this execution step.`,
    });
  }

  const knownKeys = new Set(decisions.map((decision) => decision.key));
  for (const key of plannedDecisionKeys) {
    if (knownKeys.has(key)) {
      continue;
    }
    const family = inferDecisionFamily(key);
    if (!family || (args.focus.relevantFamilies.length > 0 && !args.focus.relevantFamilies.includes(family))) {
      continue;
    }
    decisions.push({
      key,
      sourceStatus: "new",
      family,
      disposition: "supersede",
      protectedBoundary: inferProtectedBoundary(key) !== null,
      needsApproval: false,
      rationale: `Current task spec records a new ADR ${key} for this execution step.`,
    });
  }

  const updateDecisionKeys = unique(decisions.flatMap((decision) => (
    decision.disposition === "reconfirm" || decision.disposition === "supersede"
      ? [decision.key]
      : []
  )));

  return {
    phase: "execution",
    relevant: args.focus.relevant,
    summary: !args.focus.relevant
      ? "Execution ADR adjudication found no material architecture updates for this task."
      : updateDecisionKeys.length > 0
        ? `Execution ADR adjudication captured architecture context for ${updateDecisionKeys.join(", ")}.`
        : `Execution ADR adjudication kept ${args.adherence.requiredDecisionKeys.length > 0 ? "required" : "ambient"} architecture as advisory background only.`,
    overallVerdict: updateDecisionKeys.length > 0 ? "proceed_with_update" : "proceed",
    escalationReason: null,
    relevantFamilies: args.focus.relevantFamilies,
    activeRelevantKeys: args.focus.activeRelevantKeys,
    staleRelevantKeys: args.focus.staleRelevantKeys,
    protectedBoundariesTouched: args.focus.protectedBoundariesTouched,
    updateDecisionKeys,
    retireDecisionKeys: [],
    decisions,
  };
}

export function buildPlanningAdrFocus(args: {
  brief: BuilderProjectBriefState;
  activeArchitecture?: BuilderArchitectureDecisionState[];
  staleArchitecture?: BuilderArchitectureDecisionState[];
  dependencyContext?: BuilderRelevantDependencyContextState | null;
  fileTopologyContext?: BuilderRelevantFileTopologyContextState | null;
  mcpContext?: BuilderRelevantMcpContextState | null;
}): BuilderAdrContextFocusState {
  return buildBuilderAdrFocus({
    phase: "planning",
    activeArchitecture: args.activeArchitecture,
    staleArchitecture: args.staleArchitecture,
    sourceTexts: [
      args.brief.title,
      args.brief.summary,
      ...args.brief.goals,
      ...args.brief.constraints,
      ...args.brief.deliverables,
      args.brief.notes ?? "",
      ...(args.dependencyContext?.reasons ?? []),
      ...(args.fileTopologyContext?.placementGuidance ?? []),
      ...(args.fileTopologyContext?.reasons ?? []),
      ...(args.mcpContext?.reasons ?? []),
    ],
  });
}

export function buildExecutionAdrFocus(args: {
  request: string;
  taskSpec: BuilderTaskSpecState;
  adherence: BuilderPlanAdherenceState;
  activeArchitecture?: BuilderArchitectureDecisionState[];
  staleArchitecture?: BuilderArchitectureDecisionState[];
  dependencyContext?: BuilderRelevantDependencyContextState | null;
  fileTopologyContext?: BuilderRelevantFileTopologyContextState | null;
  mcpContext?: BuilderRelevantMcpContextState | null;
}): BuilderAdrContextFocusState {
  return buildBuilderAdrFocus({
    phase: "execution",
    activeArchitecture: args.activeArchitecture,
    staleArchitecture: args.staleArchitecture,
    explicitDecisionKeys: [...args.taskSpec.architecturalDecisionKeys, ...args.adherence.requiredDecisionKeys],
    explicitStaleKeys: args.adherence.reconfirmedStaleKeys,
    sourceTexts: [
      args.request,
      args.taskSpec.title,
      args.taskSpec.summary,
      ...args.taskSpec.completionCriteria,
      ...args.taskSpec.validators.map((validator) => String(validator)),
      ...args.adherence.directives,
      ...(args.dependencyContext?.reasons ?? []),
      ...(args.fileTopologyContext?.placementGuidance ?? []),
      ...(args.fileTopologyContext?.reasons ?? []),
      ...(args.mcpContext?.reasons ?? []),
    ],
  });
}
