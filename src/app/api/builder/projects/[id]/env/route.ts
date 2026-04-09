import { NextRequest } from "next/server";
import {
  getBuilderEnvSchema,
  syncBuilderProjectEnvExample,
  validateBuilderProjectEnv,
  writeBuilderProjectEnvFileEntry,
} from "@/lib/builder/environment";
import { getBuilderProject } from "@/lib/builder/projects";

function parseEnvMutationBody(value: unknown):
  | { action: "write"; key: string; value: string; file?: ".env" | ".env.local" }
  | { action: "sync_example" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Builder env payload.");
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.action === "sync_example") {
    return { action: "sync_example" };
  }
  if (candidate.action === "write") {
    if (typeof candidate.key !== "string") {
      throw new Error("Environment key is required.");
    }
    return {
      action: "write",
      key: candidate.key,
      value: typeof candidate.value === "string" ? candidate.value : "",
      file: candidate.file === ".env" || candidate.file === ".env.local" ? candidate.file : undefined,
    };
  }

  throw new Error("Unsupported Builder env action.");
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const project = await getBuilderProject(id);
    return Response.json({
      projectId: id,
      schema: getBuilderEnvSchema(project.relativePath),
      readiness: validateBuilderProjectEnv(project.relativePath),
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
    const action = parseEnvMutationBody(await req.json());

    if (action.action === "sync_example") {
      const result = syncBuilderProjectEnvExample(project.relativePath);
      return Response.json({
        projectId: id,
        action: action.action,
        result,
        readiness: validateBuilderProjectEnv(project.relativePath),
      });
    }

    const result = writeBuilderProjectEnvFileEntry(project.relativePath, {
      key: action.key,
      value: action.value,
      file: action.file,
    });
    return Response.json({
      projectId: id,
      action: action.action,
      result,
      readiness: validateBuilderProjectEnv(project.relativePath),
    });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}