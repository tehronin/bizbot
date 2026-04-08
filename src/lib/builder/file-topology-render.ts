import type {
  BuilderFileTopologyContractBaselineState,
  BuilderFileTopologyContractSnapshotState,
  BuilderFileTopologyPlanningContextState,
} from "@/lib/builder/types";

function listOrNone(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

export function buildBuilderFileTopologyPlacementGuidance(snapshot: BuilderFileTopologyContractSnapshotState): string[] {
  const guidance: string[] = [];

  if (snapshot.anchors.appRoot) {
    guidance.push(`Route files belong under ${snapshot.anchors.appRoot}.`);
  }
  if (snapshot.rules.preferSrcLib && snapshot.anchors.libRoot) {
    guidance.push(`Shared runtime helpers belong under ${snapshot.anchors.libRoot}.`);
  }
  if (snapshot.rules.preferSrcComponents && snapshot.anchors.componentsRoot) {
    guidance.push(`Shared UI belongs under ${snapshot.anchors.componentsRoot}.`);
  }
  if (snapshot.anchors.testsRoot) {
    guidance.push(`Tests belong under ${snapshot.anchors.testsRoot}.`);
  }
  if (snapshot.anchors.scriptsRoot) {
    guidance.push(`Scripts belong under ${snapshot.anchors.scriptsRoot}.`);
  }
  if (snapshot.anchors.prismaRoot) {
    guidance.push(`Prisma schema and migrations belong under ${snapshot.anchors.prismaRoot}.`);
  }
  if (snapshot.anchors.tauriRoot) {
    guidance.push(`Desktop shell files belong under ${snapshot.anchors.tauriRoot}.`);
  }
  if (snapshot.rules.reserveBuilderProjectionPaths) {
    guidance.push(`Builder projection files belong under ${snapshot.anchors.builderProjectionRoot}.`);
  }
  if (snapshot.rules.discourageTopLevelFeatureFolders) {
    guidance.push("Avoid new top-level feature, helper, or service folders unless the task explicitly intends to change project structure.");
  }

  return guidance;
}

export function renderBuilderFileTopologyProjectionMarkdown(args: {
  baseline: BuilderFileTopologyContractBaselineState | null;
  planningContext: BuilderFileTopologyPlanningContextState | null;
}): string {
  const anchors = args.planningContext?.anchors ?? args.baseline?.snapshot.anchors ?? {
    appRoot: null,
    libRoot: null,
    componentsRoot: null,
    testsRoot: null,
    scriptsRoot: null,
    prismaRoot: null,
    tauriRoot: null,
    builderProjectionRoot: ".builder" as const,
  };
  const topLevel = args.planningContext?.topLevel ?? args.baseline?.snapshot.topLevel ?? [];
  const guidance = args.planningContext?.placementGuidance ?? (args.baseline ? buildBuilderFileTopologyPlacementGuidance(args.baseline.snapshot) : []);

  return [
    "# File Topology Contract",
    "",
    `Accepted topology hash: ${args.baseline?.expectedHash ?? "none recorded"}`,
    `Current topology hash: ${args.planningContext?.currentHash ?? args.baseline?.expectedHash ?? "none recorded"}`,
    `Updated at: ${args.baseline?.updatedAt ?? "none recorded"}`,
    "",
    "## Top-Level Structure",
    "",
    ...(topLevel.length > 0 ? topLevel.map((entry) => `- ${entry}`) : ["- none recorded"]),
    "",
    "## Canonical Anchors",
    "",
    `- appRoot: ${anchors.appRoot ?? "none"}`,
    `- libRoot: ${anchors.libRoot ?? "none"}`,
    `- componentsRoot: ${anchors.componentsRoot ?? "none"}`,
    `- testsRoot: ${anchors.testsRoot ?? "none"}`,
    `- scriptsRoot: ${anchors.scriptsRoot ?? "none"}`,
    `- prismaRoot: ${anchors.prismaRoot ?? "none"}`,
    `- tauriRoot: ${anchors.tauriRoot ?? "none"}`,
    `- builderProjectionRoot: ${anchors.builderProjectionRoot}`,
    "",
    "## Placement Guidance",
    "",
    ...(guidance.length > 0 ? guidance.map((entry) => `- ${entry}`) : ["- none recorded"]),
    "",
    "## Drift Summary",
    "",
    args.planningContext?.summary ?? "No live topology summary recorded.",
    "",
    "## Active Topology ADR Keys",
    "",
    ...(args.baseline?.decisionKeys.length ? args.baseline.decisionKeys.map((entry) => `- ${entry}`) : ["- none recorded"]),
    "",
    "## Snapshot Overview",
    "",
    args.baseline
      ? `Directories: ${listOrNone(args.baseline.snapshot.directories.slice(0, 24))}`
      : "Directories: none recorded",
    args.baseline
      ? `Important files: ${listOrNone(args.baseline.snapshot.importantFiles)}`
      : "Important files: none recorded",
    "",
  ].join("\n");
}