import { NextRequest } from "next/server";
import {
  forgetMemoryFact,
  getActiveMemoryFacts,
  setMemoryFact,
} from "@/lib/agent/memory/service";
import { resolveAgentUserId } from "@/lib/agent/user-context";

function listValues(searchParams: URLSearchParams, key: string): string[] | undefined {
  const values = searchParams.getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  return values.length > 0 ? values : undefined;
}

export async function GET(req: NextRequest) {
  const userId = resolveAgentUserId(req.nextUrl.searchParams.get("userId"));
  const categories = listValues(req.nextUrl.searchParams, "category");
  const keys = listValues(req.nextUrl.searchParams, "key");

  const facts = await getActiveMemoryFacts({
    userId,
    categories: categories as never,
    keys,
  });

  return Response.json({ userId, facts });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      userId?: string;
      category?: string;
      key?: string;
      value?: unknown;
      source?: string;
    };

    if (typeof body.category !== "string" || typeof body.key !== "string" || body.value === undefined) {
      return Response.json({ error: "category, key, and value are required." }, { status: 400 });
    }

    const fact = await setMemoryFact({
      userId: resolveAgentUserId(body.userId),
      category: body.category as never,
      key: body.key,
      value: body.value as never,
      source: body.source as never,
    });

    return Response.json({ fact });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      userId?: string;
      key?: string;
    };

    if (typeof body.key !== "string" || body.key.trim().length === 0) {
      return Response.json({ error: "key is required." }, { status: 400 });
    }

    const forgotten = await forgetMemoryFact({
      userId: resolveAgentUserId(body.userId),
      key: body.key,
    });

    return Response.json({ forgotten });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 });
  }
}