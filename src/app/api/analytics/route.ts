/**
 * GET /api/analytics  – aggregate analytics across platforms
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const platformId = req.nextUrl.searchParams.get("platformId") ?? undefined;
  const snapshots = await db.analyticsSnapshot.findMany({
    where: platformId ? { platformId } : undefined,
    include: { platform: true },
    orderBy: { capturedAt: "desc" },
    take: 90,
  });
  return Response.json({ snapshots });
}
