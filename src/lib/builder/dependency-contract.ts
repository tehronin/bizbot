import crypto from "crypto";
import type { BuilderPackageManager, BuilderProject } from "@prisma/client";
import { hashCanonicalBuilderJsonValue } from "@/lib/builder/canonical-json";
import { updateBuilderProject } from "@/lib/builder/projects";
import {
  normalizeBuilderProjectContext,
  type BuilderContractDriftSeverity,
  type BuilderDependencyClassificationState,
  type BuilderDependencyContractBaselineState,
  type BuilderDependencyContractDriftState,
  type BuilderDependencyContractSnapshotState,
  type BuilderDependencyPlanningContextState,
  type BuilderDependencyScriptEntry,
  type BuilderDependencyPackageEntry,
  type BuilderProjectContextState,
  type BuilderRelevantDependencyContextState,
} from "@/lib/builder/types";
import { readBuilderFile } from "@/lib/builder/workspace";
import { promoteBuilderArchitecturalDecisionsToOntology } from "@/lib/ontology/promotion";

const BUILDER_DEPENDENCY_CONTRACT_VERSION = 1;

const DIRECT_DEPENDENCY_SECTIONS = [
  ["dependencies", "runtime"],
  ["devDependencies", "dev"],
  ["optionalDependencies", "optional"],
  ["peerDependencies", "peer"],
] as const satisfies ReadonlyArray<readonly [string, BuilderDependencyPackageEntry["kind"]]>;

const CLASSIFICATION_RULES = {
  framework: ["next", "vite", "express"],
  ui: ["react", "react-dom", "tailwindcss"],
  database: ["prisma", "@prisma/client", "better-sqlite3", "sqlite3"],
  mcp: ["@modelcontextprotocol/sdk"],
  queue: ["bullmq"],
  desktop: ["@tauri-apps/api", "@tauri-apps/cli"],
  validation: ["zod"],
  graph: ["neo4j-driver"],
  ai: ["openai", "@anthropic-ai/sdk", "@google/genai"],
} satisfies Record<keyof BuilderDependencyClassificationState, string[]>;

type SupportedPackageJson = {
  name?: string;
  version?: string;
  private?: boolean;
  type?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

type SupportedPackageLock = {
  lockfileVersion?: number;
  packages?: Record<string, { version?: string }>;
  dependencies?: Record<string, { version?: string }>;
};

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function readOptionalBuilderFile(relativePath: string): string | null {
  try {
    return readBuilderFile(relativePath);
  } catch {
    return null;
  }
}

function readOptionalBuilderJson<T>(relativePath: string): T | null {
  const source = readOptionalBuilderFile(relativePath);
  if (!source) {
    return null;
  }

  try {
    return JSON.parse(source) as T;
  } catch {
    return null;
  }
}

function toDependencyPackageManager(packageManager: BuilderPackageManager): "npm" | "pnpm" {
  return packageManager === "PNPM" ? "pnpm" : "npm";
}

function hashText(source: string | null): string | null {
  if (!source) {
    return null;
  }
  return crypto.createHash("sha256").update(source).digest("hex");
}

function resolveDirectDependencyVersion(name: string, packageLock: SupportedPackageLock | null): string | null {
  if (!packageLock) {
    return null;
  }

  const packageEntry = packageLock.packages?.[`node_modules/${name}`];
  if (packageEntry && typeof packageEntry.version === "string" && packageEntry.version.trim()) {
    return packageEntry.version.trim();
  }

  const dependencyEntry = packageLock.dependencies?.[name];
  if (dependencyEntry && typeof dependencyEntry.version === "string" && dependencyEntry.version.trim()) {
    return dependencyEntry.version.trim();
  }

  return null;
}

function classifyPackages(packageNames: string[]): BuilderDependencyClassificationState {
  const names = new Set(packageNames);
  return {
    framework: CLASSIFICATION_RULES.framework.filter((value) => names.has(value)),
    ui: CLASSIFICATION_RULES.ui.filter((value) => names.has(value)),
    database: CLASSIFICATION_RULES.database.filter((value) => names.has(value)),
    mcp: CLASSIFICATION_RULES.mcp.filter((value) => names.has(value)),
    queue: CLASSIFICATION_RULES.queue.filter((value) => names.has(value)),
    desktop: CLASSIFICATION_RULES.desktop.filter((value) => names.has(value)),
    validation: CLASSIFICATION_RULES.validation.filter((value) => names.has(value)),
    graph: CLASSIFICATION_RULES.graph.filter((value) => names.has(value)),
    ai: CLASSIFICATION_RULES.ai.filter((value) => names.has(value)),
  };
}

function collectPackageEntries(packageJson: SupportedPackageJson, packageLock: SupportedPackageLock | null): BuilderDependencyPackageEntry[] {
  const entries = DIRECT_DEPENDENCY_SECTIONS.flatMap(([sectionName, kind]) => {
    const section = packageJson[sectionName as keyof SupportedPackageJson];
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      return [];
    }

    return Object.entries(section)
      .filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string")
      .map(([name, range]) => ({
        name: name.trim(),
        kind,
        range: range.trim(),
        resolvedVersion: resolveDirectDependencyVersion(name.trim(), packageLock),
      }))
      .filter((entry) => entry.name && entry.range);
  });

  return entries.sort((left, right) => left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind));
}

function collectScripts(packageJson: SupportedPackageJson): BuilderDependencyScriptEntry[] {
  const scripts = packageJson.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    return [];
  }

  return Object.entries(scripts)
    .filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string")
    .map(([name, command]) => ({ name: name.trim(), command: command.trim() }))
    .filter((entry) => entry.name && entry.command)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function buildCurrentBuilderDependencyContractSnapshot(args: {
  projectRelativePath: string;
  packageManager: BuilderPackageManager;
}): BuilderDependencyContractSnapshotState | null {
  const packageJson = readOptionalBuilderJson<SupportedPackageJson>(`${args.projectRelativePath}/package.json`);
  if (!packageJson) {
    return null;
  }

  const packageManager = toDependencyPackageManager(args.packageManager);
  const packageLockPath = `${args.projectRelativePath}/package-lock.json`;
  const pnpmLockPath = `${args.projectRelativePath}/pnpm-lock.yaml`;
  const packageLockSource = packageManager === "npm" ? readOptionalBuilderFile(packageLockPath) : null;
  const packageLock = packageLockSource ? readOptionalBuilderJson<SupportedPackageLock>(packageLockPath) : null;
  const pnpmLockSource = packageManager === "pnpm" ? readOptionalBuilderFile(pnpmLockPath) : null;
  const packages = collectPackageEntries(packageJson, packageLock);

  return {
    packageManager,
    manifest: {
      name: typeof packageJson.name === "string" && packageJson.name.trim() ? packageJson.name.trim() : null,
      version: typeof packageJson.version === "string" && packageJson.version.trim() ? packageJson.version.trim() : null,
      private: packageJson.private === true,
      type: typeof packageJson.type === "string" && packageJson.type.trim() ? packageJson.type.trim() : null,
    },
    scripts: collectScripts(packageJson),
    packages,
    lockfile: {
      path: packageManager === "npm"
        ? packageLockSource ? "package-lock.json" : null
        : pnpmLockSource ? "pnpm-lock.yaml" : null,
      present: packageManager === "npm" ? Boolean(packageLockSource) : Boolean(pnpmLockSource),
      lockfileVersion: packageManager === "npm" && packageLock && typeof packageLock.lockfileVersion === "number" && Number.isFinite(packageLock.lockfileVersion)
        ? Math.trunc(packageLock.lockfileVersion)
        : null,
      contentHash: packageManager === "npm" ? hashText(packageLockSource) : hashText(pnpmLockSource),
    },
    classifications: classifyPackages(packages.map((entry) => entry.name)),
  };
}

export function hashBuilderDependencyContractSnapshot(snapshot: BuilderDependencyContractSnapshotState): string {
  return hashCanonicalBuilderJsonValue(snapshot);
}

function compareNamedMaps(previousValues: Map<string, string>, currentValues: Map<string, string>): {
  added: string[];
  removed: string[];
  changed: string[];
} {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const names = uniqueSorted([...previousValues.keys(), ...currentValues.keys()]);

  for (const name of names) {
    const previous = previousValues.get(name);
    const current = currentValues.get(name);
    if (previous === undefined && current !== undefined) {
      added.push(name);
      continue;
    }
    if (previous !== undefined && current === undefined) {
      removed.push(name);
      continue;
    }
    if (previous !== current) {
      changed.push(name);
    }
  }

  return { added, removed, changed };
}

function classifyBuilderDependencyContractDrift(args: {
  changed: boolean;
  packageManagerChanged: boolean;
  lockfileChanged: boolean;
  packages: BuilderDependencyContractDriftState["packages"];
  scripts: BuilderDependencyContractDriftState["scripts"];
}): { severity: BuilderContractDriftSeverity; reasons: string[] } {
  if (!args.changed) {
    return {
      severity: "benign",
      reasons: ["Current dependency contract matches the accepted Builder baseline."],
    };
  }

  const reasons: string[] = [];
  let severity: BuilderContractDriftSeverity = "benign";

  if (args.packageManagerChanged) {
    severity = "breaking";
    reasons.push("Package manager changed from the accepted dependency baseline.");
  }
  if (args.packages.removed.length > 0) {
    severity = "breaking";
    reasons.push("Direct dependencies were removed from the accepted baseline.");
  }
  if (args.packages.reclassified.length > 0) {
    severity = "breaking";
    reasons.push("Dependency kinds moved across runtime, dev, peer, or optional boundaries.");
  }
  if (severity !== "breaking" && (args.packages.added.length > 0 || args.packages.changed.length > 0 || args.scripts.removed.length > 0 || args.scripts.changed.length > 0)) {
    severity = "notable";
  }
  if (args.packages.added.length > 0) {
    reasons.push("Direct dependency additions may change the project runtime or toolchain surface.");
  }
  if (args.packages.changed.length > 0) {
    reasons.push("Existing dependency ranges or resolved versions changed.");
  }
  if (args.scripts.removed.length > 0 || args.scripts.changed.length > 0) {
    reasons.push("Existing package scripts changed and may affect verification or runtime workflows.");
  }
  if (args.scripts.added.length > 0) {
    reasons.push("New package scripts were added.");
  }
  if (args.lockfileChanged && reasons.length === 0) {
    reasons.push("Only the lockfile changed relative to the accepted dependency baseline.");
  } else if (args.lockfileChanged) {
    reasons.push("The lockfile also changed and should stay aligned with manifest intent.");
  }

  return { severity, reasons };
}

export function resolveBuilderDependencyContractDrift(args: {
  previousSnapshot: BuilderDependencyContractSnapshotState | null;
  currentSnapshot: BuilderDependencyContractSnapshotState;
}): BuilderDependencyContractDriftState {
  const previousHash = args.previousSnapshot ? hashBuilderDependencyContractSnapshot(args.previousSnapshot) : null;
  const currentHash = hashBuilderDependencyContractSnapshot(args.currentSnapshot);
  const previousPackages = new Map((args.previousSnapshot?.packages ?? []).map((entry) => [entry.name, entry]));
  const currentPackages = new Map(args.currentSnapshot.packages.map((entry) => [entry.name, entry]));
  const packageNames = uniqueSorted([...previousPackages.keys(), ...currentPackages.keys()]);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const reclassified: string[] = [];

  for (const name of packageNames) {
    const previous = previousPackages.get(name);
    const current = currentPackages.get(name);
    if (!previous && current) {
      added.push(name);
      continue;
    }
    if (previous && !current) {
      removed.push(name);
      continue;
    }
    if (!previous || !current) {
      continue;
    }
    if (previous.kind !== current.kind) {
      reclassified.push(`${name}: ${previous.kind} -> ${current.kind}`);
    }
    if (previous.range !== current.range || previous.resolvedVersion !== current.resolvedVersion) {
      changed.push(name);
    }
  }

  const previousScripts = new Map((args.previousSnapshot?.scripts ?? []).map((entry) => [entry.name, entry.command]));
  const currentScripts = new Map(args.currentSnapshot.scripts.map((entry) => [entry.name, entry.command]));
  const scriptDrift = compareNamedMaps(previousScripts, currentScripts);
  const packageManagerChanged = (args.previousSnapshot?.packageManager ?? args.currentSnapshot.packageManager) !== args.currentSnapshot.packageManager;
  const lockfileChanged = !args.previousSnapshot
    ? false
    : args.previousSnapshot.lockfile.present !== args.currentSnapshot.lockfile.present
      || args.previousSnapshot.lockfile.path !== args.currentSnapshot.lockfile.path
      || args.previousSnapshot.lockfile.lockfileVersion !== args.currentSnapshot.lockfile.lockfileVersion
      || args.previousSnapshot.lockfile.contentHash !== args.currentSnapshot.lockfile.contentHash;
  const driftChanged = previousHash !== null && previousHash !== currentHash;
  const classification = classifyBuilderDependencyContractDrift({
    changed: driftChanged,
    packageManagerChanged,
    lockfileChanged,
    packages: {
      added,
      removed,
      changed,
      reclassified,
    },
    scripts: scriptDrift,
  });

  return {
    previousHash,
    currentHash,
    changed: driftChanged,
    severity: classification.severity,
    reasons: classification.reasons,
    packageManagerChanged,
    lockfileChanged,
    packages: {
      added,
      removed,
      changed,
      reclassified,
    },
    scripts: scriptDrift,
  };
}

export function deriveBuilderDependencyContractDecisionKeys(args: {
  packageManager: BuilderPackageManager;
  snapshot: BuilderDependencyContractSnapshotState;
}): string[] {
  const packages = new Set(args.snapshot.packages.map((entry) => entry.name));
  const decisionKeys = [
    "dependency_contract_preflight_required",
    args.packageManager === "PNPM" ? "dependency_manager_pnpm" : "dependency_manager_npm",
  ];

  if (args.snapshot.lockfile.present) {
    decisionKeys.push("dependency_lockfile_required");
  }
  if (packages.has("next")) {
    decisionKeys.push("framework_next");
  }
  if (packages.has("vite")) {
    decisionKeys.push("framework_vite");
  }
  if (packages.has("react") || packages.has("react-dom")) {
    decisionKeys.push("ui_react");
  }
  if (packages.has("prisma") || packages.has("@prisma/client")) {
    decisionKeys.push("orm_prisma");
  }
  if (packages.has("@modelcontextprotocol/sdk")) {
    decisionKeys.push("mcp_sdk");
  }
  if (packages.has("bullmq")) {
    decisionKeys.push("queue_bullmq");
  }
  if (packages.has("@tauri-apps/api") || packages.has("@tauri-apps/cli")) {
    decisionKeys.push("desktop_tauri");
  }
  if (packages.has("zod")) {
    decisionKeys.push("validation_zod");
  }
  if (packages.has("neo4j-driver")) {
    decisionKeys.push("graph_neo4j_driver");
  }

  return uniqueSorted(decisionKeys);
}

export function buildBuilderDependencyContractBaseline(args: {
  packageManager: BuilderPackageManager;
  snapshot: BuilderDependencyContractSnapshotState;
}): BuilderDependencyContractBaselineState {
  return {
    version: BUILDER_DEPENDENCY_CONTRACT_VERSION,
    expectedHash: hashBuilderDependencyContractSnapshot(args.snapshot),
    packageManager: toDependencyPackageManager(args.packageManager),
    decisionKeys: deriveBuilderDependencyContractDecisionKeys(args),
    snapshot: args.snapshot,
    updatedAt: new Date().toISOString(),
  };
}

function summarizeDependencyDrift(drift: BuilderDependencyContractDriftState | null): string {
  if (!drift) {
    return "No accepted dependency contract baseline exists yet. Builder will capture it when the project is ready to advance.";
  }
  if (!drift.changed) {
    return "Current dependency contract matches the accepted Builder baseline.";
  }
  return `Dependency contract ${drift.severity} drift detected: packages(+${drift.packages.added.length}/-${drift.packages.removed.length}/~${drift.packages.changed.length}/reclass ${drift.packages.reclassified.length}), scripts(+${drift.scripts.added.length}/-${drift.scripts.removed.length}/~${drift.scripts.changed.length}), lockfileChanged=${drift.lockfileChanged}, packageManagerChanged=${drift.packageManagerChanged}.`;
}

function buildDependencyRecommendations(args: {
  baseline: BuilderDependencyContractBaselineState | null;
  drift: BuilderDependencyContractDriftState | null;
  currentSnapshot: BuilderDependencyContractSnapshotState;
  packageManager: BuilderPackageManager;
}): string[] {
  if (!args.baseline) {
    return [
      "Capture the current package manifest and lockfile as the accepted dependency contract before broad package changes.",
      "Promote architecture keys from the accepted dependency baseline instead of treating package churn as incidental.",
    ];
  }

  if (!args.drift || !args.drift.changed) {
    return [
      "Keep package.json scripts and direct dependencies aligned with the accepted dependency contract unless the task explicitly changes dependency policy.",
      "If package policy legitimately changes, resolve dependency contract drift through the sanctioned Builder command instead of hand-waving the delta.",
    ];
  }

  const recommendations = [
    "Review package.json and the active lockfile together; approve dependency drift only when both surfaces reflect the intended change.",
  ];
  if (args.drift.packages.added.length > 0 || args.drift.packages.removed.length > 0) {
    recommendations.push("Reconfirm the architecture decisions implied by direct package additions and removals before continuing implementation.");
  }
  if (args.drift.packages.reclassified.length > 0) {
    recommendations.push("Treat dependency reclassification across runtime/dev/peer/optional boundaries as an architecture change, not a cosmetic edit.");
  }
  if (args.drift.lockfileChanged) {
    recommendations.push("Keep the lockfile deterministic and regenerated by the configured package manager before approval.");
  }
  if (args.drift.packageManagerChanged) {
    recommendations.push(`Do not silently switch package manager away from ${toDependencyPackageManager(args.packageManager)} without an explicit Builder command and contract rollover.`);
  }
  return recommendations;
}

function selectHighlightedPackages(snapshot: BuilderDependencyContractSnapshotState): string[] {
  const highlighted = [
    ...snapshot.classifications.framework,
    ...snapshot.classifications.ui,
    ...snapshot.classifications.database,
    ...snapshot.classifications.mcp,
    ...snapshot.classifications.queue,
    ...snapshot.classifications.desktop,
    ...snapshot.classifications.validation,
    ...snapshot.classifications.graph,
    ...snapshot.classifications.ai,
  ];

  if (highlighted.length > 0) {
    return uniqueSorted(highlighted).slice(0, 8);
  }

  return snapshot.packages.map((entry) => entry.name).slice(0, 8);
}

export function getBuilderDependencyPlanningContext(args: {
  projectRelativePath: string;
  packageManager: BuilderPackageManager;
  context: unknown;
}): BuilderDependencyPlanningContextState | null {
  const snapshot = buildCurrentBuilderDependencyContractSnapshot({
    projectRelativePath: args.projectRelativePath,
    packageManager: args.packageManager,
  });
  if (!snapshot) {
    return null;
  }

  const context = normalizeBuilderProjectContext(args.context);
  const baseline = context.dependencyContract ?? null;
  const drift = resolveBuilderDependencyContractDrift({
    previousSnapshot: baseline?.snapshot ?? null,
    currentSnapshot: snapshot,
  });

  return {
    baselineHash: baseline?.expectedHash ?? null,
    currentHash: drift.currentHash,
    driftDetected: !baseline || drift.changed,
    severity: baseline ? drift.severity : "baseline",
    packageManager: snapshot.packageManager,
    relatedArchitectureDecisionKeys: uniqueSorted([
      ...(baseline?.decisionKeys ?? []),
      ...deriveBuilderDependencyContractDecisionKeys({ packageManager: args.packageManager, snapshot }),
    ]),
    highlightedPackages: selectHighlightedPackages(snapshot),
    recommendations: buildDependencyRecommendations({
      baseline,
      drift: baseline ? drift : null,
      currentSnapshot: snapshot,
      packageManager: args.packageManager,
    }),
    summary: summarizeDependencyDrift(baseline ? drift : null),
    drift: baseline ? drift : null,
  };
}

export function selectRelevantBuilderDependencyContext(args: {
  projectRelativePath: string;
  packageManager: BuilderPackageManager;
  reasons: string[];
}): BuilderRelevantDependencyContextState | null {
  const snapshot = buildCurrentBuilderDependencyContractSnapshot({
    projectRelativePath: args.projectRelativePath,
    packageManager: args.packageManager,
  });
  if (!snapshot) {
    return null;
  }

  return {
    currentHash: hashBuilderDependencyContractSnapshot(snapshot),
    packageManager: snapshot.packageManager,
    highlightedPackages: selectHighlightedPackages(snapshot),
    classifications: snapshot.classifications,
    reasons: uniqueSorted(args.reasons),
  };
}

async function persistBuilderDependencyContractBaseline(args: {
  project: Pick<BuilderProject, "id" | "relativePath" | "packageManager" | "context">;
  baseline: BuilderDependencyContractBaselineState;
  sourceRef: string;
}): Promise<BuilderProjectContextState> {
  const currentContext = normalizeBuilderProjectContext(args.project.context);
  const previousDecisionKeys = currentContext.dependencyContract?.decisionKeys ?? [];
  await promoteBuilderArchitecturalDecisionsToOntology({
    projectId: args.project.id,
    sourceRef: args.sourceRef,
    decisionKeys: args.baseline.decisionKeys,
    staleKeys: previousDecisionKeys.filter((key) => !args.baseline.decisionKeys.includes(key)),
  });

  const nextContext = {
    ...currentContext,
    dependencyContract: args.baseline,
  };
  await updateBuilderProject(args.project.id, {
    context: nextContext as never,
  });
  return nextContext;
}

export class BuilderDependencyContractDriftError extends Error {
  readonly projectId: string;
  readonly runId: string;
  readonly drift: BuilderDependencyContractDriftState;

  constructor(args: {
    projectId: string;
    runId: string;
    drift: BuilderDependencyContractDriftState;
  }) {
    super(`Builder dependency contract drift detected for run ${args.runId}. Resolve the drift before continuing execution.`);
    this.name = "BuilderDependencyContractDriftError";
    this.projectId = args.projectId;
    this.runId = args.runId;
    this.drift = args.drift;
  }
}

export async function ensureBuilderRunDependencyContractPreflight(args: {
  project: Pick<BuilderProject, "id" | "relativePath" | "packageManager" | "context">;
  runId: string;
}): Promise<{
  status: "skipped" | "captured" | "aligned";
  baseline: BuilderDependencyContractBaselineState | null;
  drift: BuilderDependencyContractDriftState | null;
}> {
  const snapshot = buildCurrentBuilderDependencyContractSnapshot({
    projectRelativePath: args.project.relativePath,
    packageManager: args.project.packageManager,
  });
  if (!snapshot) {
    return {
      status: "skipped",
      baseline: null,
      drift: null,
    };
  }

  const currentContext = normalizeBuilderProjectContext(args.project.context);
  const baseline = currentContext.dependencyContract ?? null;
  if (!baseline) {
    const acceptedBaseline = buildBuilderDependencyContractBaseline({
      packageManager: args.project.packageManager,
      snapshot,
    });
    await persistBuilderDependencyContractBaseline({
      project: args.project,
      baseline: acceptedBaseline,
      sourceRef: `builder:${args.project.id}:run:${args.runId}:dependency_contract_capture`,
    });
    return {
      status: "captured",
      baseline: acceptedBaseline,
      drift: null,
    };
  }

  const drift = resolveBuilderDependencyContractDrift({
    previousSnapshot: baseline.snapshot,
    currentSnapshot: snapshot,
  });
  if (drift.changed) {
    throw new BuilderDependencyContractDriftError({
      projectId: args.project.id,
      runId: args.runId,
      drift,
    });
  }

  return {
    status: "aligned",
    baseline,
    drift,
  };
}

export async function resolveBuilderProjectDependencyContractDrift(args: {
  project: Pick<BuilderProject, "id" | "relativePath" | "packageManager" | "context">;
  runId: string;
  decision: "approve" | "reject";
  reason?: string;
}): Promise<{
  status: "skipped" | "captured" | "aligned" | "approved" | "rejected";
  baseline: BuilderDependencyContractBaselineState | null;
  currentHash: string | null;
  drift: BuilderDependencyContractDriftState | null;
  reason?: string;
}> {
  const snapshot = buildCurrentBuilderDependencyContractSnapshot({
    projectRelativePath: args.project.relativePath,
    packageManager: args.project.packageManager,
  });
  if (!snapshot) {
    return {
      status: "skipped",
      baseline: null,
      currentHash: null,
      drift: null,
      reason: args.reason,
    };
  }

  const currentContext = normalizeBuilderProjectContext(args.project.context);
  const baseline = currentContext.dependencyContract ?? null;
  const currentHash = hashBuilderDependencyContractSnapshot(snapshot);

  if (!baseline) {
    if (args.decision === "reject") {
      return {
        status: "rejected",
        baseline: null,
        currentHash,
        drift: null,
        reason: args.reason,
      };
    }

    const acceptedBaseline = buildBuilderDependencyContractBaseline({
      packageManager: args.project.packageManager,
      snapshot,
    });
    await persistBuilderDependencyContractBaseline({
      project: args.project,
      baseline: acceptedBaseline,
      sourceRef: `builder:${args.project.id}:run:${args.runId}:dependency_contract_capture`,
    });
    return {
      status: "captured",
      baseline: acceptedBaseline,
      currentHash,
      drift: null,
      reason: args.reason,
    };
  }

  const drift = resolveBuilderDependencyContractDrift({
    previousSnapshot: baseline.snapshot,
    currentSnapshot: snapshot,
  });
  if (!drift.changed) {
    return {
      status: "aligned",
      baseline,
      currentHash,
      drift,
      reason: args.reason,
    };
  }

  if (args.decision === "reject") {
    return {
      status: "rejected",
      baseline,
      currentHash,
      drift,
      reason: args.reason,
    };
  }

  const acceptedBaseline = buildBuilderDependencyContractBaseline({
    packageManager: args.project.packageManager,
    snapshot,
  });
  await persistBuilderDependencyContractBaseline({
    project: args.project,
    baseline: acceptedBaseline,
    sourceRef: `builder:${args.project.id}:run:${args.runId}:dependency_contract_resolution`,
  });
  return {
    status: "approved",
    baseline: acceptedBaseline,
    currentHash,
    drift,
    reason: args.reason,
  };
}
