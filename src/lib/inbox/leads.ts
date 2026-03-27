import { LeadStage } from "@prisma/client";
import { db } from "@/lib/db";

export const LEAD_STAGE_SEQUENCE: LeadStage[] = [
  LeadStage.LEAD,
  LeadStage.QUALIFIED,
  LeadStage.CONTACTED,
  LeadStage.CONVERTED,
  LeadStage.LOST,
];

export async function listLeadPipeline() {
  return db.inboxMessage.findMany({
    where: {
      leadStage: {
        not: LeadStage.NONE,
      },
    },
    include: {
      platform: true,
      cannedResponseTree: true,
    },
    orderBy: [{ leadStage: "asc" }, { receivedAt: "desc" }],
    take: 200,
  });
}

export async function updateLeadPipelineItem(
  id: string,
  input: {
    leadStage?: LeadStage;
    leadSummary?: string | null;
    leadScore?: number;
  },
) {
  return db.inboxMessage.update({
    where: { id },
    data: {
      ...(input.leadStage !== undefined ? { leadStage: input.leadStage } : {}),
      ...(input.leadSummary !== undefined ? { leadSummary: input.leadSummary } : {}),
      ...(input.leadScore !== undefined ? { leadScore: input.leadScore } : {}),
    },
    include: {
      platform: true,
      cannedResponseTree: true,
    },
  });
}