export type BuilderProjectCommandInput =
  | { action: "initialize_git" }
  | { action: "install_dependencies"; packages?: string[]; dev?: boolean }
  | { action: "add_dependency"; packages: string[]; dev?: boolean }
  | { action: "run_script"; script: string; args?: string[] }
  | { action: "run_generator"; generator: string; args?: string[] }
  | { action: "reconcile_mcp_policy" }
  | { action: "reconcile_operational_state" }
  | { action: "resolve_mcp_contract_drift"; runId: string; decision: "approve" | "reject"; reason?: string }
  | { action: "run_agentic_task"; profile?: string; prompt: string; model?: string; args?: string[] };

export type BuilderProjectRecordedCommandInput = Exclude<BuilderProjectCommandInput, { action: "run_generator" }>;