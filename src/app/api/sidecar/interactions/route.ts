import { NextRequest } from "next/server";
import { routeSidecarInteraction } from "@/lib/sidecar/router";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      panelId?: unknown;
      actionId?: unknown;
      selectedItemIds?: unknown;
      conversationId?: unknown;
      userId?: unknown;
    };

    const result = await routeSidecarInteraction({
      panelId: typeof body.panelId === "string" ? body.panelId : "",
      actionId: typeof body.actionId === "string" ? body.actionId : "",
      selectedItemIds: Array.isArray(body.selectedItemIds)
        ? body.selectedItemIds.filter((value): value is string => typeof value === "string")
        : [],
      conversationId: typeof body.conversationId === "string" ? body.conversationId : "",
      ...(typeof body.userId === "string" ? { userId: body.userId } : {}),
    });

    return Response.json(result);
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 });
  }
}