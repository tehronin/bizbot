import { NextRequest } from "next/server";
import { syncCrmContact } from "@/lib/crm";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await req.json().catch(() => ({}))) as { provider?: string };
    const sync = await syncCrmContact(id, body.provider as never);
    return Response.json({ sync });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}