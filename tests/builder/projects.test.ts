import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  projects: [] as Array<Record<string, unknown>>,
  runs: [] as Array<Record<string, unknown>>,
  nextProjectId: 1,
  nextRunId: 1,
}));

vi.mock("@/lib/db", () => ({
  db: {
    builderProject: {
      findFirst: async ({ where }: { where: { OR: Array<Record<string, string>> } }) =>
        state.projects.find((project) =>
          where.OR.some((condition) =>
            (condition.slug && project.slug === condition.slug)
            || (condition.relativePath && project.relativePath === condition.relativePath),
          ),
        ) ?? null,
      findMany: async () => [...state.projects],
      findUnique: async ({ where }: { where: { id?: string; slug?: string } }) =>
        state.projects.find((project) => project.id === where.id || project.slug === where.slug) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const record = {
          id: `project-${state.nextProjectId++}`,
          gitInitialized: false,
          lastRunStatus: "IDLE",
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        state.projects.push(record);
        return record;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const index = state.projects.findIndex((project) => project.id === where.id);
        if (index === -1) {
          throw new Error(`missing project ${where.id}`);
        }
        state.projects[index] = {
          ...state.projects[index],
          ...data,
          updatedAt: new Date(),
        };
        return state.projects[index];
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const index = state.projects.findIndex((project) => project.id === where.id);
        if (index === -1) {
          throw new Error(`missing project ${where.id}`);
        }
        const [removed] = state.projects.splice(index, 1);
        return removed;
      },
    },
    builderRun: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const record = {
          id: `run-${state.nextRunId++}`,
          status: "RUNNING",
          startedAt: new Date(),
          ...data,
        };
        state.runs.push(record);
        return record;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const index = state.runs.findIndex((run) => run.id === where.id);
        if (index === -1) {
          throw new Error(`missing run ${where.id}`);
        }
        state.runs[index] = { ...state.runs[index], ...data };
        return state.runs[index];
      },
      findMany: async ({ where }: { where?: { projectId?: string } }) =>
        state.runs.filter((run) => !where?.projectId || run.projectId === where.projectId),
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.runs.find((run) => run.id === where.id) ?? null,
    },
  },
}));

import { completeBuilderRun, createBuilderProject, createBuilderRun, deleteBuilderProject, listBuilderProjects, reconcileBuilderWorkspaceProjects, updateBuilderRun } from "@/lib/builder/projects";

function createTempBuilderWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-builder-projects-"));
}

beforeEach(() => {
  state.projects.length = 0;
  state.runs.length = 0;
  state.nextProjectId = 1;
  state.nextRunId = 1;
});

afterEach(() => {
  delete process.env.BIZBOT_BUILDER_WORKSPACE_PATH;
  delete process.env.BIZBOT_BUILDER_DEFAULT_TEMPLATE;
  delete process.env.BIZBOT_BUILDER_DEFAULT_PACKAGE_MANAGER;
});

describe("builder projects", () => {
  it("creates named projects, allocates a dedicated folder, and persists records without running a CLI", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const project = await createBuilderProject({ name: "Acme Site" });

    expect(project.slug).toBe("acme-site");
    expect(project.relativePath).toBe("projects/acme-site");
    expect(fs.existsSync(path.resolve(workspaceRoot, "projects", "acme-site"))).toBe(true);

    const projects = await listBuilderProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe("Acme Site");
  });

  it("allocates a unique slug and folder when names collide", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const first = await createBuilderProject({ name: "Widget App" });
    const second = await createBuilderProject({ name: "Widget App" });

    expect(first.slug).toBe("widget-app");
    expect(second.slug).toBe("widget-app-2");
    expect(second.relativePath).toBe("projects/widget-app-2");
    expect(fs.existsSync(path.resolve(workspaceRoot, "projects", "widget-app-2"))).toBe(true);
  });

  it("labels projects with a missing workspace state when the folder is gone", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const project = await createBuilderProject({ name: "Missing Folder" });
    fs.rmSync(path.resolve(workspaceRoot, "projects", "missing-folder"), { recursive: true, force: true });

    const projects = await listBuilderProjects();
    expect(projects[0]?.id).toBe(project.id);
    expect(projects[0]?.workspaceState).toBe("missing");
  });

  it("relinks a moved workspace folder back to the persisted Builder record via project metadata", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const project = await createBuilderProject({ name: "Move Me" });
    const originalPath = path.resolve(workspaceRoot, "projects", "move-me");
    const movedPath = path.resolve(workspaceRoot, "projects", "rescued", "move-me");
    fs.mkdirSync(path.dirname(movedPath), { recursive: true });
    fs.renameSync(originalPath, movedPath);

    const result = await reconcileBuilderWorkspaceProjects();
    const refreshed = (await listBuilderProjects()).find((candidate) => candidate.id === project.id);

    expect(result.relinked).toBe(1);
    expect(refreshed?.relativePath).toBe("projects/rescued/move-me");
    expect(refreshed?.workspaceState).toBe("present");
  });

  it("can delete project records while preserving files by default", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const project = await createBuilderProject({ name: "Delete Me" });
    const absolutePath = path.resolve(workspaceRoot, "projects", "delete-me");

    const result = await deleteBuilderProject(project.id as string);

    expect(result.deletedFiles).toBe(false);
    expect(fs.existsSync(absolutePath)).toBe(true);
    expect(await listBuilderProjects()).toHaveLength(0);
  });

  it("does not overwrite a terminal run with late progress or completion updates", async () => {
    const workspaceRoot = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = workspaceRoot;

    const project = await createBuilderProject({ name: "Run Guard" });
    const run = await createBuilderRun({
      projectId: project.id as string,
      kind: "ORCHESTRATION",
      title: "Guarded run",
      command: "builder-orchestrator",
    });

    const cancelled = await completeBuilderRun(run.id as string, {
      status: "CANCELLED",
      summary: "Cancelled deliberately.",
    });
    const lateProgress = await updateBuilderRun(run.id as string, {
      summary: "This should not replace the cancelled state.",
    });
    const lateCompletion = await completeBuilderRun(run.id as string, {
      status: "SUCCEEDED",
      summary: "This should also be ignored.",
    });

    expect(cancelled.status).toBe("CANCELLED");
    expect(lateProgress.status).toBe("CANCELLED");
    expect(lateProgress.summary).toBe("Cancelled deliberately.");
    expect(lateCompletion.status).toBe("CANCELLED");
    expect(lateCompletion.summary).toBe("Cancelled deliberately.");
  });
});