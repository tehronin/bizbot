/**
 * GET    /api/approvals          – list pending approvals
 */

import { listPendingApprovalSnapshots } from "@/lib/approvals";

export async function GET() {
  const approvals = await listPendingApprovalSnapshots(50);
  return Response.json({ approvals });
}
