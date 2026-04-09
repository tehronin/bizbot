import { reconcileBuilderWorkspaceProjects } from "@/lib/builder/projects";

export async function POST() {
  try {
    const result = await reconcileBuilderWorkspaceProjects();
    return Response.json({
      ...result,
      summary: `Scanned ${result.scanned} Builder workspace folders. Verified ${result.verified}, relinked ${result.relinked}, imported ${result.imported}, rebound metadata ${result.metadataRebound}, ignored ${result.ignored}.`,
    });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}