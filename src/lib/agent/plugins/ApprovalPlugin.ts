/** ApprovalPlugin — Submit posts for review and decide on approvals. */

import { db } from "@/lib/db";
import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";

interface ApprovalSubmitArgs {
  postId: string;
  notes?: string;
}

type ApprovalPendingArgs = Record<string, never>;

interface ApprovalDecideArgs {
  approvalId: string;
  decision: "approve" | "reject";
  notes?: string;
}

export const approvalPlugin = {
  tools: [
    registerTool(defineTool({
      name: "approval_submit",
      description: "Submit a post for human approval before publishing.",
      parameters: {
        type: "object",
        properties: {
          postId: { type: "string" },
          notes: { type: "string" },
        },
        required: ["postId"],
      },
      execute: async ({ postId, notes }: ApprovalSubmitArgs) => {
        const approval = await db.postApproval.create({
          data: {
            postId,
            status: "PENDING",
            notes: notes ?? null,
          },
        });
        await db.post.update({
          where: { id: postId },
          data: { status: "PENDING_APPROVAL" },
        });
        return { submitted: true, approvalId: approval.id };
      },
    } satisfies ToolDefinition<ApprovalSubmitArgs, { submitted: boolean; approvalId: string }>)),
    registerTool(defineTool({
      name: "approval_get_pending",
      description: "Get all posts waiting for approval.",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        const approvals = await db.postApproval.findMany({
          where: { status: "PENDING" },
          include: { post: { include: { platform: true } } },
          orderBy: { createdAt: "asc" },
        });
        return {
          pendingApprovals: approvals.map((approval: { id: string; postId: string; status: string; notes: string | null; createdAt: Date }) => ({
            id: approval.id,
            postId: approval.postId,
            status: approval.status,
            notes: approval.notes,
            createdAt: approval.createdAt.toISOString(),
          })),
        };
      },
    } satisfies ToolDefinition<ApprovalPendingArgs, { pendingApprovals: Array<{ id: string; postId: string; status: string; notes: string | null; createdAt: string }> }>)),
    registerTool(defineTool({
      name: "approval_decide",
      description: "Approve or reject a pending post.",
      parameters: {
        type: "object",
        properties: {
          approvalId: { type: "string" },
          decision: { type: "string", enum: ["approve", "reject"] },
          notes: { type: "string" },
        },
        required: ["approvalId", "decision"],
      },
      execute: async ({ approvalId, decision, notes }: ApprovalDecideArgs) => {
        const status =
          decision === "approve" ? "APPROVED" : "REJECTED";
        const approval = await db.postApproval.update({
          where: { id: approvalId },
          data: { status, notes: notes ?? null, decidedAt: new Date() },
          include: { post: true },
        });
        const postStatus =
          decision === "approve" ? "APPROVED" : "REJECTED";
        await db.post.update({
          where: { id: approval.postId },
          data: { status: postStatus },
        });
        return { decided: true, approvalId, decision, postStatus };
      },
    } satisfies ToolDefinition<ApprovalDecideArgs, { decided: boolean; approvalId: string; decision: "approve" | "reject"; postStatus: string }>)),
  ],
};
