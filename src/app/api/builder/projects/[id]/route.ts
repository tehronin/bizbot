import type { BuilderPackageManager } from "@prisma/client";
import { NextRequest } from "next/server";
import { deleteBuilderProject, getBuilderProject, listBuilderRuns, updateBuilderProject } from "@/lib/builder/projects";

function parsePackageManager(value: unknown): BuilderPackageManager | undefined {
  return value === "PNPM" || value === "NPM" ? value : undefined;
}

function parseUpdateProjectRequest(value: object | null): {
  name?: string;
  template?: string;
  packageManager?: BuilderPackageManager;
  gitInitialized?: boolean;
} {
  if (!value || Array.isArray(value)) {
    throw new Error("Invalid builder project payload.");
  }

  const candidate = value as Record<string, unknown>;
  return {
    name: typeof candidate.name === "string" ? candidate.name : undefined,
    template: typeof candidate.template === "string" ? candidate.template : undefined,
    packageManager: parsePackageManager(candidate.packageManager),
    gitInitialized: typeof candidate.gitInitialized === "boolean" ? candidate.gitInitialized : undefined,
  };
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const [project, runs] = await Promise.all([getBuilderProject(id), listBuilderRuns(id, 25)]);
    return Response.json({ project, runs });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const project = await updateBuilderProject(id, parseUpdateProjectRequest(await req.json()));
    return Response.json({ project });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const deleteFiles = req.nextUrl.searchParams.get("deleteFiles") === "true";
    const result = await deleteBuilderProject(id, { deleteFiles });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}