import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBuilderConfig: vi.fn(),
  syncBuilderCliProfiles: vi.fn(),
  syncBuilderTemplatePresets: vi.fn(),
  getBuilderStats: vi.fn(),
  getBuilderProjectOverview: vi.fn(),
  launchBuilderTask: vi.fn(),
  planBuilderProject: vi.fn(),
  createBuilderProject: vi.fn(),
  listBuilderProjects: vi.fn(),
  getBuilderProject: vi.fn(),
  getBuilderTask: vi.fn(),
  getBuilderTaskHistory: vi.fn(),
  listBuilderRuns: vi.fn(),
  updateBuilderProject: vi.fn(),
  deleteBuilderProject: vi.fn(),
  runBuilderProjectBootstrap: vi.fn(),
  recordBuilderProjectCommand: vi.fn(),
  launchBuilderProjectCommand: vi.fn(),
  recordBuilderGeneratorCommand: vi.fn(),
  cancelBuilderProjectRun: vi.fn(),
  count: vi.fn(),
}));

vi.mock("@/lib/builder/config", () => ({
  getBuilderConfig: mocks.getBuilderConfig,
}));

vi.mock("@/lib/builder/cli-profiles", () => ({
  syncBuilderCliProfiles: mocks.syncBuilderCliProfiles,
}));

vi.mock("@/lib/builder/template-presets", () => ({
  syncBuilderTemplatePresets: mocks.syncBuilderTemplatePresets,
}));

vi.mock("@/lib/builder/bootstrap", () => ({
  runBuilderProjectBootstrap: mocks.runBuilderProjectBootstrap,
}));

vi.mock("@/lib/builder/orchestrator", () => ({
  getBuilderProjectOverview: mocks.getBuilderProjectOverview,
  launchBuilderTask: mocks.launchBuilderTask,
  planBuilderProject: mocks.planBuilderProject,
}));

vi.mock("@/lib/builder/analytics", () => ({
  getBuilderStats: mocks.getBuilderStats,
}));

vi.mock("@/lib/builder/projects", () => ({
  createBuilderProject: mocks.createBuilderProject,
  listBuilderProjects: mocks.listBuilderProjects,
  getBuilderProject: mocks.getBuilderProject,
  listBuilderRuns: mocks.listBuilderRuns,
  updateBuilderProject: mocks.updateBuilderProject,
  deleteBuilderProject: mocks.deleteBuilderProject,
}));

vi.mock("@/lib/builder/tasks", () => ({
  getBuilderTask: mocks.getBuilderTask,
  getBuilderTaskHistory: mocks.getBuilderTaskHistory,
}));

vi.mock("@/lib/builder/commands", () => ({
  recordBuilderProjectCommand: mocks.recordBuilderProjectCommand,
  launchBuilderProjectCommand: mocks.launchBuilderProjectCommand,
}));

vi.mock("@/lib/builder/command-generator", () => ({
  recordBuilderGeneratorCommand: mocks.recordBuilderGeneratorCommand,
}));

vi.mock("@/lib/builder/command-cancel", () => ({
  cancelBuilderProjectRun: mocks.cancelBuilderProjectRun,
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
import { POST as postPlan } from "@/app/api/builder/projects/[id]/plan/route";
import { GET as getTasks, POST as postTask } from "@/app/api/builder/projects/[id]/tasks/route";
import { POST as postCancelRun } from "@/app/api/builder/runs/[runId]/cancel/route";
import { GET as getTaskHistory } from "@/app/api/builder/tasks/[taskId]/history/route";
import { POST as postResumeTask } from "@/app/api/builder/tasks/[taskId]/resume/route";
import { GET as getBuilderStats } from "@/app/api/analytics/builder-stats/route";

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
      defaultAgenticProfile: "",
      agenticTimeoutSeconds: 900,
      agenticMaxIterations: 3,
    });
    mocks.syncBuilderTemplatePresets.mockResolvedValue([
      { id: "template-1", key: "node-cli", displayName: "Node CLI", description: "desc", enabled: true, defaultPackageManager: "NPM" },
    ]);
    mocks.syncBuilderCliProfiles.mockResolvedValue([
      { id: "profile-1", key: "codex", displayName: "Codex CLI", command: "codex", description: "desc", enabled: true, supportsNonInteractive: true, metadata: { available: true, healthy: true, authReady: true, ready: true, readinessReason: "Ready for Builder agentic execution." } },
    ]);
    mocks.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    mocks.listBuilderProjects.mockResolvedValue([
      { id: "project-1", name: "Demo", slug: "demo", relativePath: "projects/demo", template: "node-cli", packageManager: "NPM", gitInitialized: false, lifecycle: "ACTIVE", lastRunStatus: "IDLE" },
    ]);
    mocks.getBuilderProject.mockResolvedValue({
      id: "project-1",
      name: "Demo",
      slug: "demo",
      relativePath: "projects/demo",
      template: "node-cli",
      packageManager: "NPM",
      gitInitialized: false,
      lifecycle: "ACTIVE",
      lastRunStatus: "IDLE",
    });
    mocks.getBuilderTask.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      title: "Implement health check",
      description: "Add a health check route.",
      metadata: { lastUserRequest: "Add a health check route and verify the tests." },
    });
    mocks.getBuilderTaskHistory.mockResolvedValue([
      {
        runId: "run-1",
        taskId: "task-1",
        projectId: "project-1",
        iteration: 1,
        verdict: "retry",
        status: "FAILED",
        summary: "Tests failed.",
        stdout: "attempt 1",
        stderr: "build failed",
        timestamp: new Date("2025-01-01T00:00:00.000Z"),
        finishedAt: new Date("2025-01-01T00:01:00.000Z"),
      },
    ]);
    mocks.getBuilderStats.mockResolvedValue({
      totalRuns: 3,
      totalTasksRun: 3,
      successRate: 0.67,
      verificationPassRate: 0.5,
      retryRate: 0.33,
      avgIterationsPerTask: 2,
      avgIterationsPerRun: 1.67,
      statusCounts: { SUCCEEDED: 2, FAILED: 1 },
    });
    mocks.getBuilderProjectOverview.mockResolvedValue({
      project: {
        id: "project-1",
        name: "Demo",
        slug: "demo",
        relativePath: "projects/demo",
        template: "node-cli",
        packageManager: "NPM",
        gitInitialized: false,
        lifecycle: "ACTIVE",
        lastRunStatus: "IDLE",
        latestSessionSummary: "Validated the initial scaffold.",
      },
      context: {
        objective: "Build the external demo project.",
        plannedStack: {
          presetKey: "next-tailwind-prisma",
          label: "Next.js + Prisma + Tailwind",
          template: "next-app",
          packageManager: "NPM",
          tags: ["react", "nextjs", "prisma", "tailwind"],
        },
        architectureNotes: ["Keep Builder files under .builder."],
        architecture: {
          active: [{
            key: "planning_schema",
            canonicalKey: "builder:project-1:planning_schema",
            displayName: "planning_schema",
            description: "Planning state remains database-backed.",
            confidence: 0.9,
            status: "active",
            source: "builder_adr",
            updatedAt: "2025-01-01T00:00:00.000Z",
          }],
          stale: [{
            key: "legacy_projection_path",
            canonicalKey: "builder:project-1:legacy_projection_path",
            displayName: "legacy_projection_path",
            description: "Old projection path needs reconfirmation.",
            confidence: 0.8,
            status: "deprecated",
            source: "builder_adr",
            updatedAt: "2025-01-01T00:00:00.000Z",
          }],
        },
        codingConventions: ["Use TypeScript."],
        constraints: ["Stay inside the external builder workspace."],
        importantCommands: ["npm run build"],
        currentPlan: [{ id: "implement", label: "Implement the requested change.", status: "in_progress" }],
        latestSessionSummary: "Validated the initial scaffold.",
        knownFailures: [],
        nextSteps: ["Continue the current task."],
        instructionNotes: null,
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      tasks: [
        { id: "task-1", taskSpecId: "task-spec-1", title: "Implement health check", description: "Add a health check route.", status: "RUNNING", stage: "IMPLEMENTING", summary: null },
      ],
      brief: {
        id: "brief-1",
        projectId: "project-1",
        title: "Builder v3.1",
        summary: "Move Builder to canonical project planning.",
        goals: ["Keep planning relational."],
        constraints: ["Preserve execution history."],
        deliverables: ["Planner", "Scheduler", "Dashboard"],
        notes: "Seeded from route test.",
      },
      milestones: [{
        id: "milestone-1",
        title: "Planning foundation",
        summary: "Add brief, milestone, and task-spec models.",
        status: "ACTIVE",
        sortOrder: 1,
        taskSpecs: [{
          id: "task-spec-1",
          milestoneId: "milestone-1",
          title: "Implement health check",
          summary: "Add a health check route.",
          status: "ACTIVE",
          sortOrder: 1,
          completionCriteria: ["Add the route", "Run tests"],
          validators: ["TEST"],
          architecturalDecisionKeys: ["planning_schema"],
          dependencyIds: [],
        }],
      }],
      currentMilestone: {
        id: "milestone-1",
        title: "Planning foundation",
        summary: "Add brief, milestone, and task-spec models.",
        status: "ACTIVE",
        sortOrder: 1,
        taskSpecs: [],
      },
      currentTaskSpec: {
        id: "task-spec-1",
        milestoneId: "milestone-1",
        title: "Implement health check",
        summary: "Add a health check route.",
        status: "ACTIVE",
        sortOrder: 1,
        completionCriteria: ["Add the route", "Run tests"],
        validators: ["TEST"],
        architecturalDecisionKeys: ["planning_schema"],
        dependencyIds: [],
      },
      currentTask: { id: "task-1", taskSpecId: "task-spec-1", title: "Implement health check", description: "Add a health check route.", status: "RUNNING", stage: "IMPLEMENTING", summary: null },
      runs: [
        { id: "run-1", projectId: "project-1", kind: "ORCHESTRATION", title: "Builder task: Implement health check", status: "RUNNING" },
      ],
      latestReview: {
        taskId: "task-1",
        projectId: "project-1",
        status: "FAILED",
        stage: "TESTING",
        summary: "Tests failed after implementation.",
        filesChanged: ["src/index.ts"],
        commandsExecuted: ["codex exec"],
        validation: { passed: false, skipped: false, summary: "Tests failed.", scripts: ["test"] },
        tests: { passed: false, exitCode: 1, summary: "test failed." },
        lint: { passed: null, exitCode: null, summary: null },
        build: { passed: null, exitCode: null, summary: null },
        risks: ["Tests are still failing."],
        nextSteps: ["Fix the failing test."],
        architecture: {
          activeKeys: ["planning_schema"],
          staleKeys: ["legacy_projection_path"],
          addressedStaleKeys: ["legacy_projection_path"],
          missingStaleKeys: [],
          newDecisionKeys: ["planning_schema"],
          retiredDecisionKeys: ["legacy_projection_path"],
        },
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      metrics: {
        efficiency: {
          successRate: 0.67,
          verificationPassRate: 0.5,
          retryRate: 0.33,
          avgIterationsPerRun: 1.67,
          avgIterationsPerTask: 2,
          tasksInRetry: 1,
        },
        promotion: {
          completedMilestones: 0,
          totalMilestones: 1,
          milestoneCompletionRate: 0,
          completedTaskSpecs: 0,
          blockedTaskSpecs: 0,
          totalTaskSpecs: 1,
          taskSpecCompletionRate: 0,
        },
        architecture: {
          activeDecisionCount: 1,
          staleDecisionCount: 1,
          currentTaskDecisionCount: 1,
          latestAddressedStaleCount: 1,
          latestMissingStaleCount: 0,
          latestNewDecisionCount: 1,
          latestRetiredDecisionCount: 1,
        },
      },
      mcpSnapshot: {
        activeRunId: "run-1",
        currentSequence: 1,
        currentHash: "hash-1",
        state: "captured",
        history: [{ id: "snapshot-1", snapshotSequence: 1, versionHash: "hash-1", appliedAt: "2025-01-01T00:00:00.000Z" }],
        drift: null,
      },
      nextRecommendedStep: "Continue the current task.",
    });
    mocks.planBuilderProject.mockResolvedValue({
      project: {
        id: "project-1",
        name: "Demo",
        slug: "demo",
        relativePath: "projects/demo",
        template: "node-cli",
        packageManager: "NPM",
        gitInitialized: false,
        lifecycle: "PLANNED",
        lastRunStatus: "IDLE",
      },
      context: {
        objective: "Move Builder to canonical project planning.",
        plannedStack: null,
        architectureNotes: [],
        codingConventions: [],
        constraints: [],
        importantCommands: [],
        currentPlan: [],
        latestSessionSummary: null,
        knownFailures: [],
        nextSteps: ["Advance the first task spec."],
        instructionNotes: null,
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      brief: {
        id: "brief-1",
        projectId: "project-1",
        title: "Builder v3.1",
        summary: "Move Builder to canonical project planning.",
        goals: [],
        constraints: [],
        deliverables: [],
        notes: null,
      },
      milestones: [],
      currentMilestone: null,
      currentTaskSpec: null,
      tasks: [],
      currentTask: null,
      runs: [],
      latestReview: null,
      metrics: {
        efficiency: {
          successRate: 0,
          verificationPassRate: 0,
          retryRate: 0,
          avgIterationsPerRun: 0,
          avgIterationsPerTask: 0,
          tasksInRetry: 0,
        },
        promotion: {
          completedMilestones: 0,
          totalMilestones: 0,
          milestoneCompletionRate: 0,
          completedTaskSpecs: 0,
          blockedTaskSpecs: 0,
          totalTaskSpecs: 0,
          taskSpecCompletionRate: 0,
        },
        architecture: {
          activeDecisionCount: 0,
          staleDecisionCount: 0,
          currentTaskDecisionCount: 0,
          latestAddressedStaleCount: 0,
          latestMissingStaleCount: 0,
          latestNewDecisionCount: 0,
          latestRetiredDecisionCount: 0,
        },
      },
      nextRecommendedStep: "Advance the first task spec.",
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
    mocks.recordBuilderGeneratorCommand.mockResolvedValue({
      runId: "run-1",
      title: "Run generator: create-demo",
      result: { ok: true, stdout: "done", stderr: "", exitCode: 0 },
    });
    mocks.launchBuilderProjectCommand.mockResolvedValue({
      runId: "run-1",
      title: "Run Codex CLI task",
      command: "codex",
      args: ["exec", "prompt"],
      status: "RUNNING",
    });
    mocks.launchBuilderTask.mockResolvedValue({ runId: "run-2", taskId: "task-1", status: "RUNNING" });
    mocks.cancelBuilderProjectRun.mockResolvedValue({ runId: "run-1", status: "CANCELLED" });
    mocks.createBuilderProject.mockResolvedValue({
      id: "project-2",
      name: "Acme",
      slug: "acme",
      relativePath: "projects/acme",
      template: "vite-app",
      packageManager: "PNPM",
      lifecycle: "DRAFT",
    });
  });

  it("returns builder status with config, templates, cli profiles, and counts", async () => {
    const response = await getStatus();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.config.defaultAgenticProfile).toBe("");
    expect(payload.config.agenticMaxIterations).toBe(3);
    expect(payload.projects).toEqual({ total: 2, running: 1 });
    expect(payload.stackPresets).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "next-tailwind-prisma", template: "next-app" }),
      expect.objectContaining({ key: "vite-react-tailwind", template: "vite-app" }),
    ]));
    expect(payload.cliProfiles[0]?.key).toBe("codex");
  });

  it("creates builder projects through the collection route", async () => {
    const response = await postProjects(new NextRequest("http://localhost/api/builder/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Acme", template: "vite-app", packageManager: "PNPM", stackPresetKey: "vite-react-tailwind" }),
      headers: { "Content-Type": "application/json" },
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.createBuilderProject).toHaveBeenCalledWith({ name: "Acme", slug: undefined, relativePath: undefined, template: "vite-app", packageManager: "PNPM", stackPresetKey: "vite-react-tailwind" });
    expect(payload.project.id).toBe("project-2");
  });

  it("returns project details and recent runs", async () => {
    const response = await getProject(new Request("http://localhost/api/builder/projects/project-1"), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.project.id).toBe("project-1");
    expect(payload.currentTaskSpec.id).toBe("task-spec-1");
    expect(payload.currentTask.id).toBe("task-1");
    expect(payload.runs).toHaveLength(1);
    expect(payload.metrics.architecture.activeDecisionCount).toBe(1);
    expect(payload.mcpSnapshot.currentSequence).toBe(1);
  });

  it("plans a project through the dedicated planning route", async () => {
    const response = await postPlan(new NextRequest("http://localhost/api/builder/projects/project-1/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Builder v3.1",
        summary: "Move Builder to canonical project planning.",
        goals: ["Keep planning relational."],
        constraints: ["No new models."],
        deliverables: ["Planner", "ADR reconciliation"],
        notes: "Plan first.",
        regenerate: true,
      }),
    }), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.planBuilderProject).toHaveBeenCalledWith("project-1", {
      title: "Builder v3.1",
      summary: "Move Builder to canonical project planning.",
      goals: ["Keep planning relational."],
      constraints: ["No new models."],
      deliverables: ["Planner", "ADR reconciliation"],
      notes: "Plan first.",
      regenerate: true,
    });
    expect(payload.project.id).toBe("project-1");
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

    expect(response.status).toBe(202);
    expect(mocks.launchBuilderProjectCommand).toHaveBeenCalledWith(expect.objectContaining({ id: "project-1" }), {
      action: "run_agentic_task",
      profile: "codex",
      prompt: "Scaffold a health check route and add a basic test.",
      model: "gpt-5-codex",
      args: undefined,
    });
    expect(payload.runId).toBe("run-1");
    expect(payload.status).toBe("RUNNING");
  });

  it("runs the reconciliation command through the project commands api", async () => {
    const response = await postCommand(new NextRequest("http://localhost/api/builder/projects/project-1/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reconcile_operational_state",
      }),
    }), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.recordBuilderProjectCommand).toHaveBeenCalledWith(expect.objectContaining({ id: "project-1" }), {
      action: "reconcile_operational_state",
    });
    expect(payload.runId).toBe("run-1");
    expect(payload.result).toEqual({ ok: true, stdout: "done", stderr: "", exitCode: 0 });
  });

  it("parses and forwards MCP drift resolution commands", async () => {
    const response = await postCommand(new NextRequest("http://localhost/api/builder/projects/project-1/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "resolve_mcp_contract_drift",
        runId: "run-1",
        decision: "approve",
        reason: "Accept the new contract for this task.",
      }),
    }), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.recordBuilderProjectCommand).toHaveBeenCalledWith(expect.objectContaining({ id: "project-1" }), {
      action: "resolve_mcp_contract_drift",
      runId: "run-1",
      decision: "approve",
      reason: "Accept the new contract for this task.",
    });
    expect(payload.runId).toBe("run-1");
  });

  it("cancels a running builder run", async () => {
    const response = await postCancelRun(new NextRequest("http://localhost/api/builder/runs/run-1/cancel", {
      method: "POST",
    }), {
      params: Promise.resolve({ runId: "run-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.cancelBuilderProjectRun).toHaveBeenCalledWith("run-1");
    expect(payload.status).toBe("CANCELLED");
  });

  it("lists project tasks from the task route", async () => {
    const response = await getTasks(new Request("http://localhost/api/builder/projects/project-1/tasks"), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.tasks).toHaveLength(1);
    expect(payload.currentTask.id).toBe("task-1");
    expect(payload.nextRecommendedStep).toBe("Continue the current task.");
  });

  it("starts a builder task from the task route", async () => {
    const response = await postTask(new NextRequest("http://localhost/api/builder/projects/project-1/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: "Add a health check route and verify the tests.",
        profile: "codex",
        model: "gpt-5-codex",
      }),
    }), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(mocks.launchBuilderTask).toHaveBeenCalledWith("project-1", {
      request: "Add a health check route and verify the tests.",
      taskId: undefined,
      retryFailed: undefined,
      fromIteration: undefined,
      profile: "codex",
      model: "gpt-5-codex",
    });
    expect(payload.taskId).toBe("task-1");
  });

  it("forwards an explicit iteration when starting a builder task", async () => {
    const response = await postTask(new NextRequest("http://localhost/api/builder/projects/project-1/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: "Resume the fix from iteration 2.",
        taskId: "task-1",
        retryFailed: true,
        fromIteration: 2,
      }),
    }), {
      params: Promise.resolve({ id: "project-1" }),
    });

    expect(response.status).toBe(202);
    expect(mocks.launchBuilderTask).toHaveBeenCalledWith("project-1", {
      request: "Resume the fix from iteration 2.",
      taskId: "task-1",
      retryFailed: true,
      fromIteration: 2,
      profile: undefined,
      model: undefined,
    });
  });

  it("returns task history from the dedicated history route", async () => {
    const response = await getTaskHistory(new Request("http://localhost/api/builder/tasks/task-1/history"), {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getBuilderTaskHistory).toHaveBeenCalledWith("task-1");
    expect(payload.history).toHaveLength(1);
    expect(payload.history[0]?.iteration).toBe(1);
  });

  it("resumes a task using the task-specific resume route", async () => {
    const response = await postResumeTask(new NextRequest("http://localhost/api/builder/tasks/task-1/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromIteration: 2, profile: "codex" }),
    }), {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(mocks.launchBuilderTask).toHaveBeenCalledWith("project-1", {
      request: "Add a health check route and verify the tests.",
      taskId: "task-1",
      retryFailed: true,
      fromIteration: 2,
      profile: "codex",
      model: undefined,
    });
    expect(payload.taskId).toBe("task-1");
  });

  it("returns builder stats from the analytics route", async () => {
    const response = await getBuilderStats(new NextRequest("http://localhost/api/analytics/builder-stats?projectId=project-1"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getBuilderStats).toHaveBeenCalledWith("project-1");
    expect(payload.successRate).toBe(0.67);
    expect(payload.verificationPassRate).toBe(0.5);
  });

  it("lists projects from the collection route", async () => {
    const response = await getProjects();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.projects).toHaveLength(1);
    expect(mocks.syncBuilderTemplatePresets).toHaveBeenCalled();
  });
});