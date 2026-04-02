import { NextRequest } from "next/server";
import { getBuilderStats } from "@/lib/builder/analytics";

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
    const stats = await getBuilderStats(projectId);
    return Response.json(stats);
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}