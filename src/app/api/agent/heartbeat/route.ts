import { enqueueAgentHeartbeat, getAgentWorkerStatus } from "@/lib/agent/heartbeat-queue";

export async function POST() {
  try {
    const job = await enqueueAgentHeartbeat("manual");
    return Response.json({ ok: true, jobId: job.id });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const status = await getAgentWorkerStatus();
    return Response.json({ ok: true, status });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) }, { status: 500 });
  }
}