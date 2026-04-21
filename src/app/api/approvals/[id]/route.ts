/**
 * PATCH /api/approvals/[id]  – approve or reject a pending post
 * Body: { decision: "approve" | "reject", notes?: string }
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApprovalStatus, PostStatus } from "@prisma/client";
import { ApiRouteError, apiErrorResponse } from "@/lib/api/errors";

function parseApprovalDecisionBody(value: unknown): {
  decision: "approve" | "reject";
  notes?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiRouteError(400, "invalid_approval_payload", "Invalid approval payload.");
  }

  const body = value as {
    decision?: unknown;
    notes?: unknown;
  };

  if (body.decision !== "approve" && body.decision !== "reject") {
    throw new ApiRouteError(400, "invalid_approval_decision", "decision must be approve or reject.");
  }

  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new ApiRouteError(400, "invalid_approval_notes", "notes must be a string when provided.");
  }

  return {
    decision: body.decision,
    notes: body.notes,
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { decision, notes } = parseApprovalDecisionBody(await req.json());

    const approvalStatus =
      decision === "approve" ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;
    const postStatus =
      decision === "approve" ? PostStatus.APPROVED : PostStatus.REJECTED;

    const approval = await db.$transaction(async (tx) => {
      const existingApproval = await tx.postApproval.findUnique({
        where: { id },
        select: { id: true, postId: true, status: true },
      });

      if (!existingApproval) {
        throw new ApiRouteError(404, "approval_not_found", "Approval not found.");
      }

      if (existingApproval.status !== ApprovalStatus.PENDING) {
        throw new ApiRouteError(409, "approval_not_pending", "Only pending approvals can be decided.");
      }

      const updatedApproval = await tx.postApproval.update({
        where: { id },
        data: { status: approvalStatus, notes: notes ?? null, decidedAt: new Date() },
      });
      await tx.post.update({
        where: { id: existingApproval.postId },
        data: { status: postStatus },
      });

      return updatedApproval;
    });

    return Response.json({ updated: true, approvalId: id, decision });
  } catch (err) {
    return apiErrorResponse(err, "[api/approvals/[id]] PATCH failed");
  }
}
