import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/mcp/route";

async function callMcp(method: string, params: Record<string, unknown>, id: string) {
  const response = await POST(new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }),
  }));

  return response.json();
}

describe("MCP contract snapshots", () => {
  it("matches the stable exposed tool catalog", async () => {
    const result = await callMcp("tools/list", {}, "tools-contract");
    const catalog = result.result.tools
      .map((tool: { name: string }) => tool.name)
      .sort();

    expect(catalog).toMatchInlineSnapshot(`
      [
        "approval_get_pending",
        "builder_add_dependency",
        "builder_bootstrap_project",
        "builder_create_directory",
        "builder_create_project",
        "builder_delete_project",
        "builder_get_project",
        "builder_get_run",
        "builder_get_status",
        "builder_initialize_git",
        "builder_install_dependencies",
        "builder_list_files",
        "builder_list_projects",
        "builder_list_runs",
        "builder_read_file",
        "builder_run_agentic_task",
        "builder_run_command",
        "builder_run_generator",
        "builder_run_script",
        "builder_scaffold_node_package",
        "builder_write_file",
        "commerce_create_order",
        "commerce_get_status",
        "commerce_list_orders",
        "commerce_list_products",
        "commerce_upsert_product",
        "crm_create_activity",
        "crm_create_contact_from_inbox",
        "crm_get_activity",
        "crm_get_contact",
        "crm_get_provider_status",
        "crm_list_activities",
        "crm_list_contacts",
        "crm_sync_activity",
        "crm_sync_contact",
        "crm_upsert_contact",
        "developer_enqueue_heartbeat",
        "developer_get_agent_run",
        "developer_get_conversation_messages",
        "developer_get_worker_status",
        "developer_inspect_memories",
        "developer_list_agent_runs",
        "developer_list_conversations",
        "developer_list_worker_jobs",
        "developer_retry_worker_job",
        "file_delete",
        "file_list",
        "file_read",
        "file_write",
        "graph_get_context",
        "graph_search",
        "graph_upsert_entity",
        "graph_upsert_topic",
        "local_business_create_post",
        "local_business_get_dashboard",
        "local_business_get_status",
        "local_business_list_reviews",
        "local_business_reply_review",
        "local_business_sync_posts",
        "local_business_sync_reviews",
        "local_business_update_hours",
        "memory_recall",
        "memory_remember",
        "schedule_list",
      ]
    `);
  });

  it("matches the stable prompt catalog", async () => {
    const result = await callMcp("prompts/list", {}, "prompts-contract");
    const catalog = result.result.prompts.map((prompt: {
      name: string;
      title: string;
      description: string;
      arguments?: Array<{ name: string; required?: boolean }>;
    }) => ({
      name: prompt.name,
      title: prompt.title,
      description: prompt.description,
      arguments: (prompt.arguments ?? []).map((argument) => ({
        name: argument.name,
        required: argument.required ?? false,
      })),
    }));

    expect(catalog).toMatchInlineSnapshot(`
      [
        {
          "arguments": [
            {
              "name": "inboxItemId",
              "required": false,
            },
          ],
          "description": "Draft a reply to an inbox message using brand voice and knowledge context",
          "name": "draft-reply",
          "title": "Draft Reply",
        },
        {
          "arguments": [
            {
              "name": "topic",
              "required": false,
            },
            {
              "name": "platform",
              "required": false,
            },
          ],
          "description": "Generate a content brief for a social media post",
          "name": "content-brief",
          "title": "Content Brief",
        },
        {
          "arguments": [
            {
              "name": "symptom",
              "required": false,
            },
          ],
          "description": "Investigate BizBot runtime issues using MCP debug resources before proposing changes",
          "name": "debug-runtime",
          "title": "Debug Runtime",
        },
        {
          "arguments": [
            {
              "name": "inboxItemId",
              "required": false,
            },
          ],
          "description": "Trace why inbox items are not being processed or replied to",
          "name": "debug-inbox-flow",
          "title": "Debug Inbox Flow",
        },
        {
          "arguments": [
            {
              "name": "symptom",
              "required": false,
            },
          ],
          "description": "Diagnose why Copilot or VS Code cannot see or use BizBot MCP capabilities",
          "name": "debug-vscode-mcp-loop",
          "title": "Debug VS Code MCP Loop",
        },
        {
          "arguments": [
            {
              "name": "runId",
              "required": true,
            },
          ],
          "description": "Inspect a specific BizBot agent run by id using the run journal tools",
          "name": "inspect-agent-run",
          "title": "Inspect Agent Run",
        },
      ]
    `);
  });

  it("matches the stable resource catalog", async () => {
    const result = await callMcp("resources/list", {}, "resources-contract");
    const catalog = result.result.resources.map((resource: {
      name: string;
      title: string;
      description: string;
      uri: string;
      mimeType: string;
    }) => ({
      name: resource.name,
      title: resource.title,
      description: resource.description,
      uri: resource.uri,
      mimeType: resource.mimeType,
    }));

    expect(catalog).toMatchInlineSnapshot(`
      [
        {
          "description": "All inbox items currently in open/processing state",
          "mimeType": "application/json",
          "name": "inbox-open",
          "title": "Open Inbox Items",
          "uri": "bizbot://inbox/open",
        },
        {
          "description": "Posts scheduled for future publishing",
          "mimeType": "application/json",
          "name": "posts-scheduled",
          "title": "Scheduled Posts",
          "uri": "bizbot://posts/scheduled",
        },
        {
          "description": "Posts waiting for human approval",
          "mimeType": "application/json",
          "name": "approvals-pending",
          "title": "Pending Approvals",
          "uri": "bizbot://approvals/pending",
        },
        {
          "description": "Current agent settings and autonomy configuration",
          "mimeType": "application/json",
          "name": "settings",
          "title": "BizBot Settings",
          "uri": "bizbot://settings",
        },
        {
          "description": "Builtin plugin metadata plus exposed MCP tool coverage for each plugin",
          "mimeType": "application/json",
          "name": "plugins-installed",
          "title": "Installed Plugins",
          "uri": "bizbot://plugins/installed",
        },
        {
          "description": "Resolved mapping from exposed MCP tools to their source plugin ids",
          "mimeType": "application/json",
          "name": "plugins-tool-map",
          "title": "Plugin Tool Map",
          "uri": "bizbot://plugins/tool-map",
        },
        {
          "description": "Inbox-backed CRM pipeline state, provider readiness, and recent contacts",
          "mimeType": "application/json",
          "name": "crm-pipeline-summary",
          "title": "CRM Pipeline Summary",
          "uri": "bizbot://crm/pipeline-summary",
        },
        {
          "description": "Runtime, LLM, worker, knowledge, inbox, and MCP state for debugging BizBot",
          "mimeType": "application/json",
          "name": "debug-system-status",
          "title": "Debug System Status",
          "uri": "bizbot://debug/system-status",
        },
        {
          "description": "High-level row counts for core BizBot tables",
          "mimeType": "application/json",
          "name": "debug-database-summary",
          "title": "Debug Database Summary",
          "uri": "bizbot://debug/database-summary",
        },
        {
          "description": "Recent heartbeat and worker timestamps plus the last summary payload",
          "mimeType": "application/json",
          "name": "debug-recent-heartbeat",
          "title": "Debug Recent Heartbeat",
          "uri": "bizbot://debug/recent-heartbeat",
        },
        {
          "description": "Recent inbox items with status, sender, and lead metadata for triage",
          "mimeType": "application/json",
          "name": "debug-recent-inbox",
          "title": "Debug Recent Inbox",
          "uri": "bizbot://debug/recent-inbox",
        },
        {
          "description": "Recent Next.js development log entries and warning/error lines for runtime debugging",
          "mimeType": "application/json",
          "name": "debug-recent-log",
          "title": "Debug Recent Log",
          "uri": "bizbot://debug/recent-log",
        },
        {
          "description": "Failed inbox items, failed posts, recent heartbeat failure summary, and recent runtime log issues",
          "mimeType": "application/json",
          "name": "debug-recent-failures",
          "title": "Debug Recent Failures",
          "uri": "bizbot://debug/recent-failures",
        },
        {
          "description": "Recent BullMQ heartbeat jobs and worker state for queue inspection",
          "mimeType": "application/json",
          "name": "debug-worker-jobs",
          "title": "Debug Worker Jobs",
          "uri": "bizbot://debug/worker-jobs",
        },
        {
          "description": "Recent memories and conversations for operator inspection",
          "mimeType": "application/json",
          "name": "debug-memory-summary",
          "title": "Debug Memory Summary",
          "uri": "bizbot://debug/memory-summary",
        },
        {
          "description": "Recent BizBot agent runs with specialist lane metadata, tool policy, and tool trace summaries",
          "mimeType": "application/json",
          "name": "debug-agent-runs",
          "title": "Debug Agent Runs",
          "uri": "bizbot://debug/agent-runs",
        },
      ]
    `);
  });
});