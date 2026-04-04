import type { BuilderProject, BuilderProjectBrief, BuilderProjectLifecycle } from "@prisma/client";
import type { BuilderArchitectureDecisionState, BuilderMilestoneState, BuilderTaskSpecState } from "@/lib/builder/types";
import { normalizeBuilderTaskMetadata, type BuilderInstructionFragment, type BuilderProjectContextState } from "@/lib/builder/types";

function joinList(title: string, values: string[], empty = "none"): string {
  return `${title}: ${values.length > 0 ? values.join("; ") : empty}`;
}

function renderArchitectureSection(title: string, decisions: BuilderArchitectureDecisionState[], empty: string): string {
  return [
    title,
    ...(decisions.length > 0
      ? decisions.map((decision) => `- ${decision.key}: ${decision.description ?? decision.displayName} (confidence ${decision.confidence.toFixed(2)}, source ${decision.source})`)
      : ["- " + empty]),
  ].join("\n");
}

export function composeBuilderTaskPrompt(args: {
  project: BuilderProject;
  task: { title: string; acceptanceCriteria: unknown; metadata: unknown };
  context: BuilderProjectContextState;
  lifecycle: BuilderProjectLifecycle;
  brief: BuilderProjectBrief | null;
  currentMilestone: BuilderMilestoneState | null;
  currentTaskSpec: BuilderTaskSpecState | null;
  request: string;
  stage: string;
  fragments: BuilderInstructionFragment[];
}): string {
  const metadata = normalizeBuilderTaskMetadata(args.task.metadata);
  const acceptanceCriteria = Array.isArray(args.task.acceptanceCriteria)
    ? args.task.acceptanceCriteria.filter((item): item is string => typeof item === "string")
    : [];
  const planSteps = metadata.planSteps.length > 0 ? metadata.planSteps : args.context.currentPlan;
  const completionCriteria = args.currentTaskSpec?.completionCriteria ?? acceptanceCriteria;
  const validators = args.currentTaskSpec?.validators.length
    ? args.currentTaskSpec.validators.join(", ").toLowerCase()
    : "manual_review";

  return [
    "Builder mission: operate as a project-scoped build orchestrator inside the dedicated external builder workspace only.",
    "Safety boundary: never target or mutate the BizBot repository; keep file writes and commands bounded to the resolved Builder project workspace.",
    `Project identity: ${args.project.name} (${args.project.relativePath}) using template ${args.project.template} and package manager ${args.project.packageManager}.`,
    `Project lifecycle: ${args.lifecycle.toLowerCase()}.`,
    args.brief ? `Project brief summary: ${args.brief.summary}` : "Project brief summary: no canonical brief has been recorded yet.",
    args.currentMilestone ? `Current milestone: ${args.currentMilestone.title} (${args.currentMilestone.status.toLowerCase()}).` : "Current milestone: none selected.",
    args.currentTaskSpec ? `Current task spec: ${args.currentTaskSpec.title} (${args.currentTaskSpec.status.toLowerCase()}).` : "Current task spec: none selected.",
    `Current task: ${args.task.title}.`,
    `Current stage: ${args.stage}.`,
    metadata.resumeFromIteration
      ? `Resume target: use iteration ${metadata.resumeFromIteration} as the recovery reference while working from the current workspace state.`
      : "Resume target: none.",
    metadata.latestLoopSummary ? `Latest loop summary: ${metadata.latestLoopSummary}` : "Latest loop summary: none recorded.",
    `Success criteria: ${completionCriteria.length > 0 ? completionCriteria.join("; ") : "complete the task, validate the result, and leave a clear review summary."}`,
    `Validators: ${validators}.`,
    joinList("Top constraints", args.context.constraints, "stay within workspace, prefer deterministic changes, keep outputs reviewable"),
    joinList("Important commands", args.context.importantCommands),
    joinList("Known failures", args.context.knownFailures),
    joinList("Next steps", args.context.nextSteps),
    args.context.objective ? `Project objective: ${args.context.objective}` : "Project objective: not yet recorded.",
    planSteps.length > 0
      ? `Active plan: ${planSteps.map((step) => `[${step.status}] ${step.label}`).join("; ")}`
      : "Active plan: inspect the workspace, implement the request, validate the result, and summarize what changed.",
    args.context.latestSessionSummary ? `Latest session summary: ${args.context.latestSessionSummary}` : "Latest session summary: none recorded.",
    args.fragments.length > 0
      ? [
          "Relevant instruction fragments:",
          ...args.fragments.map((fragment) => `From ${fragment.source} / ${fragment.heading}: ${fragment.content}`),
        ].join("\n")
      : "Relevant instruction fragments: none selected.",
    `Current user request: ${args.request.trim()}`,
    "Do not restate the whole project history. Make the smallest safe set of changes needed for the current task, validate when possible, and leave the workspace in a reviewable state.",
  ].join("\n\n");
}

export function composeBuilderPlannerPrompt(args: {
  project: BuilderProject;
  brief: BuilderProjectBrief;
  context: BuilderProjectContextState;
  constraints: string[];
  nonGoals: string[];
  acceptanceCriteria: string[];
  activeArchitecture: BuilderArchitectureDecisionState[];
  staleArchitecture: BuilderArchitectureDecisionState[];
}): string {
  return [
    "Builder planner mission: produce a concise, dependency-safe project plan for the selected external Builder workspace.",
    "Planning boundary: keep the existing Builder route and plugin entry points, do not change the execution loop, and prefer project-scoped derived views over schema additions.",
    `[Brief]\nProject: ${args.project.name}\nTemplate: ${args.project.template}\nPackage manager: ${args.project.packageManager}\nTitle: ${args.brief.title}\nSummary: ${args.brief.summary}\n[/Brief]`,
    `[Constraints]\n${args.constraints.length > 0 ? args.constraints.map((constraint) => `- ${constraint}`).join("\n") : "- none recorded"}\n[/Constraints]`,
    `[Non-Goals]\n${args.nonGoals.length > 0 ? args.nonGoals.map((item) => `- ${item}`).join("\n") : "- none recorded"}\n[/Non-Goals]`,
    `[Acceptance Criteria]\n${args.acceptanceCriteria.length > 0 ? args.acceptanceCriteria.map((item) => `- ${item}`).join("\n") : "- none recorded"}\n[/Acceptance Criteria]`,
    `[Template Guidance]\n- Respect the existing template: ${args.project.template}.\n- Keep package manager assumptions aligned to ${args.project.packageManager}.\n- Reuse current context/projection patterns, but keep planning prompting separate from task execution prompting.\n[/Template Guidance]`,
    `[Active Architecture]\n${renderArchitectureSection("", args.activeArchitecture, "No active architecture decisions recorded.").replace(/^\n/, "")}\n[/Active Architecture]`,
    `[Stale Architecture - Needs Reconfirmation]\n${renderArchitectureSection("", args.staleArchitecture, "No stale architecture decisions require reconciliation.").replace(/^\n/, "")}\n[/Stale Architecture - Needs Reconfirmation]`,
    `[Context Notes]\n${args.context.objective ? `Objective: ${args.context.objective}` : "Objective: none recorded"}\n${args.context.instructionNotes ? `Instruction notes: ${args.context.instructionNotes}` : "Instruction notes: none recorded"}\n[/Context Notes]`,
    `[Planner Output Contract]\nReturn structured planner output that can be normalized into milestones and tasks.\nEach task must include: key, title, summary, completionCriteria, validators, dependencyKeys, architectural_new_decisions, architectural_stale_keys.\nEvery stale architecture key must be explicitly addressed either by reconfirming it as a new decision or listing it under architectural_stale_keys.\nKeep milestones brief, keep dependencies acyclic, and make template-aware choices.\n[/Planner Output Contract]`,
  ].join("\n\n");
}