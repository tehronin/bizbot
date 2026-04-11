import type { BuilderProject, BuilderRun, BuilderTask, BuilderTaskStage, BuilderTaskStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { BuilderAgenticProgressEvent, BuilderAgenticTaskOptions } from "@/lib/builder/agentic";
import { summarizeBuilderProjectMetrics, type BuilderHealthMetrics } from "@/lib/builder/analytics";
import { listBuilderCapabilityAuditEvents } from "@/lib/builder/audit";
import { getBuilderDatabaseInspectionOverview } from "@/lib/builder/database-introspection";
import { validateBuilderProjectEnv, type BuilderConfigReadinessState } from "@/lib/builder/environment";
import { listBuilderGovernanceDecisions, type BuilderGovernanceDecisionRecord } from "@/lib/builder/governance";
import {
  buildCurrentBuilderDependencyContractSnapshot,
  ensureBuilderRunDependencyContractPreflight,
  getBuilderDependencyPlanningContext,
  selectRelevantBuilderDependencyContext,
} from "@/lib/builder/dependency-contract";
import {
  ensureBuilderRunFileTopologySnapshotPreflight,
  getBuilderFileTopologyPlanningContext,
  selectRelevantBuilderFileTopologyContext,
} from "@/lib/builder/file-topology-snapshots";
import {
  ensureBuilderRunMcpSnapshotPreflight,
  getBuilderMcpSnapshotOverview,
  getLatestBuilderMcpSnapshotForRun,
  queueBuilderMcpSnapshotCleanup,
  selectRelevantBuilderMcpContext,
} from "@/lib/builder/mcp-snapshots";
import { loadBuilderProjectContext, selectRelevantInstructionFragments, syncBuilderProjectProjection } from "@/lib/builder/context";
import { executeNativeBuilderTask } from "@/lib/builder/native-agent";
import { buildBuilderOperatorTrustState } from "@/lib/builder/operator-trust";
import { listBuilderManagedProcesses } from "@/lib/builder/process-registry";
import { inspectBuilderOperationalState, type BuilderOperationalStateSummary } from "@/lib/builder/reconciliation";
import { getBuilderRuntimeInspectionOverview } from "@/lib/builder/runtime-orchestration";
import { getBuilderRepoStatus } from "@/lib/builder/vcs";
import {
  findExecutionTaskForTaskSpec,
  generateBuilderProjectPlan,
  getBuilderProjectBrief,
  getBuilderPlanningSnapshot,
  getBuilderTaskSpec,
  recomputeBuilderPlanningProgress,
  selectNextRunnableTaskSpec,
  setBuilderTaskSpecStatus,
  upsertBuilderProjectBrief,
  type UpsertBuilderProjectBriefInput,
} from "@/lib/builder/planning";
import { buildBuilderPlanAdherence, composeBuilderTaskPrompt } from "@/lib/builder/prompt";
import type { BuilderProjectRecord } from "@/lib/builder/projects";
import { buildBuilderStructuredReview } from "@/lib/builder/review";
import { completeBuilderRun, createBuilderRun, getBuilderProject, getBuilderProjectRecord, listBuilderRuns, updateBuilderProject, updateBuilderRun } from "@/lib/builder/projects";
import { registerBuilderRunController, unregisterBuilderRunController } from "@/lib/builder/session";
import { summarizeBuilderBudgetProfiles, summarizeBuilderRunTelemetry, type BuilderBudgetProfile, type BuilderTelemetrySummary } from "@/lib/builder/telemetry";
import { createBuilderTask, getBuilderTask, listBuilderTasks, reconcileBuilderRunWithTask, resumeBuilderTask, updateBuilderTask, updateBuilderTaskExecutionState, updateBuilderTaskStage } from "@/lib/builder/tasks";
import { ensureMcpClientsInitialized } from "@/lib/mcp/client";
import {
  defaultBuilderProjectContext,
  type BuilderDependencySnapshotOverviewState,
  type BuilderFileTopologySnapshotOverviewState,
  normalizeBuilderProjectContext,
  normalizeBuilderTaskMetadata,
  trimReviewSummary,
  type BuilderMcpSnapshotOverviewState,
  type BuilderMilestoneState,
  type BuilderOperatorTrustState,
  type BuilderPlanStep,
  type BuilderPlanningSnapshot,
  type BuilderProjectContextState,
  type BuilderStructuredReview,
  type BuilderTaskSpecState,
} from "@/lib/builder/types";

export interface BuilderOrchestrationInput {
  request: string;
  taskId?: string;
  retryFailed?: boolean;
  fromIteration?: number;
  profile?: string;
  model?: string;
}

export interface BuilderPlanProjectInput extends Partial<UpsertBuilderProjectBriefInput> {
  regenerate?: boolean;
}

export interface BuilderProjectOverview {
  project: BuilderProjectRecord;
  context: BuilderProjectContextState;
  configReadiness: BuilderConfigReadinessState;
  operatorTrust: BuilderOperatorTrustState;
  brief: BuilderPlanningSnapshot["brief"];
  milestones: BuilderPlanningSnapshot["milestones"];
  currentMilestone: BuilderMilestoneState | null;
  currentTaskSpec: BuilderTaskSpecState | null;
  tasks: BuilderTask[];
  currentTask: BuilderTask | null;
  runs: BuilderRun[];
  latestReview: BuilderStructuredReview | null;
  metrics: BuilderHealthMetrics;
  budgetProfiles: BuilderBudgetProfile[];
  telemetry: BuilderTelemetrySummary;
  reconciliation: BuilderOperationalStateSummary;
  mcpSnapshot: BuilderMcpSnapshotOverviewState;
  dependencyContract: BuilderDependencySnapshotOverviewState;
  fileTopologyContract: BuilderFileTopologySnapshotOverviewState;
  governanceHistory: BuilderGovernanceDecisionRecord[];
  nextRecommendedStep: string | null;
}

export type BuilderLaunchResult =
  | { status: "RUNNING"; runId: string; taskId: string }
  | { status: "PLANNED"; projectId: string; taskId: null; runId: null };

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function normalizeRequest(request: string): string {
  const normalized = request.trim();
  if (!normalized) {
    throw new Error("Builder task request is required.");
  }
  return normalized;
}

function buildBuilderDependencySnapshotOverview(args: {
  projectRelativePath: string;
  packageManager: BuilderProject["packageManager"];
  context: BuilderProjectContextState;
  runId: string | null;
}): BuilderDependencySnapshotOverviewState {
  const snapshot = buildCurrentBuilderDependencyContractSnapshot({
    projectRelativePath: args.projectRelativePath,
    packageManager: args.packageManager,
  });
  const baseline = args.context.dependencyContract ?? null;
  const planning = snapshot
    ? getBuilderDependencyPlanningContext({
        projectRelativePath: args.projectRelativePath,
        packageManager: args.packageManager,
        context: args.context,
      })
    : null;

  if (!snapshot) {
    return {
      runId: args.runId,
      currentHash: null,
      state: "not_available",
      baseline,
      planning: null,
      drift: null,
    };
  }

  return {
    runId: args.runId,
    currentHash: planning?.currentHash ?? null,
    state: !baseline
      ? "pending_capture"
      : planning?.drift?.changed
        ? "drifted"
        : "aligned",
    baseline,
    planning,
    drift: planning?.drift ?? null,
  };
}

function buildBuilderFileTopologySnapshotOverview(args: {
  projectRelativePath: string;
  context: BuilderProjectContextState;
  runId: string | null;
}): BuilderFileTopologySnapshotOverviewState {
  const baseline = args.context.fileTopologyContract ?? null;
  const planning = getBuilderFileTopologyPlanningContext({
    projectRelativePath: args.projectRelativePath,
    context: args.context,
  });

  return {
    runId: args.runId,
    currentHash: planning.currentHash,
    state: !baseline
      ? "pending_capture"
      : planning.drift?.changed
        ? "drifted"
        : "aligned",
    baseline,
    drift: planning.drift,
    planning,
  };
}

function buildExecutionPlanSteps(taskSpec: BuilderTaskSpecState, status: BuilderTaskStatus): BuilderPlanStep[] {
  const validators = taskSpec.validators.length > 0 ? taskSpec.validators.join(", ").toLowerCase() : "manual_review";
  if (status === "SUCCEEDED") {
    return [
      { id: "inspect", label: `Inspect the current workspace against ${taskSpec.title}.`, status: "completed" },
      { id: "implement", label: `Implement ${taskSpec.title}.`, status: "completed" },
      { id: "validate", label: `Validate using ${validators}.`, status: "completed" },
      { id: "review", label: "Summarize the result and update project state.", status: "completed" },
    ];
  }

  if (status === "RUNNING") {
    return [
      { id: "inspect", label: `Inspect the current workspace against ${taskSpec.title}.`, status: "completed" },
      { id: "implement", label: `Implement ${taskSpec.title}.`, status: "in_progress" },
      { id: "validate", label: `Validate using ${validators}.`, status: "pending" },
      { id: "review", label: "Summarize the result and update project state.", status: "pending" },
    ];
  }

  return [
    { id: "inspect", label: `Inspect the current workspace against ${taskSpec.title}.`, status: "completed" },
    { id: "implement", label: `Implement ${taskSpec.title}.`, status: "completed" },
    { id: "validate", label: `Validate using ${validators}.`, status: "in_progress" },
    { id: "review", label: "Summarize the result and update project state.", status: "pending" },
  ];
}

function deriveFailureStage(loopStage: string): BuilderTaskStage {
  if (loopStage === "complete") {
    return "DONE";
  }
  if (loopStage === "reviewing") {
    return "REVIEW";
  }
  if (loopStage === "verifying") {
    return "TESTING";
  }
  return "IMPLEMENTING";
}

function buildRunTelemetryMetadata(args: {
  project: BuilderProject;
  run: BuilderRun;
  mode?: "analysis_only" | "scaffold" | "implementation" | "verification" | null;
  loop?: Record<string, unknown> | null;
  blockedReason?: string | null;
  verificationOutcome?: "passed" | "failed" | "skipped";
}): Record<string, unknown> {
  const iterations = Array.isArray(args.loop?.iterations) ? args.loop.iterations : [];
  const lastIteration = iterations.length > 0 && typeof iterations.at(-1) === "object" && !Array.isArray(iterations.at(-1))
    ? iterations.at(-1) as Record<string, unknown>
    : null;

  return {
    template: args.project.template,
    ...(args.mode ? { mode: args.mode } : {}),
    durationMs: Math.max(0, Date.now() - args.run.startedAt.getTime()),
    ...(typeof lastIteration?.provider === "string" ? { provider: lastIteration.provider } : {}),
    ...(typeof lastIteration?.model === "string" ? { model: lastIteration.model } : {}),
    ...(args.blockedReason ? { blockedReason: args.blockedReason } : {}),
    verificationOutcome: args.verificationOutcome
      ?? (args.loop?.verificationSkipped === true ? "skipped" : "failed"),
    ...(args.loop?.usage && typeof args.loop.usage === "object" && !Array.isArray(args.loop.usage)
      ? { usage: args.loop.usage }
      : {}),
  };
}

function deriveTaskStatus(loopVerdict: string | undefined): BuilderTaskStatus {
  if (loopVerdict === "complete") {
    return "SUCCEEDED";
  }
  if (loopVerdict === "cancelled") {
    return "CANCELLED";
  }
  return "FAILED";
}

function buildNextRecommendedStep(planning: BuilderPlanningSnapshot, context: BuilderProjectContextState): string | null {
  if (!planning.brief) {
    return "Create a canonical Builder project brief.";
  }
  if (planning.milestones.length === 0) {
    return "Generate the canonical project plan.";
  }
  if (planning.lifecycle === "BLOCKED") {
    return planning.currentTaskSpec
      ? `Resolve the blocker on ${planning.currentTaskSpec.title}.`
      : "Resolve the blocked Builder milestone.";
  }
  if (planning.lifecycle === "COMPLETE") {
    return "Builder project is complete.";
  }
  if (planning.currentTaskSpec) {
    return `Advance ${planning.currentTaskSpec.title}.`;
  }
  return context.nextSteps[0] ?? null;
}

function assertBuilderPlanAdherence(adherence: ReturnType<typeof buildBuilderPlanAdherence>): void {
  if (adherence.allowsExecution) {
    return;
  }

  throw new Error(`Builder plan adherence check failed before execution: ${adherence.blockingIssues.join(" ")}`);
}

function findReplacementTaskSpec(
  planning: BuilderPlanningSnapshot,
  taskSpec: BuilderTaskSpecState,
): BuilderTaskSpecState | null {
  const taskSpecs = planning.milestones.flatMap((milestone) => milestone.taskSpecs);

  return taskSpecs.find((candidate) => candidate.id === taskSpec.id)
    ?? taskSpecs.find((candidate) => candidate.title === taskSpec.title && candidate.summary === taskSpec.summary)
    ?? taskSpecs.find((candidate) => candidate.title === taskSpec.title)
    ?? planning.currentTaskSpec
    ?? null;
}

async function resolveTaskSpecForFinalization(
  projectId: string,
  taskSpec: BuilderTaskSpecState,
): Promise<{ planning: BuilderPlanningSnapshot | null; taskSpec: BuilderTaskSpecState }> {
  try {
    return {
      planning: null,
      taskSpec: await getBuilderTaskSpec(taskSpec.id),
    };
  } catch {
    const planning = await recomputeBuilderPlanningProgress(projectId);
    const replacement = findReplacementTaskSpec(planning, taskSpec);
    if (!replacement) {
      throw new Error(`Builder task spec ${taskSpec.id} was replaced during execution and no matching replacement could be resolved.`);
    }

    return {
      planning,
      taskSpec: replacement,
    };
  }
}

function buildDerivedProjectContext(args: {
  currentContext: BuilderProjectContextState;
  planning: BuilderPlanningSnapshot;
  currentTask?: BuilderTask | null;
  review?: BuilderStructuredReview | null;
  request?: string;
}): BuilderProjectContextState {
  const next = normalizeBuilderProjectContext(args.currentContext);
  const latestSummary = args.review ? trimReviewSummary(args.review.summary, 600) : next.latestSessionSummary;
  const defaultNextSteps = (() => {
    if (!args.planning.brief) {
      return ["Create a project brief."];
    }
    if (args.planning.milestones.length === 0) {
      return ["Generate the project plan."];
    }
    if (args.planning.lifecycle === "BLOCKED") {
      return [buildNextRecommendedStep(args.planning, next) ?? "Resolve the blocked Builder task spec."];
    }
    if (args.planning.lifecycle === "COMPLETE") {
      return ["Project completed."];
    }
    return [buildNextRecommendedStep(args.planning, next) ?? "Advance the next runnable task spec."];
  })();
  const currentTaskMetadata = args.currentTask ? normalizeBuilderTaskMetadata(args.currentTask.metadata) : null;

  return {
    ...defaultBuilderProjectContext(),
    ...next,
    objective: next.objective ?? args.planning.brief?.summary ?? args.request ?? null,
    currentPlan: currentTaskMetadata?.planSteps.length
      ? currentTaskMetadata.planSteps
      : args.planning.currentTaskSpec
        ? buildExecutionPlanSteps(args.planning.currentTaskSpec, "RUNNING")
        : [],
    latestSessionSummary: latestSummary ?? null,
    knownFailures: args.review
      ? args.review.status === "SUCCEEDED"
        ? next.knownFailures.filter((item) => item !== latestSummary)
        : [latestSummary ?? args.review.summary, ...next.knownFailures].filter(Boolean).slice(0, 8)
      : next.knownFailures,
    nextSteps: args.review?.nextSteps.length ? args.review.nextSteps : defaultNextSteps,
    updatedAt: new Date().toISOString(),
  };
}

async function syncProjectState(args: {
  project: BuilderProject;
  planning: BuilderPlanningSnapshot;
  currentTask?: BuilderTask | null;
  review?: BuilderStructuredReview | null;
  request?: string;
}): Promise<{ project: BuilderProject; context: BuilderProjectContextState; planning: BuilderPlanningSnapshot }> {
  const { context } = loadBuilderProjectContext(args.project);
  const nextContext = buildDerivedProjectContext({
    currentContext: context,
    planning: args.planning,
    currentTask: args.currentTask,
    review: args.review,
    request: args.request,
  });
  const updatedProject = await updateBuilderProject(args.project.id, {
    context: nextContext as never,
    latestSessionSummary: nextContext.latestSessionSummary,
    lifecycle: args.planning.lifecycle,
  });
  const [tasks, runs, mcpSnapshot] = await Promise.all([
    listBuilderTasks(updatedProject.id, 25),
    listBuilderRuns(updatedProject.id, 50),
    getBuilderMcpSnapshotOverview({ projectId: updatedProject.id }),
  ]);
  const configReadiness = validateBuilderProjectEnv(updatedProject.relativePath);
  const reconciliation = inspectBuilderOperationalState({ runs, tasks });
  const capabilityAudit = listBuilderCapabilityAuditEvents(updatedProject.relativePath, { limit: 8 });
  const operatorTrust = await buildBuilderOperatorTrustState({
    review: args.review ?? null,
    configReadiness,
    reconciliation,
    mcpSnapshot,
    capabilityAudit,
    recentRuns: runs,
  });
  syncBuilderProjectProjection({
    project: updatedProject,
    context: nextContext,
    planning: args.planning,
    currentTask: args.currentTask,
    latestReview: args.review,
    latestOperatorTrust: operatorTrust,
  });
  return { project: updatedProject, context: nextContext, planning: args.planning };
}

async function updateRunProgress(runId: string, partial: {
  summary: string;
  stage: string;
  taskId: string;
  progressLoop?: unknown;
  taskSpecId?: string | null;
  mode?: "analysis_only" | "scaffold" | "implementation" | "verification" | null;
  template?: string;
  stdout?: string;
  stderr?: string;
}): Promise<void> {
  await updateBuilderRun(runId, {
    ...(partial.stdout !== undefined ? { stdout: partial.stdout } : {}),
    ...(partial.stderr !== undefined ? { stderr: partial.stderr } : {}),
    summary: partial.summary,
    metadata: {
      stage: partial.stage,
      taskId: partial.taskId,
      ...(partial.taskSpecId ? { taskSpecId: partial.taskSpecId } : {}),
      ...(partial.mode ? { mode: partial.mode } : {}),
      ...(partial.template ? { template: partial.template } : {}),
      ...(partial.progressLoop ? { loop: partial.progressLoop } : {}),
    },
  });
}

async function ensureExecutionTaskForTaskSpec(args: {
  projectId: string;
  request: string;
  taskSpec: BuilderTaskSpecState;
  input: BuilderOrchestrationInput;
}): Promise<BuilderTask> {
  if (args.input.taskId) {
    const explicitTask = await getBuilderTask(args.input.taskId);
    if (explicitTask.projectId !== args.projectId) {
      throw new Error("Builder task does not belong to the selected project.");
    }
    if (args.input.retryFailed || args.input.fromIteration !== undefined) {
      return resumeBuilderTask(explicitTask.id, {
        request: args.request,
        fromIteration: args.input.fromIteration,
        requestedProfile: args.input.profile,
        requestedModel: args.input.model,
      });
    }
    return explicitTask;
  }

  const existingTask = await findExecutionTaskForTaskSpec(args.projectId, args.taskSpec.id);
  if (existingTask) {
    if (existingTask.status === "RUNNING" || existingTask.status === "PENDING") {
      return existingTask;
    }
    return resumeBuilderTask(existingTask.id, {
      request: args.request,
      fromIteration: args.input.fromIteration,
      requestedProfile: args.input.profile,
      requestedModel: args.input.model,
    });
  }

  return createBuilderTask({
    projectId: args.projectId,
    taskSpecId: args.taskSpec.id,
    title: args.taskSpec.title,
    description: args.taskSpec.summary,
    acceptanceCriteria: args.taskSpec.completionCriteria,
    metadata: toInputJsonValue({
      ...normalizeBuilderTaskMetadata(null),
      lastUserRequest: args.request,
      requestedProfile: args.input.profile ?? null,
      requestedModel: args.input.model ?? null,
      planSteps: buildExecutionPlanSteps(args.taskSpec, "RUNNING"),
      resumeFromIteration: args.input.fromIteration ?? null,
    }),
  });
}

export async function planBuilderProject(projectId: string, input: BuilderPlanProjectInput): Promise<BuilderProjectOverview> {
  const project = await getBuilderProject(projectId);
  const existingBrief = await getBuilderProjectBrief(projectId);
  const brief = input.title?.trim() && input.summary?.trim()
    ? await upsertBuilderProjectBrief(projectId, input as UpsertBuilderProjectBriefInput)
    : existingBrief;
  if (!brief) {
    throw new Error("Builder project planning requires a brief title and summary the first time it runs.");
  }
  const planningSnapshot = await getBuilderPlanningSnapshot(projectId);
  const generated = input.regenerate === false && planningSnapshot.milestones.length > 0
    ? null
    : await generateBuilderProjectPlan({ project, brief });
  const planning = generated?.planning ?? await recomputeBuilderPlanningProgress(projectId);
  const architecture = generated?.architecture ?? (loadBuilderProjectContext(project).context.architecture ?? { active: [], stale: [] });
  await syncProjectState({
    project: {
      ...project,
      context: {
        ...((project.context as Record<string, unknown> | null) ?? {}),
        architecture,
      },
    } as unknown as BuilderProject,
    planning,
    request: brief.summary,
  });
  return getBuilderProjectOverview(projectId);
}

export async function orchestrateBuilderTask(
  projectId: string,
  input: BuilderOrchestrationInput,
  options: BuilderAgenticTaskOptions & { runId?: string } = {},
): Promise<{ project: BuilderProject; task: BuilderTask; run: BuilderRun; review: BuilderStructuredReview; context: BuilderProjectContextState }> {
  const request = normalizeRequest(input.request);
  const project = await getBuilderProject(projectId);
  let planning = await getBuilderPlanningSnapshot(projectId);

  if (!planning.brief) {
    await updateBuilderProject(projectId, { lifecycle: "DRAFT" });
    throw new Error("Builder project brief required before project advancement. Use builder_plan_project or the project planning API first.");
  }

  if (planning.milestones.length === 0) {
    await planBuilderProject(projectId, { regenerate: true });
    planning = await getBuilderPlanningSnapshot(projectId);
    await syncProjectState({ project: await getBuilderProject(projectId), planning, request });
    throw new Error("Builder project plan was generated. Review the plan and re-run advancement to execute the first task spec.");
  }

  let taskSpec = input.taskId
    ? (await getBuilderTask(input.taskId)).taskSpecId
      ? await getBuilderTaskSpec((await getBuilderTask(input.taskId)).taskSpecId as string)
      : await selectNextRunnableTaskSpec(projectId)
    : await selectNextRunnableTaskSpec(projectId);

  if (!taskSpec) {
    planning = await recomputeBuilderPlanningProgress(projectId);
    await syncProjectState({ project, planning, request });
    throw new Error(planning.lifecycle === "COMPLETE"
      ? "Builder project is complete."
      : planning.lifecycle === "BLOCKED"
        ? "No runnable Builder task spec is available because the project is blocked."
        : "No runnable Builder task spec is available yet.");
  }

  const task = await ensureExecutionTaskForTaskSpec({
    projectId,
    request,
    taskSpec,
    input,
  });
  planning = await setBuilderTaskSpecStatus(projectId, taskSpec.id, "ACTIVE");
  taskSpec = planning.currentTaskSpec ?? taskSpec;

  const run = options.runId
    ? await db.builderRun.findUniqueOrThrow({ where: { id: options.runId } })
    : await createBuilderRun({
        projectId,
        taskId: task.id,
        kind: "ORCHESTRATION",
        title: `Builder task: ${task.title}`,
        command: "builder-orchestrator",
        metadata: {
          template: project.template,
          taskId: task.id,
          taskSpecId: taskSpec.id,
          stage: "PLANNING",
          request,
        },
      });

  await updateBuilderTaskStage(task.id, {
    stage: "PLANNING",
    status: "RUNNING",
    error: null,
    planSteps: buildExecutionPlanSteps(taskSpec, "RUNNING"),
    lastUserRequest: request,
    requestedProfile: input.profile ?? null,
    requestedModel: input.model ?? null,
  });
  await updateBuilderTaskExecutionState(task.id, {
    summary: `Planning Builder task spec ${taskSpec.title}.`,
    currentIteration: input.fromIteration ?? null,
    loopPhase: "planning",
    latestLoopSummary: `Planning Builder task spec ${taskSpec.title}.`,
    resumeFromIteration: input.fromIteration ?? null,
    lastRunId: run.id,
  });
  await syncProjectState({
    project,
    planning,
    currentTask: await getBuilderTask(task.id),
    request,
  });

  await updateRunProgress(run.id, {
    taskId: task.id,
    taskSpecId: taskSpec.id,
    stage: "PLANNING",
    template: project.template,
    summary: `Planning Builder task spec ${taskSpec.title}.`,
  });

  await updateBuilderTaskStage(task.id, {
    stage: "IMPLEMENTING",
    status: "RUNNING",
    planSteps: buildExecutionPlanSteps(taskSpec, "RUNNING"),
    error: null,
  });

  const implementingTask = await getBuilderTask(task.id);
  const executionContext = buildDerivedProjectContext({
    currentContext: loadBuilderProjectContext(project).context,
    planning,
    currentTask: implementingTask,
    request,
  });
  const adherence = buildBuilderPlanAdherence({
    task: implementingTask,
    context: executionContext,
    currentMilestone: planning.currentMilestone,
    currentTaskSpec: taskSpec,
  });
  assertBuilderPlanAdherence(adherence);
  await ensureMcpClientsInitialized().catch((error) => {
    console.warn("[builder orchestrator] MCP client init skipped during snapshot preflight:", error);
  });
  await ensureBuilderRunMcpSnapshotPreflight({
    projectId: project.id,
    runId: run.id,
    taskId: task.id,
    taskSpecId: taskSpec.id,
    projectRelativePath: project.relativePath,
    projectContext: project.context,
  });
  await ensureBuilderRunDependencyContractPreflight({
    project: {
      id: project.id,
      relativePath: project.relativePath,
      packageManager: project.packageManager,
      context: project.context,
    },
    runId: run.id,
  });
  await ensureBuilderRunFileTopologySnapshotPreflight({
    project: {
      id: project.id,
      relativePath: project.relativePath,
      context: project.context,
    },
    runId: run.id,
  });
  const mcpContext = selectRelevantBuilderMcpContext({
    mode: adherence.mode,
    validators: taskSpec.validators.map((validator) => String(validator)),
    template: project.template,
    architecturalDecisionKeys: taskSpec.architecturalDecisionKeys,
  });
  const dependencyContext = selectRelevantBuilderDependencyContext({
    projectRelativePath: project.relativePath,
    packageManager: project.packageManager,
    reasons: [`mode:${adherence.mode}`, `template:${project.template}`],
  });
  const fileTopologyContext = selectRelevantBuilderFileTopologyContext({
    projectRelativePath: project.relativePath,
    reasons: [`mode:${adherence.mode}`, `template:${project.template}`],
  });
  const prompt = composeBuilderTaskPrompt({
    project,
    task: implementingTask,
    context: executionContext,
    lifecycle: planning.lifecycle,
    brief: planning.brief,
    currentMilestone: planning.currentMilestone,
    currentTaskSpec: taskSpec,
    request,
    stage: "IMPLEMENTING",
    fragments: selectRelevantInstructionFragments(project, request),
    adherence,
    mcpContext,
    dependencyContext,
    fileTopologyContext,
  });

  const loopResult = await executeNativeBuilderTask(project, {
    prompt,
    builderMcpContext: {
      projectId: project.id,
      builderRunId: run.id,
      taskId: task.id,
      taskSpecId: taskSpec.id,
      validatorContext: taskSpec.validators.map((validator) => String(validator)),
      activeAdrDecisionKeys: taskSpec.architecturalDecisionKeys,
      ontologyHints: taskSpec.architecturalDecisionKeys,
    },
  }, {
    ...options,
    verification: {
      mode: adherence.mode,
      validators: taskSpec.validators,
    },
    onProgress: async (event: BuilderAgenticProgressEvent) => {
      const progressStage = event.loop.phase === "verifying"
        ? "TESTING"
        : event.loop.phase === "reviewing"
          ? "REVIEW"
          : "IMPLEMENTING";
      await updateBuilderTaskExecutionState(task.id, {
        summary: trimReviewSummary(event.loop.summary, 500),
        stage: progressStage,
        currentIteration: event.loop.currentIteration ?? null,
        maxIterations: event.loop.maxIterations,
        loopPhase: event.loop.phase ?? null,
        latestLoopSummary: event.loop.summary,
        lastRetryAt: event.loop.currentIteration && event.loop.currentIteration > 1 ? new Date().toISOString() : undefined,
        resumeFromIteration: input.fromIteration ?? null,
        lastRunId: run.id,
      });
      await updateRunProgress(run.id, {
        taskId: task.id,
        taskSpecId: taskSpec.id,
        mode: adherence.mode,
        template: project.template,
        stage: event.loop.phase ?? "IMPLEMENTING",
        summary: event.loop.summary,
        progressLoop: event.loop,
        ...(event.latestResult?.stdout !== undefined ? { stdout: event.latestResult.stdout } : {}),
        ...(event.latestResult?.stderr !== undefined ? { stderr: event.latestResult.stderr } : {}),
      });
      await options.onProgress?.(event);
    },
  });

  const taskStatus = deriveTaskStatus(loopResult.loop.finalVerdict);
  const taskStage = taskStatus === "SUCCEEDED" ? "DONE" : deriveFailureStage(loopResult.loop.phase ?? "reviewing");
  const architectureContext = loadBuilderProjectContext(project).context.architecture;
  const configReadiness = validateBuilderProjectEnv(project.relativePath);
  const vcs = (() => {
    try {
      const status = getBuilderRepoStatus(project.relativePath);
      return {
        available: true,
        repoRoot: status.repoRoot,
        currentBranch: status.currentBranch,
        ahead: status.ahead,
        behind: status.behind,
        stagedCount: status.staged.length,
        unstagedCount: status.unstaged.length,
        untrackedCount: status.untracked.length,
        auditPath: status.auditPath,
        summary: `Git ${status.currentBranch ?? "detached"}; staged ${status.staged.length}, unstaged ${status.unstaged.length}, untracked ${status.untracked.length}.`,
      };
    } catch (error) {
      return {
        available: false,
        repoRoot: null,
        currentBranch: null,
        ahead: 0,
        behind: 0,
        stagedCount: 0,
        unstagedCount: 0,
        untrackedCount: 0,
        auditPath: null,
        summary: error instanceof Error ? error.message : String(error),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })();
  const managedProcesses = listBuilderManagedProcesses({ projectId, includeFinished: true, limit: 50 }).processes;
  const processSummary = {
    managedCount: managedProcesses.length,
    runningCount: managedProcesses.filter((entry) => entry.status === "running").length,
    failedCount: managedProcesses.filter((entry) => entry.status === "failed").length,
    timedOutCount: managedProcesses.filter((entry) => entry.status === "timed_out").length,
    cancelledCount: managedProcesses.filter((entry) => entry.status === "cancelled").length,
    recentProcessIds: managedProcesses.slice(0, 5).map((entry) => entry.processId),
    summary: managedProcesses.length > 0
      ? `${managedProcesses.length} managed process artifact${managedProcesses.length === 1 ? "" : "s"}; ${managedProcesses.filter((entry) => entry.status === "running").length} running.`
      : "No managed Builder processes were recorded for this project.",
  };
  const capabilityAudit = listBuilderCapabilityAuditEvents(project.relativePath, { limit: 8 });
  const auditSummary = {
    auditPath: capabilityAudit.auditPath,
    totalEvents: capabilityAudit.totalEvents,
    recentCount: capabilityAudit.recentEvents.length,
    capabilityCounts: capabilityAudit.capabilityCounts,
    notableEvents: capabilityAudit.recentEvents
      .filter((entry) => entry.outcomeStatus !== "succeeded")
      .slice(0, 5)
      .map((entry) => ({
        capabilityKey: entry.capabilityKey,
        eventName: entry.eventName,
        outcomeStatus: entry.outcomeStatus,
        timestamp: entry.timestamp,
      })),
    summary: capabilityAudit.totalEvents > 0
      ? `${capabilityAudit.totalEvents} capability audit event${capabilityAudit.totalEvents === 1 ? "" : "s"} recorded.`
      : "No capability audit events recorded yet.",
  };
  const databaseInspection = getBuilderDatabaseInspectionOverview(projectId, project.relativePath);
  const runtimeInspection = getBuilderRuntimeInspectionOverview({
    projectId,
    projectRelativePath: project.relativePath,
    packageManager: project.packageManager,
  });
  const review = buildBuilderStructuredReview({
    task: implementingTask,
    projectId,
    status: taskStatus,
    stage: taskStage,
    loop: loopResult.loop,
    config: configReadiness,
    vcs,
    process: processSummary,
    audit: auditSummary,
    database: {
      status: databaseInspection.driftSummary.status,
      summary: databaseInspection.driftSummary.summary,
      provider: databaseInspection.artifact.provider,
      connectionTarget: databaseInspection.artifact.connectionTarget,
      artifactTableCount: databaseInspection.artifact.tableCount,
      liveTableCount: databaseInspection.driftSummary.liveTableCount,
      latestProbeAt: databaseInspection.latestLiveProbe?.probedAt ?? null,
      auditPath: databaseInspection.latestLiveProbe?.auditPath ?? databaseInspection.artifact.auditPath,
    },
    runtime: {
      totalServices: runtimeInspection.totalServices,
      runningServices: runtimeInspection.runningServices,
      failedServices: runtimeInspection.failedServices,
      managedServices: runtimeInspection.managedServices,
      prominentServiceIds: runtimeInspection.services.slice(0, 5).map((entry) => entry.serviceId),
      summary: runtimeInspection.summary,
    },
    architecture: architectureContext
      ? {
          activeKeys: architectureContext.active.map((item) => item.key),
          staleKeys: architectureContext.stale.map((item) => item.key),
          reconfirmedStaleKeys: taskSpec.architecturalDecisionKeys.filter((key) => architectureContext.stale.some((item) => item.key === key)),
          addressedStaleKeys: taskSpec.architecturalDecisionKeys.filter((key) => architectureContext.stale.some((item) => item.key === key)),
          missingStaleKeys: architectureContext.stale.map((item) => item.key).filter((key) => !taskSpec.architecturalDecisionKeys.includes(key)),
          unreferencedActiveKeys: architectureContext.active.map((item) => item.key).filter((key) => !taskSpec.architecturalDecisionKeys.includes(key)),
          conflictingDecisionKeys: [],
          newDecisionKeys: taskSpec.architecturalDecisionKeys,
          retiredDecisionKeys: [],
        }
      : undefined,
  });

  const finalizedTaskSpecResult = await resolveTaskSpecForFinalization(projectId, taskSpec);
  const finalizedTaskSpec = finalizedTaskSpecResult.taskSpec;

  const completedTask = await updateBuilderTask(implementingTask.id, {
    status: taskStatus,
    stage: taskStage,
    summary: trimReviewSummary(review.summary, 500),
    taskSpecId: finalizedTaskSpec.id,
    metadata: toInputJsonValue({
      ...normalizeBuilderTaskMetadata(implementingTask.metadata),
      planSteps: buildExecutionPlanSteps(finalizedTaskSpec, taskStatus),
      lastStageError: taskStatus === "SUCCEEDED" ? null : review.summary,
      lastAttemptedStage: taskStage,
      lastUserRequest: request,
      requestedProfile: input.profile ?? null,
      requestedModel: input.model ?? null,
      currentIteration: loopResult.loop.iterations.length > 0 ? loopResult.loop.iterations.length : null,
      maxIterations: loopResult.loop.maxIterations,
      loopPhase: loopResult.loop.finalVerdict ?? loopResult.loop.phase ?? null,
      latestLoopSummary: review.summary,
      resumeFromIteration: input.fromIteration ?? null,
      lastRunId: run.id,
    }),
  });

  planning = finalizedTaskSpecResult.planning ?? planning;
  planning = await setBuilderTaskSpecStatus(projectId, finalizedTaskSpec.id, taskStatus === "SUCCEEDED" ? "COMPLETE" : "BLOCKED");
  const syncedState = await syncProjectState({
    project,
    planning,
    currentTask: completedTask,
    review,
    request,
  });

  const completedRun = await completeBuilderRun(run.id, {
    status: taskStatus === "SUCCEEDED" ? "SUCCEEDED" : taskStatus === "CANCELLED" ? "CANCELLED" : "FAILED",
    stdout: loopResult.result.stdout,
    stderr: loopResult.result.stderr,
    summary: trimReviewSummary(review.summary, 240),
    metadata: {
      telemetry: buildRunTelemetryMetadata({
        project,
        run,
        mode: adherence.mode,
        loop: loopResult.loop as unknown as Record<string, unknown>,
        blockedReason: taskStatus === "SUCCEEDED" ? null : loopResult.loop.iterations.at(-1)?.review.reason ?? review.summary,
        verificationOutcome: loopResult.loop.verificationSkipped ? "skipped" : taskStatus === "SUCCEEDED" ? "passed" : "failed",
      }),
      template: project.template,
      mode: adherence.mode,
      taskId: task.id,
      taskSpecId: finalizedTaskSpec.id,
      loop: loopResult.loop,
      review,
      stage: taskStage,
      requestedProfile: input.profile ?? null,
      requestedModel: input.model ?? null,
    },
  });
  const latestSnapshot = await getLatestBuilderMcpSnapshotForRun(run.id);
  await queueBuilderMcpSnapshotCleanup({
    projectId: project.id,
    snapshotId: latestSnapshot?.id ?? null,
    snapshotSequence: latestSnapshot?.snapshotSequence ?? null,
    reason: "post_build",
  }).catch((error) => {
    console.warn("[builder orchestrator] failed to queue MCP cleanup:", error);
  });

  return {
    project: syncedState.project,
    task: completedTask,
    run: completedRun,
    review,
    context: syncedState.context,
  };
}

export async function launchBuilderTask(projectId: string, input: BuilderOrchestrationInput): Promise<BuilderLaunchResult> {
  const request = normalizeRequest(input.request);
  const project = await getBuilderProject(projectId);
  let planning = await getBuilderPlanningSnapshot(projectId);

  if (!planning.brief) {
    await updateBuilderProject(projectId, { lifecycle: "DRAFT" });
    throw new Error("Builder project brief required before project advancement. Use builder_plan_project or the project planning API first.");
  }

  if (planning.milestones.length === 0) {
    await planBuilderProject(projectId, { regenerate: true });
    planning = await getBuilderPlanningSnapshot(projectId);
    await syncProjectState({ project: await getBuilderProject(projectId), planning, request });
    return {
      status: "PLANNED",
      projectId,
      taskId: null,
      runId: null,
    };
  }

  const taskSpec = input.taskId
    ? (await getBuilderTask(input.taskId)).taskSpecId
      ? await getBuilderTaskSpec((await getBuilderTask(input.taskId)).taskSpecId as string)
      : await selectNextRunnableTaskSpec(projectId)
    : await selectNextRunnableTaskSpec(projectId);
  if (!taskSpec) {
    planning = await recomputeBuilderPlanningProgress(projectId);
    await syncProjectState({ project, planning, request });
    throw new Error(planning.lifecycle === "COMPLETE"
      ? "Builder project is complete."
      : planning.lifecycle === "BLOCKED"
        ? "No runnable Builder task spec is available because the project is blocked."
        : "No runnable Builder task spec is available yet.");
  }

  const task = await ensureExecutionTaskForTaskSpec({
    projectId,
    request,
    taskSpec,
    input,
  });
  const run = await createBuilderRun({
    projectId,
    taskId: task.id,
    kind: "ORCHESTRATION",
    title: `Builder task: ${task.title}`,
    command: "builder-orchestrator",
    metadata: {
      template: project.template,
      taskId: task.id,
      taskSpecId: taskSpec.id,
      stage: "PLANNING",
      request,
    },
  });

  const controller = new AbortController();
  registerBuilderRunController(run.id, controller);

  void orchestrateBuilderTask(project.id, {
    ...input,
    taskId: task.id,
  }, {
    runId: run.id,
    signal: controller.signal,
  }).catch(async (error) => {
    const errorText = String(error);
    const cancelled = controller.signal.aborted;
    const status: BuilderTaskStatus = cancelled ? "CANCELLED" : "FAILED";

    await updateBuilderTaskStage(task.id, {
      stage: "IMPLEMENTING",
      status,
      error: errorText,
      lastUserRequest: request,
      requestedProfile: input.profile ?? null,
      requestedModel: input.model ?? null,
    }).catch(() => undefined);
    await updateBuilderTaskExecutionState(task.id, {
      summary: trimReviewSummary(errorText, 500),
      status,
      stage: "IMPLEMENTING",
      error: errorText,
      loopPhase: cancelled ? "cancelled" : "failed",
      latestLoopSummary: errorText,
      resumeFromIteration: input.fromIteration ?? null,
      lastRunId: run.id,
    }).catch(() => undefined);
    await completeBuilderRun(run.id, {
      status: cancelled ? "CANCELLED" : "FAILED",
      stderr: errorText,
      summary: trimReviewSummary(errorText, 240),
      metadata: {
        telemetry: buildRunTelemetryMetadata({
          project,
          run,
          blockedReason: errorText,
          verificationOutcome: "failed",
        }),
        template: project.template,
        taskId: task.id,
        taskSpecId: taskSpec.id,
        stage: "FAILED",
        request,
        requestedProfile: input.profile ?? null,
        requestedModel: input.model ?? null,
      },
    }).catch(() => undefined);
    const latestSnapshot = await getLatestBuilderMcpSnapshotForRun(run.id).catch(() => null);
    await queueBuilderMcpSnapshotCleanup({
      projectId: project.id,
      snapshotId: latestSnapshot?.id ?? null,
      snapshotSequence: latestSnapshot?.snapshotSequence ?? null,
      reason: "post_build",
    }).catch(() => undefined);
  }).finally(() => {
    unregisterBuilderRunController(run.id);
  });

  return {
    runId: run.id,
    taskId: task.id,
    status: "RUNNING",
  };
}

export async function getBuilderProjectOverview(projectId: string): Promise<BuilderProjectOverview> {
  const project = await getBuilderProject(projectId);
  const projectRecord = await getBuilderProjectRecord(projectId);
  const tasks = await listBuilderTasks(projectId, 25);
  const planning = await getBuilderPlanningSnapshot(projectId);
  const currentTask = planning.currentTaskSpec
    ? tasks.find((task) => task.taskSpecId === planning.currentTaskSpec?.id && (task.status === "RUNNING" || task.status === "PENDING"))
      ?? tasks.find((task) => task.taskSpecId === planning.currentTaskSpec?.id)
      ?? tasks.find((task) => task.status === "RUNNING" || task.status === "PENDING")
      ?? tasks[0]
      ?? null
    : tasks.find((task) => task.status === "RUNNING" || task.status === "PENDING") ?? tasks[0] ?? null;
  const runs = await listBuilderRuns(projectId, 25);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const reconciledRuns = runs.map((run) => {
    const task = run.taskId ? tasksById.get(run.taskId) : undefined;
    return task ? reconcileBuilderRunWithTask(run, task) : run;
  });
  const latestReview = reconciledRuns.find((run) => run.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata) && "review" in (run.metadata as Record<string, unknown>))?.metadata as Record<string, unknown> | undefined;
  const { context } = loadBuilderProjectContext(project);
  const configReadiness = validateBuilderProjectEnv(project.relativePath);
  const structuredReview = latestReview?.review as BuilderStructuredReview ?? null;
  const metrics = summarizeBuilderProjectMetrics({
    runs: reconciledRuns,
    tasks,
    planning,
    context,
    latestReview: structuredReview,
  });
  const budgetProfiles = summarizeBuilderBudgetProfiles(reconciledRuns, project.template);
  const telemetry = summarizeBuilderRunTelemetry(reconciledRuns, project.template);
  const reconciliation = inspectBuilderOperationalState({ runs: reconciledRuns, tasks });
  const activeRun = reconciledRuns.find((run) => run.status === "RUNNING") ?? reconciledRuns[0] ?? null;
  const mcpSnapshot = await getBuilderMcpSnapshotOverview({
    projectId,
    runId: activeRun?.id ?? null,
  });
  const dependencyContract = buildBuilderDependencySnapshotOverview({
    projectRelativePath: project.relativePath,
    packageManager: project.packageManager,
    context,
    runId: activeRun?.id ?? null,
  });
  const fileTopologyContract = buildBuilderFileTopologySnapshotOverview({
    projectRelativePath: project.relativePath,
    context,
    runId: activeRun?.id ?? null,
  });
  const capabilityAudit = listBuilderCapabilityAuditEvents(project.relativePath, { limit: 8 });
  const operatorTrust = await buildBuilderOperatorTrustState({
    review: structuredReview,
    configReadiness,
    reconciliation,
    mcpSnapshot,
    capabilityAudit,
    recentRuns: reconciledRuns,
  });
  const governanceHistory = listBuilderGovernanceDecisions(project.relativePath, { limit: 8 }).recentEvents;

  return {
    project: projectRecord,
    context,
    configReadiness,
    operatorTrust,
    brief: planning.brief,
    milestones: planning.milestones,
    currentMilestone: planning.currentMilestone,
    currentTaskSpec: planning.currentTaskSpec,
    tasks,
    currentTask,
    runs: reconciledRuns,
    latestReview: structuredReview,
    metrics,
    budgetProfiles,
    telemetry,
    reconciliation,
    mcpSnapshot,
    dependencyContract,
    fileTopologyContract,
    governanceHistory,
    nextRecommendedStep: buildNextRecommendedStep(planning, context),
  };
}

export async function getCurrentBuilderProjectOverview(): Promise<BuilderProjectOverview | null> {
  const currentTask = await db.builderTask.findFirst({
    where: {
      status: { in: ["RUNNING", "PENDING"] },
    },
    orderBy: { updatedAt: "desc" },
    include: { project: true },
  });
  if (currentTask?.project) {
    return getBuilderProjectOverview(currentTask.project.id);
  }

  const latestProject = await db.builderProject.findFirst({ orderBy: { updatedAt: "desc" } });
  return latestProject ? getBuilderProjectOverview(latestProject.id) : null;
}

export async function planOrUpdateBuilderProject(projectId: string, input: BuilderPlanProjectInput): Promise<BuilderProjectOverview> {
  return planBuilderProject(projectId, input);
}