import type { BuilderProject, BuilderProjectBrief, BuilderProjectLifecycle } from "@prisma/client";
import type { BuilderArchitectureDecisionState, BuilderMilestoneState, BuilderPlanAdherenceState, BuilderTaskSpecState } from "@/lib/builder/types";
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

function renderTemplateExecutionGuidance(project: Pick<BuilderProject, "template" | "packageManager">): string | null {
  if (project.template !== "node-cli") {
    return null;
  }

  return [
    "Node CLI template guidance:",
    "- Keep TypeScript builds emitting to dist and keep start scripts pointing at built files under dist.",
    `- Keep package manager assumptions aligned to ${project.packageManager} and use cross-platform package scripts; avoid shell-specific env assignment such as NAME=value command.`,
    "- If the task adds Prisma with a direct PrismaClient, prefer the stable direct-client setup and keep runtime SQLite paths aligned with Prisma migration paths.",
  ].join("\n");
}

function inferBuilderTaskExecutionMode(args: {
  taskTitle: string;
  taskSummary: string;
  completionCriteria: string[];
  validators: string[];
}): BuilderPlanAdherenceState["mode"] {
  const source = [args.taskTitle, args.taskSummary, ...args.completionCriteria, ...args.validators].join(" ").toLowerCase();

  if ((/capture|confirm|decisions?|scope|authority|contract|brief/.test(source)) && args.validators.every((validator) => validator === "MANUAL_REVIEW")) {
    return "analysis_only";
  }
  if (/scaffold|setup|set up|shell|bootstrap|initialize|init|wire/.test(source)) {
    return "scaffold";
  }
  if (/verify|verification|review|test|validation/.test(source)) {
    return "verification";
  }
  return "implementation";
}

export function buildBuilderPlanAdherence(args: {
  task: { title: string; acceptanceCriteria: unknown; metadata: unknown };
  context: BuilderProjectContextState;
  currentMilestone: BuilderMilestoneState | null;
  currentTaskSpec: BuilderTaskSpecState | null;
}): BuilderPlanAdherenceState {
  const metadata = normalizeBuilderTaskMetadata(args.task.metadata);
  const planSteps = metadata.planSteps.length > 0 ? metadata.planSteps : args.context.currentPlan;
  const acceptanceCriteria = Array.isArray(args.task.acceptanceCriteria)
    ? args.task.acceptanceCriteria.filter((item): item is string => typeof item === "string")
    : [];
  const completionCriteria = args.currentTaskSpec?.completionCriteria ?? acceptanceCriteria;
  const validators = args.currentTaskSpec?.validators ?? [];
  const mode = inferBuilderTaskExecutionMode({
    taskTitle: args.currentTaskSpec?.title ?? args.task.title,
    taskSummary: args.currentTaskSpec?.summary ?? "",
    completionCriteria,
    validators: validators.map((validator) => String(validator)),
  });
  const blockingIssues: string[] = [];

  if (!args.currentMilestone) {
    blockingIssues.push("No active milestone is selected for execution.");
  }
  if (!args.currentTaskSpec) {
    blockingIssues.push("No active task spec is selected for execution.");
  }
  if (args.currentTaskSpec && args.task.title.trim() !== args.currentTaskSpec.title.trim()) {
    blockingIssues.push(`Execution task title \"${args.task.title.trim()}\" does not match current task spec \"${args.currentTaskSpec.title.trim()}\".`);
  }
  if (args.currentTaskSpec && planSteps.length > 0) {
    const activeStep = planSteps.find((step) => step.status === "in_progress");
    if (activeStep && !activeStep.label.toLowerCase().includes(args.currentTaskSpec.title.toLowerCase())) {
      blockingIssues.push(`Active plan step \"${activeStep.label}\" is not aligned with the current task spec \"${args.currentTaskSpec.title}\".`);
    }
  }

  const staleDecisionKeys = args.context.architecture?.stale.map((decision) => decision.key) ?? [];
  const requiredDecisionKeys = args.currentTaskSpec?.architecturalDecisionKeys ?? [];
  const reconfirmedStaleKeys = staleDecisionKeys.filter((key) => requiredDecisionKeys.includes(key));
  const directives = [
    "Implement only the current task spec and stop once its completion criteria are satisfied.",
    args.currentMilestone
      ? `Do not start work from later milestones than \"${args.currentMilestone.title}\".`
      : "Do not start work from later milestones.",
    validators.length > 0
      ? `Leave ${validators.map((validator) => String(validator).toLowerCase()).join(", ")} to the outer deterministic verifier unless the task explicitly asks you to edit validation artifacts.`
      : "Leave build/test/lint execution to the outer deterministic verifier unless the task explicitly asks you to edit validation artifacts.",
  ];

  if (mode === "analysis_only") {
    directives.push("Stay in inspection and project-context updates only.");
    directives.push("Do not bootstrap the runtime, add dependencies, run generators, or implement application files in this task.");
  } else if (mode === "scaffold") {
    directives.push("Limit changes to runtime shell, package wiring, and scaffolding required by this task.");
    directives.push("Do not implement downstream feature behavior or full verification suites in this task.");
  } else if (mode === "verification") {
    directives.push("Prefer targeted test and verification artifacts over broad runtime rewrites.");
    directives.push("Only make implementation changes that are necessary to satisfy the declared verification gap.");
  } else {
    directives.push("Prefer direct edits to the files implied by the current task spec before exploring unrelated workspace areas.");
  }

  if (requiredDecisionKeys.length > 0) {
    directives.push(`Only introduce or revise architecture needed for: ${requiredDecisionKeys.join(", ")}.`);
  }
  if (reconfirmedStaleKeys.length > 0) {
    directives.push(`This task is responsible for reconfirming stale decisions: ${reconfirmedStaleKeys.join(", ")}.`);
  }

  return {
    allowsExecution: blockingIssues.length === 0,
    mode,
    summary: blockingIssues.length === 0
      ? `Plan adherence aligned for ${args.currentTaskSpec?.title ?? args.task.title}.`
      : `Plan adherence check failed: ${blockingIssues.join(" ")}`,
    blockingIssues,
    requiredDecisionKeys,
    staleDecisionKeys,
    reconfirmedStaleKeys,
    directives,
  };
}

function renderPlanAdherenceSection(adherence: BuilderPlanAdherenceState | null | undefined): string {
  if (!adherence) {
    return "Plan adherence: no preflight adherence state was provided.";
  }

  return [
    "[Plan Adherence]",
    `Status: ${adherence.allowsExecution ? "aligned" : "blocked"}`,
    `Mode: ${adherence.mode}`,
    `Summary: ${adherence.summary}`,
    `Required decision keys: ${adherence.requiredDecisionKeys.length > 0 ? adherence.requiredDecisionKeys.join(", ") : "none"}`,
    `Project stale decision keys: ${adherence.staleDecisionKeys.length > 0 ? adherence.staleDecisionKeys.join(", ") : "none"}`,
    `Reconfirmed stale keys for this task: ${adherence.reconfirmedStaleKeys.length > 0 ? adherence.reconfirmedStaleKeys.join(", ") : "none"}`,
    adherence.blockingIssues.length > 0 ? `Blocking issues: ${adherence.blockingIssues.join("; ")}` : "Blocking issues: none",
    ...adherence.directives.map((directive) => `- ${directive}`),
    "[/Plan Adherence]",
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
  adherence?: BuilderPlanAdherenceState | null;
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
    renderPlanAdherenceSection(args.adherence),
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
    renderTemplateExecutionGuidance(args.project),
    `Current user request: ${args.request.trim()}`,
    "Do not restate the whole project history. Make the smallest safe set of changes needed for the current task, validate when possible, and leave the workspace in a reviewable state.",
  ].filter((section): section is string => Boolean(section)).join("\n\n");
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
    "Planning boundary: plan the requested external project itself. Do not assume the brief is about Builder Mode internals unless the brief explicitly targets Builder planning, routes, plugins, projections, or execution-loop work.",
    `[Brief]\nProject: ${args.project.name}\nTemplate: ${args.project.template}\nPackage manager: ${args.project.packageManager}\nTitle: ${args.brief.title}\nSummary: ${args.brief.summary}\n[/Brief]`,
    `[Constraints]\n${args.constraints.length > 0 ? args.constraints.map((constraint) => `- ${constraint}`).join("\n") : "- none recorded"}\n[/Constraints]`,
    `[Non-Goals]\n${args.nonGoals.length > 0 ? args.nonGoals.map((item) => `- ${item}`).join("\n") : "- none recorded"}\n[/Non-Goals]`,
    `[Acceptance Criteria]\n${args.acceptanceCriteria.length > 0 ? args.acceptanceCriteria.map((item) => `- ${item}`).join("\n") : "- none recorded"}\n[/Acceptance Criteria]`,
    `[Template Guidance]\n- Respect the existing template: ${args.project.template}.\n- Keep package manager assumptions aligned to ${args.project.packageManager}.\n- Reuse current context/projection patterns, but keep planning prompting separate from task execution prompting.\n[/Template Guidance]`,
    `[Active Architecture]\n${renderArchitectureSection("", args.activeArchitecture, "No active architecture decisions recorded.").replace(/^\n/, "")}\n[/Active Architecture]`,
    `[Stale Architecture - Needs Reconfirmation]\n${renderArchitectureSection("", args.staleArchitecture, "No stale architecture decisions require reconciliation.").replace(/^\n/, "")}\n[/Stale Architecture - Needs Reconfirmation]`,
    `[Context Notes]\n${args.context.objective ? `Objective: ${args.context.objective}` : "Objective: none recorded"}\n${args.context.instructionNotes ? `Instruction notes: ${args.context.instructionNotes}` : "Instruction notes: none recorded"}\n[/Context Notes]`,
    `[Planner Output Contract]\nReturn structured planner output that can be normalized into milestones and tasks.\nEach task must include: key, title, summary, completionCriteria, validators, dependencyKeys, architectural_new_decisions, architectural_stale_keys.\nEvery stale architecture key must be explicitly addressed either by reconfirming it as a new decision or listing it under architectural_stale_keys.\nActive architecture should be carried forward when it still governs the plan, and only retired through architectural_stale_keys when the plan is explicitly superseding it.\nKeep milestones brief, keep dependencies acyclic, and make template-aware choices.\n[/Planner Output Contract]`,
  ].join("\n\n");
}