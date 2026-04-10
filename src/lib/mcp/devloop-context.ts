import type { BuilderRun } from "@prisma/client";
import { getCurrentBuilderProjectOverview } from "@/lib/builder/orchestrator";
import { extractBuilderRunTelemetry } from "@/lib/builder/telemetry";

interface DevLoopRunSummary {
  id: string;
  title: string;
  kind: string;
  status: string;
  taskId: string | null;
  startedAt: string;
  finishedAt: string | null;
  blockedReason: string | null;
}

interface DevLoopLatestFailedRun {
  id: string;
  title: string;
  status: string;
  blockedReason: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface BuilderDevLoopErrorSignal {
  activeRunBlockedReason: string | null;
  latestReviewSummary: string | null;
  latestReviewRisks: string[];
  latestFailedRun: DevLoopLatestFailedRun | null;
  trustRuntimeSummary: {
    overallStatus: string;
    overallSummary: string;
    runtimeStatus: string;
    runtimeSummary: string;
  };
}

interface BuilderDevLoopDiagnosticSummary {
  validation: {
    passed: boolean | null;
    skipped: boolean;
    summary: string | null;
    scripts: string[];
    buildSummary: string | null;
    testSummary: string | null;
    lintSummary: string | null;
  };
  contracts: {
    mcpSnapshotState: string;
    dependencyContractState: string;
    fileTopologyContractState: string;
    summary: string;
  };
  reviewFocus: {
    summary: string | null;
    risks: string[];
    nextSteps: string[];
  };
  trustFocus: {
    overallStatus: string;
    runtimeStatus: string;
    governanceStatus: string | null;
    summary: string;
  };
  probeTargets: string[];
}

export interface BuilderDevLoopContext {
  generatedAt: string;
  project: {
    id: string;
    name: string;
    slug: string;
    relativePath: string;
    template: string;
    packageManager: string;
    lifecycle: string;
    updatedAt: string;
  };
  currentTask: unknown | null;
  mcpSnapshot: unknown;
  dependencyContract: unknown;
  fileTopologyContract: unknown;
  latestReview: {
    taskId: string;
    status: string;
    stage: string;
    summary: string;
    risks: string[];
    nextSteps: string[];
    updatedAt: string;
  } | null;
  recentRuns: DevLoopRunSummary[];
  operatorTrust: unknown;
  configReadiness: unknown;
  currentBlockerOrLastErrorSignal: BuilderDevLoopErrorSignal;
  diagnosticSummary: BuilderDevLoopDiagnosticSummary;
}

function readState(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "unknown";
  }

  const state = (value as { state?: unknown }).state;
  return typeof state === "string" ? state : "unknown";
}

function buildProbeTargets(args: {
  mcpSnapshotState: string;
  dependencyContractState: string;
  fileTopologyContractState: string;
  latestReviewSummary: string | null;
  activeRunBlockedReason: string | null;
  validationPassed: boolean | null;
}): string[] {
  const targets: string[] = [];

  if (args.mcpSnapshotState === "drifted") {
    targets.push("Inspect the active Builder MCP contract drift and snapshot baseline.");
  }
  if (args.dependencyContractState === "drifted") {
    targets.push("Inspect the dependency contract drift summary and package manifest changes.");
  }
  if (args.fileTopologyContractState === "drifted") {
    targets.push("Inspect the file topology drift summary and placement-policy changes.");
  }
  if (args.activeRunBlockedReason) {
    targets.push(`Inspect the latest blocked reason: ${args.activeRunBlockedReason}`);
  }
  if (args.latestReviewSummary) {
    targets.push(`Inspect the latest Builder review summary: ${args.latestReviewSummary}`);
  }
  if (args.validationPassed === false) {
    targets.push("Inspect the first failing verification script and the smallest changed file around it.");
  }

  return targets.length > 0 ? targets : ["Inspect the latest Builder review and current runtime trust summary."];
}

function summarizeRun(run: BuilderRun): DevLoopRunSummary {
  const telemetry = extractBuilderRunTelemetry(run);

  return {
    id: run.id,
    title: run.title,
    kind: run.kind,
    status: run.status,
    taskId: run.taskId,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    blockedReason: telemetry.blockedReason,
  };
}

function findLatestFailedRun(runs: BuilderRun[]): DevLoopLatestFailedRun | null {
  const failedRun = runs.find((run) => run.status === "FAILED" || run.status === "CANCELLED");
  if (!failedRun) {
    return null;
  }

  const telemetry = extractBuilderRunTelemetry(failedRun);
  return {
    id: failedRun.id,
    title: failedRun.title,
    status: failedRun.status,
    blockedReason: telemetry.blockedReason,
    startedAt: failedRun.startedAt.toISOString(),
    finishedAt: failedRun.finishedAt?.toISOString() ?? null,
  };
}

export async function buildCurrentBuilderDevLoopContext(): Promise<BuilderDevLoopContext | null> {
  const overview = await getCurrentBuilderProjectOverview();
  if (!overview) {
    return null;
  }

  const recentRuns = overview.runs.slice(0, 5).map(summarizeRun);
  const activeRun = overview.runs.find((run) => run.status === "RUNNING") ?? overview.runs[0] ?? null;
  const activeRunBlockedReason = activeRun ? extractBuilderRunTelemetry(activeRun).blockedReason : null;
  const latestFailedRun = findLatestFailedRun(overview.runs);
  const mcpSnapshotState = readState(overview.mcpSnapshot);
  const dependencyContractState = readState(overview.dependencyContract);
  const fileTopologyContractState = readState(overview.fileTopologyContract);
  const validationSummary = overview.latestReview?.validation;
  const probeTargets = buildProbeTargets({
    mcpSnapshotState,
    dependencyContractState,
    fileTopologyContractState,
    latestReviewSummary: overview.latestReview?.summary ?? null,
    activeRunBlockedReason,
    validationPassed: validationSummary?.passed ?? null,
  });

  return {
    generatedAt: new Date().toISOString(),
    project: {
      id: overview.project.id,
      name: overview.project.name,
      slug: overview.project.slug,
      relativePath: overview.project.relativePath,
      template: overview.project.template,
      packageManager: overview.project.packageManager,
      lifecycle: overview.project.lifecycle,
      updatedAt: overview.project.updatedAt.toISOString(),
    },
    currentTask: overview.currentTask
      ? {
          id: overview.currentTask.id,
          title: overview.currentTask.title,
          status: overview.currentTask.status,
          stage: overview.currentTask.stage,
          updatedAt: overview.currentTask.updatedAt.toISOString(),
        }
      : null,
    mcpSnapshot: overview.mcpSnapshot,
    dependencyContract: overview.dependencyContract,
    fileTopologyContract: overview.fileTopologyContract,
    latestReview: overview.latestReview
      ? {
          taskId: overview.latestReview.taskId,
          status: overview.latestReview.status,
          stage: overview.latestReview.stage,
          summary: overview.latestReview.summary,
          risks: overview.latestReview.risks,
          nextSteps: overview.latestReview.nextSteps,
          updatedAt: overview.latestReview.updatedAt,
        }
      : null,
    recentRuns,
    operatorTrust: overview.operatorTrust,
    configReadiness: overview.configReadiness,
    currentBlockerOrLastErrorSignal: {
      activeRunBlockedReason,
      latestReviewSummary: overview.latestReview?.summary ?? null,
      latestReviewRisks: overview.latestReview?.risks ?? [],
      latestFailedRun,
      trustRuntimeSummary: {
        overallStatus: overview.operatorTrust.overallStatus,
        overallSummary: overview.operatorTrust.summary,
        runtimeStatus: overview.operatorTrust.runtime.status,
        runtimeSummary: overview.operatorTrust.runtime.summary,
      },
    },
    diagnosticSummary: {
      validation: {
        passed: validationSummary?.passed ?? null,
        skipped: validationSummary?.skipped ?? false,
        summary: validationSummary?.summary ?? null,
        scripts: validationSummary?.scripts ?? [],
        buildSummary: overview.latestReview?.build.summary ?? null,
        testSummary: overview.latestReview?.tests.summary ?? null,
        lintSummary: overview.latestReview?.lint.summary ?? null,
      },
      contracts: {
        mcpSnapshotState,
        dependencyContractState,
        fileTopologyContractState,
        summary: `MCP snapshot ${mcpSnapshotState}; dependency contract ${dependencyContractState}; file topology contract ${fileTopologyContractState}.`,
      },
      reviewFocus: {
        summary: overview.latestReview?.summary ?? null,
        risks: overview.latestReview?.risks ?? [],
        nextSteps: overview.latestReview?.nextSteps ?? [],
      },
      trustFocus: {
        overallStatus: overview.operatorTrust.overallStatus,
        runtimeStatus: overview.operatorTrust.runtime.status,
        governanceStatus: overview.operatorTrust.governance?.status ?? null,
        summary: overview.operatorTrust.summary,
      },
      probeTargets,
    },
  };
}