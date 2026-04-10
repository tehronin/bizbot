export const BUILDER_CAPABILITY_TIERS = ["core", "extended", "experimental"] as const;
export const BUILDER_CAPABILITY_STATUSES = ["available", "partial", "planned"] as const;
export const BUILDER_CAPABILITY_DOMAINS = [
  "workspace",
  "version_control",
  "process",
  "configuration",
  "network",
  "database",
  "runtime",
  "governance",
  "orchestration",
] as const;
export const BUILDER_AUDIT_TARGET_KINDS = [
  "file",
  "directory",
  "repository",
  "process",
  "environment",
  "host",
  "database",
  "service",
  "policy",
  "project",
  "task",
  "run",
] as const;
export const BUILDER_AUDIT_OUTCOME_STATUSES = ["succeeded", "failed", "blocked", "cancelled", "timed_out"] as const;
export const BUILDER_CAPABILITY_SCOPES = ["project", "workspace", "project_or_workspace"] as const;

export type BuilderCapabilityTier = (typeof BUILDER_CAPABILITY_TIERS)[number];
export type BuilderCapabilityStatus = (typeof BUILDER_CAPABILITY_STATUSES)[number];
export type BuilderCapabilityDomain = (typeof BUILDER_CAPABILITY_DOMAINS)[number];
export type BuilderAuditTargetKind = (typeof BUILDER_AUDIT_TARGET_KINDS)[number];
export type BuilderAuditOutcomeStatus = (typeof BUILDER_AUDIT_OUTCOME_STATUSES)[number];
export type BuilderCapabilityScope = (typeof BUILDER_CAPABILITY_SCOPES)[number];

export interface BuilderAuditTargetShape {
  kind: BuilderAuditTargetKind;
  identifier: string;
  metadata?: string[];
}

export interface BuilderCapabilityAuditShape {
  version: 1;
  eventName: string;
  requiredContext: Array<"projectId" | "taskId" | "runId" | "timestamp" | "actor">;
  scope: BuilderCapabilityScope;
  targets: BuilderAuditTargetShape[];
  outcomeStatuses: BuilderAuditOutcomeStatus[];
  redactByDefault: boolean;
}

export interface BuilderCapabilityPolicy {
  scope: BuilderCapabilityScope;
  requiresWorkspaceContainment: boolean;
  rejectsRepositoryOverlap: boolean;
  pathDenylist: string[];
  requiresCommandAllowlist: boolean;
  requiresHostAllowlist: boolean;
  requiresDatabaseAllowlist: boolean;
  redactsSecretsByDefault: boolean;
  requiresExplicitApproval: boolean;
  notes: string[];
}

export interface BuilderCapabilityDefinition {
  key: string;
  title: string;
  domain: BuilderCapabilityDomain;
  tier: BuilderCapabilityTier;
  status: BuilderCapabilityStatus;
  summary: string;
  tools: string[];
  policy: BuilderCapabilityPolicy;
  audit: BuilderCapabilityAuditShape;
}

const DEFAULT_WORKSPACE_DENYLIST = ["../", "..\\", ".git", ".next", "src-tauri/resources/standalone/.next"];

export const BUILDER_CAPABILITY_CATALOG: BuilderCapabilityDefinition[] = [
  {
    key: "workspace_manipulation",
    title: "Workspace Manipulation",
    domain: "workspace",
    tier: "core",
    status: "available",
    summary: "Project-safe file and directory operations inside the external Builder workspace.",
    tools: [
      "builder_list_files",
      "builder_read_file",
      "builder_write_file",
      "builder_create_directory",
      "builder_scaffold_node_package",
      "builder_append_file",
      "builder_delete_path",
      "builder_move_path",
      "builder_ensure_directory",
      "builder_stat_path",
      "builder_path_exists",
      "builder_apply_patch",
    ],
    policy: {
      scope: "project_or_workspace",
      requiresWorkspaceContainment: true,
      rejectsRepositoryOverlap: true,
      pathDenylist: DEFAULT_WORKSPACE_DENYLIST,
      requiresCommandAllowlist: false,
      requiresHostAllowlist: false,
      requiresDatabaseAllowlist: false,
      redactsSecretsByDefault: false,
      requiresExplicitApproval: false,
      notes: [
        "All paths must stay inside the configured external Builder workspace.",
        "Project-scoped mutations should remain inside the active project root whenever a project context exists.",
        "Builder-managed projections such as .builder and AGENTS.md remain reserved policy surfaces.",
      ],
    },
    audit: {
      version: 1,
      eventName: "builder.workspace.mutation",
      requiredContext: ["projectId", "taskId", "runId", "timestamp", "actor"],
      scope: "project_or_workspace",
      targets: [
        { kind: "file", identifier: "workspace-relative path" },
        { kind: "directory", identifier: "workspace-relative path" },
      ],
      outcomeStatuses: ["succeeded", "failed", "blocked"],
      redactByDefault: false,
    },
  },
  {
    key: "project_orchestration",
    title: "Project Orchestration",
    domain: "orchestration",
    tier: "core",
    status: "available",
    summary: "Persistent Builder project, task, run, bootstrap, and planning operations.",
    tools: [
      "builder_get_status",
      "builder_list_projects",
      "builder_create_project",
      "builder_get_project",
      "builder_plan_project",
      "builder_list_tasks",
      "builder_plan_task",
      "builder_continue_task",
      "builder_write_project_instructions",
      "builder_delete_project",
      "builder_bootstrap_project",
      "builder_list_runs",
      "builder_get_run",
    ],
    policy: {
      scope: "project_or_workspace",
      requiresWorkspaceContainment: true,
      rejectsRepositoryOverlap: true,
      pathDenylist: DEFAULT_WORKSPACE_DENYLIST,
      requiresCommandAllowlist: false,
      requiresHostAllowlist: false,
      requiresDatabaseAllowlist: false,
      redactsSecretsByDefault: true,
      requiresExplicitApproval: false,
      notes: [
        "Project records are database-authoritative even when Builder mirrors state into .builder projections.",
        "Task continuation and replanning must remain reviewable through run metadata and reports.",
      ],
    },
    audit: {
      version: 1,
      eventName: "builder.orchestration.lifecycle",
      requiredContext: ["projectId", "taskId", "runId", "timestamp", "actor"],
      scope: "project_or_workspace",
      targets: [
        { kind: "project", identifier: "builder project id" },
        { kind: "task", identifier: "builder task id" },
        { kind: "run", identifier: "builder run id" },
      ],
      outcomeStatuses: ["succeeded", "failed", "blocked", "cancelled"],
      redactByDefault: true,
    },
  },
  {
    key: "governance_contracts",
    title: "Governance Contracts",
    domain: "governance",
    tier: "core",
    status: "available",
    summary: "Deterministic MCP policy, dependency contract, and file-topology contract enforcement.",
    tools: [
      "builder_reconcile_mcp_policy",
      "builder_resolve_mcp_contract_drift",
      "builder_resolve_dependency_contract_drift",
      "builder_resolve_file_topology_contract_drift",
    ],
    policy: {
      scope: "project",
      requiresWorkspaceContainment: true,
      rejectsRepositoryOverlap: true,
      pathDenylist: DEFAULT_WORKSPACE_DENYLIST,
      requiresCommandAllowlist: false,
      requiresHostAllowlist: false,
      requiresDatabaseAllowlist: false,
      redactsSecretsByDefault: true,
      requiresExplicitApproval: true,
      notes: [
        "Drift in MCP policy, dependency state, or topology must block execution until explicitly reconciled.",
        "Builder projections are review aids; persisted Builder state remains authoritative.",
      ],
    },
    audit: {
      version: 1,
      eventName: "builder.governance.reconciliation",
      requiredContext: ["projectId", "taskId", "runId", "timestamp", "actor"],
      scope: "project",
      targets: [
        { kind: "policy", identifier: "mcp-policy or contract baseline" },
        { kind: "project", identifier: "builder project id" },
      ],
      outcomeStatuses: ["succeeded", "failed", "blocked"],
      redactByDefault: true,
    },
  },
  {
    key: "process_execution",
    title: "Process Execution",
    domain: "process",
    tier: "core",
    status: "available",
    summary: "Allowlisted one-shot and managed process execution inside the Builder workspace with lifecycle controls, scoped audit metadata, retention cleanup, and bounded live logs.",
    tools: [
      "builder_run_command",
      "builder_run_script",
      "builder_install_dependencies",
      "builder_add_dependency",
      "builder_run_generator",
      "builder_run_agentic_task",
      "builder_start_process",
      "builder_get_process",
      "builder_list_processes",
      "builder_stream_process_logs",
      "builder_stop_process",
      "builder_wait_for_process",
    ],
    policy: {
      scope: "project_or_workspace",
      requiresWorkspaceContainment: true,
      rejectsRepositoryOverlap: true,
      pathDenylist: DEFAULT_WORKSPACE_DENYLIST,
      requiresCommandAllowlist: true,
      requiresHostAllowlist: false,
      requiresDatabaseAllowlist: false,
      redactsSecretsByDefault: true,
      requiresExplicitApproval: false,
      notes: [
        "All process execution must stay behind typed Builder wrappers instead of exposing raw shell prompts.",
        "Environment injection should be explicit, bounded, and auditable.",
      ],
    },
    audit: {
      version: 1,
      eventName: "builder.process.execution",
      requiredContext: ["projectId", "taskId", "runId", "timestamp", "actor"],
      scope: "project_or_workspace",
      targets: [
        { kind: "process", identifier: "process id or command signature" },
        { kind: "directory", identifier: "effective cwd" },
      ],
      outcomeStatuses: ["succeeded", "failed", "blocked", "cancelled", "timed_out"],
      redactByDefault: true,
    },
  },
  {
    key: "version_control",
    title: "Version Control",
    domain: "version_control",
    tier: "core",
    status: "available",
    summary: "First-class git state inspection, staging, branching, and commit workflows inside Builder-managed repos.",
    tools: [
      "builder_repo_status",
      "builder_diff",
      "builder_stage_paths",
      "builder_unstage_paths",
      "builder_commit",
      "builder_create_branch",
      "builder_switch_branch",
    ],
    policy: {
      scope: "project",
      requiresWorkspaceContainment: true,
      rejectsRepositoryOverlap: true,
      pathDenylist: DEFAULT_WORKSPACE_DENYLIST,
      requiresCommandAllowlist: true,
      requiresHostAllowlist: false,
      requiresDatabaseAllowlist: false,
      redactsSecretsByDefault: false,
      requiresExplicitApproval: false,
      notes: [
        "Git operations should stay inside the Builder project repo or workspace root selected for that project.",
        "Commit creation should require an explicit message and reject empty commits by default.",
      ],
    },
    audit: {
      version: 1,
      eventName: "builder.vcs.operation",
      requiredContext: ["projectId", "taskId", "runId", "timestamp", "actor"],
      scope: "project",
      targets: [
        { kind: "repository", identifier: "builder project repository" },
        { kind: "file", identifier: "changed path" },
      ],
      outcomeStatuses: ["succeeded", "failed", "blocked"],
      redactByDefault: false,
    },
  },
  {
    key: "environment_configuration",
    title: "Environment Configuration",
    domain: "configuration",
    tier: "core",
    status: "available",
    summary: "Builder host config and project-local env inspection and mutation are formalized with redacted reads and safe writes.",
    tools: [
      "builder_get_env_schema",
      "builder_validate_env",
      "builder_read_env_value",
      "builder_write_env_file_entry",
      "builder_sync_env_example",
      "builder_list_required_config",
    ],
    policy: {
      scope: "project_or_workspace",
      requiresWorkspaceContainment: true,
      rejectsRepositoryOverlap: true,
      pathDenylist: [...DEFAULT_WORKSPACE_DENYLIST, ".env", ".env.local"],
      requiresCommandAllowlist: false,
      requiresHostAllowlist: false,
      requiresDatabaseAllowlist: false,
      redactsSecretsByDefault: true,
      requiresExplicitApproval: false,
      notes: [
        "Builder must distinguish BizBot host environment from project-local env files and ephemeral execution env.",
        "Secret values should remain redacted unless an explicit policy allows reveal-in-place behavior.",
      ],
    },
    audit: {
      version: 1,
      eventName: "builder.configuration.access",
      requiredContext: ["projectId", "taskId", "runId", "timestamp", "actor"],
      scope: "project_or_workspace",
      targets: [
        { kind: "environment", identifier: "env key or env file path" },
        { kind: "project", identifier: "builder project id" },
      ],
      outcomeStatuses: ["succeeded", "failed", "blocked"],
      redactByDefault: true,
    },
  },
  {
    key: "network_http",
    title: "Network HTTP",
    domain: "network",
    tier: "extended",
    status: "available",
    summary: "Allowlisted HTTP probing and integration validation with bounded request and response handling, explicit retry policy, auth-reference controls, and persisted capability audit events.",
    tools: ["builder_http_get", "builder_http_post", "builder_http_put", "builder_http_delete"],
    policy: {
      scope: "project",
      requiresWorkspaceContainment: false,
      rejectsRepositoryOverlap: true,
      pathDenylist: DEFAULT_WORKSPACE_DENYLIST,
      requiresCommandAllowlist: false,
      requiresHostAllowlist: true,
      requiresDatabaseAllowlist: false,
      redactsSecretsByDefault: true,
      requiresExplicitApproval: false,
      notes: [
        "Hosts, auth sources, timeout behavior, and response size limits must be policy-bound.",
        "Network access is an extension surface, not part of Builder core mutation authority.",
      ],
    },
    audit: {
      version: 1,
      eventName: "builder.network.request",
      requiredContext: ["projectId", "taskId", "runId", "timestamp", "actor"],
      scope: "project",
      targets: [{ kind: "host", identifier: "scheme://host[:port]" }],
      outcomeStatuses: ["succeeded", "failed", "blocked", "timed_out"],
      redactByDefault: true,
    },
  },
  {
    key: "database_introspection",
    title: "Database Introspection",
    domain: "database",
    tier: "extended",
    status: "available",
    summary: "Read-only schema, migration, and live-probe drift inspection for Builder-managed project databases with project-bound datasource policy and audit trails.",
    tools: [
      "builder_db_list_tables",
      "builder_db_describe_table",
      "builder_db_schema_summary",
      "builder_db_list_migrations",
    ],
    policy: {
      scope: "project",
      requiresWorkspaceContainment: false,
      rejectsRepositoryOverlap: true,
      pathDenylist: DEFAULT_WORKSPACE_DENYLIST,
      requiresCommandAllowlist: false,
      requiresHostAllowlist: false,
      requiresDatabaseAllowlist: true,
      redactsSecretsByDefault: true,
      requiresExplicitApproval: true,
      notes: [
        "The initial rollout should remain read-only and bound to project-local connection policy.",
        "Live SQL execution remains out of scope for the initial rollout; schema and migration inspection must stay read-only.",
      ],
    },
    audit: {
      version: 1,
      eventName: "builder.database.inspect",
      requiredContext: ["projectId", "taskId", "runId", "timestamp", "actor"],
      scope: "project",
      targets: [{ kind: "database", identifier: "project-bound connection target" }],
      outcomeStatuses: ["succeeded", "failed", "blocked", "timed_out"],
      redactByDefault: true,
    },
  },
  {
    key: "runtime_orchestration",
    title: "Runtime Orchestration",
    domain: "runtime",
    tier: "experimental",
    status: "partial",
    summary: "Optional service discovery across package manifests, Procfiles, and compose files with runtime reconciliation, guarded log follow, start or stop or restart controls, and allowlisted exec.",
    tools: [
      "builder_list_services",
      "builder_service_logs",
      "builder_start_service",
      "builder_stop_service",
      "builder_restart_service",
      "builder_exec_in_service",
    ],
    policy: {
      scope: "project",
      requiresWorkspaceContainment: false,
      rejectsRepositoryOverlap: true,
      pathDenylist: DEFAULT_WORKSPACE_DENYLIST,
      requiresCommandAllowlist: true,
      requiresHostAllowlist: false,
      requiresDatabaseAllowlist: false,
      redactsSecretsByDefault: true,
      requiresExplicitApproval: true,
      notes: [
        "Runtime control should remain explicitly enabled and separate from Builder core for single-project repos.",
        "Service execution must remain inspectable through persisted logs and stop reasons.",
      ],
    },
    audit: {
      version: 1,
      eventName: "builder.runtime.control",
      requiredContext: ["projectId", "taskId", "runId", "timestamp", "actor"],
      scope: "project",
      targets: [{ kind: "service", identifier: "service or container name" }],
      outcomeStatuses: ["succeeded", "failed", "blocked", "cancelled", "timed_out"],
      redactByDefault: true,
    },
  },
];

function cloneCapability(definition: BuilderCapabilityDefinition): BuilderCapabilityDefinition {
  return {
    ...definition,
    tools: [...definition.tools],
    policy: {
      ...definition.policy,
      pathDenylist: [...definition.policy.pathDenylist],
      notes: [...definition.policy.notes],
    },
    audit: {
      ...definition.audit,
      requiredContext: [...definition.audit.requiredContext],
      targets: definition.audit.targets.map((target) => ({
        ...target,
        metadata: target.metadata ? [...target.metadata] : undefined,
      })),
      outcomeStatuses: [...definition.audit.outcomeStatuses],
    },
  };
}

export function listBuilderCapabilities(): BuilderCapabilityDefinition[] {
  return BUILDER_CAPABILITY_CATALOG.map(cloneCapability);
}

export function getBuilderCapability(key: string): BuilderCapabilityDefinition | null {
  const normalizedKey = key.trim().toLowerCase();
  const capability = BUILDER_CAPABILITY_CATALOG.find((candidate) => candidate.key === normalizedKey);
  return capability ? cloneCapability(capability) : null;
}