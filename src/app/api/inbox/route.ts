import { NextRequest } from "next/server";
import { InboxChannelType, InboxStatus, PlatformType } from "@prisma/client";
import { db } from "@/lib/db";

function parsePlatformType(platform: string): PlatformType {
  switch (platform) {
    case "twitter":
      return PlatformType.TWITTER;
    case "facebook":
      return PlatformType.FACEBOOK;
    case "instagram":
      return PlatformType.INSTAGRAM;
    default:
      throw new Error("Unsupported platform");
  }
}

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

    const platformType = parsePlatformType(body.platform);
    const platform = await db.platform.upsert({
      where: { id: body.platform },
      update: { type: platformType, displayName: body.platform },
      create: { id: body.platform, type: platformType, displayName: body.platform, connected: false },
    });

    const item = await db.inboxMessage.upsert({
      where: {
        platformId_externalId: {
          platformId: platform.id,
          externalId: body.externalId,
        },
      },
      update: {
        channelType: body.channelType === "DIRECT_MESSAGE" ? InboxChannelType.DIRECT_MESSAGE : InboxChannelType.SOCIAL_MENTION,
        threadId: body.threadId ?? body.externalId,
        authorName: body.authorName ?? null,
        authorHandle: body.authorHandle ?? null,
        content: body.content,
        receivedAt: body.receivedAt ? new Date(body.receivedAt) : new Date(),
        status: InboxStatus.OPEN,
      },
      create: {
        platformId: platform.id,
        channelType: body.channelType === "DIRECT_MESSAGE" ? InboxChannelType.DIRECT_MESSAGE : InboxChannelType.SOCIAL_MENTION,
        externalId: body.externalId,
        threadId: body.threadId ?? body.externalId,
        authorName: body.authorName ?? null,
        authorHandle: body.authorHandle ?? null,
        content: body.content,
        receivedAt: body.receivedAt ? new Date(body.receivedAt) : new Date(),
      },
    });

    return Response.json({ item }, { status: 201 });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}