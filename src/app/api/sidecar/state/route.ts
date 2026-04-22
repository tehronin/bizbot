import { NextRequest } from "next/server";
import {
  activateSidecarPanelForConversation,
  closeActiveSidecarPanelForConversation,
  getActiveSidecarStackForConversation,
  popActiveSidecarPanelForConversation,
} from "@/lib/sidecar/state";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      conversationId?: unknown;
      operation?: unknown;
      panelId?: unknown;
    };

    const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
    if (!conversationId) {
      throw new Error("Sidecar conversation id is required.");
    }

    const operation = typeof body.operation === "string" ? body.operation : "close";

    if (operation === "back") {
      const stack = popActiveSidecarPanelForConversation(conversationId);
      const panel = stack.panels[stack.panels.length - 1] ?? null;
      return Response.json({
        ok: true,
        action: panel ? "update" : "close",
        panel,
        stack,
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
      });
    }

    closeActiveSidecarPanelForConversation(conversationId);
    return Response.json({ ok: true, action: "close", panel: null, stack: getActiveSidecarStackForConversation(conversationId) });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 });
  }
}