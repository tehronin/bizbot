/**
 * GET    /api/approvals          – list pending approvals
 */

import { db } from "@/lib/db";
import { ApprovalStatus } from "@prisma/client";

export async function GET() {
  const approvals = await db.postApproval.findMany({
    where: { status: ApprovalStatus.PENDING },
    include: { post: { include: { platform: true } } },
    orderBy: { createdAt: "asc" },
  });
  return Response.json({ approvals });
}
