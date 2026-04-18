import { publishBuilderTaskCompletionToConversation } from "@/lib/builder/interactions";

function parseBody(value: unknown): { conversationId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Builder task completion payload.");
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.conversationId !== "string" || !candidate.conversationId.trim()) {
    throw new Error("Builder task completion payload requires conversationId.");
  }

  return {
    conversationId: candidate.conversationId.trim(),
  };
}

export async function POST(
  req: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<Response> {
  try {
    const { taskId } = await context.params;
    const payload = parseBody(await req.json());
    const result = await publishBuilderTaskCompletionToConversation({
      taskId,
      conversationId: payload.conversationId,
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}