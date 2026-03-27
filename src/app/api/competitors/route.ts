import { NextRequest } from "next/server";
import { createCompetitorWatch, listCompetitorWatches } from "@/lib/competitors/monitor";

type CompetitorWatchRequest = {
  name: string;
  url: string;
  platformHint?: "twitter" | "facebook" | "instagram";
  extractSelector?: string;
  notes?: string;
  checkEveryMinutes?: number;
};

function parseCompetitorWatchRequest(value: object | null): CompetitorWatchRequest {
  if (!value || Array.isArray(value)) {
    throw new Error("Invalid competitor watch payload.");
  }

  const candidate = value as Record<string, string | number | boolean | null | undefined>;
  if (typeof candidate.name !== "string" || typeof candidate.url !== "string") {
    throw new Error("Competitor watch requires string name and url fields.");
  }

  if (
    candidate.platformHint !== undefined
    && candidate.platformHint !== "twitter"
    && candidate.platformHint !== "facebook"
    && candidate.platformHint !== "instagram"
  ) {
    throw new Error("Invalid competitor watch platform hint.");
  }

  return {
    name: candidate.name,
    url: candidate.url,
    platformHint: candidate.platformHint,
    extractSelector: typeof candidate.extractSelector === "string" ? candidate.extractSelector : undefined,
    notes: typeof candidate.notes === "string" ? candidate.notes : undefined,
    checkEveryMinutes:
      typeof candidate.checkEveryMinutes === "number" ? candidate.checkEveryMinutes : undefined,
  };
}

export async function GET(req: NextRequest) {
  const active = req.nextUrl.searchParams.get("active");
  const watches = await listCompetitorWatches(
    active === null ? undefined : active === "true",
  );
  return Response.json({ watches });
}

export async function POST(req: NextRequest) {
  try {
    const body = parseCompetitorWatchRequest(await req.json());
    const watch = await createCompetitorWatch(body);
    return Response.json({ watch }, { status: 201 });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}