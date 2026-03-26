import { runAgentHeartbeat } from "@/lib/agent/heartbeat";

export async function POST() {
  try {
    const summary = await runAgentHeartbeat();
    return Response.json({ ok: true, summary });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}