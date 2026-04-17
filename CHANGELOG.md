# Changelog

## 2026-04-17

- Extracted shared `MessageMarkdown` component from `SidecarHost` and applied it to all assistant chat messages for consistent block-level markdown rendering with headings, lists, and fenced code blocks.
- Added `BuilderRunPanel` live-progress indicator to the chat workspace that polls a new `/api/builder/tasks/[taskId]/progress` endpoint every 3 seconds and displays the current phase, iteration count, and latest loop summary while a Builder task is running.
- Wired `builder_plan_project` to auto-open the Sidecar with a formatted plan panel (brief title, summary, and milestone checklist) via the `_sidecar` side-channel in the executor, so Builder plans appear in context without a manual open action.
- Added persistent project name badge to the Builder chat header so the active project is always visible alongside the archive action, independent of whether a welcome screen is showing.
- Added `{ type: "builder_iteration" }` to the `AgentExecutionEvent` union for future live-streaming of Builder loop metadata through the SSE pipeline.

- Reduced Builder chat inbox noise by suppressing first-run contract capture cards, deduping drift cards independently of run id churn, collapsing MCP, dependency, and topology drift into a single combined preflight review surface, and reusing project overview fetches during inbox bootstrap.
- Enriched Builder chat cards with live task-loop progress, verification state, changed-file previews, failure excerpts, MCP drift details, and structured dependency and file-topology drift details so execution state and reconciliation context are visible without opening separate project surfaces.
- Reworked Living ADR handling into an internal adjudication flow that narrows planner and execution prompts to relevant architecture context, keeps unrelated stale ADR advisory, persists adjudication into Builder review state, and only escalates protected-boundary architecture changes.
- Hardened Builder contract preflights with severity-aware dependency, topology, and MCP drift classification so benign or additive drift can stay visible without blocking active work, while first-run MCP baselines are captured automatically instead of surfacing as manual approval churn.
- Hardened the checked-in MCP stdio host lifecycle on Windows by closing imported MCP clients, disconnecting Prisma, and shutting down cleanly on signals, stdin disconnects, and unhandled failures, with a real-process regression test covering stdio client teardown.
- Added focused regression coverage for Builder tool subsetting, interaction projection, ADR adjudication, narrowed prompt synthesis, and orchestrator integration.

## 2026-04-16

- Added Oracle swarm evidence gathering with parallel workers for prediction markets, web OSINT research, and Google Trends analysis, replacing the single-source Oracle evidence path with a richer multi-signal evidence bundle.
- Added Builder project archiving and restoring so projects can be soft-archived from the dashboard or API without deleting workspace files, with a new `archivedAt` column and Prisma migration.
- Added Builder chat interaction cards and inbox for surfacing MCP contract drift, dependency drift, file topology drift, and task execution status directly in the chat UI with approve/reject/reconcile actions.
- Added Builder onboarding flow with stack preset selection, project creation from chat, and conversation-integrated assistant messages.
- Added chat-integrated Builder task launching and interaction resolution API routes.
- Hardened Builder orchestrator contract enforcement by making MCP, dependency, and file topology drift checks non-blocking for DRAFT/PLANNED projects while remaining blocking for ACTIVE+ lifecycle stages.
- Hardened Builder container stage validation with a compose-file existence check before attempting Docker operations, preventing errors on unscaffolded projects.
- Fixed Builder container validation gate importing the non-existent `resolveBuilderWorkspaceConfig` — corrected to `resolveBuilderWorkspacePath` with updated test mocks.
- Improved Builder execution plan step generation to respect `analysis_only` mode, skipping container stage validation for analysis-only tasks.
- Expanded chat bootstrap to include Builder project summaries, stack presets, template catalog, and pending interaction inbox for the chat workspace UI.
- Expanded Oracle intent parsing with conversational follow-up detection via `isMeaningfulOraclePredictionTarget`, preventing forced Oracle verdict flows for vague inputs like "are you sure?".
- Added `oracle_swarm` as a new swarm execution mode alongside existing core chat and builder swarm modes.
- Added MCP stdio shutdown instrumentation with process event listeners for better disconnect diagnostics.
- Refreshed MCP contract snapshots to include Oracle tools in the exposed tool catalog.
- Reconciled orphaned metadata-only Builder workspace directories during project reconciliation instead of importing them as stale projects.

## 2026-04-15

- Added first-class Builder container tooling across the shared runtime and MCP surfaces, including compose-backed container inspection, bounded in-container file reads, named test presets, allowlisted exec, and durable Builder run kinds for container work.
- Added Docker-ready Builder template contracts plus scaffolded `Dockerfile` and `compose.yml` artifacts for shipped app presets, and integrated native `builder_validate_container_stage` verification into Builder review and orchestration.
- Added Builder-managed container ownership labels, bounded inventory and removal for Builder-owned and legacy Builder MCP test fixtures, and a higher-level `builder_clean_stale_containers` workflow with end-to-end MCP coverage proving BizBot can remove stale stopped test containers itself.
- Hardened `mcp-suite` CI with a dedicated Postgres service, Prisma generate or migrate setup, and temp Builder runtime paths so container-aware Builder MCP coverage runs reliably in automation.
- Expanded Builder Git support by extending the shared Builder VCS core with richer repo inspection, local mutation flows, allowlisted remote operations, and durable Builder run kinds for Git stage, commit, branch, checkout, merge, rebase, clean, fetch, pull, push, and clone behavior.
- Reworked the Builder plugin and MCP surface to expose the new `builder_git_*` and `builder_repo_*` tools while preserving temporary compatibility aliases, and added end-to-end MCP coverage for local Git actions, allowlisted remote push, and blocked non-allowlisted remotes.
- Enriched Builder review, trust, and dashboard state with Git health signals such as dirty status, remotes, pending push posture, and remote allowlist governance.
- Fixed a Builder dashboard race where a late project-detail refresh could overwrite an in-progress brief edit before planning, and hardened `npm run verify:local` log capture when Playwright cleanup has removed the verification artifact directory.

## 2026-04-11

- Hardened chat and Builder UI lifecycle behavior by preventing repeated runtime log SSE reconnects, aborting stale chat bootstrap and sidecar interaction requests, and guarding small dashboard data hooks against state updates after unmount while keeping lint, typecheck, tests, and build green.
- Added chat execution selection defaults, plugin-aware routing, bounded tool allowlisting, attachment-aware prompt context, and focused route/executor regression coverage for the new Ask/Agent chat flow.
- Redesigned the main chat composer toward a more VS Code-like layout with a compact toolbar, plugin and mode selectors under the prompt, attachment chips, and cleaner focus treatment.
- Added Builder governance decision history in the dashboard and commands flow so policy reconciliations and other governance actions remain inspectable after execution.
- Expanded Builder operator trust with prioritized blocker summaries plus recent-versus-previous run trend analysis grounded in persisted Builder run and review metadata.
- Hardened Builder capability audit reporting with severity classification, bounded retention pruning, and explicit dashboard affordances for expired or overflowed audit records.
- Added MCP sampling telemetry and policy inspection coverage across the stdio path, debug resource surface, and focused regression tests.
- Added `npm run verify:local` as a release-style local verification gate and fixed its Windows command spawning path so Prisma generation, schema sync, app tests, MCP sampling tests, and Builder Playwright checks run end to end.

## 2026-04-10

- Added Core Chat swarm MVP support with internal source collection, worker planning and execution, grounded synthesis, audit passes, SSE swarm events, run-journal telemetry, and focused regression coverage for classifier, runtime, synthesis, audit, executor, and route behavior.
- Added MCP Sampling v1 as a stdio-only capability with transport-aware server policy, Builder dev-loop diagnosis via `developer_vscode_loop_assist`, the `bizbot://debug/mcp-sampling-policy` resource, a manual stdio smoke command, and focused contract, policy, and end-to-end test coverage.
- Expanded Builder governance and operator-trust flows with explicit approval requirements, dependency and file-topology contract overview panels, broader review summaries, capability audit surfacing, runtime and database inspection rollups, and updated Builder plugin and command-route enforcement.
- Hardened Builder scaffolding and local execution by making `next-app` and `vite-app` bootstraps run through deterministic parent-directory `npm create` calls, adding non-interactive Vite generation, standardizing repo-local env loading for script entrypoints, and fixing Builder workspace path resolution so local runs stay in the intended external workspace.
- Added local development infrastructure defaults through checked-in `compose.yaml` and `.env.example`, documented the matching local setup and verification commands in the README, and kept the production build plus current-tree `test:app` and `test:mcp` validation green after the final typing and template-test fixes.

## 2026-04-09

- Added Builder runtime orchestration surfaces for service health, logs, start/stop/restart control, command execution, workspace reconciliation/import, project env mutation, runtime inspection, HTTP probing, DB inspection, and operator-trust reporting across the dashboard, API routes, plugin tools, and test coverage.
- Hardened chat and Builder bootstrap flows so failed API responses return JSON consistently, client fetch helpers no longer crash on empty bodies, missing external Builder workspaces degrade to non-fatal inspection state, and the recovered Builder workspace root can be persisted locally for future restarts.
- Fixed Builder chat routing so Builder workspace status and history prompts resolve to the Builder Operator instead of the Research Operator, and added focused regression coverage for that routing behavior.
- Added canonical BizBot capability summaries and lane-aware runtime tool-visibility summaries so generic capability or plugin-inspection prompts can describe Builder and other surfaces from current prompt context and visible tool access instead of relying on incidental lane phrasing.
- Added repo-level markdownlint configuration and wired `npm run lint:docs` to the shipped markdown surfaces so the docs gate runs deterministically in local pre-push validation.

## 2026-04-08

- Added the Builder file-topology ADR lane with deterministic structural snapshots, planner and task placement guidance, `.builder/file-topology.md` projection output, drift preflight blocking, bootstrap baselines, and explicit approve or reject reconciliation commands.
- Hardened local test and build script execution on Windows-style installs that lack `node_modules/.bin` shims by invoking the repo-local Vitest and Next.js entrypoints directly, and updated Builder orchestration regression coverage for the new topology preflight.
- Completed the sovereign baseline build stabilization pass: regenerated the real Prisma client, removed the temporary Prisma enum bridge, restored strict TypeScript settings, and kept the production build green without fallback typing hacks.
- Added BizBot Platform Contract v1 as a repo-grounded source of truth for lane exposure, plugin metadata, MCP catalog expectations, side-effect classes, provenance rules, and compatibility policy.
- Threaded the platform contract version through MCP server instructions, Builder MCP contract snapshots, developer contract inspection surfaces, and the Operations dashboard/API.
- Expanded Builder MCP drift handling to classify contract changes as breaking, non-breaking, or internal-only instead of treating drift as an untyped hash mismatch.
- Added the first Builder dependency-contract ADR slice with deterministic dependency snapshots, bootstrap baselines, planner and projection context, preflight drift blocking, and explicit approve or reject reconciliation commands.
- Pruned stale `.next` artifacts, removed workaround-era callback annotations now covered by inference, aligned the standalone duplicate sources with the same cleanup, and revalidated both `tsc --noEmit` and the production build.

## 2026-04-07

- Added Builder stack presets for common Next.js and Vite flows, surfaced them in the Builder dashboard and status API, and persisted the selected planned stack into project context/projection files.
- Expanded Builder template verification into a shared contract model that now validates `node-cli`, `plugin-package`, `vite-app`, and `next-app` scaffolds through deterministic checks.
- Added Builder run telemetry summaries, budget profiles, and operational reconciliation so stale `RUNNING` state, repeated identical failures, and operator-visible repair actions show up in the Builder dashboard and commands API.
- Introduced deterministic Builder MCP contract snapshots with drift detection, operator rollover/rejection commands, bounded planner/execution MCP context injection, and passive runtime tool provenance capture.
- Added MCP snapshot BullMQ queues, worker processors, Operations visibility, developer inspection tools, semantic snapshot search, pgvector-backed snapshot embeddings, and ontology-enrichment metadata for snapshot history.
- Fixed MCP BullMQ job IDs to use a BullMQ-safe deterministic format and added regression coverage so invalid custom IDs with `:` cannot reappear.
- Added accounting-aware content tool completions so tool-owned LLM usage is recorded into the agent run journal instead of disappearing from usage totals.
- Updated the worker launch path so `npm run worker` automatically uses `PRISMA_CLIENT_ENGINE_TYPE=binary` on Windows while preserving explicit overrides on other platforms.

## 2026-04-04

- Added threshold-based Builder dashboard health highlighting so high retry rate, low verification pass rate, blocked task-spec promotion, and stale ADR pressure are visually emphasized instead of buried in raw metrics.
- Broadened Builder generated-template validation to cover both `node-cli` and `plugin-package`, and wired the new verifier into CI.
- Tightened Builder retry heuristics across native and CLI execution loops so repeated low-signal retries stop earlier and repair prompts include concise failure excerpts.
- Hardened live Builder runtime orchestration so preflight status and in-flight stdout/stderr are persisted into active run records, making stalled native Builder runs debuggable before an iteration completes.
- Fixed Builder launch-time failure handling and task handoff so orchestration no longer leaves phantom `RUNNING` rows and newly created tasks are passed correctly into the executor.
- Corrected Google/Gemini forced tool-calling for the `builder_operator` lane by suppressing native Google extras when function calling is required.
- Removed Builder-internal planning bias from generic project briefs, added deterministic generic REST API milestones and ADR keys, and verified that Builder continuation advances task specs without a new freeform prompt.
- Updated Builder scaffold/bootstrap guards to ignore Builder-managed projection files like `.builder/` and `AGENTS.md`, which unblocked planned projects from bootstrapping inside the external Builder workspace.
- Increased the `builder_operator` tool-round budget for inspection-heavy Builder tasks and fixed deterministic verification to force `NODE_ENV=test` for project test scripts.
- Validated the full live Builder path on two external projects: a hello-world artifact and a Node.js + Express in-memory REST API with generated Jest/Supertest coverage and passing `typecheck`, `build`, and `test` scripts.
- Hardened Builder Mode v3.1 planning without changing the execution loop: planning stays on the existing orchestrator entrypoint, adds a dedicated planner prompt surface, and validates planner output before persistence.
- Added Builder planner critique and ADR reconciliation metadata so stale architecture keys must be addressed before replacing a project plan.
- Implemented Living ADR as a Builder-owned derived ontology view using the `builder:{projectId}:` canonical-key convention and `builder_adr` source instead of adding new schema.
- Promoted successful Builder architectural decisions back into ontology after validated plan writes so later planning runs can reload active architecture context.
- Extended Builder projections and review output to expose canonical brief, milestones, task-board state, and active versus stale architecture reconciliation.
- Added focused regression coverage for planner prompting, planner validation, orchestration entrypoint behavior, Builder routing, and Builder ADR ontology promotion.

## 2026-04-03

- Rolled out Sidecar v2 as a core BizBot surface with validated selection panels, structured interaction routing, and a transient server-side panel registry.
- Added the off-by-default Oracle builtin plugin for read-only Polymarket search, personality selection, verdict generation, and Sidecar-enhanced market flows.
- Expanded Oracle into a multi-source prediction flow over Polymarket and Kalshi, updated the runtime status copy to reflect enabled market sources, and added a repeatable Playwright browser e2e for the explicit Oracle chat path.
- Tightened production packaging for Next.js standalone output so `npm run build` prepares the standalone bundle correctly and `npm run start:web` now runs the shipped standalone server.
