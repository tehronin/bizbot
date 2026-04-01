import { NextRequest } from "next/server";
import {
  deleteArchivedConversation,
  getConversationDetail,
} from "@/lib/chat/conversations";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const userId = req.nextUrl.searchParams.get("userId") ?? undefined;
  const conversation = await getConversationDetail(id, userId);

  if (!conversation) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }

  return Response.json({ conversation });
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const userId = req.nextUrl.searchParams.get("userId") ?? undefined;

    await deleteArchivedConversation(id, userId);
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 });
  }
}