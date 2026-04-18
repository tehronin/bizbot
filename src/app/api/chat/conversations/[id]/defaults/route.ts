import { NextRequest } from "next/server";
import { updateConversationExecutionDefaults } from "@/lib/agent/memory";

function parseBody(value: unknown): { mode: "ask" | "agent"; pluginId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid conversation defaults payload.");
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.mode !== "ask" && candidate.mode !== "agent") {
    throw new Error("Conversation defaults payload requires mode=ask|agent.");
  }
  if (typeof candidate.pluginId !== "string" || !candidate.pluginId.trim()) {
    throw new Error("Conversation defaults payload requires pluginId.");
  }

  return {
    mode: candidate.mode,
    pluginId: candidate.pluginId.trim(),
  };
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const payload = parseBody(await req.json());
    await updateConversationExecutionDefaults(id, payload);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}