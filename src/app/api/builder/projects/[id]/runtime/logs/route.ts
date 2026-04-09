import { NextRequest } from "next/server";
import { getBuilderProject } from "@/lib/builder/projects";
import { previewBuilderRuntimeServiceLogs } from "@/lib/builder/runtime-orchestration";

function parseOptionalNumber(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const serviceId = req.nextUrl.searchParams.get("serviceId");
    if (!serviceId) {
      throw new Error("Service id is required.");
    }
    const project = await getBuilderProject(id);
    return Response.json(await previewBuilderRuntimeServiceLogs({
      projectId: id,
      projectRelativePath: project.relativePath,
      packageManager: project.packageManager,
      serviceId,
      cursor: parseOptionalNumber(req.nextUrl.searchParams.get("cursor")),
      maxBytes: parseOptionalNumber(req.nextUrl.searchParams.get("maxBytes")),
      tailBytes: parseOptionalNumber(req.nextUrl.searchParams.get("tailBytes")) ?? 6000,
      followSeconds: parseOptionalNumber(req.nextUrl.searchParams.get("followSeconds")),
    }));
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}