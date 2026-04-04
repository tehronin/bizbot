import type { BuilderTask, BuilderTaskStage, BuilderTaskStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { defaultBuilderTaskMetadata, normalizeBuilderTaskMetadata, type BuilderPlanStep } from "@/lib/builder/types";

export interface BuilderTaskCreateInput {
  projectId: string;
  taskSpecId?: string;
  title: string;
  description: string;
  acceptanceCriteria?: Prisma.InputJsonValue;
  parentTaskId?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface ResolveBuilderTaskInput {
  projectId: string;
  request: string;
  taskId?: string;
  retryFailed?: boolean;
  fromIteration?: number;
  acceptanceCriteria?: string[];
  requestedProfile?: string;
  requestedModel?: string;
}

export interface ResumeBuilderTaskInput {
  request: string;
  fromIteration?: number;
  requestedProfile?: string;
  requestedModel?: string;
}

export interface BuilderTaskHistoryEntry {
  runId: string;
  taskId: string | null;
  projectId: string;
  iteration: number | null;
  verdict: string;
  status: string;
  summary: string | null;
  stdout: string | null;
  stderr: string | null;
  timestamp: Date;
  finishedAt: Date | null;
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function normalizeIteration(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
}

function buildTaskTitle(request: string): string {
  const normalized = request.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Builder task";
  }

  const sentence = normalized.split(/[.!?]/, 1)[0]?.trim() || normalized;
  return sentence.length > 96 ? `${sentence.slice(0, 95).trimEnd()}…` : sentence;
}

function buildAcceptanceCriteria(request: string): string[] {
  return [
    `Address the request: ${request.trim()}`,
    "Leave the external builder workspace in a reviewable state.",
    "Run the smallest relevant validation available for the affected project.",
  ];
}

export async function listBuilderTasks(projectId: string, limit = 25, statuses?: BuilderTaskStatus[]): Promise<BuilderTask[]> {
  return db.builderTask.findMany({
    where: {
      projectId,
      ...(statuses && statuses.length > 0 ? { status: { in: statuses } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
}

export async function getBuilderTask(taskId: string): Promise<BuilderTask> {
  const task = await db.builderTask.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error(`Builder task not found: ${taskId}`);
  }

  return task;
}

export async function createBuilderTask(input: BuilderTaskCreateInput): Promise<BuilderTask> {
  const title = input.title.trim();
  const description = input.description.trim();
  if (!title || !description) {
    throw new Error("Builder tasks require a title and description.");
  }

  return db.builderTask.create({
    data: {
      projectId: input.projectId,
      taskSpecId: input.taskSpecId,
      title,
      description,
      acceptanceCriteria: input.acceptanceCriteria as never,
      parentTaskId: input.parentTaskId,
      metadata: input.metadata as never,
    },
  });
}

export async function updateBuilderTask(taskId: string, input: {
  taskSpecId?: string | null;
  title?: string;
  description?: string;
  status?: BuilderTaskStatus;
  stage?: BuilderTaskStage;
  acceptanceCriteria?: Prisma.InputJsonValue;
  summary?: string | null;
  metadata?: Prisma.InputJsonValue;
}): Promise<BuilderTask> {
  return db.builderTask.update({
    where: { id: taskId },
    data: {
      ...(input.taskSpecId !== undefined ? { taskSpecId: input.taskSpecId } : {}),
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.stage !== undefined ? { stage: input.stage } : {}),
      ...(input.acceptanceCriteria !== undefined ? { acceptanceCriteria: input.acceptanceCriteria as never } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata as never } : {}),
    },
  });
}

export async function updateBuilderTaskStage(taskId: string, input: {
  stage: BuilderTaskStage;
  status?: BuilderTaskStatus;
  error?: string | null;
  planSteps?: BuilderPlanStep[];
  lastUserRequest?: string | null;
  requestedProfile?: string | null;
  requestedModel?: string | null;
}): Promise<BuilderTask> {
  const task = await getBuilderTask(taskId);
  const metadata = normalizeBuilderTaskMetadata(task.metadata);

  return updateBuilderTask(taskId, {
    stage: input.stage,
    ...(input.status ? { status: input.status } : {}),
    metadata: toInputJsonValue({
      ...metadata,
      ...(input.error !== undefined ? { lastStageError: input.error } : {}),
      lastAttemptedStage: input.stage,
      ...(input.planSteps ? { planSteps: input.planSteps } : {}),
      ...(input.lastUserRequest !== undefined ? { lastUserRequest: input.lastUserRequest } : {}),
      ...(input.requestedProfile !== undefined ? { requestedProfile: input.requestedProfile } : {}),
      ...(input.requestedModel !== undefined ? { requestedModel: input.requestedModel } : {}),
    }),
  });
}

export async function updateBuilderTaskExecutionState(taskId: string, input: {
  summary?: string | null;
  status?: BuilderTaskStatus;
  stage?: BuilderTaskStage;
  error?: string | null;
  currentIteration?: number | null;
  maxIterations?: number | null;
  loopPhase?: string | null;
  latestLoopSummary?: string | null;
  lastRetryAt?: string | null;
  resumeFromIteration?: number | null;
  lastRunId?: string | null;
}): Promise<BuilderTask> {
  const task = await getBuilderTask(taskId);
  const metadata = normalizeBuilderTaskMetadata(task.metadata);

  return updateBuilderTask(taskId, {
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.stage !== undefined ? { stage: input.stage } : {}),
    metadata: toInputJsonValue({
      ...metadata,
      ...(input.error !== undefined ? { lastStageError: input.error } : {}),
      ...(input.currentIteration !== undefined ? { currentIteration: input.currentIteration } : {}),
      ...(input.maxIterations !== undefined ? { maxIterations: input.maxIterations } : {}),
      ...(input.loopPhase !== undefined ? { loopPhase: input.loopPhase } : {}),
      ...(input.latestLoopSummary !== undefined ? { latestLoopSummary: input.latestLoopSummary } : {}),
      ...(input.lastRetryAt !== undefined ? { lastRetryAt: input.lastRetryAt } : {}),
      ...(input.resumeFromIteration !== undefined ? { resumeFromIteration: input.resumeFromIteration } : {}),
      ...(input.lastRunId !== undefined ? { lastRunId: input.lastRunId } : {}),
    }),
  });
}

export async function resumeBuilderTask(taskId: string, input: ResumeBuilderTaskInput): Promise<BuilderTask> {
  const task = await getBuilderTask(taskId);
  const metadata = normalizeBuilderTaskMetadata(task.metadata);
  if (task.status === "RUNNING" || task.status === "PENDING") {
    return task;
  }

  const resumeFromIteration = normalizeIteration(input.fromIteration) ?? metadata.currentIteration ?? metadata.resumeFromIteration ?? undefined;
  const resumedAt = new Date().toISOString();
  return updateBuilderTask(task.id, {
    status: "RUNNING",
    stage: metadata.lastAttemptedStage ?? task.stage,
    summary: resumeFromIteration
      ? `Resuming builder task from iteration ${resumeFromIteration} using the current workspace state.`
      : "Resuming builder task using the current workspace state.",
    metadata: toInputJsonValue({
      ...metadata,
      retryCount: metadata.retryCount + 1,
      lastStageError: null,
      lastUserRequest: input.request.trim(),
      requestedProfile: input.requestedProfile ?? metadata.requestedProfile,
      requestedModel: input.requestedModel ?? metadata.requestedModel,
      lastRetryAt: resumedAt,
      currentIteration: resumeFromIteration ?? null,
      loopPhase: "planning",
      latestLoopSummary: resumeFromIteration
        ? `Resume requested from iteration ${resumeFromIteration}.`
        : "Resume requested.",
      resumeFromIteration: resumeFromIteration ?? null,
      lastRunId: null,
    }),
  });
}

export async function resolveBuilderContinuationTask(input: ResolveBuilderTaskInput): Promise<BuilderTask> {
  if (input.taskId) {
    const explicitTask = await getBuilderTask(input.taskId);
    if (explicitTask.projectId !== input.projectId) {
      throw new Error("Builder task does not belong to the selected project.");
    }
    if (input.retryFailed || input.fromIteration !== undefined) {
      return resumeBuilderTask(explicitTask.id, {
        request: input.request,
        fromIteration: input.fromIteration,
        requestedProfile: input.requestedProfile,
        requestedModel: input.requestedModel,
      });
    }
    return explicitTask;
  }

  const openTask = await db.builderTask.findFirst({
    where: {
      projectId: input.projectId,
      status: { in: ["RUNNING", "PENDING"] },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (openTask) {
    return openTask;
  }

  if (input.retryFailed) {
    const failedTask = await db.builderTask.findFirst({
      where: {
        projectId: input.projectId,
        status: "FAILED",
      },
      orderBy: { updatedAt: "desc" },
    });
    if (failedTask) {
      return resumeBuilderTask(failedTask.id, {
        request: input.request,
        fromIteration: input.fromIteration,
        requestedProfile: input.requestedProfile,
        requestedModel: input.requestedModel,
      });
    }
  }

  return createBuilderTask({
    projectId: input.projectId,
    title: buildTaskTitle(input.request),
    description: input.request.trim(),
    acceptanceCriteria: input.acceptanceCriteria ?? buildAcceptanceCriteria(input.request),
    metadata: toInputJsonValue({
      ...defaultBuilderTaskMetadata(),
      lastUserRequest: input.request.trim(),
      requestedProfile: input.requestedProfile ?? null,
      requestedModel: input.requestedModel ?? null,
      resumeFromIteration: normalizeIteration(input.fromIteration) ?? null,
    }),
  });
}

export async function getBuilderTaskHistory(taskId: string): Promise<BuilderTaskHistoryEntry[]> {
  await getBuilderTask(taskId);
  const runs = await db.builderRun.findMany({
    where: { taskId },
    orderBy: { startedAt: "asc" },
  });

  return runs.flatMap((run) => {
    const metadata = run.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata)
      ? run.metadata as Record<string, unknown>
      : null;
    const loop = metadata?.loop && typeof metadata.loop === "object" && !Array.isArray(metadata.loop)
      ? metadata.loop as Record<string, unknown>
      : null;
    const iterations = Array.isArray(loop?.iterations) ? loop.iterations as Array<Record<string, unknown>> : [];

    if (iterations.length === 0) {
      return [{
        runId: run.id,
        taskId: run.taskId,
        projectId: run.projectId,
        iteration: null,
        verdict: run.status,
        status: run.status,
        summary: run.summary,
        stdout: run.stdout,
        stderr: run.stderr,
        timestamp: run.startedAt,
        finishedAt: run.finishedAt,
      } satisfies BuilderTaskHistoryEntry];
    }

    return iterations.map((iteration) => {
      const review = iteration.review && typeof iteration.review === "object"
        ? iteration.review as Record<string, unknown>
        : null;
      const actResult = iteration.actResult && typeof iteration.actResult === "object"
        ? iteration.actResult as Record<string, unknown>
        : null;

      return {
        runId: run.id,
        taskId: run.taskId,
        projectId: run.projectId,
        iteration: typeof iteration.iteration === "number" ? iteration.iteration : null,
        verdict: typeof review?.verdict === "string" ? review.verdict : run.status,
        status: run.status,
        summary: typeof review?.reason === "string" ? review.reason : run.summary,
        stdout: typeof actResult?.stdout === "string" ? actResult.stdout : run.stdout,
        stderr: typeof actResult?.stderr === "string" ? actResult.stderr : run.stderr,
        timestamp: run.startedAt,
        finishedAt: run.finishedAt,
      } satisfies BuilderTaskHistoryEntry;
    });
  });
}