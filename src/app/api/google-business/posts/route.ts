import { NextRequest } from "next/server";
import { createGoogleBusinessPost } from "@/lib/google-business/service";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!isRecord(body) || typeof body.summary !== "string") {
      return Response.json({ error: "Google post payload requires a summary." }, { status: 400 });
    }

    const post = await createGoogleBusinessPost({
      summary: body.summary,
      ...(typeof body.topicType === "string" ? { topicType: body.topicType } : {}),
      ...(typeof body.actionType === "string" ? { actionType: body.actionType } : {}),
      ...(typeof body.callToActionUrl === "string" ? { callToActionUrl: body.callToActionUrl } : {}),
      ...(isRecord(body.eventData) ? { eventData: body.eventData } : {}),
      ...(isRecord(body.offerData) ? { offerData: body.offerData } : {}),
    });

    return Response.json({ post }, { status: 201 });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}