import type {
  BuilderInteraction,
  BuilderInteractionKind,
  BuilderInteractionStatus,
  BuilderProject,
  BuilderRunStatus,
  Prisma,
} from "@prisma/client";
import { getOrCreateConversation, saveMessage, updateConversationExecutionDefaults } from "@/lib/agent/memory";
import type { JsonObject } from "@/lib/agent/tools";
import { recordBuilderProjectCommand } from "@/lib/builder/commands";
import { getBuilderProjectOverview, launchBuilderTask, type BuilderProjectOverview } from "@/lib/builder/orchestrator";
import { getBuilderProject, listBuilderProjects } from "@/lib/builder/projects";
import { getBuilderTask } from "@/lib/builder/tasks";
import { db } from "@/lib/db";
import type { BuilderChatCard } from "@/lib/chat/types";

interface BuilderInteractionMetadata {
  state: string;
  recommendations?: string[];
}

interface PendingInteractionCandidate {
  dedupeKey: string;
  kind: BuilderInteractionKind;
  runId?: string | null;
  title: string;
  summary: string;
  metadata: BuilderInteractionMetadata;
}

function trimRecommendations(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean).slice(0, 3);
}

function normalizeTaskCardStatus(status: string): BuilderChatCard["status"] {
  switch (status) {
    case "PENDING":
      return "pending";
    case "RUNNING":
      return "running";
    case "SUCCEEDED":
      return "succeeded";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    default:
      return "resolved";
  }
}

function buildTaskCard(args: {
  id: string;
  project: Pick<BuilderProject, "id" | "name" | "relativePath">;
  taskId?: string | null;
  runId?: string | null;
  title: string;
  summary: string;
  status: BuilderChatCard["status"];
  state: string;
  updatedAt: Date;
}): BuilderChatCard {
  return {
    id: args.id,
    interactionId: args.id,
    kind: "task_execution",
    status: args.status,
    projectId: args.project.id,
    projectName: args.project.name,
    projectRelativePath: args.project.relativePath,
    runId: args.runId ?? null,
    taskId: args.taskId ?? null,
    title: args.title,
    summary: args.summary,
    state: args.state,
    recommendations: [],
    actions: [],
    updatedAt: args.updatedAt.toISOString(),
    resolvedAt: args.status === "running" || args.status === "pending" || args.status === "planned" ? null : args.updatedAt.toISOString(),
    resolutionReason: null,
  };
}

function buildOverviewTaskCards(overview: BuilderProjectOverview): BuilderChatCard[] {
  const cards: BuilderChatCard[] = [];
  const currentTask = overview.currentTask;
  const orchestrationRuns = overview.runs.filter((run) => run.kind === "ORCHESTRATION");

  if (currentTask && (currentTask.status === "RUNNING" || currentTask.status === "PENDING")) {
    const currentRun = orchestrationRuns.find((run) => run.taskId === currentTask.id) ?? orchestrationRuns[0] ?? null;
    cards.push(buildTaskCard({
      id: `task-${currentTask.id}`,
      project: overview.project,
      taskId: currentTask.id,
      runId: currentRun?.id ?? null,
      title: currentTask.title,
      summary: currentTask.summary ?? currentTask.description,
      status: normalizeTaskCardStatus(currentTask.status),
      state: currentTask.stage.toLowerCase(),
      updatedAt: currentTask.updatedAt,
    }));
  }

  const latestFinishedRun = orchestrationRuns.find((run) => run.status !== "RUNNING") ?? null;
  if (latestFinishedRun) {
    const matchingTask = latestFinishedRun.taskId
      ? overview.tasks.find((task) => task.id === latestFinishedRun.taskId) ?? null
      : null;
    const latestRunStatus = normalizeTaskCardStatus(latestFinishedRun.status as BuilderRunStatus);
    const duplicateCurrent = cards.some((card) => card.runId === latestFinishedRun.id);

    if (!duplicateCurrent && (latestRunStatus === "succeeded" || latestRunStatus === "failed" || latestRunStatus === "cancelled")) {
      cards.push(buildTaskCard({
        id: `run-${latestFinishedRun.id}`,
        project: overview.project,
        taskId: latestFinishedRun.taskId ?? null,
        runId: latestFinishedRun.id,
        title: matchingTask?.title ?? latestFinishedRun.title,
        summary: latestFinishedRun.summary ?? matchingTask?.summary ?? "Builder run finished.",
        status: latestRunStatus,
        state: matchingTask?.stage.toLowerCase() ?? latestFinishedRun.status.toLowerCase(),
        updatedAt: latestFinishedRun.finishedAt ?? latestFinishedRun.startedAt,
      }));
    }
  }

  return cards;
}

function toInteractionMetadata(value: Prisma.JsonValue | null | undefined): BuilderInteractionMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { state: "unknown" };
  }

  const candidate = value as Record<string, unknown>;
  return {
    state: typeof candidate.state === "string" ? candidate.state : "unknown",
    recommendations: Array.isArray(candidate.recommendations)
      ? candidate.recommendations.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

function serializeBuilderInteractionCard(
  interaction: BuilderInteraction & {
    project: Pick<BuilderProject, "id" | "name" | "relativePath">;
  },
): BuilderChatCard {
  const metadata = toInteractionMetadata(interaction.metadata as Prisma.JsonValue | null | undefined);
  const kind = interaction.kind === "MCP_POLICY_RECONCILIATION"
    ? "mcp_policy_reconciliation"
    : interaction.kind === "MCP_CONTRACT_DRIFT"
      ? "mcp_contract_drift"
      : interaction.kind === "DEPENDENCY_CONTRACT_DRIFT"
        ? "dependency_contract_drift"
        : "file_topology_contract_drift";
  const status = interaction.status === "PENDING"
    ? "pending"
    : interaction.status === "APPROVED"
      ? "approved"
      : interaction.status === "REJECTED"
        ? "rejected"
        : "resolved";

  const actions = interaction.status === "PENDING"
    ? interaction.kind === "MCP_POLICY_RECONCILIATION"
      ? [{ id: "reconcile" as const, label: "reconcile baseline", variant: "primary" as const }]
      : [
          { id: "approve" as const, label: "approve", variant: "primary" as const },
          { id: "reject" as const, label: "reject", variant: "danger" as const },
        ]
    : [];

  return {
    id: interaction.id,
    interactionId: interaction.id,
    kind,
    status,
    projectId: interaction.project.id,
    projectName: interaction.project.name,
    projectRelativePath: interaction.project.relativePath,
    runId: interaction.runId ?? null,
    title: interaction.title,
    summary: interaction.summary,
    state: metadata.state,
    recommendations: metadata.recommendations ?? [],
    actions,
    updatedAt: interaction.updatedAt.toISOString(),
    resolvedAt: interaction.resolvedAt?.toISOString() ?? null,
    resolutionReason: interaction.resolutionReason ?? null,
  };
}

function buildPendingInteractionCandidates(overview: Awaited<ReturnType<typeof getBuilderProjectOverview>>): PendingInteractionCandidate[] {
  const candidates: PendingInteractionCandidate[] = [];

  if (overview.mcpSnapshot.state === "pending_capture") {
    candidates.push({
      dedupeKey: `${overview.project.id}:mcp:reconcile:${overview.mcpSnapshot.currentHash ?? "none"}`,
      kind: "MCP_POLICY_RECONCILIATION",
      title: "Reconcile Builder MCP policy baseline",
      summary: overview.mcpSnapshot.planning?.summary
        ?? "Builder MCP policy has not been captured yet. Reconcile the reviewed contract before more Builder work proceeds.",
      metadata: {
        state: overview.mcpSnapshot.state,
        recommendations: trimRecommendations(overview.mcpSnapshot.planning?.recommendations),
      },
    });
  }

  if (overview.mcpSnapshot.state === "drifted" && overview.mcpSnapshot.activeRunId) {
    candidates.push({
      dedupeKey: `${overview.project.id}:mcp:drift:${overview.mcpSnapshot.activeRunId}:${overview.mcpSnapshot.currentHash ?? "none"}`,
      kind: "MCP_CONTRACT_DRIFT",
      runId: overview.mcpSnapshot.activeRunId,
      title: "Approve Builder MCP contract rollover",
      summary: overview.mcpSnapshot.planning?.summary
        ?? "Builder MCP contract drift is blocking execution and needs an explicit decision.",
      metadata: {
        state: overview.mcpSnapshot.state,
        recommendations: trimRecommendations(overview.mcpSnapshot.planning?.recommendations),
      },
    });
  }

  if ((overview.dependencyContract.state === "pending_capture" || overview.dependencyContract.state === "drifted") && overview.dependencyContract.runId) {
    candidates.push({
      dedupeKey: `${overview.project.id}:dependency:${overview.dependencyContract.state}:${overview.dependencyContract.runId}:${overview.dependencyContract.currentHash ?? "none"}`,
      kind: "DEPENDENCY_CONTRACT_DRIFT",
      runId: overview.dependencyContract.runId,
      title: overview.dependencyContract.state === "pending_capture"
        ? "Capture Builder dependency contract"
        : "Approve Builder dependency contract rollover",
      summary: overview.dependencyContract.planning?.summary
        ?? "Builder dependency contract drift needs an explicit decision.",
      metadata: {
        state: overview.dependencyContract.state,
        recommendations: trimRecommendations(overview.dependencyContract.planning?.recommendations),
      },
    });
  }

  if ((overview.fileTopologyContract.state === "pending_capture" || overview.fileTopologyContract.state === "drifted") && overview.fileTopologyContract.runId) {
    candidates.push({
      dedupeKey: `${overview.project.id}:file-topology:${overview.fileTopologyContract.state}:${overview.fileTopologyContract.runId}:${overview.fileTopologyContract.currentHash ?? "none"}`,
      kind: "FILE_TOPOLOGY_CONTRACT_DRIFT",
      runId: overview.fileTopologyContract.runId,
      title: overview.fileTopologyContract.state === "pending_capture"
        ? "Capture Builder file topology contract"
        : "Approve Builder file topology rollover",
      summary: overview.fileTopologyContract.planning?.summary
        ?? "Builder file topology contract drift needs an explicit decision.",
      metadata: {
        state: overview.fileTopologyContract.state,
        recommendations: trimRecommendations(overview.fileTopologyContract.planning?.recommendations),
      },
    });
  }

  return candidates;
}

export async function syncBuilderProjectInteractions(projectId: string, options?: { conversationId?: string | null }): Promise<BuilderChatCard[]> {
  const overview = await getBuilderProjectOverview(projectId);
  const candidates = buildPendingInteractionCandidates(overview);
  const pendingInteractions = await db.builderInteraction.findMany({
    where: {
      projectId,
      status: "PENDING",
    },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          relativePath: true,
        },
      },
    },
  });

  const pendingKeys = new Set(candidates.map((candidate) => candidate.dedupeKey));
  const staleInteractionIds = pendingInteractions
    .filter((interaction) => !pendingKeys.has(interaction.dedupeKey))
    .map((interaction) => interaction.id);

  if (staleInteractionIds.length > 0) {
    await db.builderInteraction.updateMany({
      where: {
        id: { in: staleInteractionIds },
      },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
      },
    });
  }

  if (candidates.length === 0) {
    return [];
  }

  const interactions = await Promise.all(candidates.map(async (candidate) => db.builderInteraction.upsert({
    where: { dedupeKey: candidate.dedupeKey },
    update: {
      projectId,
      conversationId: options?.conversationId ?? undefined,
      runId: candidate.runId ?? null,
      kind: candidate.kind,
      status: "PENDING",
      title: candidate.title,
      summary: candidate.summary,
      metadata: candidate.metadata as unknown as Prisma.InputJsonValue,
      resolutionReason: null,
      resolvedAt: null,
    },
    create: {
      projectId,
      conversationId: options?.conversationId ?? null,
      runId: candidate.runId ?? null,
      kind: candidate.kind,
      status: "PENDING",
      dedupeKey: candidate.dedupeKey,
      title: candidate.title,
      summary: candidate.summary,
      metadata: candidate.metadata as unknown as Prisma.InputJsonValue,
    },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          relativePath: true,
        },
      },
    },
  })));

  return interactions.map((interaction) => serializeBuilderInteractionCard(interaction));
}

export async function listPendingBuilderInteractionCards(options?: { conversationId?: string | null }): Promise<BuilderChatCard[]> {
  const projects = await listBuilderProjects();
  const activeProjects = projects.filter((project) => !project.archivedAt);
  const taskCards: BuilderChatCard[] = [];
  await Promise.all(activeProjects.map(async (project) => {
    try {
      await syncBuilderProjectInteractions(project.id, options);
      const overview = await getBuilderProjectOverview(project.id);
      taskCards.push(...buildOverviewTaskCards(overview));
    } catch (error) {
      console.warn(`[builder interactions] failed to sync project ${project.id}:`, error);
    }
  }));

  const interactions = await db.builderInteraction.findMany({
    where: { status: "PENDING" },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          relativePath: true,
        },
      },
    },
    orderBy: [
      { updatedAt: "desc" },
      { createdAt: "desc" },
    ],
  });

  return [
    ...taskCards,
    ...interactions.map((interaction) => serializeBuilderInteractionCard(interaction)),
  ].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

export async function launchBuilderTaskFromChat(options: {
  projectId: string;
  request: string;
  conversationId?: string | null;
  retryFailed?: boolean;
  taskId?: string | null;
  profile?: string;
  model?: string;
  userId?: string;
}): Promise<{ conversationId: string; card: BuilderChatCard; execution: Awaited<ReturnType<typeof launchBuilderTask>> }> {
  const request = options.request.trim();
  if (!request) {
    throw new Error("Builder task request is required.");
  }

  const conversationId = await getOrCreateConversation(options.conversationId ?? undefined, options.userId);
  await updateConversationExecutionDefaults(conversationId, { mode: "agent", pluginId: "builder" });

  await saveMessage(conversationId, "USER", request, {
    chatMode: "agent",
    chatPluginId: "builder",
  } as JsonObject);

  const execution = await launchBuilderTask(options.projectId, {
    request,
    ...(options.retryFailed ? { retryFailed: true } : {}),
    ...(options.taskId ? { taskId: options.taskId } : {}),
    ...(options.profile ? { profile: options.profile } : {}),
    ...(options.model ? { model: options.model } : {}),
  });

  const project = await getBuilderProject(options.projectId);
  const task = execution.taskId ? await getBuilderTask(execution.taskId).catch(() => null) : null;
  const card = buildTaskCard({
    id: execution.runId ? `run-${execution.runId}` : `planned-${project.id}-${Date.now()}`,
    project,
    taskId: execution.taskId,
    runId: execution.runId,
    title: task?.title ?? (execution.status === "PLANNED" ? `Planned Builder work for ${project.name}` : `Started Builder task for ${project.name}`),
    summary: execution.status === "PLANNED"
      ? "Builder refreshed project planning before launching the next runnable task. Review chat or Builder history, then launch again if needed."
      : task?.summary ?? task?.description ?? request,
    status: execution.status === "PLANNED" ? "planned" : "running",
    state: execution.status === "PLANNED" ? "planning" : (task?.stage.toLowerCase() ?? "implementing"),
    updatedAt: new Date(),
  });

  await saveMessage(conversationId, "ASSISTANT", `${project.name}: ${card.summary}`, {
    chatMode: "agent",
    chatPluginId: "builder",
    builderCards: [card],
  } as unknown as JsonObject);

  return {
    conversationId,
    card,
    execution,
  };
}

export async function resolveBuilderInteraction(options: {
  interactionId: string;
  action: "approve" | "reject" | "reconcile";
  conversationId?: string | null;
  reason?: string | null;
}): Promise<{ card: BuilderChatCard; summary: string; resolutionRunId: string }> {
  const interaction = await db.builderInteraction.findUnique({
    where: { id: options.interactionId },
    include: {
      project: true,
    },
  });

  if (!interaction) {
    throw new Error("Builder interaction not found.");
  }

  if (interaction.status !== "PENDING") {
    throw new Error("Builder interaction has already been resolved.");
  }

  const reason = options.reason?.trim()
    || (options.action === "approve"
      ? "Approved from chat Builder inbox."
      : options.action === "reject"
        ? "Rejected from chat Builder inbox."
        : "Reconciled from chat Builder inbox.");

  let commandInput:
    | { action: "reconcile_mcp_policy"; confirmed: true; reason: string }
    | { action: "resolve_mcp_contract_drift"; runId: string; decision: "approve" | "reject"; confirmed: true; reason: string }
    | { action: "resolve_dependency_contract_drift"; runId: string; decision: "approve" | "reject"; confirmed: true; reason: string }
    | { action: "resolve_file_topology_contract_drift"; runId: string; decision: "approve" | "reject"; confirmed: true; reason: string };

  switch (interaction.kind) {
    case "MCP_POLICY_RECONCILIATION": {
      if (options.action !== "reconcile") {
        throw new Error("This Builder interaction only supports reconcile.");
      }
      commandInput = { action: "reconcile_mcp_policy", confirmed: true, reason };
      break;
    }
    case "MCP_CONTRACT_DRIFT": {
      if (!interaction.runId) {
        throw new Error("Builder MCP drift interaction is missing a run id.");
      }
      if (options.action !== "approve" && options.action !== "reject") {
        throw new Error("This Builder interaction requires approve or reject.");
      }
      commandInput = { action: "resolve_mcp_contract_drift", runId: interaction.runId, decision: options.action, confirmed: true, reason };
      break;
    }
    case "DEPENDENCY_CONTRACT_DRIFT": {
      if (!interaction.runId) {
        throw new Error("Builder dependency interaction is missing a run id.");
      }
      if (options.action !== "approve" && options.action !== "reject") {
        throw new Error("This Builder interaction requires approve or reject.");
      }
      commandInput = { action: "resolve_dependency_contract_drift", runId: interaction.runId, decision: options.action, confirmed: true, reason };
      break;
    }
    case "FILE_TOPOLOGY_CONTRACT_DRIFT": {
      if (!interaction.runId) {
        throw new Error("Builder file topology interaction is missing a run id.");
      }
      if (options.action !== "approve" && options.action !== "reject") {
        throw new Error("This Builder interaction requires approve or reject.");
      }
      commandInput = { action: "resolve_file_topology_contract_drift", runId: interaction.runId, decision: options.action, confirmed: true, reason };
      break;
    }
    default:
      throw new Error("Unsupported Builder interaction kind.");
  }

  const execution = await recordBuilderProjectCommand(interaction.project, commandInput, {
    governanceSourceSurface: "api",
  });

  const nextStatus: BuilderInteractionStatus = options.action === "reject" ? "REJECTED" : "APPROVED";
  const updated = await db.builderInteraction.update({
    where: { id: interaction.id },
    data: {
      status: nextStatus,
      conversationId: options.conversationId ?? interaction.conversationId,
      resolutionReason: reason,
      resolvedAt: new Date(),
      metadata: {
        ...toInteractionMetadata(interaction.metadata as Prisma.JsonValue | null | undefined),
        resolutionRunId: execution.runId,
      } as Prisma.InputJsonValue,
    },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          relativePath: true,
        },
      },
    },
  });

  if (options.conversationId) {
    await saveMessage(
      options.conversationId,
      "ASSISTANT",
      `${interaction.project.name}: ${execution.summary ?? updated.summary}`,
      {
        chatMode: "agent",
        chatPluginId: "builder",
        builderCards: [serializeBuilderInteractionCard(updated)],
      } as unknown as JsonObject,
    );
  }

  await syncBuilderProjectInteractions(interaction.projectId, {
    conversationId: options.conversationId ?? interaction.conversationId,
  });

  return {
    card: serializeBuilderInteractionCard(updated),
    summary: execution.summary ?? updated.summary,
    resolutionRunId: execution.runId,
  };
}
