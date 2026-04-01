# Builder Mode v2

Builder Mode is BizBot's project-scoped build orchestrator for external workspaces. The BizBot repo remains protected. Builder projects, tasks, runs, and durable context live in the BizBot database, while `.builder/` files inside each external project are projections meant for inspection and tool consumption.

## Core Model

- `BuilderProject` remains the durable project identity.
- `BuilderTask` is the unit of ongoing work. It survives across turns and can stay open, resume, fail, or complete.
- `BuilderRun` records execution history. Runs may point at a task, and `BuilderRun.metadata.review` stores the canonical structured review for a completed orchestration.
- `BuilderProject.context` stores the canonical project context JSON: objective, architecture notes, conventions, constraints, important commands, current plan, latest session summary, known failures, and next steps.

## Authority Rule

- Database state is canonical.
- `.builder/` files are projections of the canonical state.
- If files are missing, Builder falls back to the database and regenerates them on the next successful write.
- If files diverge from the database, Builder keeps the database values and rewrites the projection.
- If a workspace exists without matching Builder records, treat it as detached and require explicit relinking or safe reinitialization before trusting it.

## Project Projection Files

Builder writes the following files into each external project:

- `AGENTS.md`
- `.builder/project-context.md`
- `.builder/architecture.md`
- `.builder/current-plan.md`
- `.builder/session-summary.md`
- `.builder/state.json`
- `.builder/reports/latest-review.md`

These files are meant to be stable, compact, and useful to tools or developers inspecting the workspace. They are not the source of truth.

## Task Continuation

When Builder receives a new request for a project, it follows this order:

1. If a `taskId` is supplied, continue that task.
2. Otherwise continue the most recent open task for the project.
3. If no open task exists and retry is requested, reopen the most recent failed task.
4. Otherwise create a new task.

`BuilderTask.stage` is mutable. A task may re-enter `PLANNING`, `IMPLEMENTING`, `TESTING`, or `REVIEW` multiple times. Retry count, last stage error, and the last attempted stage are tracked in task metadata instead of forking a new task on every failure.

## Prompt Synthesis

Builder does not dump whole files into every agentic prompt. The orchestrator composes prompts from:

- the current task
- the project context JSON
- the current plan
- selected fragments from projected instruction files that match the current request

This keeps prompts compact and avoids stale or duplicated context.

## Review Output

Every orchestration should leave behind:

- a compact `BuilderRun.summary`
- a canonical `BuilderRun.metadata.review`
- a human-readable `.builder/reports/latest-review.md`

The review captures validation status, changed files, commands executed, risks, and next steps.

## Inspection Surfaces

- Dashboard: `/builder`
- Project overview API: `/api/builder/projects/[id]`
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
