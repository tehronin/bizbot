# Builder Mode v3.1

Builder Mode is BizBot's project-scoped build orchestrator for external workspaces. The BizBot repo remains protected. Builder projects, briefs, milestones, task specs, tasks, runs, and durable context live in the BizBot database, while `.builder/` files inside each external project are projections meant for inspection and tool consumption.

## Core Model

- `BuilderProject` remains the durable project identity.
- `BuilderProjectBrief`, `BuilderMilestone`, and `BuilderTaskSpec` are the canonical planning state.
- `BuilderTaskSpec` is the canonical intent layer for executable work inside a planned project.
- `BuilderTask` is the execution layer. It survives across turns, can stay open, resume, fail, or complete, and may link back to a task spec.
- `BuilderRun` records execution history. Runs may point at a task, and `BuilderRun.metadata.review` stores the canonical structured review for a completed orchestration.
- `BuilderProject.context` stores compact derived context only: objective, architecture notes, conventions, constraints, important commands, a compact current plan summary, latest session summary, known failures, and next steps.
- `BuilderProject.lifecycle` advances through `DRAFT`, `PLANNED`, `ACTIVE`, `BLOCKED`, and `COMPLETE`.

## Authority Rule

- Database state is canonical.
- Briefs, milestones, and task specs are the canonical planning authority.
- Tasks and runs remain execution history and review history.
- `.builder/` files are projections of the canonical state.
- If files are missing, Builder falls back to the database and regenerates them on the next successful write.
- If files diverge from the database, Builder keeps the database values and rewrites the projection.
- If a workspace exists without matching Builder records, treat it as detached and require explicit relinking or safe reinitialization before trusting it.

## Project Projection Files

Builder writes the following files into each external project:

- `AGENTS.md`
- `.builder/project-brief.md`
- `.builder/project-context.md`
- `.builder/architecture.md`
- `.builder/milestones.md`
- `.builder/task-board.md`
- `.builder/current-plan.md`
- `.builder/session-summary.md`
- `.builder/state.json`
- `.builder/reports/latest-review.md`

These files are meant to be stable, compact, and useful to tools or developers inspecting the workspace. They are not the source of truth.

## Task Continuation

When Builder advances a project, it follows this order:

1. If no brief exists, keep the project in `DRAFT` and require a canonical brief.
2. If no plan exists, generate milestones and task specs from the persisted brief and move to `PLANNED`.
3. Otherwise select the next runnable task spec using milestone order, dependency completion, and active execution exclusion.
4. Create or reuse the linked `BuilderTask`, run the existing native execution loop, then map review results back onto task spec, milestone, and project lifecycle state.

`BuilderTask.stage` remains mutable. A task may re-enter `PLANNING`, `IMPLEMENTING`, `TESTING`, or `REVIEW` multiple times. Retry count, last stage error, and the last attempted stage are tracked in task metadata instead of forking a new task on every failure.

## Prompt Synthesis

Builder does not dump whole files into every agentic prompt. The orchestrator composes prompts from:

- the project brief summary and lifecycle
- the current milestone and task spec
- the current task
- the project context JSON
- completion criteria and validators
- selected fragments from projected instruction files that match the current request

This keeps prompts compact and avoids stale or duplicated context.

Planning now uses a dedicated planner prompt surface that is separate from execution prompting. The planner surface must include:

- the persisted brief
- explicit constraints
- explicit non-goals
- acceptance criteria
- template-aware guidance
- an exact `[Active Architecture]` block sourced from Builder-owned ontology rows with confidence `>= 0.7`
- an exact `[Stale Architecture - Needs Reconfirmation]` block sourced from stale Builder-owned ontology rows with confidence `>= 0.7`

Planner output is normalized and critiqued before persistence. Dependency cycles are rejected. Invalid architecture keys are normalized intentionally. Every stale architecture key must be addressed before Builder replaces the canonical plan.

## Living ADR

Living ADR is a derived Builder-owned view over existing ontology rows. It does not add Prisma models or routes.

- Builder ADR rows are stored in existing ontology tables using canonical keys prefixed with `builder:{projectId}:`
- Builder ADR rows use ontology source `builder_adr`
- project scoping is derived from the canonical key prefix instead of new columns
- active rows hydrate the planner's active architecture context
- inactive or deprecated rows hydrate the planner's stale architecture context
- successful plan writes promote `architectural_new_decisions` into ontology so later planning runs can load them back as active architecture
- successful reconciliation may deprecate stale keys without changing the execution loop

## Review Output

Every orchestration should leave behind:

- a compact `BuilderRun.summary`
- a canonical `BuilderRun.metadata.review`
- a human-readable `.builder/reports/latest-review.md`

The review captures validation status, changed files, commands executed, risks, and next steps.

## Inspection Surfaces

- Dashboard: `/builder`
- Project overview API: `/api/builder/projects/[id]`
- Project planning API: `/api/builder/projects/[id]/plan`
- Task API: `/api/builder/projects/[id]/tasks`
- MCP resources:
  - `bizbot://builder/projects`
  - `bizbot://builder/current-project`
  - `bizbot://builder/current-plan`
  - `bizbot://builder/current-tasks`
  - `bizbot://builder/current-runs`
  - `bizbot://builder/current-review`

## Operational Notes

- Builder writes stay serialized and scoped to a single project workspace.
- The existing bounded agentic loop remains the implementation engine.
- Raw builder commands still exist for low-level operations, but the preferred path is project-scoped task orchestration.
