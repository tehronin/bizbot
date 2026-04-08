import type { BuilderProject } from "@prisma/client";
import { hashCanonicalBuilderJsonValue } from "@/lib/builder/canonical-json";
import { resolveBuilderFileTopologyContractDrift, summarizeBuilderFileTopologyDrift, buildBuilderFileTopologyRecommendations } from "@/lib/builder/file-topology-diff";
import { buildBuilderFileTopologyPlacementGuidance } from "@/lib/builder/file-topology-render";
import { updateBuilderProject } from "@/lib/builder/projects";
import {
  normalizeBuilderProjectContext,
  type BuilderFileTopologyContractBaselineState,
  type BuilderFileTopologyContractDriftState,
  type BuilderFileTopologyContractSnapshotState,
  type BuilderFileTopologyPlanningContextState,
  type BuilderProjectContextState,
  type BuilderRelevantFileTopologyContextState,
} from "@/lib/builder/types";
import { listBuilderFiles } from "@/lib/builder/workspace";
import { promoteBuilderArchitecturalDecisionsToOntology } from "@/lib/ontology/promotion";

const BUILDER_FILE_TOPOLOGY_CONTRACT_VERSION = 1;
const IGNORED_PATH_PREFIXES = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  "test-results",
  "workspace",
  "src-tauri/target",
] as const;
const IMPORTANT_FILE_CANDIDATES = [
  "AGENTS.md",
  "README.md",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "prisma/schema.prisma",
  "src/app/layout.tsx",
  "src/app/page.tsx",
  "src/app/globals.css",
  "src-tauri/tauri.conf.json",
] as const;
const ROOT_DIRECTORY_ALLOWLIST = new Set([
  "src",
  "tests",
  "scripts",
  "prisma",
  "src-tauri",
  "public",
  "docs",
  ".builder",
]);

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function normalizePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/").replace(/\/$/, "");
}

function trimProjectPrefix(entryPath: string, projectRelativePath: string): string {
  const normalizedProjectPath = normalizePath(projectRelativePath);
  const normalizedEntryPath = normalizePath(entryPath);
  if (!normalizedProjectPath || normalizedProjectPath === ".") {
    return normalizedEntryPath;
  }
  return normalizedEntryPath.startsWith(`${normalizedProjectPath}/`)
    ? normalizedEntryPath.slice(normalizedProjectPath.length + 1)
    : normalizedEntryPath === normalizedProjectPath
      ? "."
      : normalizedEntryPath;
}

function isIgnoredTopologyPath(projectRelativePath: string): boolean {
  if (!projectRelativePath || projectRelativePath === ".") {
    return false;
  }
  if (projectRelativePath === ".builder") {
    return false;
  }
  if (projectRelativePath.startsWith(".builder/")) {
    return true;
  }
  if (projectRelativePath.endsWith(".tsbuildinfo")) {
    return true;
  }
  return IGNORED_PATH_PREFIXES.some((prefix) => projectRelativePath === prefix || projectRelativePath.startsWith(`${prefix}/`));
}

function firstSegment(relativePath: string): string {
  return relativePath.split("/")[0] ?? relativePath;
}

function hasDirectory(directories: Set<string>, files: Set<string>, relativePath: string): boolean {
  return directories.has(relativePath) || Array.from(files).some((entry) => entry.startsWith(`${relativePath}/`));
}

function collectBuilderFileTopologySnapshot(projectRelativePath: string): {
  directories: string[];
  files: string[];
} {
  const queue = [projectRelativePath];
  const directories = new Set<string>();
  const files = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    const entries = listBuilderFiles(current).sort((left, right) => left.path.localeCompare(right.path));

    for (const entry of entries) {
      const projectPath = trimProjectPrefix(entry.path, projectRelativePath);
      if (projectPath === "." || isIgnoredTopologyPath(projectPath)) {
        continue;
      }

      if (entry.type === "directory") {
        directories.add(projectPath);
        if (projectPath !== ".builder") {
          queue.push(entry.path);
        }
        continue;
      }

      files.add(projectPath);
    }
  }

  return {
    directories: uniqueSorted(Array.from(directories)),
    files: uniqueSorted(Array.from(files)),
  };
}

function buildAnchors(directories: Set<string>, files: Set<string>): BuilderFileTopologyContractSnapshotState["anchors"] {
  const anchorIfPresent = (value: string): string | null => hasDirectory(directories, files, value) ? value : null;
  return {
    appRoot: anchorIfPresent("src/app"),
    libRoot: anchorIfPresent("src/lib"),
    componentsRoot: anchorIfPresent("src/components"),
    testsRoot: anchorIfPresent("tests"),
    scriptsRoot: anchorIfPresent("scripts"),
    prismaRoot: anchorIfPresent("prisma"),
    tauriRoot: anchorIfPresent("src-tauri"),
    builderProjectionRoot: ".builder",
  };
}

function buildImportantFiles(files: string[]): string[] {
  const fileSet = new Set(files);
  return IMPORTANT_FILE_CANDIDATES.filter((candidate) => fileSet.has(candidate));
}

function buildTopLevelEntries(directories: string[], files: string[]): string[] {
  return uniqueSorted([
    ...directories.map(firstSegment),
    ...files.filter((entry) => !entry.includes("/")).map(firstSegment),
  ]);
}

function buildClassifications(args: {
  directories: string[];
  files: string[];
  topLevel: string[];
  anchors: BuilderFileTopologyContractSnapshotState["anchors"];
}): BuilderFileTopologyContractSnapshotState["classifications"] {
  const topLevelDirectories = uniqueSorted(args.directories.filter((entry) => !entry.includes("/")).map(firstSegment));
  const unexpectedTopLevelDirectories = topLevelDirectories.filter((entry) => !ROOT_DIRECTORY_ALLOWLIST.has(entry) && !entry.startsWith("."));

  return {
    usesSrcRoot: args.topLevel.includes("src"),
    usesNextAppRouter: Boolean(args.anchors.appRoot),
    usesTestsRoot: Boolean(args.anchors.testsRoot),
    usesScriptsRoot: Boolean(args.anchors.scriptsRoot),
    usesDesktopShell: Boolean(args.anchors.tauriRoot),
    rootMinimal: unexpectedTopLevelDirectories.length === 0,
  };
}

function buildRules(snapshot: Omit<BuilderFileTopologyContractSnapshotState, "rules">): BuilderFileTopologyContractSnapshotState["rules"] {
  return {
    preferSrcLib: Boolean(snapshot.anchors.libRoot) || snapshot.classifications.usesSrcRoot,
    preferSrcComponents: Boolean(snapshot.anchors.componentsRoot) || snapshot.classifications.usesNextAppRouter,
    discourageTopLevelFeatureFolders: snapshot.classifications.usesSrcRoot || snapshot.classifications.rootMinimal,
    reserveBuilderProjectionPaths: true,
  };
}

export function buildCurrentBuilderFileTopologyContractSnapshot(args: {
  projectRelativePath: string;
}): BuilderFileTopologyContractSnapshotState {
  const collected = collectBuilderFileTopologySnapshot(args.projectRelativePath);
  const directorySet = new Set(collected.directories);
  const fileSet = new Set(collected.files);
  const anchors = buildAnchors(directorySet, fileSet);
  const topLevel = buildTopLevelEntries(collected.directories, collected.files);
  const snapshotWithoutRules = {
    root: "." as const,
    topLevel,
    anchors,
    directories: collected.directories,
    importantFiles: buildImportantFiles(collected.files),
    classifications: buildClassifications({
      directories: collected.directories,
      files: collected.files,
      topLevel,
      anchors,
    }),
  };

  return {
    ...snapshotWithoutRules,
    rules: buildRules(snapshotWithoutRules),
  };
}

export function hashBuilderFileTopologyContractSnapshot(snapshot: BuilderFileTopologyContractSnapshotState): string {
  return hashCanonicalBuilderJsonValue(snapshot);
}

export function deriveBuilderFileTopologyDecisionKeys(snapshot: BuilderFileTopologyContractSnapshotState): string[] {
  const decisionKeys: string[] = [];
  if (snapshot.classifications.usesNextAppRouter) {
    decisionKeys.push("project_shape_next_app_router");
  }
  if (snapshot.classifications.usesSrcRoot) {
    decisionKeys.push("file_topology_src_root");
  }
  if (snapshot.rules.preferSrcLib) {
    decisionKeys.push("file_topology_src_lib_preferred");
  }
  if (snapshot.rules.preferSrcComponents) {
    decisionKeys.push("file_topology_src_components_preferred");
  }
  if (snapshot.classifications.usesTestsRoot) {
    decisionKeys.push("file_topology_tests_root_namespace");
  }
  if (snapshot.classifications.usesScriptsRoot) {
    decisionKeys.push("file_topology_scripts_root_namespace");
  }
  if (snapshot.anchors.prismaRoot) {
    decisionKeys.push("file_topology_prisma_root_namespace");
  }
  if (snapshot.classifications.usesDesktopShell) {
    decisionKeys.push("file_topology_tauri_namespace");
  }
  if (snapshot.rules.reserveBuilderProjectionPaths) {
    decisionKeys.push("file_topology_builder_projection_reserved");
  }
  if (snapshot.classifications.rootMinimal) {
    decisionKeys.push("file_topology_root_minimal");
  }
  return uniqueSorted(decisionKeys);
}

export function buildBuilderFileTopologyContractBaseline(args: {
  snapshot: BuilderFileTopologyContractSnapshotState;
}): BuilderFileTopologyContractBaselineState {
  return {
    version: BUILDER_FILE_TOPOLOGY_CONTRACT_VERSION,
    expectedHash: hashBuilderFileTopologyContractSnapshot(args.snapshot),
    decisionKeys: deriveBuilderFileTopologyDecisionKeys(args.snapshot),
    snapshot: args.snapshot,
    updatedAt: new Date().toISOString(),
  };
}

export function getBuilderFileTopologyPlanningContext(args: {
  projectRelativePath: string;
  context: unknown;
}): BuilderFileTopologyPlanningContextState {
  const snapshot = buildCurrentBuilderFileTopologyContractSnapshot({
    projectRelativePath: args.projectRelativePath,
  });
  const currentHash = hashBuilderFileTopologyContractSnapshot(snapshot);
  const context = normalizeBuilderProjectContext(args.context);
  const baseline = context.fileTopologyContract ?? null;
  const drift = resolveBuilderFileTopologyContractDrift({
    previousHash: baseline?.expectedHash ?? null,
    currentHash,
    previousSnapshot: baseline?.snapshot ?? null,
    currentSnapshot: snapshot,
  });

  return {
    baselineHash: baseline?.expectedHash ?? null,
    currentHash,
    driftDetected: !baseline || drift.changed,
    relatedArchitectureDecisionKeys: uniqueSorted([
      ...(baseline?.decisionKeys ?? []),
      ...deriveBuilderFileTopologyDecisionKeys(snapshot),
    ]),
    anchors: snapshot.anchors,
    topLevel: snapshot.topLevel,
    placementGuidance: buildBuilderFileTopologyPlacementGuidance(snapshot),
    recommendations: buildBuilderFileTopologyRecommendations({
      baseline,
      drift: baseline ? drift : null,
    }),
    summary: summarizeBuilderFileTopologyDrift(baseline ? drift : null),
    drift: baseline ? drift : null,
  };
}

export function selectRelevantBuilderFileTopologyContext(args: {
  projectRelativePath: string;
  reasons: string[];
}): BuilderRelevantFileTopologyContextState {
  const snapshot = buildCurrentBuilderFileTopologyContractSnapshot({
    projectRelativePath: args.projectRelativePath,
  });

  return {
    currentHash: hashBuilderFileTopologyContractSnapshot(snapshot),
    anchors: snapshot.anchors,
    topLevel: snapshot.topLevel,
    placementGuidance: buildBuilderFileTopologyPlacementGuidance(snapshot),
    reasons: uniqueSorted(args.reasons),
  };
}

async function persistBuilderFileTopologyContractBaseline(args: {
  project: Pick<BuilderProject, "id" | "context">;
  baseline: BuilderFileTopologyContractBaselineState;
  sourceRef: string;
}): Promise<BuilderProjectContextState> {
  const currentContext = normalizeBuilderProjectContext(args.project.context);
  const previousDecisionKeys = currentContext.fileTopologyContract?.decisionKeys ?? [];
  await promoteBuilderArchitecturalDecisionsToOntology({
    projectId: args.project.id,
    sourceRef: args.sourceRef,
    decisionKeys: args.baseline.decisionKeys,
    staleKeys: previousDecisionKeys.filter((key) => !args.baseline.decisionKeys.includes(key)),
  });

  const nextContext = {
    ...currentContext,
    fileTopologyContract: args.baseline,
  };
  await updateBuilderProject(args.project.id, {
    context: nextContext as never,
  });
  return nextContext;
}

export class BuilderFileTopologyContractDriftError extends Error {
  readonly projectId: string;
  readonly runId: string;
  readonly drift: BuilderFileTopologyContractDriftState;

  constructor(args: {
    projectId: string;
    runId: string;
    drift: BuilderFileTopologyContractDriftState;
  }) {
    super(`Builder file topology contract drift detected for run ${args.runId}. Resolve the drift before continuing execution.`);
    this.name = "BuilderFileTopologyContractDriftError";
    this.projectId = args.projectId;
    this.runId = args.runId;
    this.drift = args.drift;
  }
}

export async function ensureBuilderRunFileTopologySnapshotPreflight(args: {
  project: Pick<BuilderProject, "id" | "relativePath" | "context">;
  runId: string;
}): Promise<{
  status: "captured" | "aligned";
  baseline: BuilderFileTopologyContractBaselineState;
  drift: BuilderFileTopologyContractDriftState | null;
}> {
  const snapshot = buildCurrentBuilderFileTopologyContractSnapshot({
    projectRelativePath: args.project.relativePath,
  });
  const currentHash = hashBuilderFileTopologyContractSnapshot(snapshot);
  const currentContext = normalizeBuilderProjectContext(args.project.context);
  const baseline = currentContext.fileTopologyContract ?? null;

  if (!baseline) {
    const acceptedBaseline = buildBuilderFileTopologyContractBaseline({ snapshot });
    await persistBuilderFileTopologyContractBaseline({
      project: args.project,
      baseline: acceptedBaseline,
      sourceRef: `builder:${args.project.id}:run:${args.runId}:file_topology_capture`,
    });
    return {
      status: "captured",
      baseline: acceptedBaseline,
      drift: null,
    };
  }

  const drift = resolveBuilderFileTopologyContractDrift({
    previousHash: baseline.expectedHash,
    currentHash,
    previousSnapshot: baseline.snapshot,
    currentSnapshot: snapshot,
  });
  if (drift.changed) {
    throw new BuilderFileTopologyContractDriftError({
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

export async function resolveBuilderRunFileTopologyContractDrift(args: {
  project: Pick<BuilderProject, "id" | "relativePath" | "context">;
  runId: string;
  decision: "approve" | "reject";
  reason?: string;
}): Promise<{
  status: "captured" | "aligned" | "approved" | "rejected";
  baseline: BuilderFileTopologyContractBaselineState | null;
  currentHash: string;
  drift: BuilderFileTopologyContractDriftState | null;
  reason?: string;
}> {
  const snapshot = buildCurrentBuilderFileTopologyContractSnapshot({
    projectRelativePath: args.project.relativePath,
  });
  const currentHash = hashBuilderFileTopologyContractSnapshot(snapshot);
  const currentContext = normalizeBuilderProjectContext(args.project.context);
  const baseline = currentContext.fileTopologyContract ?? null;

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

    const acceptedBaseline = buildBuilderFileTopologyContractBaseline({ snapshot });
    await persistBuilderFileTopologyContractBaseline({
      project: args.project,
      baseline: acceptedBaseline,
      sourceRef: `builder:${args.project.id}:run:${args.runId}:file_topology_capture`,
    });
    return {
      status: "captured",
      baseline: acceptedBaseline,
      currentHash,
      drift: null,
      reason: args.reason,
    };
  }

  const drift = resolveBuilderFileTopologyContractDrift({
    previousHash: baseline.expectedHash,
    currentHash,
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

  const acceptedBaseline = buildBuilderFileTopologyContractBaseline({ snapshot });
  await persistBuilderFileTopologyContractBaseline({
    project: args.project,
    baseline: acceptedBaseline,
    sourceRef: `builder:${args.project.id}:run:${args.runId}:file_topology_resolution`,
  });
  return {
    status: "approved",
    baseline: acceptedBaseline,
    currentHash,
    drift,
    reason: args.reason,
  };
}