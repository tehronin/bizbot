import { NextRequest } from "next/server";
import { getAgenticSetupPayload, updateAgenticSetup, type AgenticSetupSession } from "@/lib/agentic-setup";

export async function GET() {
  try {
    const payload = await getAgenticSetupPayload();
    return Response.json(payload);
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      session?: Partial<AgenticSetupSession>;
      env?: Record<string, string>;
      action?: "pause" | "resume" | "complete" | "reset";
    };

    const payload = await updateAgenticSetup(body);
    return Response.json(payload);
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}