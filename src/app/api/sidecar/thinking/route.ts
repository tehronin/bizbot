import { NextRequest } from "next/server";
import { getThinkingSnapshotForConversation } from "@/lib/sidecar/thinking-state";

export async function GET(request: NextRequest) {
  try {
    const conversationId = request.nextUrl.searchParams.get("conversationId")?.trim() ?? "";
    if (!conversationId) {
      throw new Error("Sidecar conversation id is required.");
    }

    return Response.json({
      conversationId,
      snapshot: getThinkingSnapshotForConversation(conversationId),
    }, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 });
  }
}