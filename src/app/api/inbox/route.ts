import { NextRequest } from "next/server";
import { InboxStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { upsertInboxItem } from "@/lib/social/inbox";

export async function GET(req: NextRequest) {
  const statusParam = req.nextUrl.searchParams.get("status");
  const items = await db.inboxMessage.findMany({
    where: statusParam ? { status: statusParam as InboxStatus } : undefined,
    include: { platform: true },
    orderBy: { receivedAt: "desc" },
    take: 100,
  });
  return Response.json({ items });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      platform: "twitter" | "facebook" | "instagram";
      channelType: "DIRECT_MESSAGE" | "SOCIAL_MENTION";
      externalId: string;
      threadId?: string;
      authorName?: string;
      authorHandle?: string;
      content: string;
      receivedAt?: string;
    };

    const item = await upsertInboxItem({
      platform: body.platform,
      channelType: body.channelType,
      externalId: body.externalId,
      threadId: body.threadId,
      authorName: body.authorName,
      authorHandle: body.authorHandle,
      content: body.content,
      receivedAt: body.receivedAt ? new Date(body.receivedAt) : new Date(),
    });

    return Response.json({ item }, { status: 201 });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}