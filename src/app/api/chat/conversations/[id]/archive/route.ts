import { NextRequest } from "next/server";
import { archiveConversation } from "@/lib/chat/conversations";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const userId = req.nextUrl.searchParams.get("userId") ?? undefined;
    const conversation = await archiveConversation(id, userId);

    return Response.json({ conversation });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 });
  }
}