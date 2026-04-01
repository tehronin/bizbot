import type { BuilderTask, BuilderTaskStage, BuilderTaskStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { defaultBuilderTaskMetadata, normalizeBuilderTaskMetadata, type BuilderPlanStep } from "@/lib/builder/types";

export interface BuilderTaskCreateInput {
  projectId: string;
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
  acceptanceCriteria?: string[];
  requestedProfile?: string;
  requestedModel?: string;
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
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
      title,
      description,
      acceptanceCriteria: input.acceptanceCriteria as never,
      parentTaskId: input.parentTaskId,
      metadata: input.metadata as never,
    },
  });
}

export async function updateBuilderTask(taskId: string, input: {
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

async function reopenFailedTask(task: BuilderTask, input: ResolveBuilderTaskInput): Promise<BuilderTask> {
  const metadata = normalizeBuilderTaskMetadata(task.metadata);
  return updateBuilderTask(task.id, {
    status: "RUNNING",
    stage: metadata.lastAttemptedStage ?? task.stage,
    metadata: toInputJsonValue({
      ...metadata,
      retryCount: metadata.retryCount + 1,
      lastUserRequest: input.request.trim(),
      requestedProfile: input.requestedProfile ?? metadata.requestedProfile,
      requestedModel: input.requestedModel ?? metadata.requestedModel,
    }),
  });
}

export async function resolveBuilderContinuationTask(input: ResolveBuilderTaskInput): Promise<BuilderTask> {
  if (input.taskId) {
    const explicitTask = await getBuilderTask(input.taskId);
    if (explicitTask.projectId !== input.projectId) {
      throw new Error("Builder task does not belong to the selected project.");
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
      return reopenFailedTask(failedTask, input);
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
    }),
  });
}