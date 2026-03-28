import { db } from "@/lib/db";
import {
  getAgentWorkerStatus,
  listAgentHeartbeatJobs,
} from "@/lib/agent/heartbeat-queue";
import { listRecentAgentRuns } from "@/lib/agent/run-journal";
import { getMcpClientStatus } from "@/lib/mcp/client";

export async function GET() {
  const [worker, jobs, failedInboxCount, failedPostCount, pendingApprovalCount] = await Promise.all([
    getAgentWorkerStatus(),
    listAgentHeartbeatJobs(["waiting", "active", "delayed", "completed", "failed"], 12),
    db.inboxMessage.count({ where: { status: "FAILED" } }),
    db.post.count({ where: { status: "FAILED" } }),
    db.postApproval.count({ where: { status: "PENDING" } }),
  ]);

  const heartbeatSettings = await db.setting.findMany({
    where: {
      key: {
        in: [
          "agent_last_heartbeat_started_at",
          "agent_last_heartbeat_finished_at",
          "agent_last_heartbeat_summary",
          "agent_stream_abort_count",
          "agent_stream_last_aborted_at",
        ],
      },
    },
  });

  const heartbeat = Object.fromEntries(heartbeatSettings.map((entry) => [entry.key, entry.value]));

  return Response.json({
    generatedAt: new Date().toISOString(),
    worker,
    jobs,
    runs: listRecentAgentRuns(15),
    mcp: {
      connectedClients: getMcpClientStatus(),
    },
    failures: {
      failedInboxCount,
      failedPostCount,
      pendingApprovalCount,
      streamAbortCount: Number.parseInt(heartbeat.agent_stream_abort_count ?? "0", 10) || 0,
      streamLastAbortedAt: heartbeat.agent_stream_last_aborted_at ?? null,
      lastHeartbeatStartedAt: heartbeat.agent_last_heartbeat_started_at ?? null,
      lastHeartbeatFinishedAt: heartbeat.agent_last_heartbeat_finished_at ?? null,
      lastHeartbeatSummary: heartbeat.agent_last_heartbeat_summary ?? null,
    },
  });
}