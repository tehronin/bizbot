import { NextRequest } from "next/server";
import { TwitterClient } from "@/lib/social/twitter";
import { FacebookClient, InstagramClient } from "@/lib/social/meta";
import type { SocialClient } from "@/lib/social/types";

type PlatformName = "twitter" | "facebook" | "instagram";

function getClient(platform: PlatformName): SocialClient {
  switch (platform) {
    case "twitter":
      return new TwitterClient();
    case "facebook":
      return new FacebookClient();
    case "instagram":
      return new InstagramClient();
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  try {
    const { platform } = await params;
    if (platform !== "twitter" && platform !== "facebook" && platform !== "instagram") {
      return Response.json({ error: "Unsupported platform" }, { status: 400 });
    }
    const client = getClient(platform);
    const action = req.nextUrl.searchParams.get("action") ?? "mentions";

    if (action === "analytics") {
      const postId = req.nextUrl.searchParams.get("postId");
      if (!postId) {
        return Response.json({ error: "postId is required" }, { status: 400 });
      }
      const analytics = await client.getAnalytics(postId);
      return Response.json({ analytics });
    }

    const limit = Number(req.nextUrl.searchParams.get("limit") ?? "20");
    const mentions = await client.getMentions(limit);
    return Response.json({ mentions });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  try {
    const { platform } = await params;
    if (platform !== "twitter" && platform !== "facebook" && platform !== "instagram") {
      return Response.json({ error: "Unsupported platform" }, { status: 400 });
    }
    const client = getClient(platform);
    const body = (await req.json()) as {
      action: "post" | "reply";
      content: string;
      mediaUrls?: string[];
      postId?: string;
    };

    if (body.action === "reply") {
      if (!body.postId) {
        return Response.json({ error: "postId is required for reply" }, { status: 400 });
      }
      const reply = await client.reply(body.postId, body.content);
      return Response.json({ reply }, { status: 201 });
    }

    const post = await client.post({ content: body.content, mediaUrls: body.mediaUrls });
    return Response.json({ post }, { status: 201 });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
