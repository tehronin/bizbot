import type {
  BuilderContractDriftSeverity,
  BuilderFileTopologyContractBaselineState,
  BuilderFileTopologyContractDriftState,
  BuilderFileTopologyContractSnapshotState,
} from "@/lib/builder/types";

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function diffStringLists(previousValues: string[], currentValues: string[]): {
  added: string[];
  removed: string[];
} {
  const previous = new Set(previousValues);
  const current = new Set(currentValues);

  return {
    added: currentValues.filter((value) => !previous.has(value)),
    removed: previousValues.filter((value) => !current.has(value)),
  };
}

function classifyBuilderFileTopologyDrift(args: {
  changed: boolean;
  directories: BuilderFileTopologyContractDriftState["directories"];
  importantFiles: BuilderFileTopologyContractDriftState["importantFiles"];
  anchorsChanged: string[];
  classificationsChanged: string[];
  rulesChanged: string[];
}): { severity: BuilderContractDriftSeverity; reasons: string[] } {
  if (!args.changed) {
    return {
      severity: "benign",
      reasons: ["Current file topology matches the accepted Builder baseline."],
    };
  }

  const reasons: string[] = [];
  let severity: BuilderContractDriftSeverity = "benign";

  if (args.anchorsChanged.length > 0 || args.classificationsChanged.length > 0 || args.rulesChanged.length > 0 || args.importantFiles.removed.length > 0) {
    severity = "breaking";
  } else if (args.directories.removed.length > 0 || args.importantFiles.added.length > 0) {
    severity = "notable";
  }

  if (args.anchorsChanged.length > 0) {
    reasons.push("Project anchor paths changed.");
  }
  if (args.classificationsChanged.length > 0) {
    reasons.push("Topology classifications changed.");
  }
  if (args.rulesChanged.length > 0) {
    reasons.push("Topology placement rules changed.");
  }
  if (args.importantFiles.removed.length > 0) {
    reasons.push("Important root or anchor files were removed.");
  }
  if (args.importantFiles.added.length > 0) {
    reasons.push("Important root or anchor files were added.");
  }
  if (args.directories.removed.length > 0) {
    reasons.push("Existing directories were removed from the accepted topology.");
  }
  if (args.directories.added.length > 0 && reasons.length === 0) {
    reasons.push("Only additional directories were introduced under the current topology.");
  } else if (args.directories.added.length > 0) {
    reasons.push("Additional directories were introduced.");
  }

  return { severity, reasons };
}

export function resolveBuilderFileTopologyContractDrift(args: {
  previousHash: string | null;
  currentHash: string;
  previousSnapshot: BuilderFileTopologyContractSnapshotState | null;
  currentSnapshot: BuilderFileTopologyContractSnapshotState;
}): BuilderFileTopologyContractDriftState {
  const directories = diffStringLists(args.previousSnapshot?.directories ?? [], args.currentSnapshot.directories);
  const importantFiles = diffStringLists(args.previousSnapshot?.importantFiles ?? [], args.currentSnapshot.importantFiles);
  const previousAnchors = args.previousSnapshot?.anchors ?? null;
  const anchorKeys = Object.keys(args.currentSnapshot.anchors) as Array<keyof BuilderFileTopologyContractSnapshotState["anchors"]>;
  const anchorsChanged = uniqueSorted(anchorKeys.flatMap((key) => previousAnchors?.[key] !== args.currentSnapshot.anchors[key] ? [key] : []));

  const previousClassifications = args.previousSnapshot?.classifications ?? null;
  const classificationKeys = Object.keys(args.currentSnapshot.classifications) as Array<keyof BuilderFileTopologyContractSnapshotState["classifications"]>;
  const classificationsChanged = uniqueSorted(classificationKeys.flatMap((key) => previousClassifications?.[key] !== args.currentSnapshot.classifications[key] ? [key] : []));

  const previousRules = args.previousSnapshot?.rules ?? null;
  const ruleKeys = Object.keys(args.currentSnapshot.rules) as Array<keyof BuilderFileTopologyContractSnapshotState["rules"]>;
  const rulesChanged = uniqueSorted(ruleKeys.flatMap((key) => previousRules?.[key] !== args.currentSnapshot.rules[key] ? [key] : []));
  const changed = args.previousHash !== null && args.previousHash !== args.currentHash;
  const classification = classifyBuilderFileTopologyDrift({
    changed,
    directories,
    importantFiles,
    anchorsChanged,
    classificationsChanged,
    rulesChanged,
  });

  return {
    previousHash: args.previousHash,
    currentHash: args.currentHash,
    changed,
    severity: classification.severity,
    reasons: classification.reasons,
    directories,
    importantFiles,
    anchorsChanged,
    classificationsChanged,
    rulesChanged,
  };
}

export function summarizeBuilderFileTopologyDrift(drift: BuilderFileTopologyContractDriftState | null): string {
  if (!drift) {
    return "No accepted file topology contract baseline exists yet. Builder will capture it when the project is ready to advance.";
  }
  if (!drift.changed) {
    return "Current file topology matches the accepted Builder baseline.";
  }

  return `File topology ${drift.severity} drift detected: directories(+${drift.directories.added.length}/-${drift.directories.removed.length}), importantFiles(+${drift.importantFiles.added.length}/-${drift.importantFiles.removed.length}), anchorsChanged=${drift.anchorsChanged.length}, classificationsChanged=${drift.classificationsChanged.length}, rulesChanged=${drift.rulesChanged.length}.`;
}

export function buildBuilderFileTopologyRecommendations(args: {
  baseline: BuilderFileTopologyContractBaselineState | null;
  drift: BuilderFileTopologyContractDriftState | null;
}): string[] {
  if (!args.baseline) {
    return [
      "Capture the current filesystem shape as the accepted file topology contract before broad structural work.",
      "Treat Builder-managed projection paths under .builder as reserved derived output, not primary source structure.",
    ];
  }

  if (!args.drift || !args.drift.changed) {
    return [
      "Keep new routes, shared runtime helpers, UI modules, tests, and scripts inside the established topology anchors unless the task explicitly changes topology policy.",
      "If the project structure intentionally changes, resolve file topology drift through the sanctioned Builder command instead of letting the baseline silently rot.",
    ];
  }

  const recommendations = [
    "Review structural changes as placement policy, not as incidental file churn, before approving the new topology baseline.",
  ];
  if (args.drift.anchorsChanged.length > 0) {
    recommendations.push("Anchor changes such as moving app, lib, or test roots should be treated as explicit architecture decisions.");
  }
  if (args.drift.directories.added.length > 0) {
    recommendations.push("Avoid approving new top-level or parallel namespace folders unless the task explicitly intends to change project structure.");
  }
  if (args.drift.importantFiles.added.length > 0 || args.drift.importantFiles.removed.length > 0) {
    recommendations.push("Reconfirm the canonical placement of root config and anchor files before rolling the topology baseline forward.");
  }
  if (args.drift.rulesChanged.length > 0 || args.drift.classificationsChanged.length > 0) {
    recommendations.push("Treat placement-rule or classification changes as Living ADR updates, not a side effect of file creation.");
  }
  return recommendations;
}