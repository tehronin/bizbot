# Changelog

## 2026-04-08

- Completed the sovereign baseline build stabilization pass: regenerated the real Prisma client, removed the temporary Prisma enum bridge, restored strict TypeScript settings, and kept the production build green without fallback typing hacks.
- Added BizBot Platform Contract v1 as a repo-grounded source of truth for lane exposure, plugin metadata, MCP catalog expectations, side-effect classes, provenance rules, and compatibility policy.
- Threaded the platform contract version through MCP server instructions, Builder MCP contract snapshots, developer contract inspection surfaces, and the Operations dashboard/API.
- Expanded Builder MCP drift handling to classify contract changes as breaking, non-breaking, or internal-only instead of treating drift as an untyped hash mismatch.
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
- Tightened production packaging for Next.js standalone output so `npm run build` prepares the standalone bundle correctly and `npm run start:web` now runs the shipped standalone server.# Changelog

## 2026-04-08

- Added BizBot Platform Contract v1 as a repo-grounded source of truth for lane exposure, plugin metadata, MCP catalog expectations, side-effect classes, provenance rules, and compatibility policy.
- Threaded the platform contract version through MCP server instructions, Builder MCP contract snapshots, developer contract inspection surfaces, and the Operations dashboard/API.
- Expanded Builder MCP drift handling to classify contract changes as breaking, non-breaking, or internal-only instead of treating drift as an untyped hash mismatch.

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
