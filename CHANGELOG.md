# Changelog

## 2026-04-04

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
