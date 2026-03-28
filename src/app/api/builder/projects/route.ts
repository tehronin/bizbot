import type { BuilderPackageManager } from "@prisma/client";
import { NextRequest } from "next/server";
import { createBuilderProject, listBuilderProjects } from "@/lib/builder/projects";
import { syncBuilderTemplatePresets } from "@/lib/builder/templates";

function parsePackageManager(value: unknown): BuilderPackageManager | undefined {
  return value === "PNPM" || value === "NPM" ? value : undefined;
}

function parseCreateProjectRequest(value: object | null): {
  name: string;
  slug?: string;
  relativePath?: string;
  template?: string;
  packageManager?: BuilderPackageManager;
} {
  if (!value || Array.isArray(value)) {
    throw new Error("Invalid builder project payload.");
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.name !== "string") {
    throw new Error("Builder project payload requires a string name.");
  }

  return {
    name: candidate.name,
    slug: typeof candidate.slug === "string" ? candidate.slug : undefined,
    relativePath: typeof candidate.relativePath === "string" ? candidate.relativePath : undefined,
    template: typeof candidate.template === "string" ? candidate.template : undefined,
    packageManager: parsePackageManager(candidate.packageManager),
  };
}

export async function GET() {
  await syncBuilderTemplatePresets();
  const projects = await listBuilderProjects();
  return Response.json({ projects });
}

export async function POST(req: NextRequest) {
  try {
    const project = await createBuilderProject(parseCreateProjectRequest(await req.json()));
    return Response.json({ project }, { status: 201 });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}