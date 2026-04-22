import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export const MCP_AGENT_PROFILE = "mcp_operator";
export const MCP_BLOCKED_TOOLS = new Set(["agent_delegate_run"]);
export const MCP_SAMPLING_BLOCKED_TOOLS = new Set([
  "sidecar_open",
  "sidecar_update",
  "sidecar_close",
  "sidecar_navigate",
  "browser_navigate",
  "developer_invoke_imported_mcp_tool",
  "developer_accept_imported_mcp_catalog_baseline",
]);

export function getToolTitle(name: string): string {
  if (name.startsWith("social_")) return `Social: ${name.replace("social_", "").replaceAll("_", " ")}`;
  if (name.startsWith("content_")) return `Content: ${name.replace("content_", "").replaceAll("_", " ")}`;
  if (name.startsWith("crm_")) return `CRM: ${name.replace("crm_", "").replaceAll("_", " ")}`;
  if (name.startsWith("commerce_")) return `Commerce: ${name.replace("commerce_", "").replaceAll("_", " ")}`;
  if (name.startsWith("local_business_")) return `Local Business: ${name.replace("local_business_", "").replaceAll("_", " ")}`;
  if (name.startsWith("agent_")) return `Agent Runtime: ${name.replace("agent_", "").replaceAll("_", " ")}`;
  if (name.startsWith("memory_")) return `Memory: ${name.replace("memory_", "").replaceAll("_", " ")}`;
  if (name.startsWith("file_")) return `Workspace Files: ${name.replace("file_", "").replaceAll("_", " ")}`;
  if (name.startsWith("graph_")) return `Knowledge Graph: ${name.replace("graph_", "").replaceAll("_", " ")}`;
  if (name.startsWith("schedule_")) return `Scheduling: ${name.replace("schedule_", "").replaceAll("_", " ")}`;
  if (name.startsWith("approval_")) return `Approvals: ${name.replace("approval_", "").replaceAll("_", " ")}`;
  if (name.startsWith("browser_")) return `Browser: ${name.replace("browser_", "").replaceAll("_", " ")}`;
  if (name.startsWith("competitor_")) return `Competitors: ${name.replace("competitor_", "").replaceAll("_", " ")}`;
  if (name.startsWith("oracle_")) return `Oracle: ${name.replace("oracle_", "").replaceAll("_", " ")}`;
  if (name.startsWith("developer_")) return `Developer: ${name.replace("developer_", "").replaceAll("_", " ")}`;
  if (name.startsWith("builder_")) return `Builder: ${name.replace("builder_", "").replaceAll("_", " ")}`;
  if (name.startsWith("creeper_")) return `Creeper: ${name.replace("creeper_", "").replaceAll("_", " ")}`;
  if (name.startsWith("sidecar_")) return `Sidecar: ${name.replace("sidecar_", "").replaceAll("_", " ")}`;
  if (name.startsWith("mcp_")) return `Imported MCP: ${name.replaceAll("_", " ")}`;
  return name.replaceAll("_", " ");
}

export function getToolAnnotations(name: string): ToolAnnotations {
  const readOnly = [
    "crm_get_provider_status",
    "crm_list_contacts",
    "crm_get_contact",
    "crm_list_activities",
    "crm_get_activity",
    "commerce_get_status",
    "commerce_list_products",
    "commerce_list_orders",
    "local_business_get_status",
    "local_business_get_dashboard",
    "local_business_list_reviews",
    "developer_list_agent_runs",
    "developer_get_agent_run",
    "developer_get_worker_status",
    "developer_list_worker_jobs",
    "developer_inspect_memories",
    "developer_list_conversations",
    "developer_get_conversation_messages",
    "developer_inspect_plugin_registry",
    "developer_inspect_plugin",
    "developer_inspect_ontology_schema",
    "developer_validate_plugin_contract",
    "developer_validate_ontology_relation",
    "developer_check_tool_naming",
    "developer_preview_mcp_exposure",
    "developer_explain_registry_conflict",
    "developer_explain_ontology_alias",
    "developer_preview_prompt",
    "developer_preview_resource",
    "developer_preview_ontology_context",
    "developer_preview_tool_descriptor",
    "developer_search_tools",
    "developer_get_tool_bundle",
    "developer_recommend_toolset_for_goal",
    "developer_search_resources",
    "developer_search_prompts",
    "developer_search_ontology_entities",
    "developer_suggest_plugin_tests",
    "developer_check_mcp_contract_impact",
    "developer_prepare_plugin_design_review",
    "developer_summarize_builder_repair",
    "developer_audit_imported_mcp_servers",
    "developer_diff_imported_mcp_catalog",
    "developer_read_imported_mcp_resource",
    "developer_get_imported_mcp_prompt",
    "developer_get_builder_task_lifecycle",
    "developer_get_builder_task_events",
    "developer_inspect_mcp_health",
    "developer_list_mcp_trace_events",
    "developer_get_task_recipe",
    "developer_plan_plugin",
    "developer_suggest_tool_schemas",
    "social_get_mentions",
    "social_get_analytics",
    "content_check_policy",
    "memory_recall",
    "memory_get_facts",
    "file_list",
    "file_read",
    "graph_search",
    "graph_get_context",
    "schedule_list",
    "approval_get_pending",
    "sidecar_get_state",
    "oracle_open_personality_selector",
    "oracle_analyze_prediction",
    "oracle_search_markets",
    "oracle_get_market_verdict",
    "browser_navigate",
    "browser_extract_text",
    "browser_extract_links",
    "competitor_watch_list",
    "competitor_watch_check",
    "creeper_list_company_profiles",
    "creeper_get_company_profile",
    "creeper_open_company_selector",
    "creeper_list_source_assets",
    "creeper_open_source_sidecar",
  ];

  const destructive = [
    "crm_upsert_contact",
    "crm_create_contact_from_inbox",
    "crm_sync_contact",
    "crm_create_activity",
    "crm_sync_activity",
    "developer_resume_agent_run",
    "developer_retry_worker_job",
    "developer_enqueue_heartbeat",
    "developer_accept_imported_mcp_catalog_baseline",
    "developer_invoke_imported_mcp_tool",
    "commerce_upsert_product",
    "commerce_create_order",
    "agent_delegate_run",
    "social_post",
    "social_reply",
    "file_delete",
    "approval_decide",
    "browser_screenshot",
    "local_business_sync_reviews",
    "local_business_sync_posts",
    "local_business_reply_review",
    "local_business_create_post",
    "local_business_update_hours",
    "memory_remember",
    "memory_set_fact",
    "memory_forget_fact",
    "creeper_prepare_company_brief",
    "creeper_select_company_profile",
    "creeper_register_source",
    "creeper_test_source_connection",
    "creeper_profile_source",
    "creeper_draft_ingestion_plan",
    "creeper_update_ingestion_plan",
    "creeper_approve_ingestion_plan",
    "creeper_start_ingestion_run",
  ];

  const idempotent = [
    "crm_get_provider_status",
    "crm_list_contacts",
    "crm_get_contact",
    "crm_list_activities",
    "crm_get_activity",
    "developer_list_agent_runs",
    "developer_get_agent_run",
    "developer_get_worker_status",
    "developer_list_worker_jobs",
    "developer_inspect_memories",
    "developer_list_conversations",
    "developer_get_conversation_messages",
    "developer_inspect_plugin_registry",
    "developer_inspect_plugin",
    "developer_inspect_ontology_schema",
    "developer_validate_plugin_contract",
    "developer_validate_ontology_relation",
    "developer_check_tool_naming",
    "developer_preview_mcp_exposure",
    "developer_explain_registry_conflict",
    "developer_explain_ontology_alias",
    "developer_preview_prompt",
    "developer_preview_resource",
    "developer_preview_ontology_context",
    "developer_preview_tool_descriptor",
    "developer_search_tools",
    "developer_get_tool_bundle",
    "developer_recommend_toolset_for_goal",
    "developer_search_resources",
    "developer_search_prompts",
    "developer_search_ontology_entities",
    "developer_suggest_plugin_tests",
    "developer_check_mcp_contract_impact",
    "developer_prepare_plugin_design_review",
    "developer_summarize_builder_repair",
    "developer_audit_imported_mcp_servers",
    "developer_diff_imported_mcp_catalog",
    "developer_read_imported_mcp_resource",
    "developer_get_imported_mcp_prompt",
    "developer_get_builder_task_lifecycle",
    "developer_get_builder_task_events",
    "developer_inspect_mcp_health",
    "developer_list_mcp_trace_events",
    "developer_get_task_recipe",
    "developer_plan_plugin",
    "developer_suggest_tool_schemas",
    "commerce_get_status",
    "commerce_list_products",
    "commerce_list_orders",
    "content_draft",
    "content_refine",
    "content_check_policy",
    "local_business_get_status",
    "local_business_get_dashboard",
    "local_business_list_reviews",
    "memory_recall",
    "memory_get_facts",
    "file_list",
    "file_read",
    "graph_search",
    "graph_get_context",
    "schedule_list",
    "approval_get_pending",
    "sidecar_get_state",
    "oracle_open_personality_selector",
    "oracle_analyze_prediction",
    "oracle_search_markets",
    "oracle_get_market_verdict",
    "browser_extract_text",
    "browser_extract_links",
    "competitor_watch_list",
    "creeper_list_company_profiles",
    "creeper_get_company_profile",
    "creeper_open_company_selector",
    "creeper_list_source_assets",
    "creeper_open_source_sidecar",
  ];

  const openWorld = [
    "browser_navigate",
    "browser_screenshot",
    "browser_extract_text",
    "browser_extract_links",
    "competitor_watch_check",
    "developer_invoke_imported_mcp_tool",
    "creeper_test_source_connection",
    "creeper_profile_source",
  ];

  return {
    readOnlyHint: readOnly.includes(name),
    destructiveHint: destructive.includes(name),
    idempotentHint: idempotent.includes(name),
    openWorldHint: openWorld.includes(name),
  };
}

export function getToolDescription(name: string, description: string): string {
  const hints: string[] = [];

  if (name.startsWith("social_")) {
    hints.push("Use for live social platform reads or writes.");
  } else if (name.startsWith("crm_")) {
    hints.push("Use for inbox-backed CRM lead management and optional external CRM sync.");
  } else if (name.startsWith("approval_")) {
    hints.push("Use when inspecting or resolving the approval queue.");
  } else if (name.startsWith("browser_")) {
    hints.push("Use for web inspection through Playwright when local files or DB state are insufficient.");
  } else if (name.startsWith("file_")) {
    hints.push("Use for workspace file inspection or editing.");
  } else if (name.startsWith("graph_")) {
    hints.push("Use for Memgraph-backed knowledge graph inspection or updates.");
  } else if (name.startsWith("memory_")) {
    hints.push("Use for BizBot long-term memory recall or storage.");
  } else if (name.startsWith("schedule_")) {
    hints.push("Use for inspecting or changing scheduled posts.");
  } else if (name.startsWith("competitor_")) {
    hints.push("Use for competitor watch inspection or control.");
  } else if (name.startsWith("developer_")) {
    hints.push("Use for plugin authoring, runtime inspection, validation, or debugging.");
  } else if (name.startsWith("creeper_")) {
    hints.push("Use for company profile onboarding, source registration, profiling, ingestion planning, and grounded retrieval preparation.");
  } else if (name.startsWith("sidecar_")) {
    hints.push("Use to control the BizBot-owned transient Sidecar panel.");
  } else if (name.startsWith("oracle_")) {
    hints.push("Use for read-only Polymarket search, verdicts, and optional Sidecar-enhanced Oracle flows.");
  }

  if (getToolAnnotations(name).readOnlyHint) {
    hints.push("Read-only.");
  }
  if (name.startsWith("sidecar_")) {
    hints.push("UI-only. Does not write database, memory, or filesystem state.");
  }
  if (getToolAnnotations(name).destructiveHint) {
    hints.push("Changes external or persisted state.");
  }
  if (name === "creeper_test_source_connection" || name === "creeper_profile_source") {
    hints.push("Reads an external company source while also persisting local Creeper state and audit artifacts.");
  }
  if (name === "social_post" || name === "social_reply") {
    hints.push("Respect BizBot autonomy and approval rules.");
  }
  if (name === "approval_decide") {
    hints.push("Only use when you intend to approve or reject queued content.");
  }

  return `${description} ${hints.join(" ")}`.trim();
}

export function isSamplingSafeTool(name: string): boolean {
  if (MCP_BLOCKED_TOOLS.has(name) || MCP_SAMPLING_BLOCKED_TOOLS.has(name)) {
    return false;
  }

  const annotations = getToolAnnotations(name);
  return annotations.readOnlyHint === true && annotations.destructiveHint !== true && annotations.openWorldHint !== true;
}