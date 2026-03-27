import { LeadStage } from "@prisma/client";
import { NextRequest } from "next/server";
import { updateLeadPipelineItem } from "@/lib/inbox/leads";

function parseLeadStage(value: unknown): LeadStage | undefined {
  switch (value) {
    case LeadStage.NONE:
    case LeadStage.LEAD:
    case LeadStage.QUALIFIED:
    case LeadStage.CONTACTED:
    case LeadStage.CONVERTED:
    case LeadStage.LOST:
      return value;
    default:
      return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    if (!isRecord(body)) {
      return Response.json({ error: "Invalid lead payload." }, { status: 400 });
    }

    const lead = await updateLeadPipelineItem(id, {
      ...(parseLeadStage(body.leadStage) !== undefined
        ? { leadStage: parseLeadStage(body.leadStage) }
        : {}),
      ...(typeof body.leadSummary === "string" || body.leadSummary === null
        ? { leadSummary: body.leadSummary as string | null }
        : {}),
      ...(typeof body.leadScore === "number" ? { leadScore: Math.trunc(body.leadScore) } : {}),
    });

    return Response.json({ lead });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}