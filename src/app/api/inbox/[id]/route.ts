import { NextRequest } from "next/server";
import {
  approveInboxReply,
  dismissInboxMessage,
  draftInboxReply,
  resendDraftedInboxReply,
} from "@/lib/agent/heartbeat";

interface InboxActionRequest {
  action?: "approve" | "dismiss" | "draft" | "resend";
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const body = (await req.json()) as InboxActionRequest;
    switch (body.action) {
      case "approve": {
        const item = await approveInboxReply(id);
        return Response.json({ ok: true, item });
      }
      case "dismiss": {
        const item = await dismissInboxMessage(id);
        return Response.json({ ok: true, item });
      }
      case "draft": {
        const item = await draftInboxReply(id);
        return Response.json({ ok: true, item });
      }
      case "resend": {
        const item = await resendDraftedInboxReply(id);
        return Response.json({ ok: true, item });
      }
      default:
        return Response.json({ ok: false, error: "Unsupported inbox action" }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ ok: false, error: String(error) }, { status: 500 });
  }
}