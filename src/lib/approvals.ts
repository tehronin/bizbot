import { ApprovalStatus } from "@prisma/client";
import { db } from "@/lib/db";

export interface PendingApprovalSnapshot {
  id: string;
  postId: string;
  status: string;
  approvalStatus: string;
  postStatus: string;
  platform: string;
  excerpt: string;
  notes: string | null;
  createdAt: string;
}

function compactApprovalExcerpt(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 180);
}

export async function listPendingApprovalSnapshots(limit = 10): Promise<PendingApprovalSnapshot[]> {
  if (!db.postApproval?.findMany) {
    return [];
  }

  const approvals = await db.postApproval.findMany({
    where: { status: ApprovalStatus.PENDING },
    include: { post: { include: { platform: true } } },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(limit, 50)),
  });

  return approvals.map((approval) => ({
    id: approval.id,
    postId: approval.postId,
    status: approval.status,
    approvalStatus: approval.status,
    postStatus: approval.post.status,
    platform: approval.post.platform.displayName,
    excerpt: compactApprovalExcerpt(approval.post.content),
    notes: approval.notes,
    createdAt: approval.createdAt.toISOString(),
  }));
}