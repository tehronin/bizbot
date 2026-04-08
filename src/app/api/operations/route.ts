import { db } from "@/lib/db";
import {
  getAgentWorkerStatus,
  listAgentHeartbeatJobs,
} from "@/lib/agent/heartbeat-queue";
import { listRecentAgentRuns } from "@/lib/agent/run-journal";
import { getBuilderMcpSnapshotOverview } from "@/lib/builder/mcp-snapshots";
import { getMcpClientStatus } from "@/lib/mcp/client";
import { getMcpQueueStatus, listMcpJobs } from "@/lib/mcp/job-status";
import { BIZBOT_PLATFORM_CONTRACT_VERSION } from "@/lib/platform/contract";

export async function GET() {
  const [worker, jobs, mcpWorker, mcpJobs, failedInboxCount, failedPostCount, pendingApprovalCount, latestBuilderProject] = await Promise.all([
    getAgentWorkerStatus(),
    listAgentHeartbeatJobs(["waiting", "active", "delayed", "completed", "failed"], 12),
    getMcpQueueStatus(),
    listMcpJobs(["waiting", "active", "delayed", "completed", "failed"], 12),
    db.inboxMessage.count({ where: { status: "FAILED" } }),
    db.post.count({ where: { status: "FAILED" } }),
    db.postApproval.count({ where: { status: "PENDING" } }),
    db.builderProject.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    }),
  ]);

  const latestBuilderContract = latestBuilderProject
    ? await getBuilderMcpSnapshotOverview({ projectId: latestBuilderProject.id })
    : null;

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
    mcpWorker,
    mcpJobs,
    runs: listRecentAgentRuns(15),
    mcp: {
      connectedClients: getMcpClientStatus(),
    },
    contract: {
      version: BIZBOT_PLATFORM_CONTRACT_VERSION,
      latestBuilderProject,
      builderSurface: latestBuilderContract ? {
        state: latestBuilderContract.state,
        currentHash: latestBuilderContract.currentHash,
        driftDetected: Boolean(latestBuilderContract.drift ?? latestBuilderContract.planning?.drift),
        classification: latestBuilderContract.drift?.impact.classification ?? latestBuilderContract.planning?.drift?.impact.classification ?? "internal_only",
        requiresVersionBump: latestBuilderContract.drift?.impact.requiresVersionBump ?? latestBuilderContract.planning?.drift?.impact.requiresVersionBump ?? false,
      } : null,
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