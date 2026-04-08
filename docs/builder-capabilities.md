# Builder Capabilities

## Purpose

This document defines the Builder capability contract before new Builder APIs are added.

It exists to keep new workspace, process, VCS, configuration, network, and database actions inside the same safety model that already governs:

- the external Builder workspace boundary,
- command allowlisting,
- Builder run and task metadata,
- deterministic Builder governance artifacts such as MCP policy, dependency contracts, and file topology contracts.

The capability contract is the policy and audit source of truth for future Builder expansion. It does not replace the Builder tool registry, but it does define how Builder actions are classified, constrained, and reviewed.

## Taxonomy

Builder capabilities are grouped into three tiers.

| Tier | Meaning | Examples |
| --- | --- | --- |
| `core` | Required for Builder to act as a deterministic project operator. | workspace mutation, VCS, process execution, env/config |
| `extended` | Useful project operator surfaces that should remain policy-bound and opt-in at rollout time. | HTTP access, read-only DB introspection |
| `experimental` | Higher-risk or lower-frequency authority that should stay explicitly gated. | runtime/container orchestration |

Builder capability status is tracked separately from tier:

| Status | Meaning |
| --- | --- |
| `available` | already exposed as a stable Builder surface |
| `partial` | some repo-grounded pieces exist, but the capability is incomplete |
| `planned` | the capability contract exists, but the Builder surface is not implemented yet |

## Current Capability Map

The initial capability catalog is defined in [src/lib/builder/capabilities.ts](src/lib/builder/capabilities.ts).

| Capability | Domain | Tier | Status | Current shape |
| --- | --- | --- | --- | --- |
| `workspace_manipulation` | workspace | core | available | Builder now exposes read, write, list, append, delete, move, ensure-directory, stat, existence, patch, and scaffold operations inside the external workspace boundary. |
| `project_orchestration` | orchestration | core | available | Builder projects, tasks, runs, planning, bootstrap, and projections are already persisted and reviewable. |
| `governance_contracts` | governance | core | available | MCP policy, dependency contract, and file topology contract are deterministic and drift-enforced. |
| `process_execution` | process | core | available | Builder now exposes allowlisted one-shot command execution plus persisted managed processes with lifecycle inspection, filtered listing, tail or follow log streaming, wait, and stop controls. |
| `version_control` | version control | core | available | Builder now exposes typed repo status, diff, stage, unstage, commit, branch-create, and branch-switch operations for managed repos inside the Builder workspace. |
| `environment_configuration` | configuration | core | partial | Builder host config exists; project-local env inspection and redacted editing are not formalized yet. |
| `network_http` | network | extended | planned | No first-class allowlisted HTTP engine yet. |
| `database_introspection` | database | extended | planned | No read-only DB inspection surface yet. |
| `runtime_orchestration` | runtime | experimental | planned | No first-class service/container lifecycle surface yet. |

## Policy Model

Every Builder capability must declare a policy story before it is exposed.

### Workspace policy

- All path-based Builder actions must stay inside the configured external Builder workspace.
- Project-scoped actions must stay inside the active project root when a project context exists.
- Builder must continue rejecting any path overlap with the BizBot repository.
- Builder-managed projections and generated state such as `.builder/` remain reserved paths.
- Capabilities that mutate files must define a denylist for protected or generated surfaces.

### Command policy

- Process and VCS capabilities must execute through typed Builder wrappers, not raw prompt-level shell access.
- Commands must respect the Builder allowlist.
- Effective `cwd` must remain inside the Builder workspace or active project.
- Long-running execution must be cancellable, timed, and logged.

### Environment policy

- Builder must distinguish BizBot host env, Builder-project env files, and ephemeral execution env.
- Secret values are redacted by default.
- Env diagnostics should focus on present or missing state, source file, and format issues unless a stricter policy allows reveal behavior.

### Network policy

- HTTP access must be limited to allowlisted hosts.
- Auth material should come from approved secret references, not arbitrary prompt strings.
- Responses must be size-bounded and auditable.

### Database policy

- Database capability starts read-only.
- Targets must be project-bound and explicitly allowlisted.
- Destructive SQL is out of scope for the first rollout.

### Runtime policy

- Runtime and container operations are not Builder core.
- They require explicit enablement, durable logs, and stop or timeout reporting.

## Audit Event Shape

Every Builder capability must be reviewable through a stable audit envelope.

The canonical shape is represented in [src/lib/builder/capabilities.ts](src/lib/builder/capabilities.ts) through `BuilderCapabilityAuditShape`.

Required fields for all Builder actions:

- `version`
- `eventName`
- `projectId` when project-scoped
- `taskId` when initiated by a Builder task
- `runId` when initiated by a Builder run
- `timestamp`
- `actor`
- `scope`
- `targets`
- `outcomeStatus`

Target kinds should remain normalized to Builder concepts:

- `file`
- `directory`
- `repository`
- `process`
- `environment`
- `host`
- `database`
- `service`
- `policy`
- `project`
- `task`
- `run`

Example audit envelope:

```json
{
  "version": 1,
  "eventName": "builder.workspace.mutation",
  "projectId": "project_123",
  "taskId": "task_456",
  "runId": "run_789",
  "timestamp": "2026-04-08T18:00:00.000Z",
  "actor": "builder_operator",
  "scope": "project",
  "targets": [
    {
      "kind": "file",
      "identifier": "projects/demo/src/lib/env.ts"
    }
  ],
  "outcomeStatus": "succeeded",
  "metadata": {
    "bytesChanged": 148,
    "policyDecision": "allowed"
  }
}
```

## Core vs Extension Boundaries

Builder core should cover deterministic project operation:

- workspace mutation completion,
- first-class VCS,
- hardened process execution,
- env/config awareness,
- review and audit visibility.

Extended capabilities should remain behind explicit rollout boundaries:

- HTTP access,
- read-only DB introspection.

Experimental capabilities should stay opt-in and clearly separated from Builder core:

- runtime or container orchestration.

## Immediate Rollout Order

The recommended implementation order remains:

1. complete the filesystem layer
2. add first-class version control
3. harden process execution
4. add env/config management
5. expand review and reporting with the new audit surfaces
6. add HTTP and DB only after the core operator surfaces are stable

## Acceptance Notes for Phase 0

Phase 0 is complete when:

- the capability taxonomy is documented,
- core versus extension boundaries are explicit,
- every proposed Builder action has a policy model,
- every proposed Builder action has an audit envelope shape,
- the repo has a typed capability catalog that later Builder APIs can extend instead of re-defining local policy from scratch.