import { NextRequest } from "next/server";
import { resolveChatBootstrap } from "@/lib/chat/conversations";

export async function GET(req: NextRequest) {
  const selectedConversationId = req.nextUrl.searchParams.get("selectedId");
  const userId = req.nextUrl.searchParams.get("userId") ?? undefined;

  const result = await resolveChatBootstrap({
    userId,
    selectedConversationId,
  });

  return Response.json(result);
}