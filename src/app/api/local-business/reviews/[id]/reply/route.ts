import { NextRequest } from "next/server";
import { replyToGoogleBusinessReview } from "@/lib/google-business/service";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    if (!isRecord(body) || typeof body.comment !== "string") {
      return Response.json({ error: "Review reply payload requires a comment." }, { status: 400 });
    }

    const review = await replyToGoogleBusinessReview(id, body.comment);
    return Response.json({ review });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}