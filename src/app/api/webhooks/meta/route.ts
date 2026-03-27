import { NextRequest } from "next/server";
import { ingestMetaWebhook } from "@/lib/social/meta-webhooks";

function isRecord(value: object | null): value is Record<string, object | string | number | boolean | null | Array<object | string | number | boolean | null>> {
  return value !== null && !Array.isArray(value);
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const verifyToken = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  if (
    mode === "subscribe"
    && verifyToken
    && verifyToken === (process.env.META_WEBHOOK_VERIFY_TOKEN ?? "")
    && challenge
  ) {
    return new Response(challenge, { status: 200 });
  }

  return Response.json({ error: "Webhook verification failed." }, { status: 403 });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!isRecord(body)) {
      return Response.json({ error: "Invalid webhook payload." }, { status: 400 });
    }

    const result = await ingestMetaWebhook(body);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("[meta webhook]", error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
}