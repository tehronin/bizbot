import { NextRequest } from "next/server";
import { clearAgentHeartbeatJobHistory } from "@/lib/agent/heartbeat-queue";
import { clearAgentRuns } from "@/lib/agent/run-journal";
import { ApiRouteError, apiErrorResponse } from "@/lib/api/errors";
import { clearMcpJobHistory } from "@/lib/mcp/job-status";

type OperationsHistoryTarget = "runs" | "jobs" | "mcpJobs" | "all";

function parseClearHistoryBody(value: unknown): { target: OperationsHistoryTarget } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiRouteError(400, "invalid_operations_history_payload", "Invalid operations history payload.");
  }

  const body = value as { target?: unknown };
  if (body.target !== "runs" && body.target !== "jobs" && body.target !== "mcpJobs" && body.target !== "all") {
    throw new ApiRouteError(400, "invalid_operations_history_target", "target must be runs, jobs, mcpJobs, or all.");
  }

  return { target: body.target };
}

export async function POST(req: NextRequest) {
  try {
    const { target } = parseClearHistoryBody(await req.json());

    const clearRuns = target === "runs" || target === "all"
      ? clearAgentRuns()
      : { deletedRunIds: [] as string[], deletedCount: 0 };
    const clearJobs = target === "jobs" || target === "all"
      ? await clearAgentHeartbeatJobHistory()
      : { deletedCount: 0, statuses: ["completed", "failed"] as const };
    const clearMcpJobs = target === "mcpJobs" || target === "all"
      ? await clearMcpJobHistory()
      : {
        deletedCount: 0,
        queueNames: [] as string[],
        statuses: ["completed", "failed"] as const,
      };

    return Response.json({
      cleared: true,
      target,
      runs: clearRuns,
      jobs: clearJobs,
      mcpJobs: clearMcpJobs,
    });
  } catch (error) {
    return apiErrorResponse(error, "[api/operations/history] POST failed");
  }
}