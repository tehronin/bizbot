import { NextRequest } from "next/server";
import { updateConversationCompanyProfile } from "@/lib/agent/memory";

function parseBody(value: unknown): { companyProfileId: string | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid conversation company payload.");
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.companyProfileId === null) {
    return { companyProfileId: null };
  }
  if (typeof candidate.companyProfileId !== "string" || !candidate.companyProfileId.trim()) {
    throw new Error("Conversation company payload requires companyProfileId or null.");
  }

  return {
    companyProfileId: candidate.companyProfileId.trim(),
  };
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const payload = parseBody(await req.json());
    await updateConversationCompanyProfile(id, payload.companyProfileId);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}