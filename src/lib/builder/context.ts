import path from "path";
import type { BuilderProject, BuilderTask } from "@prisma/client";
import { renderBuilderReviewMarkdown } from "@/lib/builder/review";
import { readBuilderFile, writeBuilderFile } from "@/lib/builder/workspace";
import {
  defaultBuilderProjectContext,
  normalizeBuilderProjectContext,
  normalizeBuilderTaskMetadata,
  type BuilderInstructionFragment,
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
    updatedAt: new Date().toISOString(),
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
    "",
    `## Mission`,
    "",
    context.objective ?? "Complete the active Builder task while keeping the project reviewable and safe.",
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
  return [
    `# Architecture`,
    "",
    ...(context.architectureNotes.length > 0 ? context.architectureNotes.map((item) => `- ${item}`) : ["- No architecture notes recorded yet."]),
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

export function syncBuilderProjectProjection(args: {
  project: BuilderProject;
  context: BuilderProjectContextState;
  currentTask?: BuilderTask | null;
  latestReview?: BuilderStructuredReview | null;
}): void {
  const context = normalizeContextForWrite(args.context);
  const currentTaskMetadata = args.currentTask ? normalizeBuilderTaskMetadata(args.currentTask.metadata) : null;
  const planSteps = currentTaskMetadata?.planSteps ?? context.currentPlan;
  const baseDir = builderDir(args.project);

  writeBuilderFile(path.posix.join(args.project.relativePath, "AGENTS.md"), renderProjectAgentsFile(args.project, context));
  writeBuilderFile(path.posix.join(baseDir, "project-context.md"), renderProjectContextMarkdown(context));
  writeBuilderFile(path.posix.join(baseDir, "architecture.md"), renderArchitectureMarkdown(context));
  writeBuilderFile(path.posix.join(baseDir, "current-plan.md"), renderPlanMarkdown(args.currentTask ?? null, planSteps));
  writeBuilderFile(path.posix.join(baseDir, "session-summary.md"), renderSessionSummaryMarkdown(context));
  writeBuilderFile(path.posix.join(baseDir, "state.json"), `${JSON.stringify(context, null, 2)}\n`);
  if (args.latestReview) {
    writeBuilderFile(path.posix.join(baseDir, "reports/latest-review.md"), renderBuilderReviewMarkdown(args.latestReview));
  }
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
    { source: ".builder/architecture.md", path: path.posix.join(builderDir(project), "architecture.md") },
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