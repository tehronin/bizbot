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

## Builder Dependency Contract

Builder also persists an accepted dependency contract baseline in project state.

The dependency contract is derived from the project root package manifest and active lockfile. It records:

- the configured package manager,
- direct runtime/dev/optional/peer dependencies,
- package scripts,
- lockfile presence and content hash,
- dependency-derived Builder decision keys.

Builder projects project the accepted baseline into `.builder/dependency-contract.md` for review, but the database context remains authoritative.

## Dependency Enforcement Lifecycle

At bootstrap or first execution preflight, Builder captures the current dependency contract when a root `package.json` exists.

At later execution preflight, Builder:

- compares the current manifest and lockfile against the accepted baseline,
- blocks execution if direct dependencies, scripts, lockfile, or package-manager policy drifted,
- expects drift to be resolved explicitly before implementation continues.

## Dependency Reconciliation Path

When dependency policy legitimately changes, use the Builder `resolve_dependency_contract_drift` command with an explicit `approve` or `reject` decision so the persisted baseline and ontology-promoted decision keys move together.
