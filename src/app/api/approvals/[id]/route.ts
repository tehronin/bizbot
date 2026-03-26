/**
 * PATCH /api/approvals/[id]  – approve or reject a pending post
 * Body: { decision: "approve" | "reject", notes?: string }
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApprovalStatus, PostStatus } from "@prisma/client";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { decision, notes } = (await req.json()) as {
      decision: "approve" | "reject";
      notes?: string;
    };

    const approvalStatus =
      decision === "approve" ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;
    const postStatus =
      decision === "approve" ? PostStatus.APPROVED : PostStatus.REJECTED;

    const approval = await db.postApproval.update({
      where: { id },
      data: { status: approvalStatus, notes: notes ?? null, decidedAt: new Date() },
    });
    await db.post.update({
      where: { id: approval.postId },
      data: { status: postStatus },
    });

    return Response.json({ updated: true, approvalId: id, decision });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
