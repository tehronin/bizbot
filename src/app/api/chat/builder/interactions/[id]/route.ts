import { NextRequest } from "next/server";
import { resolveBuilderInteraction } from "@/lib/builder/interactions";

function parseBody(value: unknown): {
  action: "approve" | "reject" | "reconcile";
  conversationId?: string | null;
  reason?: string | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Builder interaction payload.");
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.action !== "approve" && candidate.action !== "reject" && candidate.action !== "reconcile") {
    throw new Error("Builder interaction payload requires action=approve|reject|reconcile.");
  }

  return {
    action: candidate.action,
    conversationId: typeof candidate.conversationId === "string" ? candidate.conversationId : null,
    reason: typeof candidate.reason === "string" ? candidate.reason : null,
  };
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const payload = parseBody(await req.json());
    const result = await resolveBuilderInteraction({
      interactionId: id,
      action: payload.action,
      conversationId: payload.conversationId,
      reason: payload.reason,
    });

    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
