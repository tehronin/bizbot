/**
 * GET  /api/posts        – list posts (filterable by status)
 * POST /api/posts        – create a draft post
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { PostStatus } from "@prisma/client";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") as PostStatus | null;
  const posts = await db.post.findMany({
    where: status ? { status } : undefined,
    include: { platform: true, approval: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return Response.json({ posts });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      platformId: string;
      content: string;
      scheduledAt?: string;
      mediaUrls?: string[];
    };
    const post = await db.post.create({
      data: {
        platformId: body.platformId,
        authorId: "local-user",
        content: body.content,
        status: PostStatus.DRAFT,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
        mediaUrls: body.mediaUrls ?? [],
      },
    });
    return Response.json({ post }, { status: 201 });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
