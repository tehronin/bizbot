import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBuilderConfig: vi.fn(),
  syncBuilderCliProfiles: vi.fn(),
  syncBuilderTemplatePresets: vi.fn(),
  createBuilderProject: vi.fn(),
  listBuilderProjects: vi.fn(),
  getBuilderProject: vi.fn(),
  listBuilderRuns: vi.fn(),
  updateBuilderProject: vi.fn(),
  deleteBuilderProject: vi.fn(),
  runBuilderProjectBootstrap: vi.fn(),
  recordBuilderProjectCommand: vi.fn(),
  count: vi.fn(),
}));

vi.mock("@/lib/builder/config", () => ({
  getBuilderConfig: mocks.getBuilderConfig,
}));

vi.mock("@/lib/builder/cli-profiles", () => ({
  syncBuilderCliProfiles: mocks.syncBuilderCliProfiles,
}));

vi.mock("@/lib/builder/templates", () => ({
  syncBuilderTemplatePresets: mocks.syncBuilderTemplatePresets,
}));

vi.mock("@/lib/builder/bootstrap", () => ({
  runBuilderProjectBootstrap: mocks.runBuilderProjectBootstrap,
}));

vi.mock("@/lib/builder/projects", () => ({
  createBuilderProject: mocks.createBuilderProject,
  listBuilderProjects: mocks.listBuilderProjects,
  getBuilderProject: mocks.getBuilderProject,
  listBuilderRuns: mocks.listBuilderRuns,
  updateBuilderProject: mocks.updateBuilderProject,
  deleteBuilderProject: mocks.deleteBuilderProject,
}));

vi.mock("@/lib/builder/commands", () => ({
  recordBuilderProjectCommand: mocks.recordBuilderProjectCommand,
}));

vi.mock("@/lib/db", () => ({
  db: {
    builderProject: {
      count: mocks.count,
    },
  },
}));

import { GET as getStatus } from "@/app/api/builder/status/route";
import { GET as getProjects, POST as postProjects } from "@/app/api/builder/projects/route";
import { DELETE as deleteProject, GET as getProject, PATCH as patchProject } from "@/app/api/builder/projects/[id]/route";
import { POST as postBootstrap } from "@/app/api/builder/projects/[id]/bootstrap/route";
import { POST as postCommand } from "@/app/api/builder/projects/[id]/commands/route";

describe("builder routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getBuilderConfig.mockReturnValue({
      workspaceRoot: "C:/builder",
      projectsRoot: "C:/builder/projects",
      repositoryRoot: "C:/bizbot",
      configuredByEnv: true,
      safe: true,
      allowedCommands: ["npm", "pnpm", "npx", "git", "node"],
      defaultTemplate: "node-cli",
      defaultPackageManager: "NPM",
      initializeGitByDefault: true,
      installDependenciesByDefault: false,
      defaultAgenticProfile: "codex",
      agenticTimeoutSeconds: 900,
    });
    mocks.syncBuilderTemplatePresets.mockResolvedValue([
      { id: "template-1", key: "node-cli", displayName: "Node CLI", description: "desc", enabled: true, defaultPackageManager: "NPM" },
    ]);
    mocks.syncBuilderCliProfiles.mockResolvedValue([
      { id: "profile-1", key: "codex", displayName: "Codex CLI", command: "codex", description: "desc", enabled: true, supportsNonInteractive: true, metadata: { available: true } },
    ]);
    mocks.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    mocks.listBuilderProjects.mockResolvedValue([
      { id: "project-1", name: "Demo", slug: "demo", relativePath: "projects/demo", template: "node-cli", packageManager: "NPM", gitInitialized: false, lastRunStatus: "IDLE" },
    ]);
    mocks.getBuilderProject.mockResolvedValue({
      id: "project-1",
      name: "Demo",
      slug: "demo",
      relativePath: "projects/demo",
      template: "node-cli",
      packageManager: "NPM",
      gitInitialized: false,
      lastRunStatus: "IDLE",
    });
    mocks.listBuilderRuns.mockResolvedValue([
      { id: "run-1", projectId: "project-1", kind: "AGENTIC", title: "Run Codex CLI task", status: "SUCCEEDED" },
    ]);
    mocks.updateBuilderProject.mockResolvedValue({ id: "project-1", name: "Demo Updated" });
    mocks.deleteBuilderProject.mockResolvedValue({ project: { id: "project-1" }, deletedFiles: true });
    mocks.runBuilderProjectBootstrap.mockResolvedValue({ template: "node-cli", root: "projects/demo", files: ["projects/demo/package.json"] });
    mocks.recordBuilderProjectCommand.mockResolvedValue({
      runId: "run-1",
      title: "Run Codex CLI task",
      result: { ok: true, stdout: "done", stderr: "", exitCode: 0 },
    });
    mocks.createBuilderProject.mockResolvedValue({
      id: "project-2",
      name: "Acme",
      slug: "acme",
      relativePath: "projects/acme",
      template: "vite-app",
      packageManager: "PNPM",
    });
  });

  it("returns builder status with config, templates, cli profiles, and counts", async () => {
    const response = await getStatus();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.config.defaultAgenticProfile).toBe("codex");
    expect(payload.projects).toEqual({ total: 2, running: 1 });
    expect(payload.cliProfiles[0]?.key).toBe("codex");
  });

  it("creates builder projects through the collection route", async () => {
    const response = await postProjects(new NextRequest("http://localhost/api/builder/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Acme", template: "vite-app", packageManager: "PNPM" }),
      headers: { "Content-Type": "application/json" },
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.createBuilderProject).toHaveBeenCalledWith({ name: "Acme", slug: undefined, relativePath: undefined, template: "vite-app", packageManager: "PNPM" });
    expect(payload.project.id).toBe("project-2");
  });

  it("returns project details and recent runs", async () => {
    const response = await getProject(new Request("http://localhost/api/builder/projects/project-1"), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.project.id).toBe("project-1");
    expect(payload.runs).toHaveLength(1);
  });

  it("updates and deletes a project item", async () => {
    const patchResponse = await patchProject(new NextRequest("http://localhost/api/builder/projects/project-1", {
      method: "PATCH",
      body: JSON.stringify({ name: "Demo Updated", gitInitialized: true }),
      headers: { "Content-Type": "application/json" },
    }), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const patchPayload = await patchResponse.json();

    expect(patchResponse.status).toBe(200);
    expect(mocks.updateBuilderProject).toHaveBeenCalledWith("project-1", {
      name: "Demo Updated",
      template: undefined,
      packageManager: undefined,
      gitInitialized: true,
    });
    expect(patchPayload.project.name).toBe("Demo Updated");

    const deleteResponse = await deleteProject(new NextRequest("http://localhost/api/builder/projects/project-1?deleteFiles=true", {
      method: "DELETE",
    }), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const deletePayload = await deleteResponse.json();

    expect(deleteResponse.status).toBe(200);
    expect(mocks.deleteBuilderProject).toHaveBeenCalledWith("project-1", { deleteFiles: true });
    expect(deletePayload.deletedFiles).toBe(true);
  });

  it("bootstraps a project using builder config defaults when request body is empty", async () => {
    const response = await postBootstrap(new NextRequest("http://localhost/api/builder/projects/project-1/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.runBuilderProjectBootstrap).toHaveBeenCalledWith("project-1", {
      initializeGit: true,
      installDependencies: false,
    });
    expect(payload.root).toBe("projects/demo");
  });

  it("parses and forwards the agentic task command payload", async () => {
    const response = await postCommand(new NextRequest("http://localhost/api/builder/projects/project-1/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "run_agentic_task",
        profile: "codex",
        prompt: "Scaffold a health check route and add a basic test.",
        model: "gpt-5-codex",
      }),
    }), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.recordBuilderProjectCommand).toHaveBeenCalledWith(expect.objectContaining({ id: "project-1" }), {
      action: "run_agentic_task",
      profile: "codex",
      prompt: "Scaffold a health check route and add a basic test.",
      model: "gpt-5-codex",
      args: undefined,
    });
    expect(payload.runId).toBe("run-1");
  });

  it("lists projects from the collection route", async () => {
    const response = await getProjects();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.projects).toHaveLength(1);
    expect(mocks.syncBuilderTemplatePresets).toHaveBeenCalled();
  });
});