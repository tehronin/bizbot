# Changelog

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
