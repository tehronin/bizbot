import path from "path";
import type { BuilderProject, BuilderTask } from "@prisma/client";
import { getBuilderFileTopologyPlanningContext } from "@/lib/builder/file-topology-snapshots";
import { renderBuilderFileTopologyProjectionMarkdown } from "@/lib/builder/file-topology-render";
import { renderBuilderOperatorTrustMarkdown } from "@/lib/builder/operator-trust";
import { syncBuilderProjectMetadata } from "@/lib/builder/projects";
import { renderBuilderReviewMarkdown } from "@/lib/builder/review";
import {
  hashBuilderProjectionArtifactContent,
  persistBuilderContextPacketCache,
  recordBuilderProjectionCacheSync,
  readBuilderContextPacketManifest,
  type BuilderProjectionArtifact,
} from "@/lib/builder/cache";
import { readBuilderFile, writeBuilderFile } from "@/lib/builder/workspace";
import {
  type BuilderMilestoneState,
  defaultBuilderProjectContext,
  normalizeBuilderProjectContext,
  type BuilderPlanningSnapshot,
  normalizeBuilderTaskMetadata,
  type BuilderInstructionFragment,
  type BuilderOperatorTrustState,
  type BuilderPlanStep,
  type BuilderProjectContextState,
  type BuilderStructuredReview,
} from "@/lib/builder/types";

interface BuilderInstructionProjectionState {
  stale: boolean;
  statePathExists: boolean;
}

function builderDir(project: BuilderProject): string {
  return path.posix.join(project.relativePath, ".builder");
}

function readOptionalBuilderFile(relativePath: string): string | null {
  try {
    return readBuilderFile(relativePath);
  } catch {
    return null;
  }
}

function normalizeContextForWrite(context: BuilderProjectContextState): BuilderProjectContextState {
  return {
    ...defaultBuilderProjectContext(),
    ...context,
    updatedAt: context.updatedAt ?? new Date().toISOString(),
  };
}

export function loadBuilderProjectContext(project: BuilderProject): {
  context: BuilderProjectContextState;
  projection: BuilderInstructionProjectionState;
} {
  const context = normalizeBuilderProjectContext(project.context);
  const statePath = path.posix.join(builderDir(project), "state.json");
  const rawState = readOptionalBuilderFile(statePath);

  if (!rawState) {
    return {
      context,
      projection: {
        stale: false,
        statePathExists: false,
      },
    };
  }

  let fileState: BuilderProjectContextState | null = null;
  try {
    fileState = normalizeBuilderProjectContext(JSON.parse(rawState));
  } catch {
    fileState = null;
  }

  const stale = JSON.stringify(context) !== JSON.stringify(fileState);
  return {
    context,
    projection: {
      stale,
      statePathExists: true,
    },
  };
}

function renderProjectAgentsFile(project: BuilderProject, context: BuilderProjectContextState): string {
  const constraints = context.constraints.length > 0 ? context.constraints : ["Operate only inside this Builder project workspace."];
  return [
    `# Builder Project Instructions`,
    "",
    `Project: ${project.name}`,
    `Workspace: ${project.relativePath}`,
    `Template: ${project.template}`,
    `Package manager: ${project.packageManager}`,
    `Planned stack: ${context.plannedStack ? `${context.plannedStack.label} (${context.plannedStack.tags.join(", ")})` : "not recorded"}`,
    "",
    `## Mission`,
    "",
    context.objective ?? "Complete the active Builder task while keeping the project reviewable and safe.",
    "",
    `## Builder MCP Policy`,
    "",
    context.mcpPolicy
      ? `Builder manages ${context.mcpPolicy.artifactPath} with expected hash ${context.mcpPolicy.expectedHash.slice(0, 12)}… and decision keys ${context.mcpPolicy.decisionKeys.join(", ") || "none"}.`
      : "No Builder MCP policy baseline recorded yet.",
    "",
    `## Builder Dependency Contract`,
    "",
    context.dependencyContract
      ? `Builder tracks direct dependency policy with accepted hash ${context.dependencyContract.expectedHash.slice(0, 12)}… and decision keys ${context.dependencyContract.decisionKeys.join(", ") || "none"}.`
      : "No Builder dependency contract baseline recorded yet.",
    "",
    `## Builder File Topology Contract`,
    "",
    context.fileTopologyContract
      ? `Builder tracks structural placement policy with accepted hash ${context.fileTopologyContract.expectedHash.slice(0, 12)}… and decision keys ${context.fileTopologyContract.decisionKeys.join(", ") || "none"}.`
      : "No Builder file topology contract baseline recorded yet.",
    "",
    `## Constraints`,
    "",
    ...constraints.map((constraint) => `- ${constraint}`),
    "",
    `## Notes`,
    "",
    context.instructionNotes ?? "Keep instructions short and stable. Pull detailed task state from .builder/ files instead of duplicating it here.",
    "",
  ].join("\n");
}

function renderProjectContextMarkdown(context: BuilderProjectContextState): string {
  return [
    `# Project Context`,
    "",
    `## Objective`,
    "",
    context.objective ?? "Not set yet.",
    "",
    `## Planned Stack`,
    "",
    context.plannedStack
      ? `${context.plannedStack.label} using ${context.plannedStack.template} / ${context.plannedStack.packageManager}${context.plannedStack.tags.length > 0 ? ` (${context.plannedStack.tags.join(", ")})` : ""}.`
      : "Not set yet.",
    "",
    `## Builder MCP Policy`,
    "",
    context.mcpPolicy
      ? [
          `Artifact: ${context.mcpPolicy.artifactPath}`,
          `Expected policy hash: ${context.mcpPolicy.expectedHash}`,
          `Expected MCP contract hash: ${context.mcpPolicy.expectedMcpContractHash}`,
          `Decision keys: ${context.mcpPolicy.decisionKeys.length > 0 ? context.mcpPolicy.decisionKeys.join(", ") : "none"}`,
          `Allowed tool categories: ${context.mcpPolicy.allowedToolCategories.length > 0 ? context.mcpPolicy.allowedToolCategories.join(", ") : "none"}`,
        ].join("\n")
      : "Not set yet.",
    "",
    `## Builder Dependency Contract`,
    "",
    context.dependencyContract
      ? [
          `Expected dependency hash: ${context.dependencyContract.expectedHash}`,
          `Package manager: ${context.dependencyContract.packageManager}`,
          `Decision keys: ${context.dependencyContract.decisionKeys.length > 0 ? context.dependencyContract.decisionKeys.join(", ") : "none"}`,
          `Highlighted packages: ${context.dependencyContract.snapshot.packages.length > 0 ? context.dependencyContract.snapshot.packages.map((item) => `${item.name}@${item.range}`).join(", ") : "none"}`,
          `Lockfile: ${context.dependencyContract.snapshot.lockfile.present ? `${context.dependencyContract.snapshot.lockfile.path ?? "present"} (${context.dependencyContract.snapshot.lockfile.contentHash?.slice(0, 12) ?? "hash unavailable"}…)` : "not recorded"}`,
        ].join("\n")
      : "Not set yet.",
    "",
    `## Builder File Topology Contract`,
    "",
    context.fileTopologyContract
      ? [
          `Expected topology hash: ${context.fileTopologyContract.expectedHash}`,
          `Decision keys: ${context.fileTopologyContract.decisionKeys.length > 0 ? context.fileTopologyContract.decisionKeys.join(", ") : "none"}`,
          `Top-level entries: ${context.fileTopologyContract.snapshot.topLevel.length > 0 ? context.fileTopologyContract.snapshot.topLevel.join(", ") : "none"}`,
          `Anchors: app=${context.fileTopologyContract.snapshot.anchors.appRoot ?? "none"}, lib=${context.fileTopologyContract.snapshot.anchors.libRoot ?? "none"}, components=${context.fileTopologyContract.snapshot.anchors.componentsRoot ?? "none"}, tests=${context.fileTopologyContract.snapshot.anchors.testsRoot ?? "none"}, scripts=${context.fileTopologyContract.snapshot.anchors.scriptsRoot ?? "none"}, prisma=${context.fileTopologyContract.snapshot.anchors.prismaRoot ?? "none"}, tauri=${context.fileTopologyContract.snapshot.anchors.tauriRoot ?? "none"}, builder=${context.fileTopologyContract.snapshot.anchors.builderProjectionRoot}`,
        ].join("\n")
      : "Not set yet.",
    "",
    `## Conventions`,
    "",
    ...(context.codingConventions.length > 0 ? context.codingConventions.map((item) => `- ${item}`) : ["- none recorded"]),
    "",
    `## Constraints`,
    "",
    ...(context.constraints.length > 0 ? context.constraints.map((item) => `- ${item}`) : ["- none recorded"]),
    "",
    `## Important Commands`,
    "",
    ...(context.importantCommands.length > 0 ? context.importantCommands.map((item) => `- ${item}`) : ["- none recorded"]),
    "",
    `## Notes`,
    "",
    context.instructionNotes ?? "No extra project notes yet.",
    "",
  ].join("\n");
}

function renderArchitectureMarkdown(context: BuilderProjectContextState): string {
  const activeArchitecture = context.architecture?.active ?? [];
  const staleArchitecture = context.architecture?.stale ?? [];
  return [
    `# Architecture`,
    "",
    `## Active Architecture`,
    "",
    ...(activeArchitecture.length > 0
      ? activeArchitecture.map((item) => `- ${item.key}: ${item.description ?? item.displayName}`)
      : ["- No active Builder architecture decisions recorded."]),
    "",
    `## Stale Architecture - Needs Reconfirmation`,
    "",
    ...(staleArchitecture.length > 0
      ? staleArchitecture.map((item) => `- ${item.key}: ${item.description ?? item.displayName}`)
      : ["- No stale Builder architecture decisions recorded."]),
    "",
    `## Notes`,
    "",
    ...(context.architectureNotes.length > 0 ? context.architectureNotes.map((item) => `- ${item}`) : ["- No architecture notes recorded yet."]),
    "",
  ].join("\n");
}

function renderDependencyContractMarkdown(context: BuilderProjectContextState): string {
  return [
    "# Dependency Contract",
    "",
    context.dependencyContract
      ? `Accepted dependency contract hash: ${context.dependencyContract.expectedHash}`
      : "Accepted dependency contract hash: none recorded.",
    context.dependencyContract
      ? `Package manager: ${context.dependencyContract.packageManager}`
      : "Package manager: none recorded.",
    context.dependencyContract
      ? `Updated at: ${context.dependencyContract.updatedAt}`
      : "Updated at: none recorded.",
    "",
    "## Decision Keys",
    "",
    ...(context.dependencyContract?.decisionKeys.length
      ? context.dependencyContract.decisionKeys.map((item) => `- ${item}`)
      : ["- none recorded"]),
    "",
    "## Direct Packages",
    "",
    ...(context.dependencyContract?.snapshot.packages.length
      ? context.dependencyContract.snapshot.packages.map((item) => `- ${item.name} (${item.kind}) ${item.range}${item.resolvedVersion ? ` -> ${item.resolvedVersion}` : ""}`)
      : ["- none recorded"]),
    "",
    "## Scripts",
    "",
    ...(context.dependencyContract?.snapshot.scripts.length
      ? context.dependencyContract.snapshot.scripts.map((item) => `- ${item.name}: ${item.command}`)
      : ["- none recorded"]),
    "",
    "## Lockfile",
    "",
    context.dependencyContract
      ? context.dependencyContract.snapshot.lockfile.present
        ? `Tracked lockfile: ${context.dependencyContract.snapshot.lockfile.path ?? "present"}`
        : "Tracked lockfile: none recorded."
      : "Tracked lockfile: none recorded.",
    context.dependencyContract && context.dependencyContract.snapshot.lockfile.lockfileVersion !== null
      ? `Lockfile version: ${context.dependencyContract.snapshot.lockfile.lockfileVersion}`
      : "Lockfile version: none recorded.",
    context.dependencyContract?.snapshot.lockfile.contentHash
      ? `Lockfile content hash: ${context.dependencyContract.snapshot.lockfile.contentHash}`
      : "Lockfile content hash: none recorded.",
    "",
  ].join("\n");
}

function renderPlanMarkdown(task: BuilderTask | null, planSteps: BuilderPlanStep[]): string {
  return [
    `# Current Plan`,
    "",
    ...(task ? [`Task: ${task.title}`, `Stage: ${task.stage}`, `Status: ${task.status}`, ""] : []),
    ...(planSteps.length > 0
      ? planSteps.map((step, index) => `${index + 1}. [${step.status === "completed" ? "x" : step.status === "in_progress" ? "~" : " "}] ${step.label}${step.notes ? ` — ${step.notes}` : ""}`)
      : ["1. [ ] No active plan yet"]),
    "",
  ].join("\n");
}

function renderProjectBriefMarkdown(planning: BuilderPlanningSnapshot | undefined): string {
  const brief = planning?.brief;
  return [
    "# Project Brief",
    "",
    brief
      ? `Title: ${brief.title}`
      : "Title: not recorded yet.",
    brief
      ? `Lifecycle: ${planning?.lifecycle ?? "DRAFT"}`
      : "Lifecycle: DRAFT",
    "",
    "## Summary",
    "",
    brief?.summary ?? "No canonical project brief has been recorded yet.",
    "",
    "## Goals",
    "",
    ...(brief && brief.goals.length > 0 ? brief.goals.map((goal) => `- ${goal}`) : ["- none recorded"]),
    "",
    "## Constraints",
    "",
    ...(brief && brief.constraints.length > 0 ? brief.constraints.map((constraint) => `- ${constraint}`) : ["- none recorded"]),
    "",
    "## Deliverables",
    "",
    ...(brief && brief.deliverables.length > 0 ? brief.deliverables.map((deliverable) => `- ${deliverable}`) : ["- none recorded"]),
    "",
    "## Notes",
    "",
    brief?.notes ?? "No brief notes recorded yet.",
    "",
  ].join("\n");
}

function renderMilestoneTaskLine(taskSpec: BuilderMilestoneState["taskSpecs"][number]): string {
  const validators = taskSpec.validators.length > 0 ? taskSpec.validators.join(", ").toLowerCase() : "manual_review";
  const dependencies = taskSpec.dependencyIds.length > 0 ? ` deps: ${taskSpec.dependencyIds.join(", ")}` : "";
  return `- [${taskSpec.status.toLowerCase()}] ${taskSpec.sortOrder}. ${taskSpec.title} (${validators})${dependencies}`;
}

function renderMilestonesMarkdown(planning: BuilderPlanningSnapshot | undefined): string {
  const milestones = planning?.milestones ?? [];
  return [
    "# Milestones",
    "",
    ...(milestones.length > 0
      ? milestones.flatMap((milestone) => [
          `## ${milestone.sortOrder}. ${milestone.title}`,
          "",
          milestone.summary,
          "",
          `Status: ${milestone.status.toLowerCase()}`,
          "",
          ...(milestone.taskSpecs.length > 0 ? milestone.taskSpecs.map(renderMilestoneTaskLine) : ["- no task specs recorded"]),
          "",
        ])
      : ["No canonical Builder milestones have been planned yet.", ""]),
  ].join("\n");
}

function renderTaskBoardMarkdown(planning: BuilderPlanningSnapshot | undefined): string {
  const milestones = planning?.milestones ?? [];
  return [
    "# Task Board",
    "",
    ...(milestones.length > 0
      ? milestones.flatMap((milestone) => {
          const tasks = milestone.taskSpecs.length > 0 ? milestone.taskSpecs : [];
          return [
            `## ${milestone.title}`,
            "",
            ...(tasks.length > 0
              ? tasks.flatMap((taskSpec) => [
                  `- ${taskSpec.title}`,
                  `  status: ${taskSpec.status.toLowerCase()}`,
                  `  completion: ${taskSpec.completionCriteria.length > 0 ? taskSpec.completionCriteria.join("; ") : "none recorded"}`,
                  `  validators: ${taskSpec.validators.length > 0 ? taskSpec.validators.join(", ").toLowerCase() : "manual_review"}`,
                  `  architectural decisions: ${taskSpec.architecturalDecisionKeys.length > 0 ? taskSpec.architecturalDecisionKeys.join(", ") : "none"}`,
                ])
              : ["- no task specs recorded"]),
            "",
          ];
        })
      : ["No task-board entries have been planned yet.", ""]),
  ].join("\n");
}

function renderSessionSummaryMarkdown(context: BuilderProjectContextState): string {
  return [
    `# Session Summary`,
    "",
    context.latestSessionSummary ?? "No session summary recorded yet.",
    "",
    `## Known Failures`,
    "",
    ...(context.knownFailures.length > 0 ? context.knownFailures.map((item) => `- ${item}`) : ["- none recorded"]),
    "",
    `## Next Steps`,
    "",
    ...(context.nextSteps.length > 0 ? context.nextSteps.map((item) => `- ${item}`) : ["- none recorded"]),
    "",
  ].join("\n");
}

export function collectBuilderProjectionArtifacts(args: {
  project: BuilderProject;
  context: BuilderProjectContextState;
  planning?: BuilderPlanningSnapshot;
  currentTask?: BuilderTask | null;
  latestReview?: BuilderStructuredReview | null;
  latestOperatorTrust?: BuilderOperatorTrustState | null;
}): BuilderProjectionArtifact[] {
  const context = normalizeContextForWrite(args.context);
  const currentTaskMetadata = args.currentTask ? normalizeBuilderTaskMetadata(args.currentTask.metadata) : null;
  const planSteps = currentTaskMetadata?.planSteps ?? context.currentPlan;
  const baseDir = builderDir(args.project);
  const fileTopologyPlanningContext = getBuilderFileTopologyPlanningContext({
    projectRelativePath: args.project.relativePath,
    context,
  });
  const artifacts: BuilderProjectionArtifact[] = [
    {
      packetId: "project_instructions",
      relativePath: path.posix.join(args.project.relativePath, "AGENTS.md"),
      content: renderProjectAgentsFile(args.project, context),
    },
    {
      packetId: "project_context",
      relativePath: path.posix.join(baseDir, "project-context.md"),
      content: renderProjectContextMarkdown(context),
    },
    {
      packetId: "dependency_contract",
      relativePath: path.posix.join(baseDir, "dependency-contract.md"),
      content: renderDependencyContractMarkdown(context),
    },
    {
      packetId: "file_topology",
      relativePath: path.posix.join(baseDir, "file-topology.md"),
      content: renderBuilderFileTopologyProjectionMarkdown({
        baseline: context.fileTopologyContract ?? null,
        planningContext: fileTopologyPlanningContext,
      }),
    },
    {
      packetId: "project_brief",
      relativePath: path.posix.join(baseDir, "project-brief.md"),
      content: renderProjectBriefMarkdown(args.planning),
    },
    {
      packetId: "architecture",
      relativePath: path.posix.join(baseDir, "architecture.md"),
      content: renderArchitectureMarkdown(context),
    },
    {
      packetId: "milestones",
      relativePath: path.posix.join(baseDir, "milestones.md"),
      content: renderMilestonesMarkdown(args.planning),
    },
    {
      packetId: "task_board",
      relativePath: path.posix.join(baseDir, "task-board.md"),
      content: renderTaskBoardMarkdown(args.planning),
    },
    {
      packetId: "current_plan",
      relativePath: path.posix.join(baseDir, "current-plan.md"),
      content: renderPlanMarkdown(args.currentTask ?? null, planSteps),
    },
    {
      packetId: "session_summary",
      relativePath: path.posix.join(baseDir, "session-summary.md"),
      content: renderSessionSummaryMarkdown(context),
    },
    {
      packetId: "state",
      relativePath: path.posix.join(baseDir, "state.json"),
      content: `${JSON.stringify(context, null, 2)}\n`,
    },
  ];

  if (args.latestReview) {
    artifacts.push({
      packetId: "latest_review",
      relativePath: path.posix.join(baseDir, "reports/latest-review.md"),
      content: renderBuilderReviewMarkdown(args.latestReview),
    });
  }
  if (args.latestOperatorTrust) {
    artifacts.push({
      packetId: "operator_trust_markdown",
      relativePath: path.posix.join(baseDir, "reports/operator-trust.md"),
      content: renderBuilderOperatorTrustMarkdown(args.latestOperatorTrust),
    });
    artifacts.push({
      packetId: "operator_trust_json",
      relativePath: path.posix.join(baseDir, "reports/operator-trust.json"),
      content: `${JSON.stringify(args.latestOperatorTrust, null, 2)}\n`,
    });
  }

  return artifacts;
}

export function syncBuilderProjectProjection(args: {
  project: BuilderProject;
  context: BuilderProjectContextState;
  planning?: BuilderPlanningSnapshot;
  currentTask?: BuilderTask | null;
  latestReview?: BuilderStructuredReview | null;
  latestOperatorTrust?: BuilderOperatorTrustState | null;
}): void {
  const artifacts = collectBuilderProjectionArtifacts(args);
  const previousManifest = readBuilderContextPacketManifest(args.project.relativePath);
  const previousPacketsByPath = new Map(previousManifest?.packets.map((packet) => [packet.relativePath, packet]) ?? []);
  let filesWritten = 0;
  let filesSkipped = 0;

  for (const artifact of artifacts) {
    const previousPacket = previousPacketsByPath.get(artifact.relativePath);
    const currentHash = hashBuilderProjectionArtifactContent(artifact.content);
    if (previousPacket?.contentHash === currentHash && readOptionalBuilderFile(artifact.relativePath) === artifact.content) {
      filesSkipped += 1;
      continue;
    }
    writeBuilderFile(artifact.relativePath, artifact.content);
    filesWritten += 1;
  }
  const { reused } = persistBuilderContextPacketCache({
    projectRelativePath: args.project.relativePath,
    artifacts,
  });
  recordBuilderProjectionCacheSync({
    projectRelativePath: args.project.relativePath,
    filesWritten,
    filesSkipped,
    manifestReused: reused,
  });
  syncBuilderProjectMetadata(args.project);
}

function splitMarkdownSections(source: string, content: string): BuilderInstructionFragment[] {
  const normalized = content.trim();
  if (!normalized) {
    return [];
  }

  const sections = normalized.split(/^##\s+/m);
  if (sections.length === 1) {
    return [{ source, heading: source, content: normalized }];
  }

  const [preamble, ...rest] = sections;
  const fragments: BuilderInstructionFragment[] = [];
  if (preamble.trim()) {
    fragments.push({ source, heading: "overview", content: preamble.trim() });
  }

  for (const section of rest) {
    const [heading, ...body] = section.split("\n");
    fragments.push({
      source,
      heading: heading.trim(),
      content: body.join("\n").trim(),
    });
  }

  return fragments.filter((fragment) => fragment.content);
}

function requestKeywords(request: string): string[] {
  return Array.from(new Set(
    request
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4),
  ));
}

function scoreFragment(fragment: BuilderInstructionFragment, keywords: string[]): number {
  const haystack = `${fragment.heading} ${fragment.content}`.toLowerCase();
  return keywords.reduce((score, keyword) => score + (haystack.includes(keyword) ? 1 : 0), 0);
}

export function selectRelevantInstructionFragments(project: BuilderProject, request: string): BuilderInstructionFragment[] {
  const keywords = requestKeywords(request);
  const candidates = [
    { source: "AGENTS.md", path: path.posix.join(project.relativePath, "AGENTS.md") },
    { source: ".builder/project-context.md", path: path.posix.join(builderDir(project), "project-context.md") },
    { source: ".builder/project-brief.md", path: path.posix.join(builderDir(project), "project-brief.md") },
    { source: ".builder/architecture.md", path: path.posix.join(builderDir(project), "architecture.md") },
    { source: ".builder/milestones.md", path: path.posix.join(builderDir(project), "milestones.md") },
    { source: ".builder/task-board.md", path: path.posix.join(builderDir(project), "task-board.md") },
    { source: ".builder/current-plan.md", path: path.posix.join(builderDir(project), "current-plan.md") },
  ].flatMap((entry) => {
    const content = readOptionalBuilderFile(entry.path);
    return content ? splitMarkdownSections(entry.source, content) : [];
  });

  return candidates
    .map((fragment) => ({ fragment, score: scoreFragment(fragment, keywords) }))
    .filter((entry, index) => entry.score > 0 || index === 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((entry) => ({
      ...entry.fragment,
      content: entry.fragment.content.length > 600
        ? `${entry.fragment.content.slice(0, 600).trimEnd()}…`
        : entry.fragment.content,
    }));
}