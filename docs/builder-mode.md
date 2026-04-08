# Builder Mode

## Builder MCP Policy Artifact

Builder-owned scaffolds now generate `.builder/mcp-policy.json` at bootstrap time.

The artifact is machine-generated and deterministic. It records:

- the scaffold template,
- the package manager,
- the expected BizBot MCP contract hash,
- the allowed Builder tool categories,
- the active Builder decision keys for MCP control-plane governance.

The artifact is not intended to be hand-maintained. Builder also persists the expected artifact hash in project state so later execution preflight can detect workspace drift.

## Enforcement Lifecycle

The control-plane policy now has three linked surfaces:

- runtime MCP contract snapshots in Builder snapshot history,
- the workspace artifact at `.builder/mcp-policy.json`,
- ontology-backed architecture seeded with `mcp_control_plane`.

At bootstrap, Builder:

- scaffolds the selected template,
- writes `.builder/mcp-policy.json`,
- stores the expected policy hash in Builder project context,
- seeds the `mcp_control_plane` architectural decision.

At execution preflight, Builder:

- validates the live MCP contract against the accepted runtime snapshot,
- validates the current `.builder/mcp-policy.json` hash against the persisted Builder baseline,
- blocks execution if the workspace artifact drifted.

## Reconciliation Path

When policy changes are legitimate, use the Builder `reconcile_mcp_policy` command to rebuild `.builder/mcp-policy.json` and update the persisted expected hash together.

## Operator Expectations

- Treat `.builder/mcp-policy.json` as Builder-managed state.
- Do not hand-edit the file during normal task work.
- If control-plane policy legitimately changes, use `reconcile_mcp_policy` so the Builder-managed baseline and artifact move together.
