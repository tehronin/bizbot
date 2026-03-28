import { NextRequest } from "next/server";
import type { BuilderProjectCommandInput } from "@/lib/builder/commands";
import { recordBuilderProjectCommand } from "@/lib/builder/commands";
import { getBuilderProject } from "@/lib/builder/projects";

function parseCommandPayload(value: object | null): BuilderProjectCommandInput {
  if (!value || Array.isArray(value)) {
    throw new Error("Invalid builder command payload.");
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.action === "initialize_git") {
    return { action: "initialize_git" };
  }
  if (candidate.action === "install_dependencies") {
    return {
      action: "install_dependencies",
      packages: Array.isArray(candidate.packages) ? candidate.packages.filter((item): item is string => typeof item === "string") : undefined,
      dev: typeof candidate.dev === "boolean" ? candidate.dev : undefined,
    };
  }
  if (candidate.action === "add_dependency") {
    return {
      action: "add_dependency",
      packages: Array.isArray(candidate.packages) ? candidate.packages.filter((item): item is string => typeof item === "string") : [],
      dev: typeof candidate.dev === "boolean" ? candidate.dev : undefined,
    };
  }
  if (candidate.action === "run_script" && typeof candidate.script === "string") {
    return {
      action: "run_script",
      script: candidate.script,
      args: Array.isArray(candidate.args) ? candidate.args.filter((item): item is string => typeof item === "string") : undefined,
    };
  }
  if (candidate.action === "run_generator" && typeof candidate.generator === "string") {
    return {
      action: "run_generator",
      generator: candidate.generator,
      args: Array.isArray(candidate.args) ? candidate.args.filter((item): item is string => typeof item === "string") : undefined,
    };
  }
  if (candidate.action === "run_agentic_task" && typeof candidate.prompt === "string") {
    return {
      action: "run_agentic_task",
      profile: typeof candidate.profile === "string" ? candidate.profile : undefined,
      prompt: candidate.prompt,
      model: typeof candidate.model === "string" ? candidate.model : undefined,
      args: Array.isArray(candidate.args) ? candidate.args.filter((item): item is string => typeof item === "string") : undefined,
    };
  }

  throw new Error("Unsupported builder command action.");
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const project = await getBuilderProject(id);
    const execution = await recordBuilderProjectCommand(project, parseCommandPayload(await req.json()));
    return Response.json({
      runId: execution.runId,
      title: execution.title,
      result: execution.result,
    });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}