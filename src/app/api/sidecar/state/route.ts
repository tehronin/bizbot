import { NextRequest } from "next/server";
import {
  activateSidecarPanelForConversation,
  closeActiveSidecarPanelForConversation,
  getActiveSidecarContextForConversation,
  getActiveSidecarPanelForConversation,
  getActiveSidecarStackForConversation,
  getActiveSidecarStackRevisionForConversation,
  popActiveSidecarPanelForConversation,
} from "@/lib/sidecar/state";

export async function GET(request: NextRequest) {
  try {
    const conversationId = request.nextUrl.searchParams.get("conversationId")?.trim() ?? "";
    if (!conversationId) {
      throw new Error("Sidecar conversation id is required.");
    }

    return Response.json({
      conversationId,
      activePanel: getActiveSidecarPanelForConversation(conversationId)?.panel ?? null,
      stack: getActiveSidecarStackForConversation(conversationId),
      context: getActiveSidecarContextForConversation(conversationId),
    }, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      conversationId?: unknown;
      operation?: unknown;
      panelId?: unknown;
      expectedStackRevision?: unknown;
    };

    const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
    if (!conversationId) {
      throw new Error("Sidecar conversation id is required.");
    }

    const operation = typeof body.operation === "string" ? body.operation : "close";
    const expectedStackRevision = body.expectedStackRevision;
    if (expectedStackRevision !== undefined && (typeof expectedStackRevision !== "number" || !Number.isInteger(expectedStackRevision) || expectedStackRevision < 0)) {
      throw new Error("Sidecar expected stack revision must be a non-negative integer.");
    }

    const currentStackRevision = getActiveSidecarStackRevisionForConversation(conversationId);
    if (typeof expectedStackRevision === "number" && expectedStackRevision !== currentStackRevision) {
      const stack = getActiveSidecarStackForConversation(conversationId);
      const panel = stack.panels[stack.panels.length - 1] ?? null;
      return Response.json({
        error: "Sidecar state changed while you were navigating. Review the latest panel stack and retry.",
        panel,
        stack,
        context: getActiveSidecarContextForConversation(conversationId),
      }, { status: 409 });
    }

    if (operation === "back") {
      const stack = popActiveSidecarPanelForConversation(conversationId);
      const panel = stack.panels[stack.panels.length - 1] ?? null;
      return Response.json({
        ok: true,
        action: panel ? "update" : "close",
        panel,
        stack,
        context: getActiveSidecarContextForConversation(conversationId),
      });
    }

    if (operation === "activate") {
      const panelId = typeof body.panelId === "string" ? body.panelId.trim() : "";
      if (!panelId) {
        throw new Error("Sidecar panel id is required for activate.");
      }

      const stack = activateSidecarPanelForConversation(conversationId, panelId);
      const panel = stack.panels[stack.panels.length - 1] ?? null;
      return Response.json({
        ok: true,
        action: panel ? "update" : "close",
        panel,
        stack,
        context: getActiveSidecarContextForConversation(conversationId),
      });
    }

    closeActiveSidecarPanelForConversation(conversationId);
    return Response.json({ ok: true, action: "close", panel: null, stack: getActiveSidecarStackForConversation(conversationId), context: getActiveSidecarContextForConversation(conversationId) });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 });
  }
}