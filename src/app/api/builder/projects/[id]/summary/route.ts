import { getBuilderProjectSummary } from "@/lib/builder/orchestrator";
import { apiErrorResponse } from "@/lib/api/errors";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const summary = await getBuilderProjectSummary(id);
    return Response.json(summary);
  } catch (error) {
    return apiErrorResponse(error, "[api/builder/projects/[id]/summary] GET failed");
  }
}