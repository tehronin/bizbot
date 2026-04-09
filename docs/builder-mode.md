# Builder Mode

## Builder Capability Contract

Builder capability taxonomy, policy boundaries, and audit envelopes are defined in [docs/builder-capabilities.md](docs/builder-capabilities.md).

Use that document as the contract layer for new Builder surfaces before adding tools or widening Builder authority.

## Capability Acceptance

A Builder capability is only considered accepted when all of the following are true:

- the capability entry in [docs/builder-capabilities.md](docs/builder-capabilities.md) and [src/lib/builder/capabilities.ts](src/lib/builder/capabilities.ts) reflects the real rollout state,
- the policy boundary is enforced in code rather than only described in docs,
- at least one focused test covers the policy boundary or audit behavior,
- the surface emits a stable audit artifact when the capability contract requires reviewability.

For the current rollout, HTTP and database extension probes write capability audit events into `.builder/reports/capability-audit.jsonl` inside the target Builder project.

## Extension Policy Inputs

Extended Builder capabilities now rely on explicit allowlists:

- `BIZBOT_BUILDER_ALLOWED_HOSTS` for `builder_http_*` tools. Entries may be a hostname, `host:port`, or full origin.
- `BIZBOT_BUILDER_ALLOWED_DATABASES` for non-local database inspection targets. Entries may be a host, `host:port`, or full origin.

Project-local SQLite `file:` datasources remain read-only and are accepted without a separate remote allowlist entry.

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

## Builder File Topology Contract

Builder also persists an accepted file topology contract baseline in project state.

The topology contract is structural and deterministic. It records:

- top-level entries under the project root,
- canonical anchor directories such as `src/app`, `src/lib`, `tests`, `scripts`, `prisma`, and `src-tauri`,
- selected important anchor files,
- lightweight classifications about source-root, router, test-root, and desktop-shell usage,
- placement rules that keep Builder-managed projection paths under `.builder/` reserved.

Builder projects project the accepted topology baseline and the live drift summary into `.builder/file-topology.md` for review, but the database context remains authoritative.

## File Topology Enforcement Lifecycle

At bootstrap or first execution preflight, Builder captures the current file topology contract.

At later execution preflight, Builder:

- compares the current directory/file structure against the accepted topology baseline,
- blocks execution if anchor roots, important files, or placement rules drifted,
- expects drift to be resolved explicitly before implementation continues.

## File Topology Reconciliation Path

When project structure legitimately changes, use the Builder `resolve_file_topology_contract_drift` command with an explicit `approve` or `reject` decision so the persisted baseline and ontology-promoted topology ADR keys move together.
