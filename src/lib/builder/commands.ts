import type { BuilderProject, BuilderRunKind } from "@prisma/client";
import { gitInitRepository } from "@/lib/builder/adapters/git";
import { buildBuilderAgenticExecution, executeBuilderAgenticTask } from "@/lib/builder/agentic";
import { npmInstall, npmRunScript } from "@/lib/builder/adapters/npm";
import type { BuilderProjectCommandInput, BuilderProjectRecordedCommandInput } from "@/lib/builder/command-types";
import { appendBuilderGovernanceDecision } from "@/lib/builder/governance";
import type { BuilderGovernanceSourceSurface } from "@/lib/builder/governance-shared";
import { resolveBuilderProjectDependencyContractDrift } from "@/lib/builder/dependency-contract";
import { resolveBuilderRunFileTopologyContractDrift } from "@/lib/builder/file-topology-snapshots";
import {
  buildCurrentBuilderMcpContractSnapshot,
  hashBuilderMcpContractSnapshot,
  resolveBuilderRunMcpContractDrift,
} from "@/lib/builder/mcp-snapshots";
import { writeBuilderMcpPolicyArtifact } from "@/lib/builder/mcp-policy";
import { pnpmInstall, pnpmRunScript } from "@/lib/builder/adapters/pnpm";
import { listBuilderProjectArchitecture } from "@/lib/builder/planning";
import { completeBuilderRun, createBuilderRun, updateBuilderProject, updateBuilderRun } from "@/lib/builder/projects";
import { reconcileBuilderOperationalState } from "@/lib/builder/reconciliation";
import { registerBuilderRunController, unregisterBuilderRunController } from "@/lib/builder/session";
import { normalizeBuilderProjectContext } from "@/lib/builder/types";
import type { BuilderCommandResult } from "@/lib/builder/workspace";
import { promoteBuilderArchitecturalDecisionsToOntology } from "@/lib/ontology/promotion";

const MAX_PROGRESS_OUTPUT_CHARS = 24_000;
const PROGRESS_FLUSH_INTERVAL_MS = 250;

export interface BuilderProjectCommandExecution {
  kind: BuilderRunKind;
  title: string;
  command: string;
  args: string[];
  result: BuilderCommandResult;
  summary?: string;
  finalStatus?: "SUCCEEDED" | "FAILED" | "CANCELLED";
  projectUpdates?: { gitInitialized?: boolean };
  metadata?: Record<string, unknown>;
}

export interface BuilderProjectCommandLaunch {
  runId: string;
  title: string;
  command: string;
  args: string[];
  status: "RUNNING";
}

interface RecordBuilderProjectCommandOptions {
  governanceSourceSurface?: BuilderGovernanceSourceSurface;
}

function getAgenticFinalStatus(finalVerdict: string | undefined): "SUCCEEDED" | "FAILED" | "CANCELLED" {
  if (finalVerdict === "complete") {
    return "SUCCEEDED";
  }
  if (finalVerdict === "cancelled") {
    return "CANCELLED";
  }
  return "FAILED";
}

function appendProgressOutput(current: string, chunk: string): string {
  if (current.length >= MAX_PROGRESS_OUTPUT_CHARS) {
    return current;
  }

  const next = `${current}${chunk}`;
  if (next.length <= MAX_PROGRESS_OUTPUT_CHARS) {
    return next;
  }

  return `${next.slice(0, MAX_PROGRESS_OUTPUT_CHARS)}\n[truncated output]`;
}

function assertPackages(packages: string[] | undefined, message: string): string[] {
  const filtered = (packages ?? []).map((value) => value.trim()).filter(Boolean);
  if (filtered.length === 0) {
    throw new Error(message);
  }
  return filtered;
}

async function installForProject(project: BuilderProject, packages?: string[], options?: { dev?: boolean }): Promise<BuilderCommandResult> {
  return project.packageManager === "PNPM"
    ? pnpmInstall(project.relativePath, packages, options)
    : npmInstall(project.relativePath, packages, options);
}

async function runScriptForProject(project: BuilderProject, script: string, extraArgs?: string[]): Promise<BuilderCommandResult> {
  return project.packageManager === "PNPM"
    ? pnpmRunScript(project.relativePath, script, extraArgs)
    : npmRunScript(project.relativePath, script, extraArgs);
}

export async function executeBuilderProjectCommand(
  project: BuilderProject,
  input: BuilderProjectRecordedCommandInput,
): Promise<BuilderProjectCommandExecution> {
  switch (input.action) {
    case "initialize_git": {
      const result = await gitInitRepository(project.relativePath);
      return {
        kind: "GIT_INIT",
        title: "Initialize git repository",
        command: "git",
        args: ["init"],
        result,
        projectUpdates: result.ok ? { gitInitialized: true } : undefined,
      };
    }
    case "install_dependencies": {
      const packages = input.packages?.map((value) => value.trim()).filter(Boolean);
      const result = await installForProject(project, packages, { dev: input.dev });
      return {
        kind: "INSTALL",
        title: packages && packages.length > 0 ? `Install ${packages.join(", ")}` : "Install project dependencies",
        command: project.packageManager === "PNPM" ? "pnpm" : "npm",
        args: project.packageManager === "PNPM"
          ? [packages && packages.length > 0 ? "add" : "install", ...(input.dev ? ["--save-dev"] : []), ...(packages ?? [])]
          : ["install", ...(input.dev ? ["--save-dev"] : []), ...(packages ?? [])],
        result,
      };
    }
    case "add_dependency": {
      const packages = assertPackages(input.packages, "Packages are required to add dependencies.");
      const result = await installForProject(project, packages, { dev: input.dev });
      return {
        kind: "INSTALL",
        title: `Add dependencies: ${packages.join(", ")}`,
        command: project.packageManager === "PNPM" ? "pnpm" : "npm",
        args: project.packageManager === "PNPM"
          ? ["add", ...(input.dev ? ["--save-dev"] : []), ...packages]
          : ["install", ...(input.dev ? ["--save-dev"] : []), ...packages],
        result,
      };
    }
    case "run_script": {
      const script = input.script.trim();
      if (!script) {
        throw new Error("Script name is required.");
      }
      const result = await runScriptForProject(project, script, input.args ?? []);
      return {
        kind: "SCRIPT",
        title: `Run script: ${script}`,
        command: project.packageManager === "PNPM" ? "pnpm" : "npm",
        args: project.packageManager === "PNPM" ? [script, ...(input.args ?? [])] : ["run", script, ...(input.args ?? [])],
        result,
      };
    }
    case "reconcile_mcp_policy": {
      const expectedMcpContractHash = hashBuilderMcpContractSnapshot(buildCurrentBuilderMcpContractSnapshot());
      const written = writeBuilderMcpPolicyArtifact({
        relativePath: project.relativePath,
        template: project.template,
        packageManager: project.packageManager,
        expectedMcpContractHash,
      });
      await promoteBuilderArchitecturalDecisionsToOntology({
        projectId: project.id,
        sourceRef: `builder:${project.id}:reconcile:mcp_policy`,
        decisionKeys: written.baseline.decisionKeys,
      });
      const architecture = await listBuilderProjectArchitecture(project.id);
      await updateBuilderProject(project.id, {
        context: {
          ...normalizeBuilderProjectContext(project.context),
          mcpPolicy: written.baseline,
          architecture,
        } as never,
      });
      const result: BuilderCommandResult = {
        ok: true,
        command: "builder-reconcile-mcp-policy",
        args: [project.id],
        cwd: project.relativePath,
        exitCode: 0,
        signal: null,
        stdout: JSON.stringify({ baseline: written.baseline }, null, 2),
        stderr: "",
        timedOut: false,
        cancelled: false,
      };

      return {
        kind: "COMMAND",
        title: "Reconcile Builder MCP policy",
        command: "builder-reconcile-mcp-policy",
        args: [project.id],
        result,
        summary: `Rebuilt ${written.baseline.artifactPath} and updated the persisted Builder MCP policy baseline.`,
        metadata: {
          approvalReason: input.reason?.trim() || null,
          baseline: written.baseline,
        },
      };
    }
    case "reconcile_operational_state": {
      const reconciliation = await reconcileBuilderOperationalState({ projectId: project.id });
      const result: BuilderCommandResult = {
        ok: true,
        command: "builder-reconcile",
        args: [project.id],
        cwd: project.relativePath,
        exitCode: 0,
        signal: null,
        stdout: JSON.stringify(reconciliation, null, 2),
        stderr: "",
        timedOut: false,
        cancelled: false,
      };

      return {
        kind: "COMMAND",
        title: "Reconcile Builder operational state",
        command: "builder-reconcile",
        args: [project.id],
        result,
        summary: reconciliation.reconciledRunCount > 0
          ? `Applied ${reconciliation.reconciledRunCount} Builder reconciliation correction(s).`
          : reconciliation.activeAlertCount > 0
            ? `Detected ${reconciliation.activeAlertCount} Builder operational alert(s) with no safe auto-fix applied.`
            : "Builder operational state is healthy.",
        metadata: {
          reconciliation,
        },
      };
    }
    case "resolve_mcp_contract_drift": {
      const resolution = await resolveBuilderRunMcpContractDrift({
        projectId: project.id,
        runId: input.runId,
        decision: input.decision,
        reason: input.reason,
      });
      const result: BuilderCommandResult = {
        ok: input.decision === "approve" ? resolution.status !== "rejected" : true,
        command: "builder-mcp-drift",
        args: [project.id, input.runId, input.decision],
        cwd: project.relativePath,
        exitCode: 0,
        signal: null,
        stdout: JSON.stringify(resolution, null, 2),
        stderr: "",
        timedOut: false,
        cancelled: false,
      };

      return {
        kind: "COMMAND",
        title: input.decision === "approve" ? "Approve Builder MCP contract rollover" : "Reject Builder MCP contract drift",
        command: "builder-mcp-drift",
        args: [project.id, input.runId, input.decision],
        result,
        summary: resolution.status === "approved"
          ? `Rolled Builder MCP contract forward to snapshot sequence ${resolution.snapshot?.snapshotSequence ?? "unknown"}.`
          : resolution.status === "rejected"
            ? "Rejected Builder MCP contract drift; execution remains blocked until the contract is aligned."
            : resolution.status === "captured"
              ? "Captured the initial Builder MCP contract snapshot."
              : "Builder MCP contract is already aligned.",
        metadata: {
          targetRunId: input.runId,
          resolution,
        },
      };
    }
    case "resolve_dependency_contract_drift": {
      const resolution = await resolveBuilderProjectDependencyContractDrift({
        project: {
          id: project.id,
          relativePath: project.relativePath,
          packageManager: project.packageManager,
          context: project.context,
        },
        runId: input.runId,
        decision: input.decision,
        reason: input.reason,
      });
      if (resolution.baseline && (resolution.status === "approved" || resolution.status === "captured")) {
        const architecture = await listBuilderProjectArchitecture(project.id);
        await updateBuilderProject(project.id, {
          context: {
            ...normalizeBuilderProjectContext(project.context),
            dependencyContract: resolution.baseline,
            architecture,
          } as never,
        });
      }
      const result: BuilderCommandResult = {
        ok: input.decision === "approve" ? resolution.status !== "rejected" : true,
        command: "builder-dependency-drift",
        args: [project.id, input.runId, input.decision],
        cwd: project.relativePath,
        exitCode: 0,
        signal: null,
        stdout: JSON.stringify(resolution, null, 2),
        stderr: "",
        timedOut: false,
        cancelled: false,
      };

      return {
        kind: "COMMAND",
        title: input.decision === "approve" ? "Approve Builder dependency contract rollover" : "Reject Builder dependency contract drift",
        command: "builder-dependency-drift",
        args: [project.id, input.runId, input.decision],
        result,
        summary: resolution.status === "approved"
          ? "Rolled the Builder dependency contract forward to the current package manifest and lockfile baseline."
          : resolution.status === "captured"
            ? "Captured the initial Builder dependency contract baseline."
            : resolution.status === "rejected"
              ? "Rejected Builder dependency contract drift; execution remains blocked until the dependency policy is aligned."
              : resolution.status === "aligned"
                ? "Builder dependency contract is already aligned."
                : "No dependency contract baseline is required for the current workspace state.",
        metadata: {
          targetRunId: input.runId,
          resolution,
        },
      };
    }
    case "resolve_file_topology_contract_drift": {
      const resolution = await resolveBuilderRunFileTopologyContractDrift({
        project: {
          id: project.id,
          relativePath: project.relativePath,
          context: project.context,
        },
        runId: input.runId,
        decision: input.decision,
        reason: input.reason,
      });
      if (resolution.baseline && (resolution.status === "approved" || resolution.status === "captured")) {
        const architecture = await listBuilderProjectArchitecture(project.id);
        await updateBuilderProject(project.id, {
          context: {
            ...normalizeBuilderProjectContext(project.context),
            fileTopologyContract: resolution.baseline,
            architecture,
          } as never,
        });
      }
      const result: BuilderCommandResult = {
        ok: input.decision === "approve" ? resolution.status !== "rejected" : true,
        command: "builder-file-topology-drift",
        args: [project.id, input.runId, input.decision],
        cwd: project.relativePath,
        exitCode: 0,
        signal: null,
        stdout: JSON.stringify(resolution, null, 2),
        stderr: "",
        timedOut: false,
        cancelled: false,
      };

      return {
        kind: "COMMAND",
        title: input.decision === "approve" ? "Approve Builder file topology contract rollover" : "Reject Builder file topology contract drift",
        command: "builder-file-topology-drift",
        args: [project.id, input.runId, input.decision],
        result,
        summary: resolution.status === "approved"
          ? "Rolled the Builder file topology contract forward to the current structural baseline."
          : resolution.status === "captured"
            ? "Captured the initial Builder file topology contract baseline."
            : resolution.status === "rejected"
              ? "Rejected Builder file topology contract drift; execution remains blocked until structural placement policy is aligned."
              : "Builder file topology contract is already aligned.",
        metadata: {
          targetRunId: input.runId,
          resolution,
        },
      };
    }
    case "run_agentic_task": {
      const execution = await executeBuilderAgenticTask(project, input);
      return {
        kind: "AGENTIC",
        title: `Run ${execution.profile.displayName} task`,
        command: execution.command,
        args: execution.args,
        result: execution.result,
        summary: execution.loop.summary,
        finalStatus: getAgenticFinalStatus(execution.loop.finalVerdict),
        metadata: {
          profileKey: execution.profile.key,
          profileLabel: execution.profile.displayName,
          requestedModel: input.model?.trim() || null,
          loop: execution.loop,
        },
      };
    }
  }
}

export async function recordBuilderProjectCommand(
  project: BuilderProject,
  input: BuilderProjectRecordedCommandInput,
  options: RecordBuilderProjectCommandOptions = {},
): Promise<BuilderProjectCommandExecution & { runId: string }> {
  const execution = await executeBuilderProjectCommand(project, input);
  const run = await createBuilderRun({
    projectId: project.id,
    kind: execution.kind,
    title: execution.title,
    command: execution.command,
    args: execution.args,
    metadata: execution.metadata,
  });

  if (execution.projectUpdates) {
    await updateBuilderProject(project.id, execution.projectUpdates);
  }

  await completeBuilderRun(run.id, {
    status: execution.finalStatus ?? (execution.result.ok ? "SUCCEEDED" : "FAILED"),
    stdout: execution.result.stdout,
    stderr: execution.result.stderr,
    summary: execution.summary ?? (execution.result.ok ? `${execution.title} completed.` : `${execution.title} failed with exit code ${execution.result.exitCode ?? "unknown"}.`),
    metadata: {
      ...execution.metadata,
      timedOut: execution.result.timedOut,
      exitCode: execution.result.exitCode,
      signal: execution.result.signal,
      cwd: execution.result.cwd,
    },
  });

  if (
    input.action === "reconcile_mcp_policy"
    || input.action === "resolve_mcp_contract_drift"
    || input.action === "resolve_dependency_contract_drift"
    || input.action === "resolve_file_topology_contract_drift"
  ) {
    const targetRunId = "runId" in input ? input.runId : null;
    const decision = input.action === "reconcile_mcp_policy" ? "reconcile" : input.decision;
    const resolutionStatus = execution.metadata && typeof execution.metadata === "object" && !Array.isArray(execution.metadata)
      && "resolution" in execution.metadata
      && execution.metadata.resolution
      && typeof execution.metadata.resolution === "object"
      && !Array.isArray(execution.metadata.resolution)
      && "status" in execution.metadata.resolution
      && typeof (execution.metadata.resolution as { status?: unknown }).status === "string"
        ? (execution.metadata.resolution as { status: string }).status
        : input.action === "reconcile_mcp_policy"
          ? "reconciled"
          : execution.result.ok
            ? "recorded"
            : "failed";

    appendBuilderGovernanceDecision({
      projectId: project.id,
      projectRelativePath: project.relativePath,
      action: input.action,
      decision,
      reason: input.reason,
      sourceSurface: options.governanceSourceSurface ?? "api",
      commandRunId: run.id,
      targetRunId,
      outcome: resolutionStatus,
      summary: execution.summary ?? execution.title,
      metadata: execution.metadata,
    });
  }

  return { ...execution, runId: run.id };
}

export async function launchBuilderProjectCommand(
  project: BuilderProject,
  input: Extract<BuilderProjectCommandInput, { action: "run_agentic_task" }>,
): Promise<BuilderProjectCommandLaunch> {
  const preview = await buildBuilderAgenticExecution(project, input);
  const title = `Run ${preview.profile.displayName} task`;
  const baseMetadata = {
    profileKey: preview.profile.key,
    profileLabel: preview.profile.displayName,
    requestedModel: input.model?.trim() || null,
  };

  const run = await createBuilderRun({
    projectId: project.id,
    kind: "AGENTIC",
    title,
    command: preview.command,
    args: preview.args,
    metadata: {
      ...baseMetadata,
      loop: {
        maxIterations: 3,
        summary: "Queued builder task.",
        iterations: [],
      },
    },
  });

  const abortController = new AbortController();
  registerBuilderRunController(run.id, abortController);

  let streamedStdout = "";
  let streamedStderr = "";
  let latestLoop: Record<string, unknown> | undefined;
  let latestSummary = "Queued builder task.";
  let flushTimer: NodeJS.Timeout | null = null;
  let flushPromise: Promise<void> | null = null;

  const flushProgress = async (): Promise<void> => {
    if (flushPromise) {
      await flushPromise;
      return;
    }

    flushPromise = updateBuilderRun(run.id, {
      stdout: streamedStdout || undefined,
      stderr: streamedStderr || undefined,
      summary: latestSummary,
      metadata: {
        ...baseMetadata,
        ...(latestLoop ? { loop: latestLoop } : {}),
      },
    }).then(() => undefined).finally(() => {
      flushPromise = null;
    });

    await flushPromise;
  };

  const scheduleFlush = (): void => {
    if (flushTimer) {
      return;
    }

    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushProgress();
    }, PROGRESS_FLUSH_INTERVAL_MS);
  };

  void executeBuilderAgenticTask(project, input, {
    signal: abortController.signal,
    onStdoutChunk: async (chunk) => {
      streamedStdout = appendProgressOutput(streamedStdout, chunk);
      scheduleFlush();
    },
    onStderrChunk: async (chunk) => {
      streamedStderr = appendProgressOutput(streamedStderr, chunk);
      scheduleFlush();
    },
    onProgress: async ({ loop, latestResult }) => {
      latestLoop = loop as unknown as Record<string, unknown>;
      latestSummary = loop.summary;
      if (latestResult?.stdout !== undefined) {
        streamedStdout = latestResult.stdout;
      }
      if (latestResult?.stderr !== undefined) {
        streamedStderr = latestResult.stderr;
      }
      scheduleFlush();
    },
  }).then(async (execution) => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flushProgress();
    await completeBuilderRun(run.id, {
      status: getAgenticFinalStatus(execution.loop.finalVerdict),
      stdout: execution.result.stdout,
      stderr: execution.result.stderr,
      summary: execution.loop.summary,
      metadata: {
        ...baseMetadata,
        loop: execution.loop,
        timedOut: execution.result.timedOut,
        exitCode: execution.result.exitCode,
        signal: execution.result.signal,
        cwd: execution.result.cwd,
      },
    });
    unregisterBuilderRunController(run.id);
  }).catch(async (error) => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flushProgress();
    await completeBuilderRun(run.id, {
      status: abortController.signal.aborted ? "CANCELLED" : "FAILED",
      stderr: String(error),
      summary: abortController.signal.aborted ? `${title} cancelled.` : `${title} failed: ${String(error)}`,
      metadata: {
        ...baseMetadata,
        ...(latestLoop ? { loop: latestLoop } : {}),
      },
    });
    unregisterBuilderRunController(run.id);
  });

  return {
    runId: run.id,
    title,
    command: preview.command,
    args: preview.args,
    status: "RUNNING",
  };
}

