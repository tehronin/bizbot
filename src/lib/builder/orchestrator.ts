import type { BuilderProject, BuilderRun, BuilderTask, BuilderTaskStage, BuilderTaskStatus } from "@prisma/client";
import { db } from "@/lib/db";
import type { BuilderAgenticProgressEvent, BuilderAgenticTaskOptions } from "@/lib/builder/agentic";
import { loadBuilderProjectContext, selectRelevantInstructionFragments, syncBuilderProjectProjection } from "@/lib/builder/context";
import { executeNativeBuilderTask } from "@/lib/builder/native-agent";
import { composeBuilderTaskPrompt } from "@/lib/builder/prompt";
import { buildBuilderStructuredReview } from "@/lib/builder/review";
import { createBuilderRun, getBuilderProject, listBuilderRuns, updateBuilderProject, updateBuilderRun, completeBuilderRun } from "@/lib/builder/projects";
import { registerBuilderRunController, unregisterBuilderRunController } from "@/lib/builder/session";
import { getBuilderTask, listBuilderTasks, resolveBuilderContinuationTask, updateBuilderTask, updateBuilderTaskExecutionState, updateBuilderTaskStage } from "@/lib/builder/tasks";
import { defaultBuilderProjectContext, normalizeBuilderProjectContext, normalizeBuilderTaskMetadata, trimReviewSummary, type BuilderProjectContextState, type BuilderStructuredReview } from "@/lib/builder/types";

export interface BuilderOrchestrationInput {
  request: string;
  taskId?: string;
  retryFailed?: boolean;
  fromIteration?: number;
  profile?: string;
  model?: string;
}

export interface BuilderProjectOverview {
  project: BuilderProject;
  context: BuilderProjectContextState;
  tasks: BuilderTask[];
  currentTask: BuilderTask | null;
  runs: BuilderRun[];
  latestReview: BuilderStructuredReview | null;
  nextRecommendedStep: string | null;
}

function normalizeRequest(request: string): string {
  const normalized = request.trim();
  if (!normalized) {
    throw new Error("Builder task request is required.");
  }
  return normalized;
}

function buildPlanSteps(request: string): Array<{ id: string; label: string; status: "pending" | "in_progress" | "completed" }> {
  return [
    { id: "inspect", label: `Inspect the existing workspace for: ${request}`, status: "completed" },
    { id: "implement", label: "Implement the requested changes in the external project workspace.", status: "in_progress" },
    { id: "validate", label: "Run the smallest relevant validation scripts for the affected project.", status: "pending" },
    { id: "review", label: "Summarize the result, risks, and next steps.", status: "pending" },
  ];
}

function markPlanStepStatuses(planSteps: ReturnType<typeof buildPlanSteps>, status: BuilderTaskStatus): ReturnType<typeof buildPlanSteps> {
  if (status === "SUCCEEDED") {
    return planSteps.map((step) => ({ ...step, status: "completed" }));
  }

  return planSteps.map((step) => {
    if (step.id === "inspect") {
      return { ...step, status: "completed" };
    }
    if (step.id === "implement") {
      return { ...step, status: status === "RUNNING" ? "in_progress" : "completed" };
    }
    if (step.id === "validate") {
      return { ...step, status: status === "FAILED" ? "in_progress" : step.status };
    }
    return step;
  });
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

function buildUpdatedContext(args: {
  context: BuilderProjectContextState;
  request: string;
  task: BuilderTask;
  review: BuilderStructuredReview;
}): BuilderProjectContextState {
  const next = normalizeBuilderProjectContext(args.context);
  const latestSummary = trimReviewSummary(args.review.summary, 600);
  return {
    ...defaultBuilderProjectContext(),
    ...next,
    objective: next.objective ?? args.request,
    currentPlan: normalizeBuilderTaskMetadata(args.task.metadata).planSteps,
    latestSessionSummary: latestSummary,
    knownFailures: args.review.status === "SUCCEEDED"
      ? next.knownFailures.filter((item) => item !== latestSummary)
      : [latestSummary, ...next.knownFailures].slice(0, 8),
    nextSteps: args.review.nextSteps,
    updatedAt: new Date().toISOString(),
  };
}

async function updateRunProgress(runId: string, partial: {
  summary: string;
  stage: string;
  taskId: string;
  progressLoop?: unknown;
}): Promise<void> {
  await updateBuilderRun(runId, {
    summary: partial.summary,
    metadata: {
      stage: partial.stage,
      taskId: partial.taskId,
      ...(partial.progressLoop ? { loop: partial.progressLoop } : {}),
    },
  });
}

export async function orchestrateBuilderTask(
  projectId: string,
  input: BuilderOrchestrationInput,
  options: BuilderAgenticTaskOptions & { runId?: string } = {},
): Promise<{ project: BuilderProject; task: BuilderTask; run: BuilderRun; review: BuilderStructuredReview; context: BuilderProjectContextState }> {
  const request = normalizeRequest(input.request);
  const project = await getBuilderProject(projectId);
  const { context } = loadBuilderProjectContext(project);
  const task = await resolveBuilderContinuationTask({
    projectId,
    request,
    taskId: input.taskId,
    retryFailed: input.retryFailed,
    fromIteration: input.fromIteration,
    requestedProfile: input.profile,
    requestedModel: input.model,
  });
  const planSteps = buildPlanSteps(request);

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
          stage: "PLANNING",
          request,
        },
      });

  await updateBuilderTaskStage(task.id, {
    stage: "PLANNING",
    status: "RUNNING",
    error: null,
    planSteps,
    lastUserRequest: request,
    requestedProfile: input.profile ?? null,
    requestedModel: input.model ?? null,
  });
  await updateBuilderTaskExecutionState(task.id, {
    summary: `Planning builder task ${task.title}.`,
    currentIteration: input.fromIteration ?? null,
    loopPhase: "planning",
    latestLoopSummary: `Planning builder task ${task.title}.`,
    resumeFromIteration: input.fromIteration ?? null,
    lastRunId: run.id,
  });

  const planningContext = {
    ...context,
    objective: context.objective ?? request,
    currentPlan: planSteps,
    nextSteps: ["Run implementation.", "Validate changes.", "Review the outcome."],
    updatedAt: new Date().toISOString(),
  } satisfies BuilderProjectContextState;
  await updateBuilderProject(project.id, {
    context: planningContext as never,
    latestSessionSummary: planningContext.latestSessionSummary,
  });
  syncBuilderProjectProjection({
    project,
    context: planningContext,
    currentTask: await getBuilderTask(task.id),
  });

  await updateRunProgress(run.id, {
    taskId: task.id,
    stage: "PLANNING",
    summary: `Planning builder task ${task.title}.`,
  });

  await updateBuilderTaskStage(task.id, {
    stage: "IMPLEMENTING",
    status: "RUNNING",
    planSteps: markPlanStepStatuses(planSteps, "RUNNING"),
    error: null,
  });

  const implementingTask = await getBuilderTask(task.id);
  const prompt = composeBuilderTaskPrompt({
    project,
    task: implementingTask,
    context: planningContext,
    request,
    stage: "IMPLEMENTING",
    fragments: selectRelevantInstructionFragments(project, request),
  });

  const loopResult = await executeNativeBuilderTask(project, {
    prompt,
  }, {
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
        stage: event.loop.phase ?? "IMPLEMENTING",
        summary: event.loop.summary,
        progressLoop: event.loop,
      });
      await options.onProgress?.(event);
    },
  });

  const taskStatus = deriveTaskStatus(loopResult.loop.finalVerdict);
  const taskStage = taskStatus === "SUCCEEDED" ? "DONE" : deriveFailureStage(loopResult.loop.phase ?? "reviewing");
  const review = buildBuilderStructuredReview({
    task: implementingTask,
    projectId,
    status: taskStatus,
    stage: taskStage,
    loop: loopResult.loop,
  });

  const completedPlan = markPlanStepStatuses(planSteps, taskStatus);
  const completedTask = await updateBuilderTask(implementingTask.id, {
    status: taskStatus,
    stage: taskStage,
    summary: trimReviewSummary(review.summary, 500),
    metadata: {
      ...normalizeBuilderTaskMetadata(implementingTask.metadata),
      planSteps: completedPlan,
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
    },
  });

  const nextContext = buildUpdatedContext({
    context: planningContext,
    request,
    task: completedTask,
    review,
  });
  await updateBuilderProject(project.id, {
    context: nextContext as never,
    latestSessionSummary: nextContext.latestSessionSummary,
  });

  syncBuilderProjectProjection({
    project,
    context: nextContext,
    currentTask: completedTask,
    latestReview: review,
  });

  const completedRun = await completeBuilderRun(run.id, {
    status: taskStatus === "SUCCEEDED" ? "SUCCEEDED" : taskStatus === "CANCELLED" ? "CANCELLED" : "FAILED",
    stdout: loopResult.result.stdout,
    stderr: loopResult.result.stderr,
    summary: trimReviewSummary(review.summary, 240),
    metadata: {
      taskId: task.id,
      loop: loopResult.loop,
      review,
      stage: taskStage,
      requestedProfile: input.profile ?? null,
      requestedModel: input.model ?? null,
    },
  });

  return {
    project: await getBuilderProject(projectId),
    task: completedTask,
    run: completedRun,
    review,
    context: nextContext,
  };
}

export async function launchBuilderTask(projectId: string, input: BuilderOrchestrationInput): Promise<{ runId: string; taskId: string; status: "RUNNING" }> {
  const request = normalizeRequest(input.request);
  const project = await getBuilderProject(projectId);
  const task = await resolveBuilderContinuationTask({
    projectId,
    request,
    taskId: input.taskId,
    retryFailed: input.retryFailed,
    fromIteration: input.fromIteration,
    requestedProfile: input.profile,
    requestedModel: input.model,
  });
  const run = await createBuilderRun({
    projectId,
    taskId: task.id,
    kind: "ORCHESTRATION",
    title: `Builder task: ${task.title}`,
    command: "builder-orchestrator",
    metadata: {
      taskId: task.id,
      stage: "PLANNING",
      request,
    },
  });

  const controller = new AbortController();
  registerBuilderRunController(run.id, controller);

  void orchestrateBuilderTask(project.id, input, {
    runId: run.id,
    signal: controller.signal,
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
  const currentTask = tasks.find((task) => task.status === "RUNNING" || task.status === "PENDING") ?? tasks[0] ?? null;
  const runs = await listBuilderRuns(projectId, 25);
  const latestReview = runs.find((run) => run.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata) && "review" in (run.metadata as Record<string, unknown>))?.metadata as Record<string, unknown> | undefined;
  const { context } = loadBuilderProjectContext(project);

  return {
    project,
    context,
    tasks,
    currentTask,
    runs,
    latestReview: latestReview?.review as BuilderStructuredReview ?? null,
    nextRecommendedStep: context.nextSteps[0] ?? null,
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