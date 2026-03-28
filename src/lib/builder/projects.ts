import fs from "fs";
import path from "path";
import type { BuilderPackageManager, BuilderProject, BuilderRun, BuilderRunKind, BuilderRunStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { assertBuilderWorkspaceSafe, resolveBuilderWorkspacePath } from "@/lib/builder/config";

export interface CreateBuilderProjectInput {
  name: string;
  slug?: string;
  relativePath?: string;
  template?: string;
  packageManager?: BuilderPackageManager;
}

export interface UpdateBuilderProjectInput {
  name?: string;
  template?: string;
  packageManager?: BuilderPackageManager;
  gitInitialized?: boolean;
}

export interface CreateBuilderRunInput {
  projectId: string;
  kind: BuilderRunKind;
  title: string;
  command?: string;
  args?: unknown;
  metadata?: unknown;
}

function slugifySegment(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "project";
}

function normalizeRelativeProjectPath(relativePath: string | undefined, slug: string): string {
  const raw = relativePath?.trim();
  const normalized = path.posix.normalize((raw && raw.length > 0 ? raw : slug).replace(/\\/g, "/").replace(/^\/+/, ""));
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error("Invalid builder project path.");
  }

  return normalized.startsWith("projects/") ? normalized : path.posix.join("projects", normalized);
}

function ensureDirectoryAvailable(absolutePath: string): void {
  if (fs.existsSync(absolutePath)) {
    const stat = fs.statSync(absolutePath);
    if (!stat.isDirectory()) {
      throw new Error("Builder project path already exists as a file.");
    }
    if (fs.readdirSync(absolutePath).length > 0) {
      throw new Error("Builder project path already exists and is not empty.");
    }
    return;
  }

  fs.mkdirSync(absolutePath, { recursive: true });
}

async function resolveUniqueProjectPlacement(input: CreateBuilderProjectInput): Promise<{ slug: string; relativePath: string; absolutePath: string }> {
  const slugBase = slugifySegment(input.slug ?? input.name);
  let attempt = 0;

  while (attempt < 100) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const candidateSlug = `${slugBase}${suffix}`;
    const candidateRelativePath = normalizeRelativeProjectPath(input.relativePath, candidateSlug);
    const absolutePath = resolveBuilderWorkspacePath(candidateRelativePath);
    const existing = await db.builderProject.findFirst({
      where: {
        OR: [{ slug: candidateSlug }, { relativePath: candidateRelativePath }],
      },
    });
    const pathOccupied = fs.existsSync(absolutePath) && fs.readdirSync(absolutePath).length > 0;

    if (!existing && !pathOccupied) {
      return { slug: candidateSlug, relativePath: candidateRelativePath, absolutePath };
    }
    if (input.relativePath) {
      throw new Error("Builder project path is already in use.");
    }

    attempt += 1;
  }

  throw new Error("Unable to allocate a unique builder project path.");
}

export async function listBuilderProjects(): Promise<BuilderProject[]> {
  return db.builderProject.findMany({ orderBy: { createdAt: "desc" } });
}

export async function getBuilderProject(projectId: string): Promise<BuilderProject> {
  const project = await db.builderProject.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new Error(`Builder project not found: ${projectId}`);
  }

  return project;
}

export async function createBuilderProject(input: CreateBuilderProjectInput): Promise<BuilderProject> {
  const config = assertBuilderWorkspaceSafe();
  const name = input.name?.trim();
  if (!name) {
    throw new Error("Builder project name is required.");
  }

  const placement = await resolveUniqueProjectPlacement(input);
  ensureDirectoryAvailable(placement.absolutePath);

  return db.builderProject.create({
    data: {
      name,
      slug: placement.slug,
      relativePath: placement.relativePath,
      template: input.template?.trim() || config.defaultTemplate,
      packageManager: input.packageManager ?? config.defaultPackageManager,
    },
  });
}

export async function updateBuilderProject(projectId: string, input: UpdateBuilderProjectInput): Promise<BuilderProject> {
  await getBuilderProject(projectId);

  return db.builderProject.update({
    where: { id: projectId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() || undefined } : {}),
      ...(input.template !== undefined ? { template: input.template } : {}),
      ...(input.packageManager !== undefined ? { packageManager: input.packageManager } : {}),
      ...(input.gitInitialized !== undefined ? { gitInitialized: input.gitInitialized } : {}),
    },
  });
}

export async function deleteBuilderProject(projectId: string, options?: { deleteFiles?: boolean }): Promise<{ project: BuilderProject; deletedFiles: boolean }> {
  const project = await getBuilderProject(projectId);
  if (options?.deleteFiles) {
    const absolutePath = resolveBuilderWorkspacePath(project.relativePath);
    if (fs.existsSync(absolutePath)) {
      fs.rmSync(absolutePath, { recursive: true, force: false });
    }
  }

  await db.builderProject.delete({ where: { id: projectId } });
  return { project, deletedFiles: options?.deleteFiles ?? false };
}

export async function createBuilderRun(input: CreateBuilderRunInput): Promise<BuilderRun> {
  await db.builderProject.update({ where: { id: input.projectId }, data: { lastRunStatus: "RUNNING" } });
  return db.builderRun.create({
    data: {
      projectId: input.projectId,
      kind: input.kind,
      title: input.title,
      command: input.command,
      args: input.args as never,
      metadata: input.metadata as never,
    },
  });
}

export async function completeBuilderRun(
  runId: string,
  result: { status: BuilderRunStatus; stdout?: string; stderr?: string; summary?: string; metadata?: unknown },
): Promise<BuilderRun> {
  const run = await db.builderRun.update({
    where: { id: runId },
    data: {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      summary: result.summary,
      metadata: result.metadata as never,
      finishedAt: new Date(),
    },
  });

  await db.builderProject.update({ where: { id: run.projectId }, data: { lastRunStatus: result.status } });
  return run;
}

export async function listBuilderRuns(projectId?: string, limit = 25): Promise<BuilderRun[]> {
  return db.builderRun.findMany({
    where: projectId ? { projectId } : undefined,
    orderBy: { startedAt: "desc" },
    take: limit,
  });
}

export async function getBuilderRun(runId: string): Promise<BuilderRun> {
  const run = await db.builderRun.findUnique({ where: { id: runId } });
  if (!run) {
    throw new Error(`Builder run not found: ${runId}`);
  }

  return run;
}