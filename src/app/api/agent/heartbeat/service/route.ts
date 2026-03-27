import { db } from "@/lib/db";
import { ensureAgentHeartbeatScheduler, getAgentWorkerStatus } from "@/lib/agent/heartbeat-queue";

export async function GET() {
  const [status, startedAt] = await Promise.all([
    getAgentWorkerStatus(),
    db.setting.findUnique({
      where: { key: "agent_worker_started_at" },
      select: { value: true },
    }),
  ]);

  return Response.json({
    ok: true,
    service: {
      running: status.workerRunning,
      heartbeatSeconds: status.schedulerEveryMs ? Math.trunc(status.schedulerEveryMs / 1000) : null,
      startedAt: startedAt?.value ?? null,
      schedulerRegistered: status.schedulerRegistered,
      queueName: status.queueName,
      counts: status.counts,
    },
  });
}

export async function POST() {
  try {
    const service = await ensureAgentHeartbeatScheduler();
    return Response.json({ ok: true, service });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) }, { status: 500 });
  }
}