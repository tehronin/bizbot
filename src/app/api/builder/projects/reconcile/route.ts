import { reconcileBuilderWorkspaceProjects } from "@/lib/builder/projects";
import { apiErrorResponse } from "@/lib/api/errors";

export async function POST() {
  try {
    const result = await reconcileBuilderWorkspaceProjects();
    return Response.json({
      ...result,
      summary: `Scanned ${result.scanned} Builder workspace folders. Verified ${result.verified}, relinked ${result.relinked}, imported ${result.imported}, rebound metadata ${result.metadataRebound}, ignored ${result.ignored}.`,
    });
  } catch (error) {
    return apiErrorResponse(error, "[api/builder/projects/reconcile] POST failed");
  }
}