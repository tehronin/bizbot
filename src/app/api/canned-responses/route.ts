import { NextRequest } from "next/server";
import { ensureDefaultCannedResponseTree, listCannedResponseTrees } from "@/lib/inbox/canned-responses";

export async function GET() {
  const trees = await listCannedResponseTrees();
  return Response.json({ trees });
}

export async function POST(_req: NextRequest) {
  const tree = await ensureDefaultCannedResponseTree();
  return Response.json({ tree }, { status: 201 });
}