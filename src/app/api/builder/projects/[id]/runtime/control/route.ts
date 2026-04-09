import { NextRequest } from "next/server";
import { getBuilderProject } from "@/lib/builder/projects";
import {
  execBuilderRuntimeServiceCommand,
  getBuilderRuntimeInspectionOverview,
  restartBuilderRuntimeService,
  startBuilderRuntimeService,
  stopBuilderRuntimeService,
} from "@/lib/builder/runtime-orchestration";

function parseRuntimeControlAction(value: unknown):
  | { action: "restart_service"; serviceId: string }
  | { action: "start_service"; serviceId: string }
  | { action: "stop_service"; serviceId: string }
  | { action: "exec_in_service"; serviceId: string; command: string; commandArgs: string[]; timeoutSeconds?: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid runtime control payload.");
  }

  const candidate = value as Record<string, unknown>;
  const serviceId = typeof candidate.serviceId === "string" ? candidate.serviceId.trim() : "";
  if (!serviceId) {
    throw new Error("Runtime service id is required.");
  }

  if (candidate.action === "restart_service") {
    return { action: "restart_service", serviceId };
  }

  if (candidate.action === "start_service") {
    return { action: "start_service", serviceId };
  }

  if (candidate.action === "stop_service") {
    return { action: "stop_service", serviceId };
  }

  if (candidate.action === "exec_in_service") {
    const command = typeof candidate.command === "string" ? candidate.command.trim() : "";
    if (!command) {
      throw new Error("Runtime exec command is required.");
    }
    return {
      action: "exec_in_service",
      serviceId,
      command,
      commandArgs: Array.isArray(candidate.commandArgs) ? candidate.commandArgs.map((entry) => String(entry)) : [],
      timeoutSeconds: typeof candidate.timeoutSeconds === "number" ? candidate.timeoutSeconds : undefined,
    };
  }

  throw new Error("Unsupported runtime control action.");
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const project = await getBuilderProject(id);
    const action = parseRuntimeControlAction(await req.json());

    const result = action.action === "restart_service"
      ? await restartBuilderRuntimeService({
        projectId: id,
        projectRelativePath: project.relativePath,
        packageManager: project.packageManager,
        serviceId: action.serviceId,
      })
      : action.action === "start_service"
        ? await startBuilderRuntimeService({
          projectId: id,
          projectRelativePath: project.relativePath,
          packageManager: project.packageManager,
          serviceId: action.serviceId,
        })
        : action.action === "stop_service"
          ? await stopBuilderRuntimeService({
            projectId: id,
            projectRelativePath: project.relativePath,
            packageManager: project.packageManager,
            serviceId: action.serviceId,
          })
          : await execBuilderRuntimeServiceCommand({
            projectId: id,
            projectRelativePath: project.relativePath,
            packageManager: project.packageManager,
            serviceId: action.serviceId,
            command: action.command,
            commandArgs: action.commandArgs,
            timeoutSeconds: action.timeoutSeconds,
          });

    return Response.json({
      ...result,
      runtimeInspection: getBuilderRuntimeInspectionOverview({
        projectId: id,
        projectRelativePath: project.relativePath,
        packageManager: project.packageManager,
      }),
    });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}