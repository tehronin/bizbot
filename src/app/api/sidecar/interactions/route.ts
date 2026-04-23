import { NextRequest } from "next/server";
import {
  getActiveSidecarContextForConversation,
  getActiveSidecarContextRevisionForConversation,
  getActiveSidecarStackForConversation,
  getActiveSidecarStackRevisionForConversation,
  SidecarContextConflictError,
} from "@/lib/sidecar/state";
import { routeSidecarInteraction } from "@/lib/sidecar/router";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      panelId?: unknown;
      actionId?: unknown;
      selectedItemIds?: unknown;
      conversationId?: unknown;
      userId?: unknown;
      expectedStackRevision?: unknown;
      expectedContextRevision?: unknown;
      contextPatch?: unknown;
    };

    const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
    const expectedStackRevision = body.expectedStackRevision;
    if (expectedStackRevision !== undefined && (typeof expectedStackRevision !== "number" || !Number.isInteger(expectedStackRevision) || expectedStackRevision < 0)) {
      throw new Error("Sidecar expected stack revision must be a non-negative integer.");
    }
    const expectedContextRevision = body.expectedContextRevision;
    if (expectedContextRevision !== undefined && (typeof expectedContextRevision !== "number" || !Number.isInteger(expectedContextRevision) || expectedContextRevision < 0)) {
      throw new Error("Sidecar expected context revision must be a non-negative integer.");
    }

    const currentStackRevision = getActiveSidecarStackRevisionForConversation(conversationId);
    if (typeof expectedStackRevision === "number" && expectedStackRevision !== currentStackRevision) {
      return Response.json({
        error: "Sidecar state changed while you were interacting. Review the latest panel stack and retry.",
        panel: getActiveSidecarStackForConversation(conversationId).panels.at(-1) ?? null,
        stack: getActiveSidecarStackForConversation(conversationId),
        context: getActiveSidecarContextForConversation(conversationId),
      }, { status: 409 });
    }

    const currentContextRevision = getActiveSidecarContextRevisionForConversation(conversationId);
    if (typeof expectedContextRevision === "number" && expectedContextRevision !== currentContextRevision) {
      return Response.json({
        error: "Sidecar context changed while you were interacting. Review the latest context and retry.",
        panel: getActiveSidecarStackForConversation(conversationId).panels.at(-1) ?? null,
        stack: getActiveSidecarStackForConversation(conversationId),
        context: getActiveSidecarContextForConversation(conversationId),
      }, { status: 409 });
    }

    try {
      const result = await routeSidecarInteraction({
        panelId: typeof body.panelId === "string" ? body.panelId : "",
        actionId: typeof body.actionId === "string" ? body.actionId : "",
        selectedItemIds: Array.isArray(body.selectedItemIds)
          ? body.selectedItemIds.filter((value): value is string => typeof value === "string")
          : [],
        conversationId,
        ...(typeof expectedStackRevision === "number" ? { expectedStackRevision } : {}),
        ...(typeof expectedContextRevision === "number" ? { expectedContextRevision } : {}),
        ...(body.contextPatch && typeof body.contextPatch === "object" && !Array.isArray(body.contextPatch) ? { contextPatch: body.contextPatch as never } : {}),
        ...(typeof body.userId === "string" ? { userId: body.userId } : {}),
      });

      return Response.json(result);
    } catch (error) {
      if (error instanceof SidecarContextConflictError) {
        return Response.json({
          error: error.message,
          panel: getActiveSidecarStackForConversation(conversationId).panels.at(-1) ?? null,
          stack: getActiveSidecarStackForConversation(conversationId),
          context: getActiveSidecarContextForConversation(conversationId),
        }, { status: 409 });
      }

      throw error;
    }
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 });
  }
}