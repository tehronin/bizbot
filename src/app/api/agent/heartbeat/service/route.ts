import { db } from "@/lib/db";
import { getHeartbeatServiceState, startHeartbeatService } from "@/lib/agent/heartbeat";

export async function GET() {
  const state = getHeartbeatServiceState();
  const startedAt = await db.setting.findUnique({
    where: { key: "agent_heartbeat_service_started_at" },
    select: { value: true },
  });

  return Response.json({
    ok: true,
    service: {
      running: state.running,
      heartbeatSeconds: state.heartbeatSeconds,
      startedAt: startedAt?.value ?? null,
    },
  });
}

export async function POST() {
  try {
    const service = await startHeartbeatService();
    return Response.json({ ok: true, service });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) }, { status: 500 });
  }
}