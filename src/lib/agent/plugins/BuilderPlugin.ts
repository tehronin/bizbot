/** BuilderPlugin — Sandbox builder tools for an external project workspace. */

import type { BuilderPackageManager, BuilderRunKind } from "@prisma/client";
import { loadBuilderProjectContext, syncBuilderProjectProjection } from "@/lib/builder/context";
import {
  completeBuilderRun,
  createBuilderProject,
  createBuilderRun,
  deleteBuilderProject,
  getBuilderProject,
  getBuilderRun,
  listBuilderProjects,
  listBuilderRuns,
  updateBuilderProject,
} from "@/lib/builder/projects";
import {
  describeBuilderDatabaseTable,
  getBuilderDatabaseSchemaSummary,
  listBuilderDatabaseMigrations,
  listBuilderDatabaseTables,
} from "@/lib/builder/database-introspection";
import {
  getBuilderEnvSchema,
  listBuilderRequiredConfig,
  readBuilderProjectEnvValue,
  syncBuilderProjectEnvExample,
  validateBuilderProjectEnv,
  writeBuilderProjectEnvFileEntry,
} from "@/lib/builder/environment";
import { builderHttpRequest } from "@/lib/builder/http";
import {
  cleanStaleBuilderManagedContainers,
  execBuilderRuntimeContainerCommand,
  execBuilderRuntimeServiceCommand,
  getBuilderRuntimeContainer,
  getBuilderRuntimeContainerLogs,
  getBuilderRuntimeServiceLogs,
  listBuilderManagedContainers,
  removeBuilderManagedContainers,
  listBuilderRuntimeContainers,
  listBuilderRuntimeServices,
  listBuilderRuntimeContainerFiles,
  readBuilderRuntimeContainerFile,
  restartBuilderRuntimeService,
  startBuilderRuntimeService,
  statBuilderRuntimeContainerPath,
  stopBuilderRuntimeService,
  testBuilderRuntimeContainer,
} from "@/lib/builder/runtime-orchestration";
import { validateBuilderContainerStage } from "@/lib/builder/container-stage";
import { listBuilderTasks } from "@/lib/builder/tasks";
import {
  appendBuilderFile,
  applyBuilderPatch,
  builderPathExists,
  createBuilderDirectory,
  deleteBuilderPath,
  ensureBuilderDirectory,
  getBuilderWorkspaceStatus,
  listBuilderFiles,
  moveBuilderPath,
  readBuilderFile,
  runBuilderCommand,
  scaffoldBuilderNodePackage,
  statBuilderPath,
  writeBuilderFile,
} from "@/lib/builder/workspace";
import {
  getBuilderManagedProcess,
  listBuilderManagedProcesses,
  startBuilderManagedProcess,
  stopBuilderManagedProcess,
  streamBuilderManagedProcessLogs,
  waitForBuilderManagedProcess,
} from "@/lib/builder/process-registry";
import {
  addBuilderRepoRemote,
  cleanBuilderRepo,
  commitBuilderRepo,
  cloneBuilderRepo,
  createBuilderRepoBranch,
  fetchBuilderRepoRemote,
  getBuilderRepoDiff,
  getBuilderRepoLog,
  getBuilderRepoStatus,
  listBuilderRepoBranches,
  listBuilderRepoRemotes,
  listBuilderRepoTags,
  manageBuilderRepoBranch,
  mergeBuilderRepoBranch,
  pullBuilderRepoRemote,
  pushBuilderRepoRemote,
  revParseBuilderRepo,
  rebaseBuilderRepo,
  removeBuilderRepoRemote,
  showBuilderRepoObject,
  stageBuilderRepoPaths,
  switchBuilderRepoBranch,
  unstageBuilderRepoPaths,
} from "@/lib/builder/vcs";
import type { BuilderCapabilityAuditContext } from "@/lib/builder/audit";
import { defineTool, registerTool, type ToolDefinition, type ToolExecutionResult } from "@/lib/agent/tools";
import type { runBuilderProjectBootstrap } from "@/lib/builder/bootstrap";
import type { recordBuilderProjectCommand } from "@/lib/builder/commands";
import type { getBuilderProjectOverview, launchBuilderTask, planBuilderProject } from "@/lib/builder/orchestrator";
import type { SidecarToolResult } from "@/lib/sidecar/types";

async function loadBuilderBootstrap() {
  return import("@/lib/builder/bootstrap");
}

async function loadBuilderCommands() {
  return import("@/lib/builder/commands");
}

async function loadBuilderGenerator() {
  return import("@/lib/builder/command-generator");
}

async function loadBuilderOrchestrator() {
  return import("@/lib/builder/orchestrator");
}

interface BuilderListArgs {
  subdir?: string;
}

interface BuilderReadArgs {
  path: string;
}

interface BuilderWriteArgs {
  path: string;
  content: string;
}

interface BuilderAppendArgs {
  path: string;
  content: string;
}

interface BuilderDeletePathArgs {
  path: string;
}

interface BuilderMovePathArgs {
  fromPath: string;
  toPath: string;
}

interface BuilderCreateDirectoryArgs {
  path: string;
}

interface BuilderPathArgs {
  path: string;
}

interface BuilderPatchArgs {
  patch: string;
  cwd?: string;
}

interface BuilderRunCommandArgs {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutSeconds?: number;
}

interface BuilderStartProcessArgs {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutSeconds?: number;
  projectId?: string;
  taskId?: string;
  runId?: string;
}

interface BuilderProcessArgs {
  processId: string;
}

interface BuilderListProcessesArgs {
  statuses?: Array<"running" | "exited" | "failed" | "cancelled" | "timed_out">;
  includeFinished?: boolean;
  commandContains?: string;
  cwdPrefix?: string;
  startedAfter?: string;
  startedBefore?: string;
  projectId?: string;
  taskId?: string;
  runId?: string;
  limit?: number;
}

interface BuilderProcessLogArgs extends BuilderProcessArgs {
  cursor?: number;
  maxChars?: number;
  maxBytes?: number;
  tailBytes?: number;
  followSeconds?: number;
}

interface BuilderWaitProcessArgs extends BuilderProcessArgs {
  timeoutSeconds?: number;
}

interface BuilderScaffoldArgs {
  projectDir: string;
  packageName: string;
  description?: string;
  entrypoint?: string;
}

interface BuilderCreateProjectArgs {
  name: string;
  slug?: string;
  relativePath?: string;
  template?: string;
  packageManager?: BuilderPackageManager;
}

interface BuilderProjectArgs {
  projectId: string;
}

interface BuilderDeleteProjectArgs {
  projectId: string;
  deleteFiles?: boolean;
}

interface BuilderBootstrapProjectArgs {
  projectId: string;
  initializeGit?: boolean;
  installDependencies?: boolean;
}

interface BuilderInstallDependenciesArgs {
  projectId: string;
  packages?: string[];
  dev?: boolean;
}

interface BuilderRunScriptArgs {
  projectId: string;
  script: string;
  args?: string[];
}

interface BuilderRunGeneratorArgs {
  projectId: string;
  generator: string;
  args?: string[];
}

interface BuilderRunAgenticTaskArgs {
  projectId: string;
  prompt: string;
  profile?: string;
  model?: string;
  args?: string[];
}

interface BuilderRunArgs {
  runId: string;
}

interface BuilderRepoArgs {
  subdir?: string;
  projectId?: string;
  taskId?: string;
  runId?: string;
}

interface BuilderRepoDiffArgs extends BuilderRepoArgs {
  staged?: boolean;
  paths?: string[];
}

interface BuilderRepoLogArgs extends BuilderRepoArgs {
  limit?: number;
  ref?: string;
  paths?: string[];
}

interface BuilderRepoShowArgs extends BuilderRepoArgs {
  revision: string;
  stat?: boolean;
}

interface BuilderRepoRevParseArgs extends BuilderRepoArgs {
  revision?: string;
}

interface BuilderRepoPathsArgs extends BuilderRepoArgs {
  paths: string[];
}

interface BuilderRepoCommitArgs extends BuilderRepoArgs {
  message: string;
  allowEmpty?: boolean;
}

interface BuilderRepoBranchArgs extends BuilderRepoArgs {
  name: string;
  checkout?: boolean;
  force?: boolean;
  confirmed?: boolean;
  reason?: string;
}

interface BuilderRepoCheckoutArgs extends BuilderRepoArgs {
  name: string;
  create?: boolean;
}

interface BuilderRepoMergeArgs extends BuilderRepoArgs {
  name: string;
  ffOnly?: boolean;
  noCommit?: boolean;
  confirmed: boolean;
  reason: string;
}

interface BuilderRepoRebaseArgs extends BuilderRepoArgs {
  upstream: string;
  confirmed: boolean;
  reason: string;
}

interface BuilderRepoCleanArgs extends BuilderRepoArgs {
  force: boolean;
  directories?: boolean;
  includeIgnored?: boolean;
  confirmed: boolean;
  reason: string;
}

interface BuilderRepoRemoteArgs extends BuilderRepoArgs {
  name?: string;
  remote?: string;
  remoteUrl?: string;
  branch?: string;
  refspec?: string;
  targetPath?: string;
  setUpstream?: boolean;
  force?: boolean;
  confirmed?: boolean;
  reason?: string;
}

interface BuilderHttpArgs {
  projectId: string;
  url: string;
  headers?: Array<{ name: string; value: string }>;
  body?: string;
  contentType?: string;
  timeoutSeconds?: number;
  maxBytes?: number;
  maxRequestBytes?: number;
  retryCount?: number;
  authEnvKey?: string;
  authHeaderName?: string;
  authScheme?: string;
}

interface BuilderDatabaseTableArgs {
  projectId: string;
  name: string;
}

interface BuilderContinueTaskArgs {
  projectId: string;
  request: string;
  taskId?: string;
  retryFailed?: boolean;
  profile?: string;
  model?: string;
}

interface BuilderPlanProjectArgs {
  projectId: string;
  title?: string;
  summary?: string;
  goals?: string[];
  constraints?: string[];
  deliverables?: string[];
  notes?: string;
  regenerate?: boolean;
}

interface BuilderWriteProjectInstructionsArgs {
  projectId: string;
  objective?: string;
  architectureNotes?: string[];
  conventions?: string[];
  constraints?: string[];
  commands?: string[];
  instructionNotes?: string;
}

interface BuilderEnvKeyArgs {
  projectId: string;
  key: string;
}

interface BuilderEnvWriteArgs extends BuilderEnvKeyArgs {
  value: string;
  file?: ".env" | ".env.local";
}

interface BuilderGovernanceApprovalArgs extends BuilderProjectArgs {
  confirmed: boolean;
  reason: string;
}

interface BuilderGovernanceDriftArgs extends BuilderGovernanceApprovalArgs {
  runId: string;
  decision: "approve" | "reject";
}

interface BuilderRuntimeServiceLogsArgs extends BuilderProjectArgs {
  serviceId: string;
  cursor?: number;
  maxBytes?: number;
  tailBytes?: number;
  followSeconds?: number;
}

interface BuilderRuntimeServiceControlArgs extends BuilderProjectArgs {
  serviceId: string;
}

interface BuilderRuntimeExecArgs extends BuilderRuntimeServiceControlArgs {
  command: string;
  commandArgs?: string[];
  timeoutSeconds?: number;
}

interface BuilderRuntimeContainerListArgs extends BuilderProjectArgs {
  includeStopped?: boolean;
}

interface BuilderRuntimeContainerPathArgs extends BuilderRuntimeServiceControlArgs {
  path: string;
}

interface BuilderRuntimeContainerFileListArgs extends BuilderRuntimeContainerPathArgs {
  maxEntries?: number;
  includeHidden?: boolean;
}

interface BuilderRuntimeContainerFileReadArgs extends BuilderRuntimeContainerPathArgs {
  maxBytes?: number;
}

interface BuilderRuntimeContainerTestArgs extends BuilderRuntimeServiceControlArgs {
  preset: "npm_test" | "npm_vitest" | "pnpm_test" | "pnpm_vitest" | "pytest";
  args?: string[];
  timeoutSeconds?: number;
}

interface BuilderManagedContainerListArgs {
  projectId?: string;
  status?: "running" | "stopped" | "all";
  olderThanMinutes?: number;
  limit?: number;
}

interface BuilderManagedContainerRemoveArgs extends BuilderManagedContainerListArgs {
  containerIds?: string[];
  confirmed: boolean;
  reason: string;
}

interface BuilderManagedContainerCleanupArgs extends Omit<BuilderManagedContainerRemoveArgs, "status"> {}

interface BuilderContainerStageValidationArgs extends BuilderProjectArgs {
  stopAfterValidation?: boolean;
  taskId?: string;
  runId?: string;
}

function formatPlanAsSidecarMarkdown(overview: Awaited<ReturnType<typeof import("@/lib/builder/orchestrator").planBuilderProject>>): string {
  const lines: string[] = [];
  const brief = overview.brief;
  if (brief?.title) {
    lines.push(`## ${brief.title}`);
  }
  if (brief?.summary) {
    lines.push("", brief.summary);
  }
  if (overview.milestones?.length) {
    lines.push("", "### Milestones");
    for (const ms of overview.milestones) {
      const done = ms.status === "COMPLETE" ? "✓" : "○";
      const title = ms.title;
      lines.push(`- ${done} ${title}`);
    }
  }
  if (overview.nextRecommendedStep) {
    lines.push("", "### Next Step", overview.nextRecommendedStep);
  }
  return lines.join("\n");
}

function buildPlanSidecar(overview: Awaited<ReturnType<typeof import("@/lib/builder/orchestrator").planBuilderProject>>): SidecarToolResult {
  const markdown = formatPlanAsSidecarMarkdown(overview);
  return {
    ok: true,
    action: "open",
    panel: {
      panelId: `builder-plan-${overview.project.id}`,
      title: overview.brief?.title ? `Plan: ${overview.brief.title}` : "Builder Plan",
      persistence: "workflow",
      content: { type: "markdown", markdown },
    },
  };
}

function assertExplicitGovernanceApproval(args: { confirmed: boolean; reason: string }, actionLabel: string): string {
  if (!args.confirmed) {
    throw new Error(`${actionLabel} requires explicit operator confirmation.`);
  }

  const reason = args.reason.trim();
  if (!reason) {
    throw new Error(`${actionLabel} requires a non-empty approval reason.`);
  }

  return reason;
}

async function resolveBuilderRepoInvocation(args: BuilderRepoArgs): Promise<{
  subdir: string;
  projectId: string | null;
  taskId: string | null;
  parentRunId: string | null;
}> {
  if (args.projectId) {
    const project = await getBuilderProject(args.projectId);
    return {
      subdir: args.subdir?.trim() || project.relativePath,
      projectId: project.id,
      taskId: args.taskId ?? null,
      parentRunId: args.runId ?? null,
    };
  }

  return {
    subdir: args.subdir?.trim() || ".",
    projectId: null,
    taskId: args.taskId ?? null,
    parentRunId: args.runId ?? null,
  };
}

function toBuilderRunKind(value: string): BuilderRunKind {
  return value as BuilderRunKind;
}

async function executeBuilderGitMutation<TResult extends object>(args: {
  repoArgs: BuilderRepoArgs;
  kind: string;
  title: string;
  command: string;
  commandArgs?: unknown;
  metadata?: Record<string, unknown>;
  execute: (context: { subdir: string; audit: BuilderCapabilityAuditContext }) => TResult | Promise<TResult>;
  resultMetadata?: (result: TResult) => Record<string, unknown>;
}): Promise<TResult & { builderRunId: string | null }> {
  const invocation = await resolveBuilderRepoInvocation(args.repoArgs);
  const baseMetadata = {
    parentRunId: invocation.parentRunId,
    requestedSubdir: args.repoArgs.subdir ?? null,
    ...args.metadata,
  };

  let builderRunId: string | null = null;
  if (invocation.projectId) {
    const run = await createBuilderRun({
      projectId: invocation.projectId,
      taskId: invocation.taskId ?? undefined,
      kind: toBuilderRunKind(args.kind),
      title: args.title,
      command: args.command,
      args: args.commandArgs,
      metadata: baseMetadata,
    });
    builderRunId = run.id;
  }

  try {
    const result = await args.execute({
      subdir: invocation.subdir,
      audit: {
        projectId: invocation.projectId,
        taskId: invocation.taskId,
        runId: builderRunId,
      },
    });
    if (builderRunId) {
      await completeBuilderRun(builderRunId, {
        status: "SUCCEEDED",
        summary: args.title,
        metadata: {
          ...baseMetadata,
          ...(args.resultMetadata ? args.resultMetadata(result) : {}),
        },
      });
    }
    return { ...result, builderRunId };
  } catch (error) {
    if (builderRunId) {
      await completeBuilderRun(builderRunId, {
        status: "FAILED",
        stderr: error instanceof Error ? error.message : String(error),
        summary: error instanceof Error ? error.message : String(error),
        metadata: baseMetadata,
      });
    }
    throw error;
  }
}

async function executeBuilderProjectMutation<TResult extends object>(args: {
  projectId: string;
  taskId?: string;
  runId?: string;
  kind: string;
  title: string;
  command: string;
  commandArgs?: unknown;
  metadata?: Record<string, unknown>;
  execute: (context: { project: Awaited<ReturnType<typeof getBuilderProject>>; builderRunId: string | null }) => TResult | Promise<TResult>;
  resultMetadata?: (result: TResult) => Record<string, unknown>;
  statusForResult?: (result: TResult) => "SUCCEEDED" | "FAILED" | "CANCELLED";
}): Promise<TResult & { builderRunId: string | null }> {
  const project = await getBuilderProject(args.projectId);
  const baseMetadata = {
    parentRunId: args.runId ?? null,
    ...args.metadata,
  };

  const run = await createBuilderRun({
    projectId: project.id,
    taskId: args.taskId,
    kind: toBuilderRunKind(args.kind),
    title: args.title,
    command: args.command,
    args: args.commandArgs,
    metadata: baseMetadata,
  });

  try {
    const result = await args.execute({ project, builderRunId: run.id });
    const resolvedStatus = args.statusForResult ? args.statusForResult(result) : "SUCCEEDED";
    await completeBuilderRun(run.id, {
      status: resolvedStatus,
      summary: args.title,
      metadata: {
        ...baseMetadata,
        ...(args.resultMetadata ? args.resultMetadata(result) : {}),
      },
    });
    return { ...result, builderRunId: run.id };
  } catch (error) {
    await completeBuilderRun(run.id, {
      status: "FAILED",
      stderr: error instanceof Error ? error.message : String(error),
      summary: error instanceof Error ? error.message : String(error),
      metadata: baseMetadata,
    });
    throw error;
  }
}

export const builderPlugin = {
  tools: [
    registerTool(defineTool({
      name: "builder_get_status",
      description: "Inspect the dedicated Builder Mode workspace, repository guard, and allowed command list.",
      parameters: { type: "object", properties: {} },
      execute: async () => getBuilderWorkspaceStatus(),
    } satisfies ToolDefinition<Record<string, never>, ReturnType<typeof getBuilderWorkspaceStatus>>)),
    registerTool(defineTool({
      name: "builder_list_projects",
      description: "List persisted Builder Mode projects managed inside the dedicated builder workspace.",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ projects: await listBuilderProjects() }),
    } satisfies ToolDefinition<Record<string, never>, { projects: Awaited<ReturnType<typeof listBuilderProjects>> }>)),
    registerTool(defineTool({
      name: "builder_create_project",
      description: "Create a named Builder Mode project and reserve its dedicated folder inside the builder workspace.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          slug: { type: "string" },
          relativePath: { type: "string" },
          template: { type: "string" },
          packageManager: { type: "string", enum: ["NPM", "PNPM"] },
        },
        required: ["name"],
      },
      execute: async ({ name, slug, relativePath, template, packageManager }: BuilderCreateProjectArgs) => ({
        project: await createBuilderProject({ name, slug, relativePath, template, packageManager }),
      }),
    } satisfies ToolDefinition<BuilderCreateProjectArgs, { project: Awaited<ReturnType<typeof createBuilderProject>> }>)),
    registerTool(defineTool({
      name: "builder_get_project",
      description: "Read a Builder Mode project and its recent run history.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId }: BuilderProjectArgs) => ({
        ...((await loadBuilderOrchestrator()).getBuilderProjectOverview(projectId)),
      }),
    } satisfies ToolDefinition<BuilderProjectArgs, Awaited<ReturnType<typeof getBuilderProjectOverview>>>)),
    registerTool(defineTool({
      name: "builder_get_env_schema",
      description: "Read the declared project env schema from .env.example inside a Builder project.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId }: BuilderProjectArgs) => {
        const project = await getBuilderProject(projectId);
        return {
          projectId,
          ...getBuilderEnvSchema(project.relativePath, { projectId, projectRelativePath: project.relativePath }),
        };
      },
    } satisfies ToolDefinition<BuilderProjectArgs, { projectId: string; path: ReturnType<typeof getBuilderEnvSchema>["path"]; keys: string[] }>)),
    registerTool(defineTool({
      name: "builder_validate_env",
      description: "Evaluate project-local and execution-time env readiness for a Builder project.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId }: BuilderProjectArgs) => {
        const project = await getBuilderProject(projectId);
        return {
          projectId,
          readiness: validateBuilderProjectEnv(project.relativePath, { projectId, projectRelativePath: project.relativePath }),
        };
      },
    } satisfies ToolDefinition<BuilderProjectArgs, { projectId: string; readiness: ReturnType<typeof validateBuilderProjectEnv> }>)),
    registerTool(defineTool({
      name: "builder_read_env_value",
      description: "Read a Builder project env value with redaction by default and source attribution.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          key: { type: "string" },
        },
        required: ["projectId", "key"],
      },
      execute: async ({ projectId, key }: BuilderEnvKeyArgs) => {
        const project = await getBuilderProject(projectId);
        return {
          projectId,
          ...readBuilderProjectEnvValue(project.relativePath, key, undefined, { projectId, projectRelativePath: project.relativePath }),
        };
      },
    } satisfies ToolDefinition<BuilderEnvKeyArgs, { projectId: string } & ReturnType<typeof readBuilderProjectEnvValue>>)),
    registerTool(defineTool({
      name: "builder_write_env_file_entry",
      description: "Safely write or update a project-local env entry in .env or .env.local for a Builder project.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          key: { type: "string" },
          value: { type: "string" },
          file: { type: "string", enum: [".env", ".env.local"] },
        },
        required: ["projectId", "key", "value"],
      },
      execute: async ({ projectId, key, value, file }: BuilderEnvWriteArgs) => {
        const project = await getBuilderProject(projectId);
        return {
          projectId,
          ...writeBuilderProjectEnvFileEntry(project.relativePath, { key, value, file }, { projectId, projectRelativePath: project.relativePath }),
        };
      },
    } satisfies ToolDefinition<BuilderEnvWriteArgs, { projectId: string } & ReturnType<typeof writeBuilderProjectEnvFileEntry>>)),
    registerTool(defineTool({
      name: "builder_sync_env_example",
      description: "Sync .env.example to include the union of keys currently used in the Builder project's env files.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId }: BuilderProjectArgs) => {
        const project = await getBuilderProject(projectId);
        return {
          projectId,
          ...syncBuilderProjectEnvExample(project.relativePath),
        };
      },
    } satisfies ToolDefinition<BuilderProjectArgs, { projectId: string } & ReturnType<typeof syncBuilderProjectEnvExample>>)),
    registerTool(defineTool({
      name: "builder_list_required_config",
      description: "List required config keys declared for a Builder project from .env.example.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId }: BuilderProjectArgs) => {
        const project = await getBuilderProject(projectId);
        return {
          projectId,
          ...listBuilderRequiredConfig(project.relativePath, { projectId, projectRelativePath: project.relativePath }),
        };
      },
    } satisfies ToolDefinition<BuilderProjectArgs, { projectId: string; keys: string[] }>)),
    registerTool(defineTool({
      name: "builder_reconcile_mcp_policy",
      description: "Rebuild the Builder MCP policy baseline for a project after an operator explicitly confirms the governance change.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          confirmed: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["projectId", "confirmed", "reason"],
      },
      execute: async ({ projectId, confirmed, reason }: BuilderGovernanceApprovalArgs) => {
        const approvalReason = assertExplicitGovernanceApproval({ confirmed, reason }, "Builder MCP policy reconciliation");
        const project = await getBuilderProject(projectId);
        return (await loadBuilderCommands()).recordBuilderProjectCommand(project, {
          action: "reconcile_mcp_policy",
          confirmed: true,
          reason: approvalReason,
        });
      },
    } satisfies ToolDefinition<BuilderGovernanceApprovalArgs, Awaited<ReturnType<typeof recordBuilderProjectCommand>>>)),
    registerTool(defineTool({
      name: "builder_resolve_mcp_contract_drift",
      description: "Approve or reject Builder MCP contract drift after explicit operator confirmation.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          runId: { type: "string" },
          decision: { type: "string", enum: ["approve", "reject"] },
          confirmed: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["projectId", "runId", "decision", "confirmed", "reason"],
      },
      execute: async ({ projectId, runId, decision, confirmed, reason }: BuilderGovernanceDriftArgs) => {
        const approvalReason = assertExplicitGovernanceApproval({ confirmed, reason }, "Builder MCP contract drift resolution");
        const project = await getBuilderProject(projectId);
        return (await loadBuilderCommands()).recordBuilderProjectCommand(project, {
          action: "resolve_mcp_contract_drift",
          runId,
          decision,
          confirmed: true,
          reason: approvalReason,
        });
      },
    } satisfies ToolDefinition<BuilderGovernanceDriftArgs, Awaited<ReturnType<typeof recordBuilderProjectCommand>>>)),
    registerTool(defineTool({
      name: "builder_resolve_dependency_contract_drift",
      description: "Approve or reject Builder dependency contract drift after explicit operator confirmation.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          runId: { type: "string" },
          decision: { type: "string", enum: ["approve", "reject"] },
          confirmed: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["projectId", "runId", "decision", "confirmed", "reason"],
      },
      execute: async ({ projectId, runId, decision, confirmed, reason }: BuilderGovernanceDriftArgs) => {
        const approvalReason = assertExplicitGovernanceApproval({ confirmed, reason }, "Builder dependency contract drift resolution");
        const project = await getBuilderProject(projectId);
        return (await loadBuilderCommands()).recordBuilderProjectCommand(project, {
          action: "resolve_dependency_contract_drift",
          runId,
          decision,
          confirmed: true,
          reason: approvalReason,
        });
      },
    } satisfies ToolDefinition<BuilderGovernanceDriftArgs, Awaited<ReturnType<typeof recordBuilderProjectCommand>>>)),
    registerTool(defineTool({
      name: "builder_resolve_file_topology_contract_drift",
      description: "Approve or reject Builder file topology contract drift after explicit operator confirmation.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          runId: { type: "string" },
          decision: { type: "string", enum: ["approve", "reject"] },
          confirmed: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["projectId", "runId", "decision", "confirmed", "reason"],
      },
      execute: async ({ projectId, runId, decision, confirmed, reason }: BuilderGovernanceDriftArgs) => {
        const approvalReason = assertExplicitGovernanceApproval({ confirmed, reason }, "Builder file topology contract drift resolution");
        const project = await getBuilderProject(projectId);
        return (await loadBuilderCommands()).recordBuilderProjectCommand(project, {
          action: "resolve_file_topology_contract_drift",
          runId,
          decision,
          confirmed: true,
          reason: approvalReason,
        });
      },
    } satisfies ToolDefinition<BuilderGovernanceDriftArgs, Awaited<ReturnType<typeof recordBuilderProjectCommand>>>)),
    registerTool(defineTool({
      name: "builder_plan_project",
      description: "Persist or update a canonical Builder project brief, generate the relational project plan, and sync the staged project overview.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          goals: { type: "array", items: { type: "string" } },
          constraints: { type: "array", items: { type: "string" } },
          deliverables: { type: "array", items: { type: "string" } },
          notes: { type: "string" },
          regenerate: { type: "boolean" },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId, title, summary, goals, constraints, deliverables, notes, regenerate }: BuilderPlanProjectArgs) => {
        const overview = await (await loadBuilderOrchestrator()).planBuilderProject(projectId, {
          title: title ?? "",
          summary: summary ?? "",
          goals,
          constraints,
          deliverables,
          notes,
          regenerate,
        });
        return { ...overview, _sidecar: buildPlanSidecar(overview) };
      },
    } satisfies ToolDefinition<BuilderPlanProjectArgs, Awaited<ReturnType<typeof planBuilderProject>>>)),
    registerTool(defineTool({
      name: "builder_list_tasks",
      description: "List persisted Builder tasks for a Builder Mode project so work can continue across turns.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId }: BuilderProjectArgs) => ({ tasks: await listBuilderTasks(projectId, 25) }),
    } satisfies ToolDefinition<BuilderProjectArgs, { tasks: Awaited<ReturnType<typeof listBuilderTasks>> }>)),
    registerTool(defineTool({
      name: "builder_plan_task",
      description: "Start a persistent Builder task for a project using compact synthesized context instead of a one-shot raw prompt.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          request: { type: "string" },
          profile: { type: "string", default: "codex" },
          model: { type: "string" },
        },
        required: ["projectId", "request"],
      },
        execute: async ({ projectId, request, profile, model }: BuilderContinueTaskArgs) => (await loadBuilderOrchestrator()).launchBuilderTask(projectId, { request, profile, model }),
    } satisfies ToolDefinition<BuilderContinueTaskArgs, Awaited<ReturnType<typeof launchBuilderTask>>>)),
    registerTool(defineTool({
      name: "builder_continue_task",
      description: "Continue the current open Builder task, or reopen the most recent failed task when retryFailed is true.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          request: { type: "string" },
          taskId: { type: "string" },
          retryFailed: { type: "boolean" },
          profile: { type: "string", default: "codex" },
          model: { type: "string" },
        },
        required: ["projectId", "request"],
      },
      execute: async ({ projectId, request, taskId, retryFailed, profile, model }: BuilderContinueTaskArgs) =>
          (await loadBuilderOrchestrator()).launchBuilderTask(projectId, { request, taskId, retryFailed, profile, model }),
    } satisfies ToolDefinition<BuilderContinueTaskArgs, Awaited<ReturnType<typeof launchBuilderTask>>>)),
    registerTool(defineTool({
      name: "builder_write_project_instructions",
      description: "Update durable Builder project instructions and sync them into the project's .builder projection files.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          objective: { type: "string" },
          architectureNotes: { type: "array", items: { type: "string" } },
          conventions: { type: "array", items: { type: "string" } },
          constraints: { type: "array", items: { type: "string" } },
          commands: { type: "array", items: { type: "string" } },
          instructionNotes: { type: "string" },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId, objective, architectureNotes, conventions, constraints, commands, instructionNotes }: BuilderWriteProjectInstructionsArgs) => {
        const project = await getBuilderProject(projectId);
        const { context } = loadBuilderProjectContext(project);
        const nextContext = {
          ...context,
          ...(objective !== undefined ? { objective } : {}),
          ...(architectureNotes !== undefined ? { architectureNotes } : {}),
          ...(conventions !== undefined ? { codingConventions: conventions } : {}),
          ...(constraints !== undefined ? { constraints } : {}),
          ...(commands !== undefined ? { importantCommands: commands } : {}),
          ...(instructionNotes !== undefined ? { instructionNotes } : {}),
          updatedAt: new Date().toISOString(),
        };
        const updatedProject = await updateBuilderProject(projectId, {
          context: nextContext as never,
          latestSessionSummary: nextContext.latestSessionSummary,
        });
        syncBuilderProjectProjection({ project: updatedProject, context: nextContext });
        return { project: updatedProject, context: nextContext };
      },
    } satisfies ToolDefinition<BuilderWriteProjectInstructionsArgs, { project: Awaited<ReturnType<typeof updateBuilderProject>>; context: ReturnType<typeof loadBuilderProjectContext>["context"] }>)),
    registerTool(defineTool({
      name: "builder_delete_project",
      description: "Delete a Builder Mode project record and optionally remove its reserved folder.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          deleteFiles: { type: "boolean", default: false },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId, deleteFiles }: BuilderDeleteProjectArgs) => deleteBuilderProject(projectId, { deleteFiles }),
    } satisfies ToolDefinition<BuilderDeleteProjectArgs, Awaited<ReturnType<typeof deleteBuilderProject>>>)),
    registerTool(defineTool({
      name: "builder_bootstrap_project",
      description: "Bootstrap a Builder Mode project from its selected preset, then optionally initialize git and install dependencies.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          initializeGit: { type: "boolean" },
          installDependencies: { type: "boolean" },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId, initializeGit, installDependencies }: BuilderBootstrapProjectArgs) =>
          (await loadBuilderBootstrap()).runBuilderProjectBootstrap(projectId, { initializeGit, installDependencies }),
    } satisfies ToolDefinition<BuilderBootstrapProjectArgs, Awaited<ReturnType<typeof runBuilderProjectBootstrap>>>)),
    registerTool(defineTool({
      name: "builder_initialize_git",
      description: "Initialize a git repository for a Builder Mode project.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId }: BuilderProjectArgs) => {
        const project = await getBuilderProject(projectId);
          return (await loadBuilderCommands()).recordBuilderProjectCommand(project, { action: "initialize_git" });
      },
    } satisfies ToolDefinition<BuilderProjectArgs, Awaited<ReturnType<typeof recordBuilderProjectCommand>>>)),
    registerTool(defineTool({
      name: "builder_install_dependencies",
      description: "Install project dependencies or add packages using the project's configured package manager.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          packages: { type: "array", items: { type: "string" } },
          dev: { type: "boolean", default: false },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId, packages, dev }: BuilderInstallDependenciesArgs) => {
        const project = await getBuilderProject(projectId);
          return (await loadBuilderCommands()).recordBuilderProjectCommand(project, { action: "install_dependencies", packages, dev });
      },
    } satisfies ToolDefinition<BuilderInstallDependenciesArgs, Awaited<ReturnType<typeof recordBuilderProjectCommand>>>)),
    registerTool(defineTool({
      name: "builder_run_script",
      description: "Run a named package script inside a Builder Mode project.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          script: { type: "string" },
          args: { type: "array", items: { type: "string" } },
        },
        required: ["projectId", "script"],
      },
      execute: async ({ projectId, script, args }: BuilderRunScriptArgs) => {
        const project = await getBuilderProject(projectId);
          return (await loadBuilderCommands()).recordBuilderProjectCommand(project, { action: "run_script", script, args });
      },
    } satisfies ToolDefinition<BuilderRunScriptArgs, Awaited<ReturnType<typeof recordBuilderProjectCommand>>>)),
    registerTool(defineTool({
      name: "builder_add_dependency",
      description: "Add one or more dependencies to a Builder Mode project using the configured package manager.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          packages: { type: "array", items: { type: "string" } },
          dev: { type: "boolean", default: false },
        },
        required: ["projectId", "packages"],
      },
      execute: async ({ projectId, packages, dev }: BuilderInstallDependenciesArgs) => {
        const project = await getBuilderProject(projectId);
          return (await loadBuilderCommands()).recordBuilderProjectCommand(project, { action: "add_dependency", packages: packages ?? [], dev });
      },
    } satisfies ToolDefinition<BuilderInstallDependenciesArgs, Awaited<ReturnType<typeof recordBuilderProjectCommand>>>)),
    registerTool(defineTool({
      name: "builder_run_generator",
      description: "Run a one-shot generator package through npx inside a Builder Mode project.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          generator: { type: "string" },
          args: { type: "array", items: { type: "string" } },
        },
        required: ["projectId", "generator"],
      },
      execute: async ({ projectId, generator, args }: BuilderRunGeneratorArgs) => {
        const project = await getBuilderProject(projectId);
          return (await loadBuilderGenerator()).recordBuilderGeneratorCommand(project, { action: "run_generator", generator, args });
      },
    } satisfies ToolDefinition<BuilderRunGeneratorArgs, Awaited<ReturnType<typeof recordBuilderProjectCommand>>>)),
    registerTool(defineTool({
      name: "builder_run_agentic_task",
      description: "Run an optional non-interactive builder CLI profile such as Codex against a specific builder project.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          prompt: { type: "string" },
          profile: { type: "string", default: "codex" },
          model: { type: "string" },
          args: { type: "array", items: { type: "string" } },
        },
        required: ["projectId", "prompt"],
      },
      execute: async ({ projectId, prompt, profile, model, args }: BuilderRunAgenticTaskArgs) => {
        const project = await getBuilderProject(projectId);
          return (await loadBuilderCommands()).recordBuilderProjectCommand(project, { action: "run_agentic_task", prompt, profile, model, args });
      },
    } satisfies ToolDefinition<BuilderRunAgenticTaskArgs, Awaited<ReturnType<typeof recordBuilderProjectCommand>>>)),
    registerTool(defineTool({
      name: "builder_list_runs",
      description: "List recent Builder Mode runs across all projects or a specific project.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
        },
      },
      execute: async ({ projectId }: Partial<BuilderProjectArgs>) => ({ runs: await listBuilderRuns(projectId, 25) }),
    } satisfies ToolDefinition<Partial<BuilderProjectArgs>, { runs: Awaited<ReturnType<typeof listBuilderRuns>> }>)),
    registerTool(defineTool({
      name: "builder_get_run",
      description: "Read a specific Builder Mode run record including its captured output summary.",
      parameters: {
        type: "object",
        properties: {
          runId: { type: "string" },
        },
        required: ["runId"],
      },
      execute: async ({ runId }: BuilderRunArgs) => ({ run: await getBuilderRun(runId) }),
    } satisfies ToolDefinition<BuilderRunArgs, { run: Awaited<ReturnType<typeof getBuilderRun>> }>)),
    registerTool(defineTool({
      name: "builder_list_files",
      description: "List files inside the external Builder Mode workspace.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
        },
      },
      execute: async ({ subdir }: BuilderListArgs) => ({ files: listBuilderFiles(subdir ?? ".") }),
    } satisfies ToolDefinition<BuilderListArgs, { files: ReturnType<typeof listBuilderFiles> }>)),
    registerTool(defineTool({
      name: "builder_read_file",
      description: "Read a text file from the external Builder Mode workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
      execute: async ({ path }: BuilderReadArgs) => ({ content: readBuilderFile(path) }),
    } satisfies ToolDefinition<BuilderReadArgs, { content: string }>)),
    registerTool(defineTool({
      name: "builder_write_file",
      description: "Write or overwrite a text file inside the external Builder Mode workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
      execute: async ({ path, content }: BuilderWriteArgs) => {
        writeBuilderFile(path, content);
        return { written: true, path };
      },
    } satisfies ToolDefinition<BuilderWriteArgs, { written: boolean; path: string }>)),
    registerTool(defineTool({
      name: "builder_append_file",
      description: "Append text to a file inside the external Builder Mode workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
      execute: async ({ path, content }: BuilderAppendArgs) => {
        appendBuilderFile(path, content);
        return { appended: true, path };
      },
    } satisfies ToolDefinition<BuilderAppendArgs, { appended: boolean; path: string }>)),
    registerTool(defineTool({
      name: "builder_delete_path",
      description: "Delete a file or directory inside the external Builder Mode workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
      execute: async ({ path }: BuilderDeletePathArgs) => {
        deleteBuilderPath(path);
        return { deleted: true, path };
      },
    } satisfies ToolDefinition<BuilderDeletePathArgs, { deleted: boolean; path: string }>)),
    registerTool(defineTool({
      name: "builder_move_path",
      description: "Move or rename a file or directory inside the external Builder Mode workspace.",
      parameters: {
        type: "object",
        properties: {
          fromPath: { type: "string" },
          toPath: { type: "string" },
        },
        required: ["fromPath", "toPath"],
      },
      execute: async ({ fromPath, toPath }: BuilderMovePathArgs) => {
        moveBuilderPath(fromPath, toPath);
        return { moved: true, fromPath, toPath };
      },
    } satisfies ToolDefinition<BuilderMovePathArgs, { moved: boolean; fromPath: string; toPath: string }>)),
    registerTool(defineTool({
      name: "builder_create_directory",
      description: "Create a directory inside the external Builder Mode workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
      execute: async ({ path }: BuilderCreateDirectoryArgs) => {
        createBuilderDirectory(path);
        return { created: true, path };
      },
    } satisfies ToolDefinition<BuilderCreateDirectoryArgs, { created: boolean; path: string }>)),
    registerTool(defineTool({
      name: "builder_ensure_directory",
      description: "Ensure a directory exists inside the external Builder Mode workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
      execute: async ({ path }: BuilderCreateDirectoryArgs) => {
        ensureBuilderDirectory(path);
        return { ensured: true, path };
      },
    } satisfies ToolDefinition<BuilderCreateDirectoryArgs, { ensured: boolean; path: string }>)),
    registerTool(defineTool({
      name: "builder_stat_path",
      description: "Inspect whether a path exists in the external Builder Mode workspace and return its metadata.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
      execute: async ({ path }: BuilderPathArgs) => statBuilderPath(path),
    } satisfies ToolDefinition<BuilderPathArgs, ReturnType<typeof statBuilderPath>>)),
    registerTool(defineTool({
      name: "builder_path_exists",
      description: "Check whether a path exists in the external Builder Mode workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
      execute: async ({ path }: BuilderPathArgs) => ({ exists: builderPathExists(path), path }),
    } satisfies ToolDefinition<BuilderPathArgs, { exists: boolean; path: string }>)),
    registerTool(defineTool({
      name: "builder_apply_patch",
      description: "Apply a unified diff patch inside the external Builder Mode workspace.",
      parameters: {
        type: "object",
        properties: {
          patch: { type: "string" },
          cwd: { type: "string" },
        },
        required: ["patch"],
      },
      execute: async ({ patch, cwd }: BuilderPatchArgs) => applyBuilderPatch(patch, cwd),
    } satisfies ToolDefinition<BuilderPatchArgs, Awaited<ReturnType<typeof applyBuilderPatch>>>)),
    registerTool(defineTool({
      name: "builder_scaffold_node_package",
      description: "Scaffold a minimal TypeScript Node package inside the external Builder Mode workspace.",
      parameters: {
        type: "object",
        properties: {
          projectDir: { type: "string" },
          packageName: { type: "string" },
          description: { type: "string" },
          entrypoint: { type: "string", default: "src/index.ts" },
        },
        required: ["projectDir", "packageName"],
      },
      execute: async ({ projectDir, packageName, description, entrypoint }: BuilderScaffoldArgs) => ({
        scaffolded: true,
        ...scaffoldBuilderNodePackage({ projectDir, packageName, description, entrypoint }),
      }),
    } satisfies ToolDefinition<BuilderScaffoldArgs, { scaffolded: boolean; root: string; files: string[] }>)),
    registerTool(defineTool({
      name: "builder_http_get",
      description: "Issue an allowlisted HTTP GET request for a Builder project with bounded responses and an audit trail.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          url: { type: "string" },
          headers: { type: "array", items: { type: "object", properties: { name: { type: "string" }, value: { type: "string" } }, required: ["name", "value"] } },
          timeoutSeconds: { type: "number", default: 30 },
          maxBytes: { type: "number", default: 64000 },
          maxRequestBytes: { type: "number", default: 16000 },
          retryCount: { type: "number", default: 1 },
          authEnvKey: { type: "string" },
          authHeaderName: { type: "string" },
          authScheme: { type: "string" },
        },
        required: ["projectId", "url"],
      },
      execute: async ({ projectId, url, headers, timeoutSeconds, maxBytes, maxRequestBytes, retryCount, authEnvKey, authHeaderName, authScheme }: BuilderHttpArgs) => {
        const project = await getBuilderProject(projectId);
        return builderHttpRequest({
          projectId,
          projectRelativePath: project.relativePath,
          method: "GET",
          url,
          headers,
          timeoutSeconds,
          maxBytes,
          maxRequestBytes,
          retryCount,
          authEnvKey,
          authHeaderName,
          authScheme,
        });
      },
    } satisfies ToolDefinition<BuilderHttpArgs, Awaited<ReturnType<typeof builderHttpRequest>>>)),
    registerTool(defineTool({
      name: "builder_http_post",
      description: "Issue an allowlisted HTTP POST request for a Builder project with bounded responses and an audit trail.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          url: { type: "string" },
          headers: { type: "array", items: { type: "object", properties: { name: { type: "string" }, value: { type: "string" } }, required: ["name", "value"] } },
          body: { type: "string" },
          contentType: { type: "string" },
          timeoutSeconds: { type: "number", default: 30 },
          maxBytes: { type: "number", default: 64000 },
          maxRequestBytes: { type: "number", default: 16000 },
          retryCount: { type: "number", default: 1 },
          authEnvKey: { type: "string" },
          authHeaderName: { type: "string" },
          authScheme: { type: "string" },
        },
        required: ["projectId", "url"],
      },
      execute: async ({ projectId, url, headers, body, contentType, timeoutSeconds, maxBytes, maxRequestBytes, retryCount, authEnvKey, authHeaderName, authScheme }: BuilderHttpArgs) => {
        const project = await getBuilderProject(projectId);
        return builderHttpRequest({
          projectId,
          projectRelativePath: project.relativePath,
          method: "POST",
          url,
          headers,
          body,
          contentType,
          timeoutSeconds,
          maxBytes,
          maxRequestBytes,
          retryCount,
          authEnvKey,
          authHeaderName,
          authScheme,
        });
      },
    } satisfies ToolDefinition<BuilderHttpArgs, Awaited<ReturnType<typeof builderHttpRequest>>>)),
    registerTool(defineTool({
      name: "builder_http_put",
      description: "Issue an allowlisted HTTP PUT request for a Builder project with bounded responses and an audit trail.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          url: { type: "string" },
          headers: { type: "array", items: { type: "object", properties: { name: { type: "string" }, value: { type: "string" } }, required: ["name", "value"] } },
          body: { type: "string" },
          contentType: { type: "string" },
          timeoutSeconds: { type: "number", default: 30 },
          maxBytes: { type: "number", default: 64000 },
          maxRequestBytes: { type: "number", default: 16000 },
          retryCount: { type: "number", default: 1 },
          authEnvKey: { type: "string" },
          authHeaderName: { type: "string" },
          authScheme: { type: "string" },
        },
        required: ["projectId", "url"],
      },
      execute: async ({ projectId, url, headers, body, contentType, timeoutSeconds, maxBytes, maxRequestBytes, retryCount, authEnvKey, authHeaderName, authScheme }: BuilderHttpArgs) => {
        const project = await getBuilderProject(projectId);
        return builderHttpRequest({
          projectId,
          projectRelativePath: project.relativePath,
          method: "PUT",
          url,
          headers,
          body,
          contentType,
          timeoutSeconds,
          maxBytes,
          maxRequestBytes,
          retryCount,
          authEnvKey,
          authHeaderName,
          authScheme,
        });
      },
    } satisfies ToolDefinition<BuilderHttpArgs, Awaited<ReturnType<typeof builderHttpRequest>>>)),
    registerTool(defineTool({
      name: "builder_http_delete",
      description: "Issue an allowlisted HTTP DELETE request for a Builder project with bounded responses and an audit trail.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          url: { type: "string" },
          headers: { type: "array", items: { type: "object", properties: { name: { type: "string" }, value: { type: "string" } }, required: ["name", "value"] } },
          timeoutSeconds: { type: "number", default: 30 },
          maxBytes: { type: "number", default: 64000 },
          maxRequestBytes: { type: "number", default: 16000 },
          retryCount: { type: "number", default: 1 },
          authEnvKey: { type: "string" },
          authHeaderName: { type: "string" },
          authScheme: { type: "string" },
        },
        required: ["projectId", "url"],
      },
      execute: async ({ projectId, url, headers, timeoutSeconds, maxBytes, maxRequestBytes, retryCount, authEnvKey, authHeaderName, authScheme }: BuilderHttpArgs) => {
        const project = await getBuilderProject(projectId);
        return builderHttpRequest({
          projectId,
          projectRelativePath: project.relativePath,
          method: "DELETE",
          url,
          headers,
          timeoutSeconds,
          maxBytes,
          maxRequestBytes,
          retryCount,
          authEnvKey,
          authHeaderName,
          authScheme,
        });
      },
    } satisfies ToolDefinition<BuilderHttpArgs, Awaited<ReturnType<typeof builderHttpRequest>>>)),
    registerTool(defineTool({
      name: "builder_db_schema_summary",
      description: "Summarize the read-only database contract for a Builder project from Prisma schema and migration artifacts.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId }: BuilderProjectArgs) => {
        const project = await getBuilderProject(projectId);
        return getBuilderDatabaseSchemaSummary(projectId, project.relativePath);
      },
    } satisfies ToolDefinition<BuilderProjectArgs, ReturnType<typeof getBuilderDatabaseSchemaSummary>>)),
    registerTool(defineTool({
      name: "builder_db_list_tables",
      description: "List read-only database tables for a Builder project from Prisma schema artifacts.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId }: BuilderProjectArgs) => {
        const project = await getBuilderProject(projectId);
        return listBuilderDatabaseTables(projectId, project.relativePath);
      },
    } satisfies ToolDefinition<BuilderProjectArgs, ReturnType<typeof listBuilderDatabaseTables>>)),
    registerTool(defineTool({
      name: "builder_db_describe_table",
      description: "Describe a read-only database table for a Builder project from Prisma schema artifacts.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          name: { type: "string" },
        },
        required: ["projectId", "name"],
      },
      execute: async ({ projectId, name }: BuilderDatabaseTableArgs) => {
        const project = await getBuilderProject(projectId);
        return describeBuilderDatabaseTable(projectId, project.relativePath, name);
      },
    } satisfies ToolDefinition<BuilderDatabaseTableArgs, ReturnType<typeof describeBuilderDatabaseTable>>)),
    registerTool(defineTool({
      name: "builder_db_list_migrations",
      description: "List migration artifacts for a Builder project in a read-only manner.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId }: BuilderProjectArgs) => {
        const project = await getBuilderProject(projectId);
        return listBuilderDatabaseMigrations(projectId, project.relativePath);
      },
    } satisfies ToolDefinition<BuilderProjectArgs, ReturnType<typeof listBuilderDatabaseMigrations>>)),
    registerTool(defineTool({
      name: "builder_list_services",
      description: "List declared runtime services for a Builder project and correlate them with managed Builder processes when available.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId }: BuilderProjectArgs) => {
        const project = await getBuilderProject(projectId);
        return listBuilderRuntimeServices({
          projectId,
          projectRelativePath: project.relativePath,
          packageManager: project.packageManager,
        });
      },
    } satisfies ToolDefinition<BuilderProjectArgs, ReturnType<typeof listBuilderRuntimeServices>>)),
    registerTool(defineTool({
      name: "builder_service_logs",
      description: "Read the current managed log buffer for a discovered Builder runtime service.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          serviceId: { type: "string" },
          cursor: { type: "number" },
          maxBytes: { type: "number" },
          tailBytes: { type: "number" },
          followSeconds: { type: "number" },
        },
        required: ["projectId", "serviceId"],
      },
      execute: async ({ projectId, serviceId, cursor, maxBytes, tailBytes, followSeconds }: BuilderRuntimeServiceLogsArgs) => {
        const project = await getBuilderProject(projectId);
        return getBuilderRuntimeServiceLogs({
          projectId,
          projectRelativePath: project.relativePath,
          packageManager: project.packageManager,
          serviceId,
          cursor,
          maxBytes,
          tailBytes,
          followSeconds,
        });
      },
    } satisfies ToolDefinition<BuilderRuntimeServiceLogsArgs, Awaited<ReturnType<typeof getBuilderRuntimeServiceLogs>>>)),
    registerTool(defineTool({
      name: "builder_list_containers",
      description: "List compose-backed containers discovered for a Builder project.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          includeStopped: { type: "boolean" },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId, includeStopped }: BuilderRuntimeContainerListArgs) => {
        const project = await getBuilderProject(projectId);
        return {
          containers: listBuilderRuntimeContainers({
            projectId,
            projectRelativePath: project.relativePath,
            packageManager: project.packageManager,
            includeStopped,
          }),
        };
      },
    } satisfies ToolDefinition<BuilderRuntimeContainerListArgs, { containers: ReturnType<typeof listBuilderRuntimeContainers> }>)),
    registerTool(defineTool({
      name: "builder_list_managed_containers",
      description: "List Docker containers owned by BizBot Builder labels or legacy Builder test fixtures.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          status: { type: "string", enum: ["running", "stopped", "all"] },
          olderThanMinutes: { type: "number" },
          limit: { type: "number" },
        },
      },
      execute: async ({ projectId, status, olderThanMinutes, limit }: BuilderManagedContainerListArgs) => listBuilderManagedContainers({
        projectId,
        status,
        olderThanMinutes,
        limit,
      }),
    } satisfies ToolDefinition<BuilderManagedContainerListArgs, Awaited<ReturnType<typeof listBuilderManagedContainers>>>)),
    registerTool(defineTool({
      name: "builder_get_container",
      description: "Inspect one compose-backed container resolved through Builder runtime discovery.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          serviceId: { type: "string" },
        },
        required: ["projectId", "serviceId"],
      },
      execute: async ({ projectId, serviceId }: BuilderRuntimeServiceControlArgs) => {
        const project = await getBuilderProject(projectId);
        return getBuilderRuntimeContainer({
          projectId,
          projectRelativePath: project.relativePath,
          packageManager: project.packageManager,
          serviceId,
        });
      },
    } satisfies ToolDefinition<BuilderRuntimeServiceControlArgs, ReturnType<typeof getBuilderRuntimeContainer>>)),
    registerTool(defineTool({
      name: "builder_container_logs",
      description: "Read compose-backed logs for a discovered Builder container service.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          serviceId: { type: "string" },
          cursor: { type: "number" },
          maxBytes: { type: "number" },
          tailBytes: { type: "number" },
          followSeconds: { type: "number" },
        },
        required: ["projectId", "serviceId"],
      },
      execute: async ({ projectId, serviceId, cursor, maxBytes, tailBytes, followSeconds }: BuilderRuntimeServiceLogsArgs) => {
        const project = await getBuilderProject(projectId);
        return getBuilderRuntimeContainerLogs({
          projectId,
          projectRelativePath: project.relativePath,
          packageManager: project.packageManager,
          serviceId,
          cursor,
          maxBytes,
          tailBytes,
          followSeconds,
        });
      },
    } satisfies ToolDefinition<BuilderRuntimeServiceLogsArgs, Awaited<ReturnType<typeof getBuilderRuntimeContainerLogs>>>)),
    registerTool(defineTool({
      name: "builder_stat_path_in_container",
      description: "Stat an allowlisted absolute path inside a compose-backed Builder container.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          serviceId: { type: "string" },
          path: { type: "string" },
        },
        required: ["projectId", "serviceId", "path"],
      },
      execute: async ({ projectId, serviceId, path }: BuilderRuntimeContainerPathArgs) => {
        const project = await getBuilderProject(projectId);
        return statBuilderRuntimeContainerPath({
          projectId,
          projectRelativePath: project.relativePath,
          packageManager: project.packageManager,
          serviceId,
          path,
        });
      },
    } satisfies ToolDefinition<BuilderRuntimeContainerPathArgs, Awaited<ReturnType<typeof statBuilderRuntimeContainerPath>>>)),
    registerTool(defineTool({
      name: "builder_list_files_in_container",
      description: "List files under an allowlisted directory inside a compose-backed Builder container.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          serviceId: { type: "string" },
          path: { type: "string" },
          maxEntries: { type: "number" },
          includeHidden: { type: "boolean" },
        },
        required: ["projectId", "serviceId", "path"],
      },
      execute: async ({ projectId, serviceId, path, maxEntries, includeHidden }: BuilderRuntimeContainerFileListArgs) => {
        const project = await getBuilderProject(projectId);
        return listBuilderRuntimeContainerFiles({
          projectId,
          projectRelativePath: project.relativePath,
          packageManager: project.packageManager,
          serviceId,
          path,
          maxEntries,
          includeHidden,
        });
      },
    } satisfies ToolDefinition<BuilderRuntimeContainerFileListArgs, Awaited<ReturnType<typeof listBuilderRuntimeContainerFiles>>>)),
    registerTool(defineTool({
      name: "builder_read_file_in_container",
      description: "Read a bounded text file from an allowlisted absolute path inside a compose-backed Builder container.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          serviceId: { type: "string" },
          path: { type: "string" },
          maxBytes: { type: "number" },
        },
        required: ["projectId", "serviceId", "path"],
      },
      execute: async ({ projectId, serviceId, path, maxBytes }: BuilderRuntimeContainerFileReadArgs) => {
        const project = await getBuilderProject(projectId);
        return readBuilderRuntimeContainerFile({
          projectId,
          projectRelativePath: project.relativePath,
          packageManager: project.packageManager,
          serviceId,
          path,
          maxBytes,
        });
      },
    } satisfies ToolDefinition<BuilderRuntimeContainerFileReadArgs, Awaited<ReturnType<typeof readBuilderRuntimeContainerFile>>>)),
    registerTool(defineTool({
      name: "builder_restart_service",
      description: "Restart a discovered Builder runtime service using managed process or compose control when supported.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          serviceId: { type: "string" },
        },
        required: ["projectId", "serviceId"],
      },
      execute: async ({ projectId, serviceId }: BuilderRuntimeServiceControlArgs) => {
        const project = await getBuilderProject(projectId);
        return restartBuilderRuntimeService({
          projectId,
          projectRelativePath: project.relativePath,
          packageManager: project.packageManager,
          serviceId,
        });
      },
    } satisfies ToolDefinition<BuilderRuntimeServiceControlArgs, Awaited<ReturnType<typeof restartBuilderRuntimeService>>>)),
    registerTool(defineTool({
      name: "builder_start_service",
      description: "Start a discovered Builder runtime service when its managed process or compose service is not running.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          serviceId: { type: "string" },
        },
        required: ["projectId", "serviceId"],
      },
      execute: async ({ projectId, serviceId }: BuilderRuntimeServiceControlArgs) => {
        const project = await getBuilderProject(projectId);
        return startBuilderRuntimeService({
          projectId,
          projectRelativePath: project.relativePath,
          packageManager: project.packageManager,
          serviceId,
        });
      },
    } satisfies ToolDefinition<BuilderRuntimeServiceControlArgs, Awaited<ReturnType<typeof startBuilderRuntimeService>>>)),
    registerTool(defineTool({
      name: "builder_stop_service",
      description: "Stop a discovered Builder runtime service when its managed process or compose service is running.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          serviceId: { type: "string" },
        },
        required: ["projectId", "serviceId"],
      },
      execute: async ({ projectId, serviceId }: BuilderRuntimeServiceControlArgs) => {
        const project = await getBuilderProject(projectId);
        return stopBuilderRuntimeService({
          projectId,
          projectRelativePath: project.relativePath,
          packageManager: project.packageManager,
          serviceId,
        });
      },
    } satisfies ToolDefinition<BuilderRuntimeServiceControlArgs, Awaited<ReturnType<typeof stopBuilderRuntimeService>>>)),
    registerTool(defineTool({
      name: "builder_exec_in_service",
      description: "Run an allowlisted one-shot command in the working directory or container context of a discovered Builder runtime service.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          serviceId: { type: "string" },
          command: { type: "string" },
          commandArgs: { type: "array", items: { type: "string" } },
          timeoutSeconds: { type: "number", default: 120 },
        },
        required: ["projectId", "serviceId", "command"],
      },
      execute: async ({ projectId, serviceId, command, commandArgs, timeoutSeconds }: BuilderRuntimeExecArgs) => {
        const project = await getBuilderProject(projectId);
        return execBuilderRuntimeServiceCommand({
          projectId,
          projectRelativePath: project.relativePath,
          packageManager: project.packageManager,
          serviceId,
          command,
          commandArgs,
          timeoutSeconds,
        });
      },
    } satisfies ToolDefinition<BuilderRuntimeExecArgs, Awaited<ReturnType<typeof execBuilderRuntimeServiceCommand>>>)),
    registerTool(defineTool({
      name: "builder_test_in_container",
      description: "Run an allowlisted named test preset inside a compose-backed Builder container service.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          serviceId: { type: "string" },
          preset: { type: "string", enum: ["npm_test", "npm_vitest", "pnpm_test", "pnpm_vitest", "pytest"] },
          args: { type: "array", items: { type: "string" } },
          timeoutSeconds: { type: "number", default: 120 },
          taskId: { type: "string" },
          runId: { type: "string" },
        },
        required: ["projectId", "serviceId", "preset"],
      },
      execute: async ({ projectId, serviceId, preset, args, timeoutSeconds, taskId, runId }: BuilderRuntimeContainerTestArgs & { taskId?: string; runId?: string }) => executeBuilderProjectMutation({
        projectId,
        taskId,
        runId,
        kind: "CONTAINER_TEST",
        title: `Run ${preset} in ${serviceId}`,
        command: preset,
        commandArgs: args,
        metadata: { serviceId, preset },
        execute: async ({ project }) => testBuilderRuntimeContainer({
          projectId,
          projectRelativePath: project.relativePath,
          packageManager: project.packageManager,
          serviceId,
          preset,
          args,
          timeoutSeconds,
        }),
        resultMetadata: (result) => ({
          serviceId: result.service.serviceId,
          exitCode: result.commandResult?.exitCode ?? null,
          preset,
        }),
        statusForResult: (result) => result.status === "completed" ? "SUCCEEDED" : "FAILED",
      }),
    } satisfies ToolDefinition<BuilderRuntimeContainerTestArgs & { taskId?: string; runId?: string }, Awaited<ReturnType<typeof executeBuilderProjectMutation>>>)),
    registerTool(defineTool({
      name: "builder_exec_in_container",
      description: "Run an allowlisted command inside a compose-backed Builder container service.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          serviceId: { type: "string" },
          command: { type: "string" },
          commandArgs: { type: "array", items: { type: "string" } },
          timeoutSeconds: { type: "number", default: 120 },
          taskId: { type: "string" },
          runId: { type: "string" },
        },
        required: ["projectId", "serviceId", "command"],
      },
      execute: async ({ projectId, serviceId, command, commandArgs, timeoutSeconds, taskId, runId }: BuilderRuntimeExecArgs & { taskId?: string; runId?: string }) => executeBuilderProjectMutation({
        projectId,
        taskId,
        runId,
        kind: "CONTAINER_EXEC",
        title: `Exec ${command} in ${serviceId}`,
        command,
        commandArgs,
        metadata: { serviceId },
        execute: async ({ project }) => execBuilderRuntimeContainerCommand({
          projectId,
          projectRelativePath: project.relativePath,
          packageManager: project.packageManager,
          serviceId,
          command,
          commandArgs,
          timeoutSeconds,
        }),
        resultMetadata: (result) => ({
          serviceId: result.service.serviceId,
          exitCode: result.commandResult?.exitCode ?? null,
          command,
        }),
        statusForResult: (result) => result.status === "completed" ? "SUCCEEDED" : "FAILED",
      }),
    } satisfies ToolDefinition<BuilderRuntimeExecArgs & { taskId?: string; runId?: string }, Awaited<ReturnType<typeof executeBuilderProjectMutation>>>)),
    registerTool(defineTool({
      name: "builder_remove_managed_containers",
      description: "Remove Builder-owned or legacy Builder test-fixture Docker containers identified through Builder labels and bounded heuristics.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          status: { type: "string", enum: ["running", "stopped", "all"] },
          olderThanMinutes: { type: "number" },
          limit: { type: "number" },
          containerIds: { type: "array", items: { type: "string" } },
          confirmed: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["confirmed", "reason"],
      },
      execute: async ({ projectId, status, olderThanMinutes, limit, containerIds, confirmed, reason }: BuilderManagedContainerRemoveArgs) => {
        assertExplicitGovernanceApproval({ confirmed, reason }, "Removing managed Builder containers");
        return removeBuilderManagedContainers({
          projectId,
          status,
          olderThanMinutes,
          limit,
          containerIds,
        });
      },
    } satisfies ToolDefinition<BuilderManagedContainerRemoveArgs, Awaited<ReturnType<typeof removeBuilderManagedContainers>>>)),
    registerTool(defineTool({
      name: "builder_clean_stale_containers",
      description: "Remove stopped Builder-owned or legacy Builder test-fixture Docker containers through the bounded managed-container cleanup path.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          olderThanMinutes: { type: "number" },
          limit: { type: "number" },
          containerIds: { type: "array", items: { type: "string" } },
          confirmed: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["confirmed", "reason"],
      },
      execute: async ({ projectId, olderThanMinutes, limit, containerIds, confirmed, reason }: BuilderManagedContainerCleanupArgs) => {
        assertExplicitGovernanceApproval({ confirmed, reason }, "Cleaning stale Builder containers");
        return cleanStaleBuilderManagedContainers({
          projectId,
          olderThanMinutes,
          limit,
          containerIds,
        });
      },
    } satisfies ToolDefinition<BuilderManagedContainerCleanupArgs, Awaited<ReturnType<typeof cleanStaleBuilderManagedContainers>>>)),
    registerTool(defineTool({
      name: "builder_validate_container_stage",
      description: "Run the Docker-ready container stage contract for a Builder project and persist a structured validation result.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          stopAfterValidation: { type: "boolean", default: true },
          taskId: { type: "string" },
          runId: { type: "string" },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId, stopAfterValidation, taskId, runId }: BuilderContainerStageValidationArgs) => executeBuilderProjectMutation({
        projectId,
        taskId,
        runId,
        kind: "CONTAINER_TEST",
        title: "Validate Docker-ready container stage",
        command: "builder_validate_container_stage",
        metadata: { workflow: "container_stage", stopAfterValidation: stopAfterValidation ?? true },
        execute: async ({ project }) => validateBuilderContainerStage({
          project,
          stopAfterValidation,
        }),
        resultMetadata: (result) => ({
          workflow: "container_stage",
          containerStatus: result.status,
          serviceId: result.serviceId,
        }),
        statusForResult: (result) => result.status === "passed" || result.status === "skipped" ? "SUCCEEDED" : "FAILED",
      }),
    } satisfies ToolDefinition<BuilderContainerStageValidationArgs, Awaited<ReturnType<typeof executeBuilderProjectMutation>>>)),
    registerTool(defineTool({
      name: "builder_run_command",
      description: "Run an allowlisted command inside the external Builder Mode workspace without shell expansion.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          args: { type: "array", items: { type: "string" } },
          cwd: { type: "string" },
          timeoutSeconds: { type: "number", default: 60 },
        },
        required: ["command"],
      },
      execute: async ({ command, args, cwd, timeoutSeconds }: BuilderRunCommandArgs) => runBuilderCommand(command, args ?? [], { cwd, timeoutSeconds }),
    } satisfies ToolDefinition<BuilderRunCommandArgs, Awaited<ReturnType<typeof runBuilderCommand>>>)),
    registerTool(defineTool({
      name: "builder_start_process",
      description: "Start a managed long-running process inside the external Builder Mode workspace with bounded logs and timeout control.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          args: { type: "array", items: { type: "string" } },
          cwd: { type: "string" },
          timeoutSeconds: { type: "number", default: 1800 },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
        },
        required: ["command"],
      },
      execute: async ({ command, args, cwd, timeoutSeconds, projectId, taskId, runId }: BuilderStartProcessArgs) => startBuilderManagedProcess({ command, args, cwd, timeoutSeconds, projectId, taskId, runId }),
    } satisfies ToolDefinition<BuilderStartProcessArgs, Awaited<ReturnType<typeof startBuilderManagedProcess>>>)),
    registerTool(defineTool({
      name: "builder_get_process",
      description: "Inspect the current state of a managed Builder process.",
      parameters: {
        type: "object",
        properties: {
          processId: { type: "string" },
        },
        required: ["processId"],
      },
      execute: async ({ processId }: BuilderProcessArgs) => getBuilderManagedProcess(processId),
    } satisfies ToolDefinition<BuilderProcessArgs, ReturnType<typeof getBuilderManagedProcess>>)),
    registerTool(defineTool({
      name: "builder_list_processes",
      description: "List managed Builder processes with optional lifecycle and metadata filters.",
      parameters: {
        type: "object",
        properties: {
          statuses: { type: "array", items: { type: "string", enum: ["running", "exited", "failed", "cancelled", "timed_out"] } },
          includeFinished: { type: "boolean" },
          commandContains: { type: "string" },
          cwdPrefix: { type: "string" },
          startedAfter: { type: "string" },
          startedBefore: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          limit: { type: "number", default: 25 },
        },
      },
      execute: async ({ statuses, includeFinished, commandContains, cwdPrefix, startedAfter, startedBefore, projectId, taskId, runId, limit }: BuilderListProcessesArgs) => listBuilderManagedProcesses({ statuses, includeFinished, commandContains, cwdPrefix, startedAfter, startedBefore, projectId, taskId, runId, limit }),
    } satisfies ToolDefinition<BuilderListProcessesArgs, ReturnType<typeof listBuilderManagedProcesses>>)),
    registerTool(defineTool({
      name: "builder_stream_process_logs",
      description: "Read buffered logs from a managed Builder process using a resumable cursor.",
      parameters: {
        type: "object",
        properties: {
          processId: { type: "string" },
          cursor: { type: "number" },
          maxChars: { type: "number" },
          maxBytes: { type: "number" },
          tailBytes: { type: "number" },
          followSeconds: { type: "number", default: 0 },
        },
        required: ["processId"],
      },
      execute: async ({ processId, cursor, maxChars, maxBytes, tailBytes, followSeconds }: BuilderProcessLogArgs) => await streamBuilderManagedProcessLogs({ processId, cursor, maxChars, maxBytes, tailBytes, followSeconds }),
    } satisfies ToolDefinition<BuilderProcessLogArgs, Awaited<ReturnType<typeof streamBuilderManagedProcessLogs>>>)),
    registerTool(defineTool({
      name: "builder_stop_process",
      description: "Stop a managed Builder process using a terminate-first strategy.",
      parameters: {
        type: "object",
        properties: {
          processId: { type: "string" },
        },
        required: ["processId"],
      },
      execute: async ({ processId }: BuilderProcessArgs) => stopBuilderManagedProcess(processId),
    } satisfies ToolDefinition<BuilderProcessArgs, ReturnType<typeof stopBuilderManagedProcess>>)),
    registerTool(defineTool({
      name: "builder_wait_for_process",
      description: "Wait for a managed Builder process to complete without blocking indefinitely.",
      parameters: {
        type: "object",
        properties: {
          processId: { type: "string" },
          timeoutSeconds: { type: "number", default: 60 },
        },
        required: ["processId"],
      },
      execute: async ({ processId, timeoutSeconds }: BuilderWaitProcessArgs) => waitForBuilderManagedProcess({ processId, timeoutSeconds }),
    } satisfies ToolDefinition<BuilderWaitProcessArgs, Awaited<ReturnType<typeof waitForBuilderManagedProcess>>>)),
    registerTool(defineTool({
      name: "builder_repo_status",
      description: "Inspect git status for a Builder-managed repository inside the external Builder workspace.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
        },
      },
      execute: async (input: BuilderRepoArgs) => {
        const invocation = await resolveBuilderRepoInvocation(input);
        return getBuilderRepoStatus(invocation.subdir, {
          projectId: invocation.projectId,
          taskId: invocation.taskId,
          runId: invocation.parentRunId,
        });
      },
    } satisfies ToolDefinition<BuilderRepoArgs, ReturnType<typeof getBuilderRepoStatus>>)),
    registerTool(defineTool({
      name: "builder_repo_diff",
      description: "Return a staged or unstaged git diff for a Builder-managed repository.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          staged: { type: "boolean", default: false },
          paths: { type: "array", items: { type: "string" } },
        },
      },
      execute: async (input: BuilderRepoDiffArgs) => {
        const invocation = await resolveBuilderRepoInvocation(input);
        return getBuilderRepoDiff({
          subdir: invocation.subdir,
          staged: input.staged,
          paths: input.paths,
          audit: {
            projectId: invocation.projectId,
            taskId: invocation.taskId,
            runId: invocation.parentRunId,
          },
        });
      },
    } satisfies ToolDefinition<BuilderRepoDiffArgs, ReturnType<typeof getBuilderRepoDiff>>)),
    registerTool(defineTool({
      name: "builder_diff",
      description: "Compatibility alias for builder_repo_diff.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          staged: { type: "boolean", default: false },
          paths: { type: "array", items: { type: "string" } },
        },
      },
      execute: async (input: BuilderRepoDiffArgs) => {
        const invocation = await resolveBuilderRepoInvocation(input);
        return getBuilderRepoDiff({
          subdir: invocation.subdir,
          staged: input.staged,
          paths: input.paths,
          audit: {
            projectId: invocation.projectId,
            taskId: invocation.taskId,
            runId: invocation.parentRunId,
          },
        });
      },
    } satisfies ToolDefinition<BuilderRepoDiffArgs, ReturnType<typeof getBuilderRepoDiff>>)),
    registerTool(defineTool({
      name: "builder_repo_log",
      description: "Read recent commit history for a Builder-managed repository.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          limit: { type: "number", default: 20 },
          ref: { type: "string" },
          paths: { type: "array", items: { type: "string" } },
        },
      },
      execute: async (input: BuilderRepoLogArgs) => {
        const invocation = await resolveBuilderRepoInvocation(input);
        return getBuilderRepoLog({
          subdir: invocation.subdir,
          limit: input.limit,
          ref: input.ref,
          paths: input.paths,
          audit: {
            projectId: invocation.projectId,
            taskId: invocation.taskId,
            runId: invocation.parentRunId,
          },
        });
      },
    } satisfies ToolDefinition<BuilderRepoLogArgs, ReturnType<typeof getBuilderRepoLog>>)),
    registerTool(defineTool({
      name: "builder_repo_show",
      description: "Show a commit, tag, or other revision object from a Builder-managed repository.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          revision: { type: "string" },
          stat: { type: "boolean", default: false },
        },
        required: ["revision"],
      },
      execute: async (input: BuilderRepoShowArgs) => {
        const invocation = await resolveBuilderRepoInvocation(input);
        return showBuilderRepoObject({
          subdir: invocation.subdir,
          revision: input.revision,
          stat: input.stat,
          audit: {
            projectId: invocation.projectId,
            taskId: invocation.taskId,
            runId: invocation.parentRunId,
          },
        });
      },
    } satisfies ToolDefinition<BuilderRepoShowArgs, ReturnType<typeof showBuilderRepoObject>>)),
    registerTool(defineTool({
      name: "builder_list_branches",
      description: "List local branches, and optionally remote branches, for a Builder-managed repository.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          includeRemote: { type: "boolean", default: false },
        },
      },
      execute: async (input: BuilderRepoArgs & { includeRemote?: boolean }) => {
        const invocation = await resolveBuilderRepoInvocation(input);
        return listBuilderRepoBranches({
          subdir: invocation.subdir,
          includeRemote: input.includeRemote,
          audit: {
            projectId: invocation.projectId,
            taskId: invocation.taskId,
            runId: invocation.parentRunId,
          },
        });
      },
    } satisfies ToolDefinition<BuilderRepoArgs & { includeRemote?: boolean }, ReturnType<typeof listBuilderRepoBranches>>)),
    registerTool(defineTool({
      name: "builder_list_tags",
      description: "List tags for a Builder-managed repository.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
        },
      },
      execute: async (input: BuilderRepoArgs) => {
        const invocation = await resolveBuilderRepoInvocation(input);
        return listBuilderRepoTags({
          subdir: invocation.subdir,
          audit: {
            projectId: invocation.projectId,
            taskId: invocation.taskId,
            runId: invocation.parentRunId,
          },
        });
      },
    } satisfies ToolDefinition<BuilderRepoArgs, ReturnType<typeof listBuilderRepoTags>>)),
    registerTool(defineTool({
      name: "builder_list_remotes",
      description: "List configured remotes for a Builder-managed repository.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
        },
      },
      execute: async (input: BuilderRepoArgs) => {
        const invocation = await resolveBuilderRepoInvocation(input);
        return listBuilderRepoRemotes({
          subdir: invocation.subdir,
          audit: {
            projectId: invocation.projectId,
            taskId: invocation.taskId,
            runId: invocation.parentRunId,
          },
        });
      },
    } satisfies ToolDefinition<BuilderRepoArgs, ReturnType<typeof listBuilderRepoRemotes>>)),
    registerTool(defineTool({
      name: "builder_rev_parse",
      description: "Resolve a revision to its canonical git object id.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          revision: { type: "string" },
        },
      },
      execute: async (input: BuilderRepoRevParseArgs) => {
        const invocation = await resolveBuilderRepoInvocation(input);
        return revParseBuilderRepo({
          subdir: invocation.subdir,
          revision: input.revision,
          audit: {
            projectId: invocation.projectId,
            taskId: invocation.taskId,
            runId: invocation.parentRunId,
          },
        });
      },
    } satisfies ToolDefinition<BuilderRepoRevParseArgs, ReturnType<typeof revParseBuilderRepo>>)),
    registerTool(defineTool({
      name: "builder_git_add",
      description: "Stage one or more paths in a Builder-managed repository.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          paths: { type: "array", items: { type: "string" } },
        },
        required: ["paths"],
      },
      execute: async (input: BuilderRepoPathsArgs) => executeBuilderGitMutation({
        repoArgs: input,
        kind: "GIT_STAGE",
        title: "Stage git paths",
        command: "builder_git_add",
        commandArgs: { paths: input.paths },
        execute: ({ subdir, audit }) => stageBuilderRepoPaths(input.paths, subdir, audit),
        resultMetadata: (result) => ({ repoRoot: result.repoRoot, stagedCount: result.stagedCount, unstagedCount: result.unstagedCount }),
      }),
    } satisfies ToolDefinition<BuilderRepoPathsArgs, ToolExecutionResult>)),
    registerTool(defineTool({
      name: "builder_stage_paths",
      description: "Compatibility alias for builder_git_add.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          paths: { type: "array", items: { type: "string" } },
        },
        required: ["paths"],
      },
      execute: async (input: BuilderRepoPathsArgs) => executeBuilderGitMutation({
        repoArgs: input,
        kind: "GIT_STAGE",
        title: "Stage git paths",
        command: "builder_stage_paths",
        commandArgs: { paths: input.paths },
        execute: ({ subdir, audit }) => stageBuilderRepoPaths(input.paths, subdir, audit),
        resultMetadata: (result) => ({ repoRoot: result.repoRoot, stagedCount: result.stagedCount, unstagedCount: result.unstagedCount }),
      }),
    } satisfies ToolDefinition<BuilderRepoPathsArgs, ToolExecutionResult>)),
    registerTool(defineTool({
      name: "builder_unstage_paths",
      description: "Unstage one or more paths in a Builder-managed repository.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          paths: { type: "array", items: { type: "string" } },
        },
        required: ["paths"],
      },
      execute: async (input: BuilderRepoPathsArgs) => executeBuilderGitMutation({
        repoArgs: input,
        kind: "GIT_UNSTAGE",
        title: "Unstage git paths",
        command: "builder_unstage_paths",
        commandArgs: { paths: input.paths },
        execute: ({ subdir, audit }) => unstageBuilderRepoPaths(input.paths, subdir, audit),
        resultMetadata: (result) => ({ repoRoot: result.repoRoot, stagedCount: result.stagedCount, unstagedCount: result.unstagedCount }),
      }),
    } satisfies ToolDefinition<BuilderRepoPathsArgs, ToolExecutionResult>)),
    registerTool(defineTool({
      name: "builder_git_commit",
      description: "Create a git commit in a Builder-managed repository with an explicit message.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          message: { type: "string" },
          allowEmpty: { type: "boolean", default: false },
        },
        required: ["message"],
      },
      execute: async (input: BuilderRepoCommitArgs) => executeBuilderGitMutation({
        repoArgs: input,
        kind: "GIT_COMMIT",
        title: "Create git commit",
        command: "builder_git_commit",
        commandArgs: { message: input.message, allowEmpty: Boolean(input.allowEmpty) },
        execute: ({ subdir, audit }) => commitBuilderRepo({ subdir, message: input.message, allowEmpty: input.allowEmpty, audit }),
        resultMetadata: (result) => ({ repoRoot: result.repoRoot, commitSha: result.commitSha, summary: result.summary }),
      }),
    } satisfies ToolDefinition<BuilderRepoCommitArgs, ToolExecutionResult>)),
    registerTool(defineTool({
      name: "builder_commit",
      description: "Compatibility alias for builder_git_commit.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          message: { type: "string" },
          allowEmpty: { type: "boolean", default: false },
        },
        required: ["message"],
      },
      execute: async (input: BuilderRepoCommitArgs) => executeBuilderGitMutation({
        repoArgs: input,
        kind: "GIT_COMMIT",
        title: "Create git commit",
        command: "builder_commit",
        commandArgs: { message: input.message, allowEmpty: Boolean(input.allowEmpty) },
        execute: ({ subdir, audit }) => commitBuilderRepo({ subdir, message: input.message, allowEmpty: input.allowEmpty, audit }),
        resultMetadata: (result) => ({ repoRoot: result.repoRoot, commitSha: result.commitSha, summary: result.summary }),
      }),
    } satisfies ToolDefinition<BuilderRepoCommitArgs, ToolExecutionResult>)),
    registerTool(defineTool({
      name: "builder_git_branch",
      description: "Create or delete a branch in a Builder-managed repository.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          action: { type: "string", enum: ["create", "delete"], default: "create" },
          name: { type: "string" },
          checkout: { type: "boolean", default: false },
          force: { type: "boolean", default: false },
          confirmed: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["name"],
      },
      execute: async (input: BuilderRepoBranchArgs & { action?: "create" | "delete" }) => {
        const action = input.action ?? "create";
        const approvalReason = action === "delete"
          ? assertExplicitGovernanceApproval({ confirmed: Boolean(input.confirmed), reason: input.reason ?? "" }, "Builder git branch deletion")
          : null;
        return executeBuilderGitMutation({
          repoArgs: input,
          kind: "GIT_BRANCH",
          title: action === "create" ? "Create git branch" : "Delete git branch",
          command: "builder_git_branch",
          commandArgs: { action, name: input.name, checkout: Boolean(input.checkout), force: Boolean(input.force) },
          metadata: approvalReason ? { approvalReason } : undefined,
          execute: ({ subdir, audit }) => action === "create"
            ? createBuilderRepoBranch({ subdir, name: input.name, checkout: input.checkout, audit })
            : manageBuilderRepoBranch({ subdir, action: "delete", name: input.name, force: input.force, audit }),
          resultMetadata: (result) => ({ repoRoot: result.repoRoot, currentBranch: result.currentBranch, headCommitSha: result.headCommitSha }),
        });
      },
    } satisfies ToolDefinition<BuilderRepoBranchArgs & { action?: "create" | "delete" }, ToolExecutionResult>)),
    registerTool(defineTool({
      name: "builder_create_branch",
      description: "Compatibility alias for builder_git_branch create.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          name: { type: "string" },
          checkout: { type: "boolean", default: false },
        },
        required: ["name"],
      },
      execute: async (input: BuilderRepoBranchArgs) => executeBuilderGitMutation({
        repoArgs: input,
        kind: "GIT_BRANCH",
        title: "Create git branch",
        command: "builder_create_branch",
        commandArgs: { name: input.name, checkout: Boolean(input.checkout) },
        execute: ({ subdir, audit }) => createBuilderRepoBranch({ subdir, name: input.name, checkout: input.checkout, audit }),
        resultMetadata: (result) => ({ repoRoot: result.repoRoot, currentBranch: result.currentBranch, headCommitSha: result.headCommitSha }),
      }),
    } satisfies ToolDefinition<BuilderRepoBranchArgs, ToolExecutionResult>)),
    registerTool(defineTool({
      name: "builder_git_checkout",
      description: "Switch branches in a Builder-managed repository, or create and switch in one step.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          name: { type: "string" },
          create: { type: "boolean", default: false },
        },
        required: ["name"],
      },
      execute: async (input: BuilderRepoCheckoutArgs) => executeBuilderGitMutation({
        repoArgs: input,
        kind: "GIT_CHECKOUT",
        title: input.create ? "Create and checkout git branch" : "Checkout git branch",
        command: "builder_git_checkout",
        commandArgs: { name: input.name, create: Boolean(input.create) },
        execute: ({ subdir, audit }) => switchBuilderRepoBranch({ subdir, name: input.name, create: input.create, audit }),
        resultMetadata: (result) => ({ repoRoot: result.repoRoot, currentBranch: result.currentBranch, headCommitSha: result.headCommitSha }),
      }),
    } satisfies ToolDefinition<BuilderRepoCheckoutArgs, ToolExecutionResult>)),
    registerTool(defineTool({
      name: "builder_switch_branch",
      description: "Compatibility alias for builder_git_checkout.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          name: { type: "string" },
          create: { type: "boolean", default: false },
        },
        required: ["name"],
      },
      execute: async (input: BuilderRepoCheckoutArgs) => executeBuilderGitMutation({
        repoArgs: input,
        kind: "GIT_CHECKOUT",
        title: input.create ? "Create and checkout git branch" : "Checkout git branch",
        command: "builder_switch_branch",
        commandArgs: { name: input.name, create: Boolean(input.create) },
        execute: ({ subdir, audit }) => switchBuilderRepoBranch({ subdir, name: input.name, create: input.create, audit }),
        resultMetadata: (result) => ({ repoRoot: result.repoRoot, currentBranch: result.currentBranch, headCommitSha: result.headCommitSha }),
      }),
    } satisfies ToolDefinition<BuilderRepoCheckoutArgs, ToolExecutionResult>)),
    registerTool(defineTool({
      name: "builder_git_merge",
      description: "Merge another branch into the current branch with explicit approval.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          name: { type: "string" },
          ffOnly: { type: "boolean", default: false },
          noCommit: { type: "boolean", default: false },
          confirmed: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["name", "confirmed", "reason"],
      },
      execute: async (input: BuilderRepoMergeArgs) => {
        const approvalReason = assertExplicitGovernanceApproval({ confirmed: input.confirmed, reason: input.reason }, "Builder git merge");
        return executeBuilderGitMutation({
          repoArgs: input,
          kind: "GIT_MERGE",
          title: "Merge git branch",
          command: "builder_git_merge",
          commandArgs: { name: input.name, ffOnly: Boolean(input.ffOnly), noCommit: Boolean(input.noCommit) },
          metadata: { approvalReason },
          execute: ({ subdir, audit }) => mergeBuilderRepoBranch({ subdir, name: input.name, ffOnly: input.ffOnly, noCommit: input.noCommit, audit }),
          resultMetadata: (result) => ({ repoRoot: result.repoRoot, currentBranch: result.currentBranch, headCommitSha: result.headCommitSha, conflictedCount: result.conflictedFiles.length }),
        });
      },
    } satisfies ToolDefinition<BuilderRepoMergeArgs, ToolExecutionResult>)),
    registerTool(defineTool({
      name: "builder_git_rebase",
      description: "Rebase the current branch onto another ref with explicit approval.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          upstream: { type: "string" },
          confirmed: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["upstream", "confirmed", "reason"],
      },
      execute: async (input: BuilderRepoRebaseArgs) => {
        const approvalReason = assertExplicitGovernanceApproval({ confirmed: input.confirmed, reason: input.reason }, "Builder git rebase");
        return executeBuilderGitMutation({
          repoArgs: input,
          kind: "GIT_REBASE",
          title: "Rebase git branch",
          command: "builder_git_rebase",
          commandArgs: { upstream: input.upstream },
          metadata: { approvalReason },
          execute: ({ subdir, audit }) => rebaseBuilderRepo({ subdir, upstream: input.upstream, audit }),
          resultMetadata: (result) => ({ repoRoot: result.repoRoot, currentBranch: result.currentBranch, headCommitSha: result.headCommitSha, conflictedCount: result.conflictedFiles.length }),
        });
      },
    } satisfies ToolDefinition<BuilderRepoRebaseArgs, ToolExecutionResult>)),
    registerTool(defineTool({
      name: "builder_git_clean",
      description: "Clean untracked files from a Builder-managed repository with explicit approval.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          force: { type: "boolean" },
          directories: { type: "boolean", default: false },
          includeIgnored: { type: "boolean", default: false },
          confirmed: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["force", "confirmed", "reason"],
      },
      execute: async (input: BuilderRepoCleanArgs) => {
        const approvalReason = assertExplicitGovernanceApproval({ confirmed: input.confirmed, reason: input.reason }, "Builder git clean");
        return executeBuilderGitMutation({
          repoArgs: input,
          kind: "GIT_CLEAN",
          title: "Clean git working tree",
          command: "builder_git_clean",
          commandArgs: { force: Boolean(input.force), directories: Boolean(input.directories), includeIgnored: Boolean(input.includeIgnored) },
          metadata: { approvalReason },
          execute: ({ subdir, audit }) => cleanBuilderRepo({ subdir, force: input.force, directories: input.directories, includeIgnored: input.includeIgnored, audit }),
          resultMetadata: (result) => ({ repoRoot: result.repoRoot, dirty: result.dirty, untrackedCount: result.untrackedCount }),
        });
      },
    } satisfies ToolDefinition<BuilderRepoCleanArgs, ToolExecutionResult>)),
    registerTool(defineTool({
      name: "builder_git_remote_add",
      description: "Add an allowlisted remote to a Builder-managed repository.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          name: { type: "string" },
          remoteUrl: { type: "string" },
        },
        required: ["name", "remoteUrl"],
      },
      execute: async (input: BuilderRepoRemoteArgs) => executeBuilderGitMutation({
        repoArgs: input,
        kind: "GIT_REMOTE",
        title: "Add git remote",
        command: "builder_git_remote_add",
        commandArgs: { name: input.name, remoteUrl: input.remoteUrl },
        execute: ({ subdir, audit }) => addBuilderRepoRemote({ subdir, name: input.name!, remoteUrl: input.remoteUrl!, audit }),
        resultMetadata: (result) => ({ repoRoot: result.repoRoot, remoteNames: result.remotes.map((entry) => entry.name) }),
      }),
    } satisfies ToolDefinition<BuilderRepoRemoteArgs, ToolExecutionResult>)),
    registerTool(defineTool({
      name: "builder_git_remote_remove",
      description: "Remove a remote from a Builder-managed repository.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          name: { type: "string" },
        },
        required: ["name"],
      },
      execute: async (input: BuilderRepoRemoteArgs) => executeBuilderGitMutation({
        repoArgs: input,
        kind: "GIT_REMOTE",
        title: "Remove git remote",
        command: "builder_git_remote_remove",
        commandArgs: { name: input.name },
        execute: ({ subdir, audit }) => removeBuilderRepoRemote({ subdir, name: input.name!, audit }),
        resultMetadata: (result) => ({ repoRoot: result.repoRoot, remoteNames: result.remotes.map((entry) => entry.name) }),
      }),
    } satisfies ToolDefinition<BuilderRepoRemoteArgs, ToolExecutionResult>)),
    registerTool(defineTool({
      name: "builder_git_fetch",
      description: "Fetch from an allowlisted remote for a Builder-managed repository.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          remote: { type: "string" },
          refspec: { type: "string" },
        },
      },
      execute: async (input: BuilderRepoRemoteArgs) => executeBuilderGitMutation({
        repoArgs: input,
        kind: "GIT_FETCH",
        title: "Fetch git remote",
        command: "builder_git_fetch",
        commandArgs: { remote: input.remote, refspec: input.refspec },
        execute: ({ subdir, audit }) => fetchBuilderRepoRemote({ subdir, remote: input.remote, refspec: input.refspec, audit }),
        resultMetadata: (result) => ({ repoRoot: result.repoRoot, ahead: result.ahead, behind: result.behind }),
      }),
    } satisfies ToolDefinition<BuilderRepoRemoteArgs, ToolExecutionResult>)),
    registerTool(defineTool({
      name: "builder_git_pull",
      description: "Pull from an allowlisted remote for a Builder-managed repository.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          remote: { type: "string" },
          branch: { type: "string" },
        },
      },
      execute: async (input: BuilderRepoRemoteArgs) => executeBuilderGitMutation({
        repoArgs: input,
        kind: "GIT_PULL",
        title: "Pull git remote",
        command: "builder_git_pull",
        commandArgs: { remote: input.remote, branch: input.branch },
        execute: ({ subdir, audit }) => pullBuilderRepoRemote({ subdir, remote: input.remote, branch: input.branch, audit }),
        resultMetadata: (result) => ({ repoRoot: result.repoRoot, currentBranch: result.currentBranch, headCommitSha: result.headCommitSha }),
      }),
    } satisfies ToolDefinition<BuilderRepoRemoteArgs, ToolExecutionResult>)),
    registerTool(defineTool({
      name: "builder_git_push",
      description: "Push to an allowlisted remote for a Builder-managed repository with explicit approval.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          remote: { type: "string" },
          branch: { type: "string" },
          setUpstream: { type: "boolean", default: false },
          force: { type: "boolean", default: false },
          confirmed: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["confirmed", "reason"],
      },
      execute: async (input: BuilderRepoRemoteArgs) => {
        const approvalReason = assertExplicitGovernanceApproval({ confirmed: Boolean(input.confirmed), reason: input.reason ?? "" }, "Builder git push");
        return executeBuilderGitMutation({
          repoArgs: input,
          kind: "GIT_PUSH",
          title: "Push git remote",
          command: "builder_git_push",
          commandArgs: { remote: input.remote, branch: input.branch, setUpstream: Boolean(input.setUpstream), force: Boolean(input.force) },
          metadata: { approvalReason },
          execute: ({ subdir, audit }) => pushBuilderRepoRemote({ subdir, remote: input.remote, branch: input.branch, setUpstream: input.setUpstream, force: input.force, audit }),
          resultMetadata: (result) => ({ repoRoot: result.repoRoot, currentBranch: result.currentBranch, ahead: result.ahead, behind: result.behind }),
        });
      },
    } satisfies ToolDefinition<BuilderRepoRemoteArgs, ToolExecutionResult>)),
    registerTool(defineTool({
      name: "builder_git_clone",
      description: "Clone an allowlisted remote into the external Builder workspace.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          taskId: { type: "string" },
          runId: { type: "string" },
          remoteUrl: { type: "string" },
          targetPath: { type: "string" },
          branch: { type: "string" },
        },
        required: ["remoteUrl", "targetPath"],
      },
      execute: async (input: BuilderRepoRemoteArgs) => executeBuilderGitMutation({
        repoArgs: input,
        kind: "GIT_CLONE",
        title: "Clone git repository",
        command: "builder_git_clone",
        commandArgs: { remoteUrl: input.remoteUrl, targetPath: input.targetPath, branch: input.branch },
        execute: ({ audit }) => cloneBuilderRepo({ remoteUrl: input.remoteUrl!, targetPath: input.targetPath!, branch: input.branch, audit }),
        resultMetadata: (result) => ({ repoRoot: result.repoRoot, currentBranch: result.currentBranch, headCommitSha: result.headCommitSha, targetPath: input.targetPath }),
      }),
    } satisfies ToolDefinition<BuilderRepoRemoteArgs, ToolExecutionResult>)),
  ],
};