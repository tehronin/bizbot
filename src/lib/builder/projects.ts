import fs from "fs";
import path from "path";
import type { BuilderPackageManager, BuilderProject, BuilderProjectLifecycle, BuilderRun, BuilderRunKind, BuilderRunStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertBuilderWorkspaceSafe, resolveBuilderWorkspacePath } from "@/lib/builder/config";
import { getBuilderStackPreset } from "@/lib/builder/stacks";
import { defaultBuilderProjectContext } from "@/lib/builder/types";

const BUILDER_PROJECT_METADATA_VERSION = 1;

export type BuilderProjectWorkspaceState = "present" | "missing" | "unavailable";

export interface BuilderProjectRecord extends BuilderProject {
  workspaceState: BuilderProjectWorkspaceState;
}

export interface BuilderProjectMetadata {
  version: number;
  projectId: string;
  slug: string;
  name: string;
  relativePath: string;
  template: string;
  packageManager: BuilderPackageManager;
  recordedAt: string;
}

export interface BuilderWorkspaceReconcileEntry {
  action: "verified" | "relinked" | "imported" | "metadata_rebound" | "ignored";
  projectId: string | null;
  relativePath: string;
  metadataProjectId: string | null;
  summary: string;
}

export interface BuilderWorkspaceReconcileResult {
  projects: BuilderProjectRecord[];
  scanned: number;
  verified: number;
  relinked: number;
  imported: number;
  metadataRebound: number;
  ignored: number;
  entries: BuilderWorkspaceReconcileEntry[];
}

export interface CreateBuilderProjectInput {
  name: string;
  slug?: string;
  relativePath?: string;
  template?: string;
  packageManager?: BuilderPackageManager;
  stackPresetKey?: string;
}

export interface UpdateBuilderProjectInput {
  name?: string;
  template?: string;
  packageManager?: BuilderPackageManager;
  gitInitialized?: boolean;
  archivedAt?: Date | null;
  lifecycle?: BuilderProjectLifecycle;
  context?: Prisma.InputJsonValue;
  latestSessionSummary?: string | null;
}

export interface CreateBuilderRunInput {
  projectId: string;
  taskId?: string;
  kind: BuilderRunKind;
  title: string;
  command?: string;
  args?: unknown;
  metadata?: unknown;
}

interface ScannedBuilderWorkspaceProject {
  relativePath: string;
  absolutePath: string;
  metadata: BuilderProjectMetadata;
  /** True when the directory contains only `.builder/` metadata and no project files. */
  metadataOnly?: boolean;
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

function toBuilderMetadataPath(relativePath: string): string {
  return path.posix.join(relativePath, ".builder", "project.json");
}

function buildBuilderProjectMetadata(project: Pick<BuilderProject, "id" | "slug" | "name" | "relativePath" | "template" | "packageManager">): BuilderProjectMetadata {
  return {
    version: BUILDER_PROJECT_METADATA_VERSION,
    projectId: project.id,
    slug: project.slug,
    name: project.name,
    relativePath: project.relativePath,
    template: project.template,
    packageManager: project.packageManager,
    recordedAt: new Date().toISOString(),
  };
}

function writeBuilderProjectMetadata(project: Pick<BuilderProject, "id" | "slug" | "name" | "relativePath" | "template" | "packageManager">): void {
  const projectRoot = resolveBuilderWorkspacePath(project.relativePath);
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    return;
  }

  const metadataPath = resolveBuilderWorkspacePath(toBuilderMetadataPath(project.relativePath));
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(metadataPath, `${JSON.stringify(buildBuilderProjectMetadata(project), null, 2)}\n`, "utf-8");
}

function readBuilderProjectMetadata(absoluteMetadataPath: string): BuilderProjectMetadata | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(absoluteMetadataPath, "utf-8")) as Record<string, unknown>;
    if (
      typeof parsed.projectId !== "string"
      || typeof parsed.slug !== "string"
      || typeof parsed.name !== "string"
      || typeof parsed.relativePath !== "string"
      || typeof parsed.template !== "string"
      || (parsed.packageManager !== "NPM" && parsed.packageManager !== "PNPM")
    ) {
      return null;
    }

    return {
      version: typeof parsed.version === "number" ? parsed.version : BUILDER_PROJECT_METADATA_VERSION,
      projectId: parsed.projectId,
      slug: parsed.slug,
      name: parsed.name,
      relativePath: parsed.relativePath.replace(/\\/g, "/"),
      template: parsed.template,
      packageManager: parsed.packageManager,
      recordedAt: typeof parsed.recordedAt === "string" ? parsed.recordedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function getBuilderProjectWorkspaceState(project: Pick<BuilderProject, "relativePath">): BuilderProjectWorkspaceState {
  try {
    const absolutePath = resolveBuilderWorkspacePath(project.relativePath);
    return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory() ? "present" : "missing";
  } catch {
    return "unavailable";
  }
}

function toBuilderProjectRecord(project: BuilderProject): BuilderProjectRecord {
  return {
    ...project,
    workspaceState: getBuilderProjectWorkspaceState(project),
  };
}

function scanBuilderWorkspaceProjects(): ScannedBuilderWorkspaceProject[] {
  const config = assertBuilderWorkspaceSafe();
  if (!fs.existsSync(config.projectsRoot)) {
    return [];
  }

  const results: ScannedBuilderWorkspaceProject[] = [];
  const queue = [config.projectsRoot];
  while (queue.length > 0) {
    const currentPath = queue.shift()!;
    const metadataPath = path.join(currentPath, ".builder", "project.json");
    if (fs.existsSync(metadataPath) && fs.statSync(metadataPath).isFile()) {
      const metadata = readBuilderProjectMetadata(metadataPath);
      if (metadata) {
        const relativePath = path.relative(config.workspaceRoot, currentPath).replace(/\\/g, "/");
        const topLevelEntries = fs.readdirSync(currentPath);
        const hasProjectContent = topLevelEntries.some((entry) => entry !== ".builder");
        results.push({
          relativePath,
          absolutePath: currentPath,
          metadata,
          metadataOnly: !hasProjectContent,
        });
      }
      continue;
    }

    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".builder") {
        continue;
      }
      queue.push(path.join(currentPath, entry.name));
    }
  }

  return results;
}

async function resolveUniqueImportedSlug(baseValue: string): Promise<string> {
  const baseSlug = slugifySegment(baseValue);
  let attempt = 0;

  while (attempt < 100) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const candidateSlug = `${baseSlug}${suffix}`;
    const existing = await db.builderProject.findFirst({
      where: {
        OR: [{ slug: candidateSlug }],
      },
    });
    if (!existing) {
      return candidateSlug;
    }
    attempt += 1;
  }

  throw new Error("Unable to allocate an imported Builder project slug.");
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

export async function listBuilderProjects(): Promise<BuilderProjectRecord[]> {
  const projects = await db.builderProject.findMany({ orderBy: { updatedAt: "desc" } });
  return projects.map(toBuilderProjectRecord);
}

export async function getBuilderProject(projectId: string): Promise<BuilderProject> {
  const project = await db.builderProject.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new Error(`Builder project not found: ${projectId}`);
  }

  return project;
}

export async function getBuilderProjectRecord(projectId: string): Promise<BuilderProjectRecord> {
  return toBuilderProjectRecord(await getBuilderProject(projectId));
}

export async function createBuilderProject(input: CreateBuilderProjectInput): Promise<BuilderProject> {
  const config = assertBuilderWorkspaceSafe();
  const name = input.name?.trim();
  if (!name) {
    throw new Error("Builder project name is required.");
  }

  const stackPreset = input.stackPresetKey?.trim() ? getBuilderStackPreset(input.stackPresetKey) : null;
  if (input.stackPresetKey?.trim() && !stackPreset) {
    throw new Error(`Unknown builder stack preset: ${input.stackPresetKey}.`);
  }
  if (stackPreset && input.template?.trim() && input.template.trim() !== stackPreset.template) {
    throw new Error(`Builder stack preset ${stackPreset.key} requires template ${stackPreset.template}.`);
  }
  if (stackPreset && input.packageManager && input.packageManager !== stackPreset.packageManager) {
    throw new Error(`Builder stack preset ${stackPreset.key} requires package manager ${stackPreset.packageManager}.`);
  }

  const placement = await resolveUniqueProjectPlacement(input);
  ensureDirectoryAvailable(placement.absolutePath);

  const template = stackPreset?.template ?? input.template?.trim() ?? config.defaultTemplate;
  const packageManager = stackPreset?.packageManager ?? input.packageManager ?? config.defaultPackageManager;
  const context = stackPreset
    ? {
        ...defaultBuilderProjectContext(),
        plannedStack: {
          presetKey: stackPreset.key,
          label: stackPreset.displayName,
          template: stackPreset.template,
          packageManager: stackPreset.packageManager,
          tags: stackPreset.tags,
        },
      }
    : undefined;

  const project = await db.builderProject.create({
    data: {
      name,
      slug: placement.slug,
      relativePath: placement.relativePath,
      template,
      packageManager,
      ...(context ? { context: context as never } : {}),
    },
  });

  writeBuilderProjectMetadata(project);
  return project;
}

export async function updateBuilderProject(projectId: string, input: UpdateBuilderProjectInput): Promise<BuilderProject> {
  await getBuilderProject(projectId);

  const project = await db.builderProject.update({
    where: { id: projectId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() || undefined } : {}),
      ...(input.template !== undefined ? { template: input.template } : {}),
      ...(input.packageManager !== undefined ? { packageManager: input.packageManager } : {}),
      ...(input.gitInitialized !== undefined ? { gitInitialized: input.gitInitialized } : {}),
      ...(input.archivedAt !== undefined ? { archivedAt: input.archivedAt } : {}),
      ...(input.lifecycle !== undefined ? { lifecycle: input.lifecycle } : {}),
      ...(input.context !== undefined ? { context: input.context as never } : {}),
      ...(input.latestSessionSummary !== undefined ? { latestSessionSummary: input.latestSessionSummary } : {}),
    },
  });

  try {
    writeBuilderProjectMetadata(project);
  } catch {
    // Preserve the DB update even if the external workspace projection is currently unavailable.
  }

  return project;
}

export async function archiveBuilderProject(projectId: string): Promise<BuilderProject> {
  const project = await getBuilderProject(projectId);
  if (project.archivedAt) {
    return project;
  }

  return updateBuilderProject(projectId, { archivedAt: new Date() });
}

export async function restoreBuilderProject(projectId: string): Promise<BuilderProject> {
  const project = await getBuilderProject(projectId);
  if (!project.archivedAt) {
    return project;
  }

  return updateBuilderProject(projectId, { archivedAt: null });
}

export function syncBuilderProjectMetadata(project: Pick<BuilderProject, "id" | "slug" | "name" | "relativePath" | "template" | "packageManager">): void {
  writeBuilderProjectMetadata(project);
}

export async function reconcileBuilderWorkspaceProjects(): Promise<BuilderWorkspaceReconcileResult> {
  const scannedProjects = scanBuilderWorkspaceProjects();
  const existingProjects = await db.builderProject.findMany({ orderBy: { updatedAt: "desc" } });
  const existingById = new Map(existingProjects.map((project) => [project.id, project]));
  const existingByRelativePath = new Map(existingProjects.map((project) => [project.relativePath, project]));
  const entries: BuilderWorkspaceReconcileEntry[] = [];
  let verified = 0;
  let relinked = 0;
  let imported = 0;
  let metadataRebound = 0;
  let ignored = 0;

  for (const scanned of scannedProjects) {
    const byId = existingById.get(scanned.metadata.projectId) ?? null;
    if (byId) {
      if (byId.relativePath !== scanned.relativePath) {
        const updated = await db.builderProject.update({
          where: { id: byId.id },
          data: { relativePath: scanned.relativePath },
        });
        existingById.set(updated.id, updated);
        existingByRelativePath.delete(byId.relativePath);
        existingByRelativePath.set(updated.relativePath, updated);
        writeBuilderProjectMetadata(updated);
        relinked += 1;
        entries.push({
          action: "relinked",
          projectId: updated.id,
          relativePath: scanned.relativePath,
          metadataProjectId: scanned.metadata.projectId,
          summary: `Relinked Builder project ${updated.name} to ${scanned.relativePath}.`,
        });
      } else {
        writeBuilderProjectMetadata(byId);
        verified += 1;
        entries.push({
          action: "verified",
          projectId: byId.id,
          relativePath: scanned.relativePath,
          metadataProjectId: scanned.metadata.projectId,
          summary: `Verified Builder project ${byId.name} at ${scanned.relativePath}.`,
        });
      }
      continue;
    }

    const byPath = existingByRelativePath.get(scanned.relativePath) ?? null;
    if (byPath) {
      writeBuilderProjectMetadata(byPath);
      metadataRebound += 1;
      entries.push({
        action: "metadata_rebound",
        projectId: byPath.id,
        relativePath: scanned.relativePath,
        metadataProjectId: scanned.metadata.projectId,
        summary: `Rebound workspace metadata at ${scanned.relativePath} to Builder project ${byPath.name}.`,
      });
      continue;
    }

    const conflictingRelativePath = await db.builderProject.findFirst({
      where: {
        OR: [{ relativePath: scanned.relativePath }],
      },
    });
    if (conflictingRelativePath) {
      ignored += 1;
      entries.push({
        action: "ignored",
        projectId: conflictingRelativePath.id,
        relativePath: scanned.relativePath,
        metadataProjectId: scanned.metadata.projectId,
        summary: `Ignored ${scanned.relativePath} because the relative path is already claimed by ${conflictingRelativePath.name}.`,
      });
      continue;
    }

    // Skip orphaned metadata-only directories (e.g. stale E2E test artifacts)
    // that have no DB record and no real project files beyond .builder/.
    if (scanned.metadataOnly) {
      ignored += 1;
      entries.push({
        action: "ignored",
        projectId: scanned.metadata.projectId,
        relativePath: scanned.relativePath,
        metadataProjectId: scanned.metadata.projectId,
        summary: `Ignored orphaned metadata-only folder at ${scanned.relativePath} (no project files found).`,
      });
      continue;
    }

    const importedProject = await db.builderProject.create({
      data: {
        id: scanned.metadata.projectId,
        name: scanned.metadata.name,
        slug: await resolveUniqueImportedSlug(scanned.metadata.slug || path.posix.basename(scanned.relativePath)),
        relativePath: scanned.relativePath,
        template: scanned.metadata.template,
        packageManager: scanned.metadata.packageManager,
        gitInitialized: fs.existsSync(path.join(scanned.absolutePath, ".git")),
      },
    });
    existingById.set(importedProject.id, importedProject);
    existingByRelativePath.set(importedProject.relativePath, importedProject);
    writeBuilderProjectMetadata(importedProject);
    imported += 1;
    entries.push({
      action: "imported",
      projectId: importedProject.id,
      relativePath: scanned.relativePath,
      metadataProjectId: scanned.metadata.projectId,
      summary: `Imported workspace folder ${scanned.relativePath} as Builder project ${importedProject.name}.`,
    });
  }

  return {
    projects: await listBuilderProjects(),
    scanned: scannedProjects.length,
    verified,
    relinked,
    imported,
    metadataRebound,
    ignored,
    entries,
  };
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
      taskId: input.taskId,
      kind: input.kind,
      title: input.title,
      command: input.command,
      args: input.args as never,
      metadata: input.metadata as never,
    },
  });
}

export async function updateBuilderRun(
  runId: string,
  result: { status?: BuilderRunStatus; stdout?: string; stderr?: string; summary?: string; metadata?: unknown; finishedAt?: Date | null },
): Promise<BuilderRun> {
  const existingRun = await getBuilderRun(runId);
  if (existingRun.status !== "RUNNING") {
    if (result.status === undefined || result.status !== existingRun.status) {
      return existingRun;
    }
  }

  const run = await db.builderRun.update({
    where: { id: runId },
    data: {
      ...(result.status !== undefined ? { status: result.status } : {}),
      ...(result.stdout !== undefined ? { stdout: result.stdout } : {}),
      ...(result.stderr !== undefined ? { stderr: result.stderr } : {}),
      ...(result.summary !== undefined ? { summary: result.summary } : {}),
      ...(result.metadata !== undefined ? { metadata: result.metadata as never } : {}),
      ...(result.finishedAt !== undefined ? { finishedAt: result.finishedAt } : {}),
    },
  });

  if (result.status && result.status !== "RUNNING") {
    await db.builderProject.update({ where: { id: run.projectId }, data: { lastRunStatus: result.status } });
  }

  return run;
}

export async function completeBuilderRun(
  runId: string,
  result: { status: BuilderRunStatus; stdout?: string; stderr?: string; summary?: string; metadata?: unknown },
): Promise<BuilderRun> {
  const existingRun = await getBuilderRun(runId);
  if (existingRun.status !== "RUNNING") {
    return existingRun;
  }

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