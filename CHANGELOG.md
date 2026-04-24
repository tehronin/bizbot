# Changelog

## 2026-04-24

- Promoted the local stdio MCP path from a thin bootstrap script to a session-aware runtime wrapper that owns session ids, startup and shutdown coordination, capability-sync tracing, heartbeat checkpoints, stale-session recovery, and opt-in stderr debug logging while keeping protocol stdout clean.
- Extended persisted MCP trace coverage to include local stdio session lifecycle, initialize and capability-sync events, transport or protocol faults, and stdio-backed tool-call provenance so the app-side debug resources can inspect the standalone stdio server after the fact.
- Added structured stdio tool-error envelopes with typed categories and trace ids, threaded sampling session metadata through `developer_vscode_loop_assist`, and expanded focused MCP tests and docs for the new runtime, observability, and debug workflow.

## 2026-04-23

- Hardened authoritative Sidecar context concurrency with `contextRevision` and `contextLineageId`, stale-write rejection on the interaction route and MCP path, merged transport plus handler context patches in the router reducer, and updated Oracle or Creeper Sidecar handlers to return resolved context patches instead of mutating shared state ad hoc.
- Reworked the Sidecar host sync path around explicit lifecycle refreshes plus same-tab selected-conversation events, added a dev sync-status indicator and debug drawer, tightened placeholder escaping and no-op clear handling, and documented the now-implemented server-owned context model in the Sidecar guide.
- Added a separate runtime-authoritative Sidecar thinking state store, a `GET /api/sidecar/thinking` route, a bottom-dock renderer in the shell, and a bounded `sidecar_thinking_*` MCP surface so safe execution progress can be inspected without turning thinking into a regular Sidecar panel type.
- Wired agent executor status, tool-call, and tool-result checkpoints into the new thinking state with strict safe summarization, including allowlisted bounded summaries for selected Developer, Oracle, Creeper, Builder, and Sidecar tools instead of copying raw tool payloads into the dock.
- Expanded regression and MCP contract coverage for context conflicts, merged context patches, thinking-route and thinking-store behavior, host sync and dock UX, authoritative MCP Sidecar responses, and the exposed tool catalog so local CI-equivalent app, MCP, build, template, and Builder e2e verification all pass again.

## 2026-04-22

- Added authoritative Sidecar stack revisions plus bounded `SidecarContext` state, placeholder-driven context rendering, and write-scoped interaction patches so nested Oracle and Creeper Sidecar workflows can share server-owned state without clobbering parent panels.
- Expanded the Sidecar MCP surface with `sidecar_get_state`, `sidecar_interact`, and `sidecar_navigate`, made raw MCP Sidecar mutators authoritative for the MCP lane, and aligned tool presentation plus server guidance with the new non-read-only UI control model.
- Closed the live MCP-to-browser sync gap by exposing `GET /api/sidecar/state`, polling authoritative conversation Sidecar state from the shell, and moving the in-memory Sidecar store onto a `globalThis` singleton so MCP and browser routes observe the same runtime state.
- Tightened Sidecar regression coverage and CI-facing build safety around route revision conflicts, context patch validation, browser-side authoritative sync, Oracle and Creeper context-backed panels, MCP contract exposure, and Sidecar app roundtrip behavior.
- Reworked Sidecar into a persistent right-edge split view with an always-available chevron rail, local width and expansion persistence, explicit collapse versus close behavior, and bootstrap-driven rehydration so active panels survive refresh and conversation switches without reopening as popups.
- Expanded the Sidecar contract and renderer set with stack-aware events plus built-in `table`, `key_value`, `progress`, and `diff` surfaces, then updated the host UI to render those richer content types alongside inline selection pending and error feedback.
- Added server-backed Sidecar stack state with full conversation stacks, back navigation, clickable stack-chip activation, and a dedicated `/api/sidecar/state` route so the client shell and persisted conversation state stay synchronized while users drill into nested review panels.
- Implemented persistence-aware Sidecar semantics so `ephemeral` overlays dismiss and avoid bootstrap restore, `sticky` panels act as durable reference context, and `workflow` panels restore as active task context with shared stack-reducer coverage.
- Preserved producer-selected Sidecar persistence through the shared panel factory, added producer-facing persistence guidance to the Sidecar developer guide, and introduced plugin contract coverage that locks Oracle, Creeper, and Builder sidecar producers to the intended `ephemeral`, `sticky`, and `workflow` choices.
- Refreshed focused regression coverage for Sidecar state routes, stack reducers, UI flows, chat bootstrap rehydration, Oracle interaction round-trips, and Builder plugin validation so the CI-equivalent local suite is green with the updated Sidecar lifecycle.

## 2026-04-21

- Added Operations history clear actions for recent agent runs, heartbeat jobs, and MCP jobs, backed by a new `/api/operations/history` route that removes persisted run-journal records and prunes completed or failed BullMQ history without disturbing active work.
- Restored chat-route continuity by reworking `useChat` bootstrap coordination around route-aware scheduling, one-time initial hydration, and safer cancellation handling, which fixed empty chat returns after navigating away and removed several bootstrap race conditions surfaced by tests.
- Changed builtin plugin defaults so unfinished social, commerce, local-business, and schedule surfaces stay off by default while Oracle and Creeper are enabled, and tightened dashboard navigation to hide plugin-owned sidebar entries whenever their backing plugin is disabled.
- Reduced repeated dashboard churn by centralizing approval-count state in a shared shell provider, broadcasting plugin and approval catalog changes across the shell, and narrowing active Builder polling to a lightweight project-summary endpoint plus inspection refresh instead of repeatedly loading the full detail payload.
- Hardened mutating API routes by adding structured `ApiRouteError` responses, atomic approval decisions, stricter settings payload and env validation, and explicit user-memory ownership enforcement that rejects cross-user overrides.
- Improved Builder consistency and diagnostics by wrapping run and project mutation paths in transaction-aware helpers, adding the `GET /api/builder/projects/[id]/summary` surface for active-run polling, and introducing a live heap-snapshot capture script for Next.js memory investigation.
- Refreshed regression and contract coverage for the updated chat bootstrap behavior, Builder transaction flow, Oracle and Creeper default exposure, MCP tool catalogs, and developer dev-loop safety checks so local CI-equivalent validation passes again.

## 2026-04-20

- Reworked the Tailwind v4 migration across chat, Builder, settings, onboarding, and dashboard surfaces by promoting semantic color and border tokens into `globals.css`, replacing broad inline-style usage with reusable utility classes, and fixing the resulting JSX and encoding regressions so local CI verification is green again.
- Added the off-by-default Creeper plugin with company-profile onboarding, conversation-scoped company selection, read-only Postgres source registration and credential storage, bounded schema profiling, ingestion-plan drafting and approval, ingestion worker execution, Sidecar review panels, chat composer integration, MCP discovery/catalog exposure, and the supporting Prisma schema and migrations for company profiles, external sources, scans, plans, runs, chunks, embeddings, entities, relations, and retrieval audits.
- Added Gemini-specific runtime controls for max output tokens, extended context assembly, and tool-result truncation, surfaced through the LLM status route and Settings UI so Google provider behavior can be tuned independently of the global chat defaults.
- Added Builder projection and planning cache persistence under `.builder/cache`, including projection write elision, regenerate-aware planning cache bypass, and operator-visible cache telemetry counters for planning lookups and projection reuse.
- Stabilized the latest imported MCP and Builder discovery additions by fixing strict TypeScript regressions across plugin catalog drift typing, developer prompt and resource discovery helpers, MCP client tool-result unwrapping, imported-catalog aggregation, MCP health and trace helpers, and sampling schema wiring, keeping the production build green after the recent MCP snapshot work.
- Fixed Builder project conversation bootstrap typing so project-scoped chat history summaries can be serialized from the lighter conversation-list query shape without requiring full message records.
- Refreshed Builder regression coverage for the latest planning and runtime changes by updating builder project deletion mocks, isolating orchestrator tests to a temporary Builder workspace outside the repo, and correcting compose-service polling fixtures in runtime orchestration tests.

## 2026-04-19

- Added imported MCP drift tracking with persisted baseline acceptance, the `developer_diff_imported_mcp_catalog` and `developer_accept_imported_mcp_catalog_baseline` tools, plus the `bizbot://plugins/imported-mcp-drift` resource so external MCP inventory changes are reviewable instead of only observed live.
- Added runtime imported-MCP tracing with the `developer_list_mcp_trace_events` tool and `bizbot://debug/mcp-trace` resource, capturing connect, inventory, tool, prompt, and resource operations for MCP dev-loop diagnosis.
- Added task-oriented MCP workflow recipes and direct imported-tool debugging wrappers through `developer_get_task_recipe`, `developer_invoke_imported_mcp_tool`, and the `bizbot://plugins/task-recipes` resource so diagnosis can follow repeatable workflows instead of raw catalog browsing only.
- Added Builder task event history in persisted task metadata, surfaced through `developer_get_builder_task_events` and `bizbot://builder/task-events`, making long-running Builder work inspectable as lifecycle state between polls.
- Extended the Plugins catalog payload and in-app UI with imported MCP trust and drift posture, latency and capability chips, task recipe discovery, and MCP trace guidance so operator discovery is visible in the app as well as over MCP.
- Added explicit imported MCP wrapper tools for reading connected external resources and prompts through BizBot's client layer (`developer_read_imported_mcp_resource`, `developer_get_imported_mcp_prompt`) so imported MCP is callable as first-class dev-loop surface area instead of only inspectable through inventories.
- Added a task-oriented Builder lifecycle layer with `developer_get_builder_task_lifecycle` plus the new `bizbot://builder/task-lifecycle` resource, making current task progression, recent transitions, run linkage, and next-step posture visible for long-running Builder work.
- Added a checked-in VS Code dev-loop diagnostic path with `bizbot://debug/vscode-mcp-devloop`, the `optimize-vscode-mcp-devloop` prompt, and a tuned `.vscode/mcp.json` stdio config that enables source maps and suppresses query logs for a cleaner local MCP loop.
- Surfaced MCP discovery inside the app by extending the Plugins page payload and UI to show discovery bundles, skill resources, imported catalog counts, and preferred VS Code/BizBot dev-loop commands instead of keeping discovery only in raw MCP catalogs.
- Added server-backed builder project chat history by introducing a `listBuilderProjectConversations` server query, a `selectedBuilderProjectId` parameter on the `/api/chat/conversations` bootstrap route, and a `builderProjectConversations` field on `ChatConversationBootstrap`, so the project chat dropdown in the composer reflects persisted history rather than only the in-memory conversation window.
- Wired the builder project chat history dropdown through the shared `handleSwitchConversation` handler so selecting a previous project chat correctly swaps the active transcript, clears composer state, and resets panel mode.
- Added a dedicated `handleStartNewConversation` handler for the blank-option selection in the project chat dropdown, keeping new-chat flow consistent with the header button.
- Changed the `Conversation → BuilderProject` relation to `onDelete: Cascade` with a new migration (`20260419163000_builder_project_conversation_cascade`), and added an explicit `conversation.deleteMany` before builder project deletion in `deleteBuilderProject` as belt-and-suspenders, so all chat history scoped to a removed project is cleaned up as dependent data.
- Fixed `normalizeMessageMetadata` in `conversations.ts` to include `preflight_review` in the valid builder card kind allowlist, preventing those cards from being silently dropped when rehydrating messages from the database.
- Fixed `listBuilderProjectConversations` to fetch messages in descending order so `serializeSummary` uses the latest message content for the conversation preview instead of the first.
- Guarded the "New Chat" header button against active streaming and bootstrap state by adding `disabled={chat.isPending || chat.isBootstrapping}` with disabled styling, preventing silent discard of an in-flight assistant turn.
- Moved the `loadBootstrap` side-effect out of the `setSelectedBuilderProjectId` state updater into a dedicated `useEffect` keyed on `selectedBuilderProjectId` with a `previousBuilderProjectIdRef` skip-guard, eliminating anti-pattern double-fire in React Strict Mode.
- Added `conversationIdRef` and `selectedBuilderProjectIdRef` mirrors (synced on every render) and rewrote the builder task polling `useEffect` to read live ref values instead of stale closure captures, preventing the polling closure from dispatching progress against a conversation or project that has already changed; removed `conversationId` and `selectedBuilderProjectId` from the polling `useEffect` dependency array so the interval no longer restarts on every project or conversation switch.

## 2026-04-18

- Hardened Builder chat execution persistence by restoring and syncing per-conversation Ask or Agent mode plus plugin defaults, preserving server message ids during bootstrap refresh, and publishing completed Builder task summaries back into the chat transcript with active Builder usage included in session totals.
- Reworked the chat workspace toward a more continuous transcript model with grouped assistant activity, richer markdown rendering with inline formatting and code-copy actions, compact Builder cards and inbox surfaces, reduced per-message metadata chrome, hover-only memory promotion controls, a dedicated transcript viewport with bottom anchoring, and an initial Builder status rail for governance and progress context.
- Continued the Builder chat UX pass by removing always-visible mode and plugin controls from the default composer, moving advanced routing and Builder project selection into a dedicated capabilities panel, replacing the remaining Builder rail with inline assistant narration plus action-only prompts, and strengthening Builder progress and governance copy so the experience reads like a collaborative conversation instead of surfaced system state.
- Added clearer Builder user-facing copy for task cards, preflight reviews, governance actions, and Builder route errors so chat-first Builder flows explain required review steps without leaking raw internal phrasing.
- Improved Builder onboarding by creating an initial persisted project brief and plan during project creation, then refreshed Builder and chat regression coverage for execution defaults, onboarding planning, markdown rendering, conversation usage aggregation, and the updated chat and Builder end-to-end flows.

## 2026-04-17

- Reworked Oracle swarm evidence collection to remove brittle Google scraping and replace it with adjacent market research plus Kalshi market-coverage signals, while surfacing explicit `evidenceGaps` when non-primary lanes fail.
- Upgraded the shared swarm runtime with optional concurrency control, per-item timeout and retry handling, abort support, and per-item completion callbacks for streaming-friendly execution.
- Added LLM-driven Oracle verdict generation with a structured verdict object, personality lens prompts, and automatic Sidecar verdict panels for `oracle_analyze_prediction`.
- Expanded `oracle_search_markets` to include Kalshi results alongside Polymarket in read-only search output.
- Broadened Oracle intent parsing beyond crypto to cover macro, equity, commodity, and election-style prompts, and fixed numeric parsing so bare years are not misclassified as price thresholds.
- Added Oracle prediction persistence with a new `OraclePrediction` table, automatic analysis logging, and new `oracle_watch_prediction` and `oracle_list_predictions` tools for recalling watched or recent prediction calls.

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
