import type { BuilderProject, BuilderProjectBrief } from "@prisma/client";
import { selectRelevantBuilderMcpContext } from "@/lib/builder/mcp-snapshots";
import { defaultTaskSpecValidators } from "@/lib/builder/planning";
import { composeBuilderPlannerPrompt } from "@/lib/builder/prompt";
import {
  defaultBuilderArchitectureContext,
  defaultBuilderProjectContext,
  normalizeBuilderProjectBriefState,
  normalizeBuilderProjectContext,
  type BuilderArchitectureContextState,
  type BuilderDependencyPlanningContextState,
  type BuilderFileTopologyPlanningContextState,
  type BuilderMcpPlanningContextState,
  type BuilderNormalizedMilestoneDraft,
  type BuilderNormalizedTaskSpecDraft,
  type BuilderPlannerCritiqueIssue,
  type BuilderPlannerCritiqueState,
  type BuilderPlannerInputState,
  type BuilderPlannerMilestoneDraft,
  type BuilderProjectBriefState,
  type BuilderProjectContextState,
  type BuilderRelevantDependencyContextState,
  type BuilderRelevantFileTopologyContextState,
} from "@/lib/builder/types";
function isNormalizedValidator(
  value: BuilderNormalizedTaskSpecDraft["validators"][number] | null,
): value is BuilderNormalizedTaskSpecDraft["validators"][number] {
  return value !== null;
}

const ARCHITECTURAL_DECISION_KEY_RE = /^[a-z][a-z0-9_]*$/;

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function normalizeValidatorName(value: string): BuilderNormalizedTaskSpecDraft["validators"][number] | null {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  switch (normalized) {
    case "build":
      return "BUILD";
    case "test":
      return "TEST";
    case "lint":
      return "LINT";
    case "typecheck":
      return "TYPECHECK";
    case "none":
      return "NONE";
    case "manual_review":
      return "MANUAL_REVIEW";
    default:
      return null;
  }
}

export function normalizeArchitecturalDecisionKeys(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.flatMap((value) => {
    if (typeof value !== "string") {
      return [];
    }
    const candidate = value.trim();
    return ARCHITECTURAL_DECISION_KEY_RE.test(candidate) ? [candidate] : [];
  });
}

function normalizeTaskDraft(task: BuilderPlannerMilestoneDraft["tasks"][number], index: number, validKeys: Set<string>): BuilderNormalizedTaskSpecDraft {
  const completionCriteria = Array.isArray(task.completionCriteria)
    ? task.completionCriteria.flatMap((value) => typeof value === "string" && value.trim() ? [value.trim()] : [])
    : [];
  const validators = unique(
    (Array.isArray(task.validators) ? task.validators : [])
      .flatMap((value) => typeof value === "string" ? [normalizeValidatorName(value)] : [])
      .filter(isNormalizedValidator),
  ) as BuilderNormalizedTaskSpecDraft["validators"];
  const dependencyKeys = unique(
    (Array.isArray(task.dependencyKeys) ? task.dependencyKeys : [])
      .flatMap((value) => typeof value === "string" && validKeys.has(value.trim()) ? [value.trim()] : []),
  );
  const architecturalDecisionKeys = normalizeArchitecturalDecisionKeys(task.architectural_new_decisions);
  const architecturalStaleKeys = normalizeArchitecturalDecisionKeys(task.architectural_stale_keys);

  return {
    key: task.key,
    title: task.title.trim(),
    summary: task.summary.trim(),
    status: "PENDING",
    sortOrder: index + 1,
    completionCriteria,
    validators: validators.length > 0 ? validators : defaultTaskSpecValidators(),
    dependencyKeys,
    architecturalDecisionKeys,
    architecturalStaleKeys,
  };
}

export function normalizePlannerOutput(milestones: BuilderPlannerMilestoneDraft[]): BuilderNormalizedMilestoneDraft[] {
  const validMilestones = milestones.flatMap((milestone, milestoneIndex) => {
    const title = milestone.title.trim();
    const summary = milestone.summary.trim();
    if (!title || !summary || !Array.isArray(milestone.tasks) || milestone.tasks.length === 0) {
      return [];
    }

    const validTaskKeys = new Set(
      milestone.tasks
        .flatMap((task, taskIndex) => typeof task.key === "string" && task.key.trim()
          ? [task.key.trim()]
          : [`task_${milestoneIndex + 1}_${taskIndex + 1}`]),
    );

    const tasks = milestone.tasks.flatMap((task, taskIndex) => {
      const key = typeof task.key === "string" && task.key.trim()
        ? task.key.trim()
        : `task_${milestoneIndex + 1}_${taskIndex + 1}`;
      const taskTitle = typeof task.title === "string" ? task.title.trim() : "";
      const taskSummary = typeof task.summary === "string" ? task.summary.trim() : "";
      if (!taskTitle || !taskSummary) {
        return [];
      }
      return [normalizeTaskDraft({ ...task, key, title: taskTitle, summary: taskSummary }, taskIndex, validTaskKeys)];
    });

    if (tasks.length === 0) {
      return [];
    }

    return [{
      key: typeof milestone.key === "string" && milestone.key.trim() ? milestone.key.trim() : `milestone_${milestoneIndex + 1}`,
      title,
      summary,
      status: "PENDING",
      sortOrder: milestoneIndex + 1,
      tasks,
    } satisfies BuilderNormalizedMilestoneDraft];
  });

  return validMilestones;
}

function buildCategoryFlags(brief: BuilderProjectBrief) {
  const implementationSource = [
    brief.title,
    brief.summary,
    ...brief.goals,
    ...brief.constraints,
    ...brief.deliverables,
  ].join(" ").toLowerCase();
  const noteSource = (brief.notes ?? "").toLowerCase();

  return {
    isBuilderMeta: /\bbuilder\b|\bplanner\b|\bplanning\b|\badr\b|\bprojection\b|\bmilestone\b|\btask spec\b|\bexecution loop\b/.test(implementationSource),
    hasData: /schema|prisma|database|migration|model|table/.test(implementationSource),
    hasServices: /service|api|route|orchestrator|scheduler|backend|plugin/.test(implementationSource),
    hasUi: /dashboard|page|ui|frontend|react|view/.test(implementationSource),
    hasTests: /test|docs|documentation|verify|verification|typecheck|lint/.test(`${implementationSource} ${noteSource}`),
    isApi: /\brest\b|\bapi\b|\bendpoint\b|\bjson\b|\bexpress\b/.test(implementationSource),
    usesNode: /\bnode(?:\.js)?\b|\bexpress\b/.test(implementationSource),
    usesExpress: /\bexpress\b/.test(implementationSource),
    usesPrisma: /\bprisma\b/.test(implementationSource),
    usesSqlite: /\bsqlite\b/.test(implementationSource),
    usesInMemoryStorage: /in[- ]memory|memory storage/.test(implementationSource),
    forbidsDatabase: /no database|without database|avoid database|in-memory storage/.test(implementationSource),
    returnsJson: /returns? json|json response|json api/.test(implementationSource),
  };
}

function derivePlannerNonGoals(brief: BuilderProjectBrief): string[] {
  const notes = brief.notes?.trim() ?? "";
  const explicit = notes.match(/non-goals?:\s*([^\n]+)/i)?.[1] ?? "";
  const values = explicit
    .split(/[;,]/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (values.length > 0) {
    return unique(values);
  }

  return [];
}

function derivePlannerAcceptanceCriteria(brief: BuilderProjectBrief): string[] {
  return unique([
    ...brief.deliverables,
    ...brief.goals,
  ]).slice(0, 8);
}

function withStaleArchitectureTasks(
  milestones: BuilderPlannerMilestoneDraft[],
  staleKeys: string[],
): BuilderPlannerMilestoneDraft[] {
  if (staleKeys.length === 0 || milestones.length === 0 || milestones[0]?.tasks.length === 0) {
    return milestones;
  }

  const [firstMilestone, ...restMilestones] = milestones;
  const [firstTask, ...restTasks] = firstMilestone.tasks;
  return [{
    ...firstMilestone,
    tasks: [{
      ...firstTask,
      architectural_stale_keys: unique([
        ...normalizeArchitecturalDecisionKeys(firstTask.architectural_stale_keys),
        ...staleKeys,
      ]),
    }, ...restTasks],
  }, ...restMilestones];
}

function buildBuilderMetaPlannerDraft(
  brief: BuilderProjectBrief,
  architecture: BuilderArchitectureContextState = defaultBuilderArchitectureContext(),
): BuilderPlannerMilestoneDraft[] {
  const flags = buildCategoryFlags(brief);
  const rawMilestones: BuilderPlannerMilestoneDraft[] = [];

  rawMilestones.push({
    key: "brief_alignment",
    title: "Confirm brief boundaries",
    summary: "Translate the persisted brief into concrete work boundaries, authority rules, and implementation scope.",
    tasks: [{
      key: "brief_scope",
      title: "Capture scope and authority split",
      summary: brief.summary,
      completionCriteria: [
        "Summarize the brief in durable project context.",
        "Identify the canonical planning authority and execution-history boundary.",
        ...(architecture.active.length > 0 ? ["Reconfirm the active Builder architecture decisions that still apply."] : []),
      ],
      validators: ["manual_review"],
      architectural_new_decisions: ["planning_authority_split"],
    }],
  });

  if (flags.hasData) {
    rawMilestones.push({
      key: "canonical_data_model",
      title: "Establish canonical planning schema",
      summary: "Add the relational planning structures and lifecycle fields required for project-first Builder orchestration.",
      tasks: [{
        key: "schema_updates",
        title: "Add planning tables and lifecycle fields",
        summary: "Extend the Builder schema with project lifecycle, briefs, milestones, task specs, and execution links.",
        completionCriteria: [
          "Schema exposes the canonical planning models.",
          "Execution tasks can optionally link back to task specs.",
        ],
        validators: ["typecheck"],
        dependencyKeys: ["brief_scope"],
        architectural_new_decisions: ["planning_schema"],
      }],
    });
  }

  if (flags.hasServices) {
    rawMilestones.push({
      key: "planning_services",
      title: "Implement planning services and scheduling",
      summary: "Persist briefs and plans canonically, schedule runnable task specs, and map execution results back into planning state.",
      tasks: [{
        key: "planning_services_impl",
        title: "Persist brief and plan state",
        summary: "Add CRUD, plan replacement, normalization, and lifecycle synchronization for planning records.",
        completionCriteria: [
          "Brief CRUD is available beside the current project and task services.",
          "Plan writes normalize statuses, orders, dependencies, validators, and architectural decision keys.",
        ],
        validators: ["typecheck", "manual_review"],
        dependencyKeys: unique(["brief_scope", ...(flags.hasData ? ["schema_updates"] : [])]),
        architectural_new_decisions: ["task_spec_scheduler"],
      }, {
        key: "orchestrator_advancement",
        title: "Advance projects through plan-driven orchestration",
        summary: "Refactor project advancement so runnable task specs feed the current native execution loop and review sync.",
        completionCriteria: [
          "Orchestrator requires a brief before planning and a plan before execution.",
          "Next runnable task spec selection is canonical and milestone-ordered.",
        ],
        validators: ["build", "test", "typecheck"],
        dependencyKeys: ["planning_services_impl"],
        architectural_new_decisions: ["project_advancement_flow"],
      }],
    });
  }

  if (flags.hasUi) {
    rawMilestones.push({
      key: "builder_surfaces",
      title: "Project surfaces and projections",
      summary: "Expose the brief, staged plan, and current task in Builder projections, routes, and dashboard payloads.",
      tasks: [{
        key: "projection_sync",
        title: "Sync brief and plan projection files",
        summary: "Write DB-driven brief, milestone, and task-board projections while preserving the existing projection surface.",
        completionCriteria: [
          "Projection files include brief, milestones, and task board snapshots.",
          "Projection rewrites stay deterministic and DB authoritative.",
        ],
        validators: ["manual_review"],
        dependencyKeys: ["planning_services_impl"],
      }, {
        key: "api_and_dashboard",
        title: "Expose staged project overview",
        summary: "Extend the current Builder project API and dashboard to show Brief, Plan, and Current Task without duplicating existing routes.",
        completionCriteria: [
          "Project overview payload includes lifecycle, brief, milestones, and current task spec.",
          "Dashboard renders the staged Builder view using the existing polling model.",
        ],
        validators: ["build", "manual_review"],
        dependencyKeys: ["projection_sync", "orchestrator_advancement"],
      }],
    });
  }

  rawMilestones.push({
    key: "verification_and_docs",
    title: "Verify and document the planning model",
    summary: "Cover the new scheduling and planning behavior with targeted tests and update Builder documentation.",
    tasks: [{
      key: "tests_and_docs",
      title: "Add focused Builder planning coverage",
      summary: "Extend Builder tests and docs for planning schema, scheduler rules, projections, prompt synthesis, and route behavior.",
      completionCriteria: [
        "Scheduler, projection, prompt, and route coverage reflects the new planning authority split.",
        "Documentation explains canonical planning state versus execution history.",
      ],
      validators: flags.hasTests ? ["test", "lint", "typecheck"] : ["test", "typecheck"],
      dependencyKeys: unique([
        ...(flags.hasUi ? ["api_and_dashboard"] : []),
        ...(flags.hasServices ? ["orchestrator_advancement"] : []),
        ...(flags.hasData ? ["schema_updates"] : []),
      ]),
      architectural_new_decisions: ["builder_plan_projection"],
    }],
  });

  return withStaleArchitectureTasks(rawMilestones.slice(0, 7), architecture.stale.map((decision) => decision.key));
}

function buildGenericPlannerDraft(
  brief: BuilderProjectBrief,
  architecture: BuilderArchitectureContextState = defaultBuilderArchitectureContext(),
): BuilderPlannerMilestoneDraft[] {
  const flags = buildCategoryFlags(brief);
  const runtimeDecisionKeys = unique([
    ...(flags.usesNode ? ["tech_stack_runtime"] : []),
    ...(flags.usesExpress ? ["tech_stack_framework"] : []),
    ...(flags.isApi ? ["service_surface_rest_api"] : []),
    ...(flags.returnsJson ? ["response_format_json"] : []),
    ...(flags.usesPrisma ? ["orm_prisma"] : []),
    ...(flags.usesSqlite ? ["database_strategy_sqlite"] : []),
    ...(flags.hasData && !flags.usesInMemoryStorage && !flags.forbidsDatabase ? ["persistence_relational"] : []),
    ...(flags.usesInMemoryStorage || flags.forbidsDatabase ? ["persistence_in_memory", "database_strategy_none"] : []),
  ]);

  const rawMilestones: BuilderPlannerMilestoneDraft[] = [{
    key: "requirements_alignment",
    title: flags.isApi ? "Confirm API contract" : "Confirm implementation contract",
    summary: flags.isApi
      ? "Translate the brief into concrete runtime, endpoint, storage, and validation requirements."
      : "Translate the brief into concrete runtime, scope, and validation requirements.",
    tasks: [{
      key: "capture_requirements",
      title: flags.isApi ? "Capture runtime and endpoint decisions" : "Capture runtime and scope decisions",
      summary: brief.summary,
      completionCriteria: unique([
        ...(flags.isApi ? ["Identify the required endpoints, payloads, and JSON response contract."] : ["Identify the requested deliverables and runtime boundary."]),
        ...(flags.hasData && !flags.usesInMemoryStorage && !flags.forbidsDatabase ? ["Record the database, schema, and migration boundary needed for persistence."] : []),
        ...(flags.usesInMemoryStorage || flags.forbidsDatabase ? ["Record that persistence stays in memory without a database dependency."] : []),
        ...(brief.deliverables.length > 0 ? [brief.deliverables[0] ?? ""] : []),
      ].filter(Boolean)),
      validators: ["manual_review"],
      architectural_new_decisions: runtimeDecisionKeys,
    }],
  }];

  rawMilestones.push({
    key: "project_scaffold",
    title: flags.isApi ? "Scaffold the service runtime" : "Scaffold the project runtime",
    summary: flags.isApi
      ? "Create the minimal package structure, scripts, and entrypoint needed for the requested service."
      : "Create the minimal package structure, scripts, and entrypoint needed for the requested project.",
    tasks: [{
      key: "scaffold_runtime",
      title: flags.usesExpress ? "Set up the Express server shell" : "Set up the runtime shell",
      summary: flags.usesExpress
        ? "Add the server entrypoint, dependency wiring, and package scripts for an Express-based API."
        : "Add the project entrypoint, dependency wiring, and package scripts needed by the brief.",
      completionCriteria: unique([
        "Package scripts support deterministic verification.",
        ...(flags.usesExpress ? ["The runtime boots an Express app that can serve HTTP requests."] : ["The runtime boots cleanly for the requested project type."]),
        ...(flags.hasData && !flags.usesInMemoryStorage && !flags.forbidsDatabase ? ["Database client and schema tooling are wired for local development."] : []),
      ]),
      validators: ["build", "typecheck"],
      dependencyKeys: ["capture_requirements"],
      architectural_new_decisions: unique([
        ...(flags.usesNode ? ["tech_stack_runtime"] : []),
        ...(flags.usesExpress ? ["tech_stack_framework", "transport_http"] : []),
        ...(flags.usesPrisma ? ["orm_prisma"] : []),
        ...(flags.usesSqlite ? ["database_strategy_sqlite"] : []),
      ]),
    }],
  });

  rawMilestones.push({
    key: "feature_implementation",
    title: flags.isApi ? "Implement endpoint behavior" : "Implement requested behavior",
    summary: flags.isApi
      ? "Build the requested routes, persistence layer, and response handling."
      : "Build the requested core behavior and supporting state handling.",
    tasks: [{
      key: "implement_core_behavior",
      title: flags.isApi ? "Implement health and items endpoints" : "Implement the primary feature set",
      summary: flags.isApi
        ? `Add GET /health, GET /items, and POST /items with ${flags.hasData && !flags.usesInMemoryStorage && !flags.forbidsDatabase ? "database-backed persistence" : "in-memory storage"} and JSON responses.`
        : "Implement the primary feature set described in the brief.",
      completionCriteria: unique([
        ...(flags.isApi ? [
          "GET /health returns a 200 JSON response.",
          `GET /items returns the current ${flags.hasData && !flags.usesInMemoryStorage && !flags.forbidsDatabase ? "persisted" : "in-memory"} collection as JSON.`,
          `POST /items validates input and stores a new ${flags.hasData && !flags.usesInMemoryStorage && !flags.forbidsDatabase ? "persisted" : "in-memory"} item.`,
        ] : ["The requested feature set is implemented and usable."]),
      ]),
      validators: ["build", "typecheck"],
      dependencyKeys: ["scaffold_runtime"],
      architectural_new_decisions: unique([
        ...(flags.hasData && !flags.usesInMemoryStorage && !flags.forbidsDatabase ? ["persistence_relational"] : []),
        ...(flags.usesSqlite ? ["database_strategy_sqlite"] : []),
        ...(flags.usesInMemoryStorage || flags.forbidsDatabase ? ["persistence_in_memory", "database_strategy_none"] : []),
        ...(flags.returnsJson || flags.isApi ? ["response_format_json"] : []),
      ]),
    }, {
      key: "add_input_validation",
      title: flags.isApi ? "Add request validation and JSON error handling" : "Add validation and error handling",
      summary: flags.isApi
        ? "Validate POST payloads and return bounded JSON errors for invalid requests."
        : "Add validation and bounded error handling for the implemented feature set.",
      completionCriteria: unique([
        ...(flags.isApi ? ["Invalid POST /items requests return structured JSON errors."] : ["Invalid inputs are rejected with clear, bounded errors."]),
        "Validation rules are explicit in the implementation.",
      ]),
      validators: ["test", "typecheck"],
      dependencyKeys: ["implement_core_behavior"],
      architectural_new_decisions: flags.isApi ? ["input_validation_boundary"] : [],
    }],
  });

  rawMilestones.push({
    key: "verification_and_review",
    title: "Verify and review the deliverable",
    summary: "Add focused verification, run the relevant scripts, and leave the project in a reviewable state.",
    tasks: [{
      key: "verify_behavior",
      title: flags.isApi ? "Add endpoint tests and verification scripts" : "Add focused verification coverage",
      summary: flags.isApi
        ? "Add tests for the health and items endpoints and ensure verification scripts exercise the API behavior."
        : "Add the smallest useful verification coverage and scripts for the implemented behavior.",
      completionCriteria: unique([
        ...(flags.isApi ? ["The verification suite checks the health endpoint and item lifecycle behavior."] : ["The verification suite checks the implemented behavior."]),
        "The project finishes in a reviewable state with passing validation.",
      ]),
      validators: flags.hasTests || flags.isApi ? ["test", "build", "typecheck"] : ["build", "typecheck"],
      dependencyKeys: ["add_input_validation"],
      architectural_new_decisions: flags.isApi ? ["verification_http_contract"] : ["verification_strategy_local"],
    }],
  });

  return withStaleArchitectureTasks(rawMilestones.slice(0, 7), architecture.stale.map((decision) => decision.key));
}

function buildDeterministicPlannerDraft(
  brief: BuilderProjectBrief,
  architecture: BuilderArchitectureContextState = defaultBuilderArchitectureContext(),
): BuilderPlannerMilestoneDraft[] {
  const flags = buildCategoryFlags(brief);
  return flags.isBuilderMeta
    ? buildBuilderMetaPlannerDraft(brief, architecture)
    : buildGenericPlannerDraft(brief, architecture);
}

function toBriefState(brief: BuilderProjectBrief): BuilderProjectBriefState {
  return normalizeBuilderProjectBriefState(brief) ?? {
    title: brief.title,
    summary: brief.summary,
    goals: [...brief.goals],
    constraints: [...brief.constraints],
    deliverables: [...brief.deliverables],
    notes: brief.notes,
  };
}

export function assembleBuilderPlannerInput(args: {
  project: Pick<BuilderProject, "id" | "name" | "template" | "packageManager">;
  brief: BuilderProjectBrief;
  context?: BuilderProjectContextState;
  architecture?: BuilderArchitectureContextState;
}): BuilderPlannerInputState {
  const context = normalizeBuilderProjectContext(args.context ?? defaultBuilderProjectContext());
  const architecture = args.architecture ?? context.architecture ?? defaultBuilderArchitectureContext();
  const briefState = toBriefState(args.brief);

  return {
    projectId: args.project.id,
    projectName: args.project.name,
    template: args.project.template,
    packageManager: args.project.packageManager,
    brief: briefState,
    constraints: unique([...briefState.constraints, ...context.constraints]),
    nonGoals: derivePlannerNonGoals(args.brief),
    acceptanceCriteria: derivePlannerAcceptanceCriteria(args.brief),
    activeArchitecture: architecture.active,
    staleArchitecture: architecture.stale,
  };
}

function collectArchitecturalKeyUsage(milestones: BuilderNormalizedMilestoneDraft[]) {
  const newDecisionKeys = unique(milestones.flatMap((milestone) => milestone.tasks.flatMap((task) => task.architecturalDecisionKeys)));
  const staleDecisionKeys = unique(milestones.flatMap((milestone) => milestone.tasks.flatMap((task) => task.architecturalStaleKeys)));
  return { newDecisionKeys, staleDecisionKeys };
}

function detectDependencyCycles(milestones: BuilderNormalizedMilestoneDraft[]): string[] {
  const dependencyGraph = new Map<string, string[]>();

  for (const milestone of milestones) {
    for (const task of milestone.tasks) {
      dependencyGraph.set(task.key, task.dependencyKeys);
    }
  }

  const seen = new Set<string>();
  const active = new Set<string>();
  const cycles = new Set<string>();

  const visit = (taskKey: string, path: string[]) => {
    if (active.has(taskKey)) {
      const cycleStart = path.indexOf(taskKey);
      const cycle = [...path.slice(cycleStart), taskKey].join(" -> ");
      cycles.add(cycle);
      return;
    }
    if (seen.has(taskKey)) {
      return;
    }

    seen.add(taskKey);
    active.add(taskKey);
    for (const dependencyKey of dependencyGraph.get(taskKey) ?? []) {
      visit(dependencyKey, [...path, taskKey]);
    }
    active.delete(taskKey);
  };

  for (const taskKey of dependencyGraph.keys()) {
    visit(taskKey, []);
  }

  return [...cycles];
}

function buildPlannerCritiqueIssues(args: {
  milestones: BuilderNormalizedMilestoneDraft[];
  activeArchitecture: BuilderArchitectureContextState["active"];
  staleArchitecture: BuilderArchitectureContextState["stale"];
}): BuilderPlannerCritiqueIssue[] {
  const issues: BuilderPlannerCritiqueIssue[] = [];
  const cycles = detectDependencyCycles(args.milestones);
  for (const cycle of cycles) {
    issues.push({
      severity: "error",
      code: "dependency_cycle",
      message: `Planner output contains a dependency cycle: ${cycle}.`,
    });
  }

  if (args.milestones.length === 0) {
    issues.push({
      severity: "error",
      code: "empty_plan",
      message: "Planner output did not produce any milestones.",
    });
  }

  const allTasks = args.milestones.flatMap((milestone) => milestone.tasks);
  if (allTasks.some((task) => task.validators.length === 0)) {
    issues.push({
      severity: "warning",
      code: "missing_validators",
      message: "At least one task normalized to the default validator set.",
    });
  }

  const architecturalUsage = collectArchitecturalKeyUsage(args.milestones);
  const staleKeys = args.staleArchitecture.map((decision) => decision.key);
  const activeKeys = args.activeArchitecture.map((decision) => decision.key);
  const conflictingDecisionKeys = architecturalUsage.newDecisionKeys.filter((key) => architecturalUsage.staleDecisionKeys.includes(key));
  if (conflictingDecisionKeys.length > 0) {
    issues.push({
      severity: "error",
      code: "conflicting_architecture_reconciliation",
      message: `Planner output marked architecture keys as both new and stale: ${conflictingDecisionKeys.join(", ")}.`,
    });
  }

  const unknownStaleKeys = architecturalUsage.staleDecisionKeys.filter((key) => !staleKeys.includes(key));
  if (unknownStaleKeys.length > 0) {
    issues.push({
      severity: "error",
      code: "unknown_stale_architecture_key",
      message: `Planner output attempted to retire non-stale architecture keys: ${unknownStaleKeys.join(", ")}.`,
    });
  }

  const missingStaleKeys = staleKeys.filter((key) => !architecturalUsage.newDecisionKeys.includes(key) && !architecturalUsage.staleDecisionKeys.includes(key));
  if (missingStaleKeys.length > 0) {
    issues.push({
      severity: "error",
      code: "stale_architecture_unaddressed",
      message: `Planner output did not address stale architecture keys: ${missingStaleKeys.join(", ")}.`,
    });
  }

  if (activeKeys.length > 0 && architecturalUsage.newDecisionKeys.length === 0) {
    issues.push({
      severity: "warning",
      code: "active_architecture_unreferenced",
      message: "Planner output introduced no architectural decisions while active Builder architecture exists.",
    });
  } else {
    const unreferencedActiveKeys = activeKeys.filter((key) => !architecturalUsage.newDecisionKeys.includes(key) && !architecturalUsage.staleDecisionKeys.includes(key));
    if (unreferencedActiveKeys.length > 0) {
      issues.push({
        severity: "warning",
        code: "active_architecture_not_reconciled",
        message: `Planner output left active architecture keys implicit instead of reconciling them explicitly: ${unreferencedActiveKeys.join(", ")}.`,
      });
    }
  }

  return issues;
}

export function critiqueBuilderPlanCandidate(args: {
  milestones: BuilderNormalizedMilestoneDraft[];
  activeArchitecture?: BuilderArchitectureContextState["active"];
  staleArchitecture?: BuilderArchitectureContextState["stale"];
}): BuilderPlannerCritiqueState {
  const activeArchitecture = args.activeArchitecture ?? [];
  const staleArchitecture = args.staleArchitecture ?? [];
  const issues = buildPlannerCritiqueIssues({
    milestones: args.milestones,
    activeArchitecture,
    staleArchitecture,
  });
  const { newDecisionKeys, staleDecisionKeys } = collectArchitecturalKeyUsage(args.milestones);
  const activeKeys = activeArchitecture.map((decision) => decision.key);
  const staleKeys = staleArchitecture.map((decision) => decision.key);
  const reconfirmedStaleKeys = staleKeys.filter((key) => newDecisionKeys.includes(key));
  const addressedStaleKeys = staleKeys.filter((key) => newDecisionKeys.includes(key) || staleDecisionKeys.includes(key));
  const missingStaleKeys = staleKeys.filter((key) => !addressedStaleKeys.includes(key));
  const unreferencedActiveKeys = activeKeys.filter((key) => !newDecisionKeys.includes(key) && !staleDecisionKeys.includes(key));
  const conflictingDecisionKeys = newDecisionKeys.filter((key) => staleDecisionKeys.includes(key));

  return {
    valid: issues.every((issue) => issue.severity !== "error"),
    issues,
    normalizedMilestones: args.milestones,
    reconciliation: {
      activeKeys,
      staleKeys,
      reconfirmedStaleKeys,
      addressedStaleKeys,
      missingStaleKeys,
      unreferencedActiveKeys,
      conflictingDecisionKeys,
      newDecisionKeys,
      retiredDecisionKeys: staleDecisionKeys.filter((key) => staleKeys.includes(key)),
    },
  };
}

export function runBuilderPlannerPipeline(args: {
  project: Pick<BuilderProject, "id" | "name" | "relativePath" | "template" | "packageManager">;
  brief: BuilderProjectBrief;
  context?: BuilderProjectContextState;
  architecture?: BuilderArchitectureContextState;
  mcpPlanningContext?: BuilderMcpPlanningContextState | null;
  dependencyPlanningContext?: BuilderDependencyPlanningContextState | null;
  dependencyContext?: BuilderRelevantDependencyContextState | null;
  fileTopologyPlanningContext?: BuilderFileTopologyPlanningContextState | null;
  fileTopologyContext?: BuilderRelevantFileTopologyContextState | null;
}): {
  input: BuilderPlannerInputState;
  prompt: string;
  candidateMilestones: BuilderPlannerMilestoneDraft[];
  normalizedMilestones: BuilderNormalizedMilestoneDraft[];
  critique: BuilderPlannerCritiqueState;
} {
  const input = assembleBuilderPlannerInput(args);
  const plannerMcpContext = selectRelevantBuilderMcpContext({
    mode: "analysis_only",
    validators: ["MANUAL_REVIEW"],
    template: args.project.template,
    architecturalDecisionKeys: [
      ...input.activeArchitecture.map((decision) => decision.key),
      ...input.staleArchitecture.map((decision) => decision.key),
    ],
  });
  const prompt = composeBuilderPlannerPrompt({
    project: args.project as BuilderProject,
    brief: args.brief,
    context: normalizeBuilderProjectContext(args.context ?? defaultBuilderProjectContext()),
    constraints: input.constraints,
    nonGoals: input.nonGoals,
    acceptanceCriteria: input.acceptanceCriteria,
    activeArchitecture: input.activeArchitecture,
    staleArchitecture: input.staleArchitecture,
    dependencyContext: args.dependencyContext,
    mcpContext: plannerMcpContext,
    mcpPlanningContext: args.mcpPlanningContext,
    dependencyPlanningContext: args.dependencyPlanningContext,
    fileTopologyContext: args.fileTopologyContext,
    fileTopologyPlanningContext: args.fileTopologyPlanningContext,
  });
  const candidateMilestones = buildDeterministicPlannerDraft(args.brief, args.architecture ?? defaultBuilderArchitectureContext());
  const normalizedMilestones = normalizePlannerOutput(candidateMilestones);
  const critique = critiqueBuilderPlanCandidate({
    milestones: normalizedMilestones,
    activeArchitecture: input.activeArchitecture,
    staleArchitecture: input.staleArchitecture,
  });

  return {
    input,
    prompt,
    candidateMilestones,
    normalizedMilestones,
    critique,
  };
}

export function buildPlanFromBrief(
  brief: BuilderProjectBrief,
  options?: {
    project?: Pick<BuilderProject, "id" | "name" | "relativePath" | "template" | "packageManager">;
    context?: BuilderProjectContextState;
    architecture?: BuilderArchitectureContextState;
  },
): BuilderNormalizedMilestoneDraft[] {
  if (!options?.project) {
    return normalizePlannerOutput(buildDeterministicPlannerDraft(brief, options?.architecture)).slice(0, 7);
  }

  return runBuilderPlannerPipeline({
    project: options.project,
    brief,
    context: options.context,
    architecture: options.architecture,
  }).critique.normalizedMilestones;
}