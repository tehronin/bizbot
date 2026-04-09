import { NextRequest } from "next/server";
import { listBuilderCapabilityAuditEvents } from "@/lib/builder/audit";
import { getBuilderDatabaseInspectionOverview, probeBuilderDatabaseLiveMetadata } from "@/lib/builder/database-introspection";
import { getBuilderProject } from "@/lib/builder/projects";
import { getBuilderRuntimeInspectionOverview } from "@/lib/builder/runtime-orchestration";

function parseInspectionAction(value: object | null): { action: "probe_live_database" } {
  if (!value || Array.isArray(value)) {
    throw new Error("Invalid builder inspection payload.");
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.action === "probe_live_database") {
    return { action: "probe_live_database" };
  }

  throw new Error("Unsupported builder inspection action.");
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const project = await getBuilderProject(id);
    return Response.json({
      capabilityAudit: listBuilderCapabilityAuditEvents(project.relativePath),
      databaseInspection: getBuilderDatabaseInspectionOverview(id, project.relativePath),
      runtimeInspection: getBuilderRuntimeInspectionOverview({ projectId: id, projectRelativePath: project.relativePath, packageManager: project.packageManager }),
    });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const project = await getBuilderProject(id);
    const action = parseInspectionAction(await req.json());

    if (action.action === "probe_live_database") {
      const probe = probeBuilderDatabaseLiveMetadata(id, project.relativePath);
      return Response.json({
        status: probe.status === "succeeded" ? "completed" : "failed",
        message: probe.status === "succeeded" ? probe.summary : probe.error ?? probe.summary,
        capabilityAudit: listBuilderCapabilityAuditEvents(project.relativePath),
        databaseInspection: getBuilderDatabaseInspectionOverview(id, project.relativePath),
        runtimeInspection: getBuilderRuntimeInspectionOverview({ projectId: id, projectRelativePath: project.relativePath, packageManager: project.packageManager }),
      });
    }

    return Response.json({ error: "Unsupported builder inspection action." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}