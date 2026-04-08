import { NextRequest } from "next/server";
import type { BuilderProjectCommandInput } from "@/lib/builder/command-types";
import { getBuilderProject } from "@/lib/builder/projects";

function parseCommandPayload(value: object | null): BuilderProjectCommandInput {
  if (!value || Array.isArray(value)) {
    throw new Error("Invalid builder command payload.");
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.action === "initialize_git") {
    return { action: "initialize_git" };
  }
  if (candidate.action === "reconcile_mcp_policy") {
    return { action: "reconcile_mcp_policy" };
  }
  if (candidate.action === "reconcile_operational_state") {
    return { action: "reconcile_operational_state" };
  }
  if (candidate.action === "resolve_mcp_contract_drift" && typeof candidate.runId === "string") {
    const decision = candidate.decision === "approve" || candidate.decision === "reject"
      ? candidate.decision
      : null;
    if (!decision) {
      throw new Error("Builder MCP contract drift resolution requires decision=approve|reject.");
    }

    return {
      action: "resolve_mcp_contract_drift",
      runId: candidate.runId,
      decision,
      reason: typeof candidate.reason === "string" ? candidate.reason : undefined,
    };
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
    const { launchBuilderProjectCommand, recordBuilderProjectCommand } = await import("@/lib/builder/commands");
    const { id } = await context.params;
    const project = await getBuilderProject(id);
    const payload = parseCommandPayload(await req.json());
    if (payload.action === "run_agentic_task") {
      const execution = await launchBuilderProjectCommand(project, payload);
      return Response.json({
        runId: execution.runId,
        title: execution.title,
        status: execution.status,
      }, { status: 202 });
    }

    if (payload.action === "run_generator") {
      const { recordBuilderGeneratorCommand } = await import("@/lib/builder/command-generator");
      const execution = await recordBuilderGeneratorCommand(project, payload);
      return Response.json({
        runId: execution.runId,
        title: execution.title,
        result: execution.result,
      });
    }

    const execution = await recordBuilderProjectCommand(project, payload);
    return Response.json({
      runId: execution.runId,
      title: execution.title,
      result: execution.result,
    });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}