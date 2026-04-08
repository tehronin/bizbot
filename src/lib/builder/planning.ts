import type {
  BuilderMilestone,
  BuilderMilestoneStatus,
  BuilderProject,
  BuilderProjectBrief,
  BuilderProjectLifecycle,
  Prisma,
  BuilderTaskSpec,
  BuilderTaskSpecStatus,
  BuilderTaskSpecValidator,
} from "@prisma/client";
import { db } from "@/lib/db";
import { getBuilderDependencyPlanningContext, selectRelevantBuilderDependencyContext } from "@/lib/builder/dependency-contract";
import { getBuilderFileTopologyPlanningContext, selectRelevantBuilderFileTopologyContext } from "@/lib/builder/file-topology-snapshots";
import { getBuilderMcpPlanningContext } from "@/lib/builder/mcp-snapshots";
import { getBuilderProject, updateBuilderProject } from "@/lib/builder/projects";
import { runBuilderPlannerPipeline } from "@/lib/builder/planner";
import { listOntologyEntities } from "@/lib/ontology/service";
import { buildBuilderAdrCanonicalKey, promoteBuilderArchitecturalDecisionsToOntology } from "@/lib/ontology/promotion";
import type {
  BuilderArchitectureContextState,
  BuilderArchitectureDecisionState,
  BuilderMilestoneState,
  BuilderNormalizedMilestoneDraft,
  BuilderPlannerCritiqueState,
  BuilderPlanningSnapshot,
  BuilderTaskSpecState,
} from "@/lib/builder/types";

export const BUILDER_ADR_MIN_CONFIDENCE = 0.7;

export interface UpsertBuilderProjectBriefInput {
  title: string;
  summary: string;
  goals?: string[];
  constraints?: string[];
  deliverables?: string[];
  notes?: string | null;
}

type BuilderMilestoneRecord = BuilderMilestone & {
  taskSpecs: Array<BuilderTaskSpec & {
    dependencies: Array<{ dependsOnTaskSpecId: string }>;
  }>;
};

function normalizeStringArray(value: string[] | undefined): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => typeof entry === "string" && entry.trim() ? [entry.trim()] : [])
    : [];
}

export function buildBuilderAdrScopePrefix(projectId: string): string {
  return `builder:${projectId}:`;
}

function parseBuilderDecisionKey(projectId: string, canonicalKey: string, attributes: unknown): string | null {
  const attributeKey = typeof attributes === "object" && attributes && !Array.isArray(attributes)
    ? (attributes as Record<string, unknown>).decisionKey
    : null;
  if (typeof attributeKey === "string" && attributeKey.trim()) {
    return attributeKey.trim();
  }

  const prefix = buildBuilderAdrScopePrefix(projectId);
  return canonicalKey.startsWith(prefix) ? canonicalKey.slice(prefix.length) : null;
}

function toBuilderArchitectureDecisionState(projectId: string, entity: Awaited<ReturnType<typeof listOntologyEntities>>[number]): BuilderArchitectureDecisionState | null {
  const key = parseBuilderDecisionKey(projectId, entity.canonicalKey, entity.attributes);
  if (!key) {
    return null;
  }

  return {
    key,
    canonicalKey: entity.canonicalKey,
    displayName: entity.displayName,
    description: entity.description,
    confidence: entity.confidence,
    status: entity.status,
    source: entity.source,
    updatedAt: entity.updatedAt,
  };
}

export async function listBuilderProjectArchitecture(projectId: string): Promise<BuilderArchitectureContextState> {
  const entities = await listOntologyEntities({
    scope: "global",
    source: "builder_adr",
    canonicalKeyPrefix: buildBuilderAdrScopePrefix(projectId),
    minConfidence: BUILDER_ADR_MIN_CONFIDENCE,
  });

  const decisions = entities.flatMap((entity) => {
    const decision = toBuilderArchitectureDecisionState(projectId, entity);
    return decision ? [decision] : [];
  });

  return {
    active: decisions.filter((decision) => decision.status === "active"),
    stale: decisions.filter((decision) => decision.status !== "active"),
  };
}

function assertBuilderPlannerCritique(critique: BuilderPlannerCritiqueState): void {
  if (critique.valid) {
    return;
  }

  const errors = critique.issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.message);
  throw new Error(errors.join(" "));
}

export async function replaceBuilderProjectPlanWithValidation(args: {
  projectId: string;
  critique: BuilderPlannerCritiqueState;
}): Promise<{
  planning: BuilderPlanningSnapshot;
  reconciliation: BuilderPlannerCritiqueState["reconciliation"];
}> {
  assertBuilderPlannerCritique(args.critique);
  if (args.critique.reconciliation.missingStaleKeys.length > 0) {
    throw new Error(`Planner must address every stale architecture key before persistence: ${args.critique.reconciliation.missingStaleKeys.join(", ")}.`);
  }

  const planning = await replaceBuilderProjectPlan(args.projectId, args.critique.normalizedMilestones);
  return {
    planning,
    reconciliation: args.critique.reconciliation,
  };
}

export async function generateBuilderProjectPlan(args: {
  project: Pick<BuilderProject, "id" | "name" | "relativePath" | "template" | "packageManager" | "context">;
  brief: BuilderProjectBrief;
}): Promise<{
  planning: BuilderPlanningSnapshot;
  architecture: BuilderArchitectureContextState;
  critique: BuilderPlannerCritiqueState;
}> {
  const architecture = await listBuilderProjectArchitecture(args.project.id);
  const mcpPlanningContext = await getBuilderMcpPlanningContext({
    projectId: args.project.id,
    architectureDecisionKeys: [
      ...architecture.active.map((decision) => decision.key),
      ...architecture.stale.map((decision) => decision.key),
    ],
  });
  const dependencyPlanningContext = getBuilderDependencyPlanningContext({
    projectRelativePath: args.project.relativePath,
    packageManager: args.project.packageManager,
    context: args.project.context,
  });
  const dependencyContext = selectRelevantBuilderDependencyContext({
    projectRelativePath: args.project.relativePath,
    packageManager: args.project.packageManager,
    reasons: ["mode:analysis_only", `template:${args.project.template}`],
  });
  const fileTopologyPlanningContext = getBuilderFileTopologyPlanningContext({
    projectRelativePath: args.project.relativePath,
    context: args.project.context,
  });
  const fileTopologyContext = selectRelevantBuilderFileTopologyContext({
    projectRelativePath: args.project.relativePath,
    reasons: ["mode:analysis_only", `template:${args.project.template}`],
  });
  const pipeline = runBuilderPlannerPipeline({
    project: args.project,
    brief: args.brief,
    context: args.project.context as never,
    architecture,
    mcpPlanningContext,
    dependencyPlanningContext,
    dependencyContext,
    fileTopologyPlanningContext,
    fileTopologyContext,
  });
  const persisted = await replaceBuilderProjectPlanWithValidation({
    projectId: args.project.id,
    critique: pipeline.critique,
  });

  await promoteBuilderArchitecturalDecisionsToOntology({
    projectId: args.project.id,
    sourceRef: buildBuilderAdrCanonicalKey(args.project.id, "plan_sync"),
    decisionKeys: persisted.reconciliation.newDecisionKeys,
    staleKeys: persisted.reconciliation.retiredDecisionKeys,
  });

  return {
    planning: await recomputeBuilderPlanningProgress(args.project.id),
    architecture: await listBuilderProjectArchitecture(args.project.id),
    critique: pipeline.critique,
  };
}

function toTaskSpecState(taskSpec: BuilderMilestoneRecord["taskSpecs"][number]): BuilderTaskSpecState {
  return {
    id: taskSpec.id,
    milestoneId: taskSpec.milestoneId,
    title: taskSpec.title,
    summary: taskSpec.summary,
    status: taskSpec.status,
    sortOrder: taskSpec.sortOrder,
    completionCriteria: [...taskSpec.completionCriteria],
    validators: [...taskSpec.validators],
    architecturalDecisionKeys: [...taskSpec.architecturalDecisionKeys],
    dependencyIds: taskSpec.dependencies.map((dependency) => dependency.dependsOnTaskSpecId),
  };
}

function toMilestoneState(milestone: BuilderMilestoneRecord): BuilderMilestoneState {
  return {
    id: milestone.id,
    title: milestone.title,
    summary: milestone.summary,
    status: milestone.status,
    sortOrder: milestone.sortOrder,
    taskSpecs: milestone.taskSpecs.map(toTaskSpecState),
  };
}

export function deriveBuilderMilestoneStatus(taskSpecs: Array<{ status: BuilderTaskSpecStatus }>): BuilderMilestoneStatus {
  if (taskSpecs.length > 0 && taskSpecs.every((taskSpec) => taskSpec.status === "COMPLETE")) {
    return "COMPLETE";
  }
  if (taskSpecs.some((taskSpec) => taskSpec.status === "BLOCKED")) {
    return "BLOCKED";
  }
  if (taskSpecs.some((taskSpec) => taskSpec.status === "ACTIVE" || taskSpec.status === "COMPLETE")) {
    return "ACTIVE";
  }
  return "PENDING";
}

export function deriveBuilderProjectLifecycle(args: {
  brief: BuilderProjectBrief | null;
  milestones: BuilderMilestoneState[];
}): BuilderProjectLifecycle {
  if (!args.brief) {
    return "DRAFT";
  }
  if (args.milestones.length === 0) {
    return "DRAFT";
  }
  if (args.milestones.every((milestone) => milestone.status === "COMPLETE")) {
    return "COMPLETE";
  }
  if (args.milestones.some((milestone) => milestone.status === "BLOCKED")) {
    return "BLOCKED";
  }
  if (args.milestones.some((milestone) => milestone.status === "ACTIVE" || milestone.status === "COMPLETE")) {
    return "ACTIVE";
  }
  return "PLANNED";
}

async function listMilestoneRecords(projectId: string): Promise<BuilderMilestoneRecord[]> {
  return db.builderMilestone.findMany({
    where: { projectId },
    orderBy: { sortOrder: "asc" },
    include: {
      taskSpecs: {
        orderBy: { sortOrder: "asc" },
        include: {
          dependencies: {
            select: {
              dependsOnTaskSpecId: true,
            },
          },
        },
      },
    },
  });
}

export async function updateBuilderProjectLifecycle(projectId: string, lifecycle: BuilderProjectLifecycle) {
  return updateBuilderProject(projectId, { lifecycle });
}

export async function getBuilderProjectBrief(projectId: string): Promise<BuilderProjectBrief | null> {
  await getBuilderProject(projectId);
  return db.builderProjectBrief.findUnique({ where: { projectId } });
}

export async function upsertBuilderProjectBrief(projectId: string, input: UpsertBuilderProjectBriefInput): Promise<BuilderProjectBrief> {
  const title = input.title.trim();
  const summary = input.summary.trim();
  if (!title || !summary) {
    throw new Error("Builder project brief requires a title and summary.");
  }

  await getBuilderProject(projectId);
  const brief = await db.builderProjectBrief.upsert({
    where: { projectId },
    create: {
      projectId,
      title,
      summary,
      goals: normalizeStringArray(input.goals),
      constraints: normalizeStringArray(input.constraints),
      deliverables: normalizeStringArray(input.deliverables),
      notes: input.notes?.trim() || null,
    },
    update: {
      title,
      summary,
      goals: normalizeStringArray(input.goals),
      constraints: normalizeStringArray(input.constraints),
      deliverables: normalizeStringArray(input.deliverables),
      notes: input.notes?.trim() || null,
    },
  });

  await updateBuilderProject(projectId, { lifecycle: "DRAFT" });
  return brief;
}

export async function listBuilderMilestones(projectId: string): Promise<BuilderMilestoneState[]> {
  await getBuilderProject(projectId);
  const milestones = await listMilestoneRecords(projectId);
  return milestones.map(toMilestoneState);
}

export async function getBuilderTaskSpec(taskSpecId: string): Promise<BuilderTaskSpecState> {
  const taskSpec = await db.builderTaskSpec.findUnique({
    where: { id: taskSpecId },
    include: {
      dependencies: {
        select: {
          dependsOnTaskSpecId: true,
        },
      },
    },
  });
  if (!taskSpec) {
    throw new Error(`Builder task spec not found: ${taskSpecId}`);
  }

  return {
    id: taskSpec.id,
    milestoneId: taskSpec.milestoneId,
    title: taskSpec.title,
    summary: taskSpec.summary,
    status: taskSpec.status,
    sortOrder: taskSpec.sortOrder,
    completionCriteria: [...taskSpec.completionCriteria],
    validators: [...taskSpec.validators],
    architecturalDecisionKeys: [...taskSpec.architecturalDecisionKeys],
    dependencyIds: taskSpec.dependencies.map((dependency) => dependency.dependsOnTaskSpecId),
  };
}

export async function getBuilderPlanningSnapshot(projectId: string): Promise<BuilderPlanningSnapshot> {
  const [project, brief, milestones] = await Promise.all([
    getBuilderProject(projectId),
    getBuilderProjectBrief(projectId),
    listMilestoneRecords(projectId),
  ]);
  const milestoneStates = milestones.map(toMilestoneState);
  const currentMilestone = milestoneStates.find((milestone) => milestone.status !== "COMPLETE") ?? null;
  const currentTaskSpec = currentMilestone?.taskSpecs.find((taskSpec) => taskSpec.status !== "COMPLETE") ?? null;

  return {
    lifecycle: project.lifecycle,
    brief,
    milestones: milestoneStates,
    currentMilestone,
    currentTaskSpec,
  };
}

export async function replaceBuilderProjectPlan(projectId: string, milestones: BuilderNormalizedMilestoneDraft[]): Promise<BuilderPlanningSnapshot> {
  await getBuilderProject(projectId);

  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const existingTaskSpecs = await tx.builderTaskSpec.findMany({
      where: { projectId },
      select: { id: true },
    });
    const existingTaskSpecIds = existingTaskSpecs.map((taskSpec) => taskSpec.id);

    if (existingTaskSpecIds.length > 0) {
      await tx.builderTask.updateMany({
        where: {
          projectId,
          taskSpecId: { in: existingTaskSpecIds },
        },
        data: {
          taskSpecId: null,
        },
      });
      await tx.builderTaskSpecDependency.deleteMany({
        where: {
          OR: [
            { taskSpecId: { in: existingTaskSpecIds } },
            { dependsOnTaskSpecId: { in: existingTaskSpecIds } },
          ],
        },
      });
    }

    await tx.builderTaskSpec.deleteMany({ where: { projectId } });
    await tx.builderMilestone.deleteMany({ where: { projectId } });

    const taskSpecIdByKey = new Map<string, string>();

    for (const milestone of milestones) {
      const createdMilestone = await tx.builderMilestone.create({
        data: {
          projectId,
          title: milestone.title,
          summary: milestone.summary,
          status: milestone.status,
          sortOrder: milestone.sortOrder,
        },
      });

      for (const task of milestone.tasks) {
        const createdTaskSpec = await tx.builderTaskSpec.create({
          data: {
            projectId,
            milestoneId: createdMilestone.id,
            title: task.title,
            summary: task.summary,
            status: task.status,
            sortOrder: task.sortOrder,
            completionCriteria: task.completionCriteria,
            validators: task.validators,
            architecturalDecisionKeys: task.architecturalDecisionKeys,
          },
        });
        taskSpecIdByKey.set(task.key, createdTaskSpec.id);
      }
    }

    for (const milestone of milestones) {
      for (const task of milestone.tasks) {
        const taskSpecId = taskSpecIdByKey.get(task.key);
        if (!taskSpecId) {
          continue;
        }

        for (const dependencyKey of task.dependencyKeys) {
          const dependsOnTaskSpecId = taskSpecIdByKey.get(dependencyKey);
          if (!dependsOnTaskSpecId || dependsOnTaskSpecId === taskSpecId) {
            continue;
          }
          await tx.builderTaskSpecDependency.create({
            data: {
              taskSpecId,
              dependsOnTaskSpecId,
            },
          });
        }
      }
    }
  });

  const snapshot = await recomputeBuilderPlanningProgress(projectId);
  if (snapshot.milestones.length > 0 && snapshot.lifecycle === "DRAFT") {
    await updateBuilderProject(projectId, { lifecycle: "PLANNED" });
    return getBuilderPlanningSnapshot(projectId);
  }
  return snapshot;
}

export async function recomputeBuilderPlanningProgress(projectId: string): Promise<BuilderPlanningSnapshot> {
  const [brief, milestones] = await Promise.all([
    getBuilderProjectBrief(projectId),
    listMilestoneRecords(projectId),
  ]);

  for (const milestone of milestones) {
    const nextStatus = deriveBuilderMilestoneStatus(milestone.taskSpecs);
    if (milestone.status !== nextStatus) {
      await db.builderMilestone.update({
        where: { id: milestone.id },
        data: { status: nextStatus },
      });
      milestone.status = nextStatus;
    }
  }

  const milestoneStates = milestones.map(toMilestoneState);
  const lifecycle = deriveBuilderProjectLifecycle({
    brief,
    milestones: milestoneStates,
  });
  await updateBuilderProject(projectId, { lifecycle });

  const currentMilestone = milestoneStates.find((milestone) => milestone.status !== "COMPLETE") ?? null;
  const currentTaskSpec = currentMilestone?.taskSpecs.find((taskSpec) => taskSpec.status !== "COMPLETE") ?? null;
  return {
    lifecycle,
    brief,
    milestones: milestoneStates,
    currentMilestone,
    currentTaskSpec,
  };
}

export async function setBuilderTaskSpecStatus(projectId: string, taskSpecId: string, status: BuilderTaskSpecStatus): Promise<BuilderPlanningSnapshot> {
  await db.builderTaskSpec.update({
    where: { id: taskSpecId },
    data: { status },
  });
  return recomputeBuilderPlanningProgress(projectId);
}

export async function selectNextRunnableTaskSpec(projectId: string): Promise<BuilderTaskSpecState | null> {
  const snapshot = await getBuilderPlanningSnapshot(projectId);
  if (!snapshot.brief || snapshot.milestones.length === 0) {
    return null;
  }

  const activeTaskSpecIds = new Set<string>();
  for (const milestone of snapshot.milestones) {
    for (const taskSpec of milestone.taskSpecs) {
      const [activeTasks, activeRuns] = await Promise.all([
        db.builderTask.count({
          where: {
            projectId,
            taskSpecId: taskSpec.id,
            status: { in: ["PENDING", "RUNNING"] },
          },
        }),
        db.builderRun.count({
          where: {
            projectId,
            status: "RUNNING",
            task: {
              is: {
                taskSpecId: taskSpec.id,
              },
            },
          },
        }),
      ]);

      if (activeTasks > 0 || activeRuns > 0) {
        activeTaskSpecIds.add(taskSpec.id);
      }
    }
  }

  return pickNextRunnableTaskSpecFromSnapshot(snapshot, activeTaskSpecIds);
}

export function pickNextRunnableTaskSpecFromSnapshot(
  snapshot: BuilderPlanningSnapshot,
  activeTaskSpecIds: ReadonlySet<string> = new Set(),
): BuilderTaskSpecState | null {
  if (!snapshot.brief || snapshot.milestones.length === 0) {
    return null;
  }

  const taskSpecStatusById = new Map<string, BuilderTaskSpecStatus>();
  for (const milestone of snapshot.milestones) {
    for (const taskSpec of milestone.taskSpecs) {
      taskSpecStatusById.set(taskSpec.id, taskSpec.status);
    }
  }

  for (const milestone of snapshot.milestones) {
    if (milestone.status === "COMPLETE") {
      continue;
    }

    const nextTaskSpec = milestone.taskSpecs.find((taskSpec) => taskSpec.status !== "COMPLETE") ?? null;
    if (!nextTaskSpec) {
      continue;
    }
    if (milestone.status === "BLOCKED" || nextTaskSpec.status === "BLOCKED") {
      return null;
    }

    const dependenciesSatisfied = nextTaskSpec.dependencyIds.every((dependencyId) => taskSpecStatusById.get(dependencyId) === "COMPLETE");
    if (!dependenciesSatisfied) {
      return null;
    }

    if (activeTaskSpecIds.has(nextTaskSpec.id)) {
      return null;
    }

    return nextTaskSpec;
  }

  return null;
}

export async function findExecutionTaskForTaskSpec(projectId: string, taskSpecId: string) {
  return db.builderTask.findFirst({
    where: {
      projectId,
      taskSpecId,
    },
    orderBy: { updatedAt: "desc" },
  });
}

export function defaultTaskSpecValidators(): BuilderTaskSpecValidator[] {
  return ["MANUAL_REVIEW"];
}