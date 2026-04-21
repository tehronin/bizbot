import { NextRequest } from "next/server";
import { resolveChatBootstrap } from "@/lib/chat/conversations";
import { DEFAULT_CHAT_HISTORY_PAGE_SIZE } from "@/lib/chat/types";

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(req: NextRequest) {
  try {
    const selectedConversationId = req.nextUrl.searchParams.get("selectedId");
    const selectedBuilderProjectId = req.nextUrl.searchParams.get("selectedBuilderProjectId");
    const selectedCreeperCompanyProfileId = req.nextUrl.searchParams.get("selectedCreeperCompanyProfileId");
    const userId = req.nextUrl.searchParams.get("userId") ?? undefined;
    const recentPage = parsePositiveInt(req.nextUrl.searchParams.get("recentPage"), 1);
    const archivedPage = parsePositiveInt(req.nextUrl.searchParams.get("archivedPage"), 1);
    const pageSize = parsePositiveInt(req.nextUrl.searchParams.get("historyPageSize"), DEFAULT_CHAT_HISTORY_PAGE_SIZE);
    const historySearch = req.nextUrl.searchParams.get("historySearch") ?? "";
    const historyFrom = req.nextUrl.searchParams.get("historyFrom");
    const historyTo = req.nextUrl.searchParams.get("historyTo");

    const result = await resolveChatBootstrap({
      userId,
      selectedConversationId,
      selectedBuilderProjectId,
      ...(selectedCreeperCompanyProfileId ? { selectedCreeperCompanyProfileId } : {}),
      recentPage,
      archivedPage,
      pageSize,
      historyFilters: {
        search: historySearch,
        from: historyFrom,
        to: historyTo,
      },
    });

    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}