import type { BuilderProject, BuilderTask } from "@prisma/client";
import { normalizeBuilderTaskMetadata, type BuilderInstructionFragment, type BuilderProjectContextState } from "@/lib/builder/types";

function joinList(title: string, values: string[], empty = "none"): string {
  return `${title}: ${values.length > 0 ? values.join("; ") : empty}`;
}

export function composeBuilderTaskPrompt(args: {
  project: BuilderProject;
  task: BuilderTask;
  context: BuilderProjectContextState;
  request: string;
  stage: string;
  fragments: BuilderInstructionFragment[];
}): string {
  const metadata = normalizeBuilderTaskMetadata(args.task.metadata);
  const acceptanceCriteria = Array.isArray(args.task.acceptanceCriteria)
    ? args.task.acceptanceCriteria.filter((item): item is string => typeof item === "string")
    : [];
  const planSteps = metadata.planSteps.length > 0 ? metadata.planSteps : args.context.currentPlan;

  return [
    "Builder mission: operate as a project-scoped build orchestrator inside the dedicated external builder workspace only.",
    "Safety boundary: never target or mutate the BizBot repository; keep file writes and commands bounded to the resolved Builder project workspace.",
    `Project identity: ${args.project.name} (${args.project.relativePath}) using template ${args.project.template} and package manager ${args.project.packageManager}.`,
    `Current task: ${args.task.title}.`,
    `Current stage: ${args.stage}.`,
    metadata.resumeFromIteration
      ? `Resume target: use iteration ${metadata.resumeFromIteration} as the recovery reference while working from the current workspace state.`
      : "Resume target: none.",
    metadata.latestLoopSummary ? `Latest loop summary: ${metadata.latestLoopSummary}` : "Latest loop summary: none recorded.",
    `Success criteria: ${acceptanceCriteria.length > 0 ? acceptanceCriteria.join("; ") : "complete the task, validate the result, and leave a clear review summary."}`,
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