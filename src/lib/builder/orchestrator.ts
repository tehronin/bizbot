import type { BuilderProject, BuilderRun, BuilderTask, BuilderTaskStage, BuilderTaskStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { BuilderAgenticProgressEvent, BuilderAgenticTaskOptions } from "@/lib/builder/agentic";
import { loadBuilderProjectContext, selectRelevantInstructionFragments, syncBuilderProjectProjection } from "@/lib/builder/context";
import { executeNativeBuilderTask } from "@/lib/builder/native-agent";
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
import { composeBuilderTaskPrompt } from "@/lib/builder/prompt";
import { buildBuilderStructuredReview } from "@/lib/builder/review";
import { completeBuilderRun, createBuilderRun, getBuilderProject, listBuilderRuns, updateBuilderProject, updateBuilderRun } from "@/lib/builder/projects";
import { registerBuilderRunController, unregisterBuilderRunController } from "@/lib/builder/session";
import { createBuilderTask, getBuilderTask, listBuilderTasks, resolveBuilderContinuationTask, resumeBuilderTask, updateBuilderTask, updateBuilderTaskExecutionState, updateBuilderTaskStage } from "@/lib/builder/tasks";
import {
  defaultBuilderProjectContext,
  normalizeBuilderProjectContext,
  normalizeBuilderTaskMetadata,
  trimReviewSummary,
  type BuilderMilestoneState,
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
  project: BuilderProject;
  context: BuilderProjectContextState;
  brief: BuilderPlanningSnapshot["brief"];
  milestones: BuilderPlanningSnapshot["milestones"];
  currentMilestone: BuilderMilestoneState | null;
  currentTaskSpec: BuilderTaskSpecState | null;
  tasks: BuilderTask[];
  currentTask: BuilderTask | null;
  runs: BuilderRun[];
  latestReview: BuilderStructuredReview | null;
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
  syncBuilderProjectProjection({
    project: updatedProject,
    context: nextContext,
    planning: args.planning,
    currentTask: args.currentTask,
    latestReview: args.review,
  });
  return { project: updatedProject, context: nextContext, planning: args.planning };
}

async function updateRunProgress(runId: string, partial: {
  summary: string;
  stage: string;
  taskId: string;
  progressLoop?: unknown;
  taskSpecId?: string | null;
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
    summary: `Planning Builder task spec ${taskSpec.title}.`,
  });

  await updateBuilderTaskStage(task.id, {
    stage: "IMPLEMENTING",
    status: "RUNNING",
    planSteps: buildExecutionPlanSteps(taskSpec, "RUNNING"),
    error: null,
  });

  const implementingTask = await getBuilderTask(task.id);
  const prompt = composeBuilderTaskPrompt({
    project,
    task: implementingTask,
    context: buildDerivedProjectContext({
      currentContext: loadBuilderProjectContext(project).context,
      planning,
      currentTask: implementingTask,
      request,
    }),
    lifecycle: planning.lifecycle,
    brief: planning.brief,
    currentMilestone: planning.currentMilestone,
    currentTaskSpec: taskSpec,
    request,
    stage: "IMPLEMENTING",
    fragments: selectRelevantInstructionFragments(project, request),
  });

  const loopResult = await executeNativeBuilderTask(project, { prompt }, {
    ...options,
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
  const review = buildBuilderStructuredReview({
    task: implementingTask,
    projectId,
    status: taskStatus,
    stage: taskStage,
    loop: loopResult.loop,
    architecture: architectureContext
      ? {
          activeKeys: architectureContext.active.map((item) => item.key),
          staleKeys: architectureContext.stale.map((item) => item.key),
          addressedStaleKeys: [],
          missingStaleKeys: [],
          newDecisionKeys: taskSpec.architecturalDecisionKeys,
          retiredDecisionKeys: [],
        }
      : undefined,
  });

  const completedTask = await updateBuilderTask(implementingTask.id, {
    status: taskStatus,
    stage: taskStage,
    summary: trimReviewSummary(review.summary, 500),
    taskSpecId: taskSpec.id,
    metadata: toInputJsonValue({
      ...normalizeBuilderTaskMetadata(implementingTask.metadata),
      planSteps: buildExecutionPlanSteps(taskSpec, taskStatus),
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

  planning = await setBuilderTaskSpecStatus(projectId, taskSpec.id, taskStatus === "SUCCEEDED" ? "COMPLETE" : "BLOCKED");
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
      taskId: task.id,
      taskSpecId: taskSpec.id,
      loop: loopResult.loop,
      review,
      stage: taskStage,
      requestedProfile: input.profile ?? null,
      requestedModel: input.model ?? null,
    },
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
        taskId: task.id,
        taskSpecId: taskSpec.id,
        stage: "FAILED",
        request,
        requestedProfile: input.profile ?? null,
        requestedModel: input.model ?? null,
      },
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
  const latestReview = runs.find((run) => run.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata) && "review" in (run.metadata as Record<string, unknown>))?.metadata as Record<string, unknown> | undefined;
  const { context } = loadBuilderProjectContext(project);

  return {
    project,
    context,
    brief: planning.brief,
    milestones: planning.milestones,
    currentMilestone: planning.currentMilestone,
    currentTaskSpec: planning.currentTaskSpec,
    tasks,
    currentTask,
    runs,
    latestReview: latestReview?.review as BuilderStructuredReview ?? null,
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