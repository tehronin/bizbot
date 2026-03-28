/** DeveloperPlugin — Inspect BizBot runtime queues, jobs, memories, and conversations. */

import {
  enqueueAgentHeartbeat,
  getAgentWorkerStatus,
  listAgentHeartbeatJobs,
  retryAgentHeartbeatJob,
  type AgentHeartbeatJobStatus,
} from "@/lib/agent/heartbeat-queue";
import {
  inspectConversationMessages,
  inspectMemories,
  listRecentConversations,
} from "@/lib/agent/memory";
import { getAgentRun, listRecentAgentRuns } from "@/lib/agent/run-journal";
import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";

type WorkerStatusArgs = Record<string, never>;

interface WorkerJobsArgs {
  statuses?: AgentHeartbeatJobStatus[];
  limit?: number;
}

interface RetryWorkerJobArgs {
  jobId: string;
}

interface EnqueueHeartbeatArgs {
  trigger?: "manual" | "scheduler";
}

interface MemoryInspectArgs {
  query?: string;
  category?: string;
  limit?: number;
}

interface ConversationListArgs {
  limit?: number;
}

interface ConversationMessagesArgs {
  conversationId: string;
  limit?: number;
}

interface AgentRunsArgs {
  limit?: number;
}

interface AgentRunArgs {
  runId: string;
}

export const developerPlugin = {
  tools: [
    registerTool(defineTool({
      name: "developer_get_worker_status",
      description: "Inspect BullMQ heartbeat worker status, scheduler state, and queue counts.",
      parameters: { type: "object", properties: {} },
      execute: async (_args: WorkerStatusArgs) => ({
        worker: await getAgentWorkerStatus(),
      }),
    } satisfies ToolDefinition<WorkerStatusArgs, { worker: Awaited<ReturnType<typeof getAgentWorkerStatus>> }>)),
    registerTool(defineTool({
      name: "developer_list_worker_jobs",
      description: "List recent heartbeat worker jobs by status for inspection and debugging.",
      parameters: {
        type: "object",
        properties: {
          statuses: {
            type: "array",
            items: { type: "string", enum: ["waiting", "active", "delayed", "completed", "failed"] },
          },
          limit: { type: "number", default: 20 },
        },
      },
      execute: async ({ statuses, limit }: WorkerJobsArgs) => ({
        jobs: await listAgentHeartbeatJobs(statuses, limit ?? 20),
      }),
    } satisfies ToolDefinition<WorkerJobsArgs, { jobs: Awaited<ReturnType<typeof listAgentHeartbeatJobs>> }>)),
    registerTool(defineTool({
      name: "developer_retry_worker_job",
      description: "Retry a failed heartbeat worker job by job id.",
      parameters: {
        type: "object",
        properties: {
          jobId: { type: "string" },
        },
        required: ["jobId"],
      },
      execute: async ({ jobId }: RetryWorkerJobArgs) => retryAgentHeartbeatJob(jobId),
    } satisfies ToolDefinition<RetryWorkerJobArgs, Awaited<ReturnType<typeof retryAgentHeartbeatJob>>>)),
    registerTool(defineTool({
      name: "developer_enqueue_heartbeat",
      description: "Enqueue a heartbeat job manually for immediate worker execution.",
      parameters: {
        type: "object",
        properties: {
          trigger: { type: "string", enum: ["manual", "scheduler"], default: "manual" },
        },
      },
      execute: async ({ trigger }: EnqueueHeartbeatArgs) => {
        const job = await enqueueAgentHeartbeat(trigger ?? "manual");
        return { queued: true, jobId: String(job.id) };
      },
    } satisfies ToolDefinition<EnqueueHeartbeatArgs, { queued: boolean; jobId: string }>)),
    registerTool(defineTool({
      name: "developer_inspect_memories",
      description: "Inspect stored BizBot memories by query or category without using semantic recall.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          category: { type: "string" },
          limit: { type: "number", default: 20 },
        },
      },
      execute: async ({ query, category, limit }: MemoryInspectArgs) => ({
        memories: await inspectMemories({ query, category, limit: limit ?? 20 }),
      }),
    } satisfies ToolDefinition<MemoryInspectArgs, { memories: Awaited<ReturnType<typeof inspectMemories>> }>)),
    registerTool(defineTool({
      name: "developer_list_conversations",
      description: "List recent BizBot conversations with message counts for debugging and inspection.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", default: 20 },
        },
      },
      execute: async ({ limit }: ConversationListArgs) => ({
        conversations: await listRecentConversations({ limit: limit ?? 20 }),
      }),
    } satisfies ToolDefinition<ConversationListArgs, { conversations: Awaited<ReturnType<typeof listRecentConversations>> }>)),
    registerTool(defineTool({
      name: "developer_get_conversation_messages",
      description: "Read recent messages from a specific BizBot conversation.",
      parameters: {
        type: "object",
        properties: {
          conversationId: { type: "string" },
          limit: { type: "number", default: 50 },
        },
        required: ["conversationId"],
      },
      execute: async ({ conversationId, limit }: ConversationMessagesArgs) => ({
        messages: await inspectConversationMessages(conversationId, limit ?? 50),
      }),
    } satisfies ToolDefinition<ConversationMessagesArgs, { messages: Awaited<ReturnType<typeof inspectConversationMessages>> }>)),
    registerTool(defineTool({
      name: "developer_list_agent_runs",
      description: "List recent BizBot agent runs with lane, status, tool counts, and reply/error summary.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", default: 20 },
        },
      },
      execute: async ({ limit }: AgentRunsArgs) => ({
        runs: listRecentAgentRuns(limit ?? 20),
      }),
    } satisfies ToolDefinition<AgentRunsArgs, { runs: ReturnType<typeof listRecentAgentRuns> }>)),
    registerTool(defineTool({
      name: "developer_get_agent_run",
      description: "Read the full journal for a specific BizBot agent run, including tool call/result traces.",
      parameters: {
        type: "object",
        properties: {
          runId: { type: "string" },
        },
        required: ["runId"],
      },
      execute: async ({ runId }: AgentRunArgs) => ({
        run: getAgentRun(runId),
      }),
    } satisfies ToolDefinition<AgentRunArgs, { run: ReturnType<typeof getAgentRun> }>)),
  ],
};