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
  reconcileBuilderWorkspaceProjects: vi.fn(),
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
  streamBuilderManagedProcessLogs: vi.fn(),
  getBuilderEnvSchema: vi.fn(),
  validateBuilderProjectEnv: vi.fn(),
  writeBuilderProjectEnvFileEntry: vi.fn(),
  syncBuilderProjectEnvExample: vi.fn(),
  listBuilderCapabilityAuditEvents: vi.fn(),
  getBuilderDatabaseInspectionOverview: vi.fn(),
  probeBuilderDatabaseLiveMetadata: vi.fn(),
  getBuilderRuntimeInspectionOverview: vi.fn(),
  previewBuilderRuntimeServiceLogs: vi.fn(),
  getBuilderRuntimeServiceLogs: vi.fn(),
  resolveBuilderRuntimeService: vi.fn(),
  restartBuilderRuntimeService: vi.fn(),
  startBuilderRuntimeService: vi.fn(),
  stopBuilderRuntimeService: vi.fn(),
  execBuilderRuntimeServiceCommand: vi.fn(),
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
  reconcileBuilderWorkspaceProjects: mocks.reconcileBuilderWorkspaceProjects,
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

vi.mock("@/lib/builder/process-registry", () => ({
  streamBuilderManagedProcessLogs: mocks.streamBuilderManagedProcessLogs,
}));

vi.mock("@/lib/builder/environment", () => ({
  getBuilderEnvSchema: mocks.getBuilderEnvSchema,
  validateBuilderProjectEnv: mocks.validateBuilderProjectEnv,
  writeBuilderProjectEnvFileEntry: mocks.writeBuilderProjectEnvFileEntry,
  syncBuilderProjectEnvExample: mocks.syncBuilderProjectEnvExample,
}));

vi.mock("@/lib/builder/audit", () => ({
  listBuilderCapabilityAuditEvents: mocks.listBuilderCapabilityAuditEvents,
}));

vi.mock("@/lib/builder/database-introspection", () => ({
  getBuilderDatabaseInspectionOverview: mocks.getBuilderDatabaseInspectionOverview,
  probeBuilderDatabaseLiveMetadata: mocks.probeBuilderDatabaseLiveMetadata,
}));

vi.mock("@/lib/builder/runtime-orchestration", () => ({
  getBuilderRuntimeInspectionOverview: mocks.getBuilderRuntimeInspectionOverview,
  previewBuilderRuntimeServiceLogs: mocks.previewBuilderRuntimeServiceLogs,
  getBuilderRuntimeServiceLogs: mocks.getBuilderRuntimeServiceLogs,
  resolveBuilderRuntimeService: mocks.resolveBuilderRuntimeService,
  restartBuilderRuntimeService: mocks.restartBuilderRuntimeService,
  startBuilderRuntimeService: mocks.startBuilderRuntimeService,
  stopBuilderRuntimeService: mocks.stopBuilderRuntimeService,
  execBuilderRuntimeServiceCommand: mocks.execBuilderRuntimeServiceCommand,
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
import { POST as postProjectReconcile } from "@/app/api/builder/projects/reconcile/route";
import { DELETE as deleteProject, GET as getProject, PATCH as patchProject } from "@/app/api/builder/projects/[id]/route";
import { POST as postBootstrap } from "@/app/api/builder/projects/[id]/bootstrap/route";
import { POST as postCommand } from "@/app/api/builder/projects/[id]/commands/route";
import { POST as postPlan } from "@/app/api/builder/projects/[id]/plan/route";
import { GET as getProjectEnv, POST as postProjectEnv } from "@/app/api/builder/projects/[id]/env/route";
import { GET as getProjectInspect, POST as postProjectInspect } from "@/app/api/builder/projects/[id]/inspect/route";
import { POST as postProjectRuntimeControl } from "@/app/api/builder/projects/[id]/runtime/control/route";
import { GET as getProjectRuntimeLogs } from "@/app/api/builder/projects/[id]/runtime/logs/route";
import { GET as getProjectRuntimeLogStream } from "@/app/api/builder/projects/[id]/runtime/logs/stream/route";
import { GET as getProcessStream } from "@/app/api/builder/processes/[processId]/stream/route";
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
      { id: "project-1", name: "Demo", slug: "demo", relativePath: "projects/demo", template: "node-cli", packageManager: "NPM", gitInitialized: false, lifecycle: "ACTIVE", lastRunStatus: "IDLE", workspaceState: "present" },
    ]);
    mocks.reconcileBuilderWorkspaceProjects.mockResolvedValue({
      projects: [
        { id: "project-1", name: "Demo", slug: "demo", relativePath: "projects/demo", template: "node-cli", packageManager: "NPM", gitInitialized: false, lifecycle: "ACTIVE", lastRunStatus: "IDLE", workspaceState: "present" },
      ],
      scanned: 1,
      verified: 1,
      relinked: 0,
      imported: 0,
      metadataRebound: 0,
      ignored: 0,
      entries: [
        { action: "verified", projectId: "project-1", relativePath: "projects/demo", metadataProjectId: "project-1", summary: "Verified Builder project Demo at projects/demo." },
      ],
    });
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
    mocks.getBuilderEnvSchema.mockReturnValue({ path: ".env.example", keys: ["DATABASE_URL", "API_KEY"] });
    mocks.validateBuilderProjectEnv.mockReturnValue({
      schemaPath: ".env.example",
      schemaAvailable: true,
      projectReady: false,
      executionReady: true,
      totalRequiredKeys: 2,
      missingProjectKeys: ["DATABASE_URL"],
      missingExecutionKeys: [],
      malformedEntries: [],
      keys: [
        {
          key: "DATABASE_URL",
          required: true,
          examplePresent: true,
          projectValuePresent: false,
          executionValuePresent: true,
          projectSource: null,
          executionSource: "host_env",
          redactedProjectValue: null,
          redactedExecutionValue: "******rl",
        },
        {
          key: "API_KEY",
          required: true,
          examplePresent: true,
          projectValuePresent: true,
          executionValuePresent: true,
          projectSource: ".env.local",
          executionSource: ".env.local",
          redactedProjectValue: "******ey",
          redactedExecutionValue: "******ey",
        },
      ],
      summary: "Execution can rely on host env, but project-local env files are missing: DATABASE_URL.",
    });
    mocks.writeBuilderProjectEnvFileEntry.mockReturnValue({ path: ".env.local", key: "DATABASE_URL", redactedValue: "******rl" });
    mocks.syncBuilderProjectEnvExample.mockReturnValue({ path: ".env.example", addedKeys: ["DATABASE_URL"], totalKeys: 2 });
    mocks.listBuilderCapabilityAuditEvents.mockReturnValue({
      auditPath: "projects/demo/.builder/reports/capability-audit.jsonl",
      totalEvents: 2,
      capabilityCounts: { network_http: 1, database_introspection: 1 },
      outcomeCounts: { succeeded: 1, failed: 1 },
      recentEvents: [
        {
          eventId: "event-1",
          capabilityKey: "database_introspection",
          eventName: "builder.database.inspect",
          timestamp: new Date().toISOString(),
          outcomeStatus: "failed",
          metadata: { operation: "live_probe" },
        },
      ],
    });
    mocks.getBuilderDatabaseInspectionOverview.mockReturnValue({
      artifact: {
        provider: "sqlite",
        datasourceName: "db",
        connectionTarget: "file:dev.db",
        migrationsPath: "projects/demo/prisma/migrations",
        migrationsCount: 1,
        tableCount: 2,
        tables: [{ modelName: "User", tableName: "users", fieldCount: 2 }],
        auditPath: "projects/demo/.builder/reports/capability-audit.jsonl",
      },
      latestLiveProbe: null,
      driftSummary: {
        status: "not_available",
        summary: "Run a live database probe to compare Prisma artifacts against the current database.",
        comparedAt: null,
        artifactTableCount: 2,
        liveTableCount: 0,
        missingInLive: [],
        unexpectedLive: [],
        fieldCountMismatches: [],
      },
    });
    mocks.probeBuilderDatabaseLiveMetadata.mockReturnValue({
      status: "succeeded",
      source: "live",
      provider: "sqlite",
      connectionTarget: "file:dev.db",
      probedAt: new Date().toISOString(),
      summary: "Live sqlite probe found 2 tables.",
      tableCount: 2,
      tables: [{ modelName: "User", tableName: "users", fieldCount: 2 }],
      auditPath: "projects/demo/.builder/reports/capability-audit.jsonl",
    });
    mocks.getBuilderRuntimeInspectionOverview.mockReturnValue({
      summary: "Runtime services: 2 declared, 1 running, 1 managed.",
      totalServices: 2,
      runningServices: 1,
      failedServices: 0,
      managedServices: 1,
      services: [
        {
          serviceId: "script:dev",
          label: "dev",
          source: "package_script",
          runner: "npm_script",
          declaredIn: "projects/demo/package.json",
          command: "next dev",
          processId: "proc-1",
          processStatus: "running",
          status: "running",
          startedAt: "2025-01-01T00:00:00.000Z",
          logPath: ".builder/processes/proc-1.log",
          auditPath: ".builder/processes/proc-1.audit.jsonl",
          supportsStart: false,
          supportsStop: true,
          supportsRestart: true,
          supportsExec: true,
          healthStatus: "healthy",
          healthReason: "Managed Builder process is running.",
          containerId: null,
          publishedPorts: [],
        },
        {
          serviceId: "script:worker",
          label: "worker",
          source: "package_script",
          runner: "npm_script",
          declaredIn: "projects/demo/package.json",
          command: "node worker.js",
          processId: null,
          processStatus: null,
          status: "declared",
          startedAt: null,
          logPath: null,
          auditPath: null,
          supportsStart: true,
          supportsStop: false,
          supportsRestart: true,
          supportsExec: true,
          healthStatus: "declared",
          healthReason: "Builder has not started this service yet.",
          containerId: null,
          publishedPorts: [],
        },
      ],
    });
    mocks.previewBuilderRuntimeServiceLogs.mockResolvedValue({
      service: {
        serviceId: "script:dev",
        label: "dev",
        source: "package_script",
        runner: "npm_script",
        declaredIn: "projects/demo/package.json",
        workingDirectory: "projects/demo",
        command: "next dev",
        processId: "proc-1",
        processStatus: "running",
        status: "running",
        startedAt: "2025-01-01T00:00:00.000Z",
        logPath: ".builder/processes/proc-1.log",
        auditPath: ".builder/processes/proc-1.audit.jsonl",
        supportsStart: false,
        supportsStop: true,
        supportsRestart: true,
        supportsExec: true,
        healthStatus: "healthy",
        healthReason: "Managed Builder process is running.",
        containerId: null,
        publishedPorts: [],
      },
      logs: "ready",
      cursorUsed: 0,
      nextCursor: 5,
      truncatedBeforeCursor: false,
      complete: false,
      followed: false,
      followTimedOut: false,
    });
    const runtimeService = {
      serviceId: "script:dev",
      label: "dev",
      source: "package_script",
      runner: "npm_script",
      declaredIn: "projects/demo/package.json",
      workingDirectory: "projects/demo",
      command: "next dev",
      processId: "proc-1",
      processStatus: "running",
      status: "running",
      startedAt: "2025-01-01T00:00:00.000Z",
      logPath: ".builder/processes/proc-1.log",
      auditPath: ".builder/processes/proc-1.audit.jsonl",
      supportsStart: false,
      supportsStop: true,
      supportsRestart: true,
      supportsExec: true,
      healthStatus: "healthy",
      healthReason: "Managed Builder process is running.",
      containerId: null,
      publishedPorts: [],
    };
    mocks.resolveBuilderRuntimeService.mockReturnValue(runtimeService);
    mocks.restartBuilderRuntimeService.mockResolvedValue({
      status: "completed",
      message: "Restarted service dev.",
      service: runtimeService,
      process: {
        processId: "proc-2",
        status: "running",
        logPath: ".builder/processes/proc-2.log",
        auditPath: ".builder/processes/proc-2.audit.jsonl",
      },
    });
    mocks.startBuilderRuntimeService.mockResolvedValue({
      status: "completed",
      message: "Started service dev.",
      service: runtimeService,
    });
    mocks.stopBuilderRuntimeService.mockResolvedValue({
      status: "completed",
      message: "Stopped service dev.",
      service: {
        ...runtimeService,
        processId: null,
        processStatus: null,
        status: "stopped",
        supportsStart: true,
        supportsStop: false,
        healthStatus: "stopped",
        healthReason: "Managed Builder process is cancelled.",
      },
    });
    mocks.execBuilderRuntimeServiceCommand.mockResolvedValue({
      status: "completed",
      message: "Executed node for service dev.",
      service: runtimeService,
      commandResult: {
        ok: true,
        command: "node",
        args: ["--version"],
        cwd: "projects/demo",
        exitCode: 0,
        signal: null,
        stdout: "v22.0.0",
        stderr: "",
        timedOut: false,
        cancelled: false,
      },
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
    mocks.streamBuilderManagedProcessLogs.mockResolvedValue({
      process: {
        processId: "proc-1",
        status: "exited",
      },
      cursorUsed: 0,
      nextCursor: 12,
      logs: "hello world\n",
      truncatedBeforeCursor: false,
      complete: true,
      followed: true,
      followTimedOut: false,
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
        workspaceState: "present",
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
      configReadiness: {
        schemaPath: ".env.example",
        schemaAvailable: true,
        projectReady: false,
        executionReady: true,
        totalRequiredKeys: 2,
        missingProjectKeys: ["DATABASE_URL"],
        missingExecutionKeys: [],
        malformedEntries: [],
        keys: [
          {
            key: "DATABASE_URL",
            required: true,
            examplePresent: true,
            projectValuePresent: false,
            executionValuePresent: true,
            projectSource: null,
            executionSource: "host_env",
            redactedProjectValue: null,
            redactedExecutionValue: "******rl",
          },
        ],
        summary: "Execution can rely on host env, but project-local env files are missing: DATABASE_URL.",
      },
      operatorTrust: {
        generatedAt: "2025-01-01T00:00:00.000Z",
        overallStatus: "blocked",
        summary: "Operator trust is blocked because config blocked, runtime blocked, review needs review, approvals needs review.",
        review: { status: "warning", summary: "Tests failed after implementation.", reviewStatus: "FAILED", validationPassed: false, riskCount: 1, updatedAt: "2025-01-01T00:00:00.000Z" },
        config: { status: "warning", summary: "Execution can rely on host env, but project-local env files are missing: DATABASE_URL.", schemaAvailable: true, projectReady: false, executionReady: true, missingProjectKeys: ["DATABASE_URL"], missingExecutionKeys: [] },
        runtime: { status: "blocked", summary: "MCP contract drift is active and must be resolved before trusting runtime state.", activeAlertCount: 1, unresolvedAlertCount: 1, autoFixCount: 0, mcpState: "drifted", driftDetected: true },
        approvals: { status: "warning", summary: "1 post approval item is waiting in the human queue.", pendingCount: 1, pendingApprovals: [{ id: "approval-1", postId: "post-1", approvalStatus: "PENDING", postStatus: "PENDING_APPROVAL", platform: "Twitter", excerpt: "Queued post excerpt", notes: "Operator note", createdAt: "2025-01-01T00:00:00.000Z" }] },
        governance: { status: "warning", summary: "Builder capability gates that require explicit approval when invoked: governance_contracts, database_introspection, runtime_orchestration.", approvalRequiredCapabilities: ["governance_contracts", "database_introspection", "runtime_orchestration"] },
        artifactPaths: { markdown: ".builder/reports/operator-trust.md", json: ".builder/reports/operator-trust.json", latestReview: ".builder/reports/latest-review.md", processArtifacts: ".builder/processes" },
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
        config: {
          schemaAvailable: true,
          projectReady: false,
          executionReady: true,
          missingProjectKeys: ["DATABASE_URL"],
          missingExecutionKeys: [],
          malformedEntries: [],
          summary: "Execution can rely on host env, but project-local env files are missing: DATABASE_URL.",
        },
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
      dependencyContract: {
        runId: "run-1",
        currentHash: "dep-hash-1",
        state: "drifted",
        baseline: {
          expectedHash: "dep-hash-0",
          decisionKeys: ["dependency_policy"],
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
        planning: {
          baselineHash: "dep-hash-0",
          currentHash: "dep-hash-1",
          driftDetected: true,
          packageManager: "npm",
          relatedArchitectureDecisionKeys: ["dependency_policy"],
          highlightedPackages: ["next", "prisma"],
          recommendations: ["Review package.json and the active lockfile together before approval."],
          summary: "Dependency contract drift detected: packages(+1/-0/~1/reclass 0), scripts(+0/-0/~1), lockfileChanged=true, packageManagerChanged=false.",
        },
        drift: {
          previousHash: "dep-hash-0",
          currentHash: "dep-hash-1",
          changed: true,
          packages: { added: ["zod"], removed: [], changed: ["next"], reclassified: [] },
          scripts: { added: [], removed: [], changed: ["build"] },
          lockfileChanged: true,
          packageManagerChanged: false,
        },
      },
      fileTopologyContract: {
        runId: "run-1",
        currentHash: "topo-hash-1",
        state: "drifted",
        baseline: {
          expectedHash: "topo-hash-0",
          decisionKeys: ["topology_policy"],
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
        planning: {
          baselineHash: "topo-hash-0",
          currentHash: "topo-hash-1",
          driftDetected: true,
          relatedArchitectureDecisionKeys: ["topology_policy"],
          anchors: { appRoot: "src/app", libRoot: "src/lib", componentsRoot: "src/components", testsRoot: "tests", scriptsRoot: "scripts", prismaRoot: "prisma", tauriRoot: "src-tauri", builderProjectionRoot: ".builder" },
          topLevel: ["src", "tests", "scripts"],
          placementGuidance: ["Keep Builder-managed projection paths under .builder."],
          recommendations: ["Review structural changes as placement policy before approving the new topology baseline."],
          summary: "File topology drift detected: directories(+1/-0), importantFiles(+0/-0), anchorsChanged=1, classificationsChanged=0, rulesChanged=0.",
        },
        drift: {
          previousHash: "topo-hash-0",
          currentHash: "topo-hash-1",
          changed: true,
          directories: { added: ["src/features"], removed: [] },
          importantFiles: { added: [], removed: [] },
          anchorsChanged: ["componentsRoot"],
          classificationsChanged: [],
          rulesChanged: [],
        },
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
      configReadiness: {
        schemaPath: null,
        schemaAvailable: false,
        projectReady: false,
        executionReady: false,
        totalRequiredKeys: 0,
        missingProjectKeys: [],
        missingExecutionKeys: [],
        malformedEntries: [],
        keys: [],
        summary: "No .env.example schema is present yet.",
      },
      operatorTrust: {
        generatedAt: "2025-01-01T00:00:00.000Z",
        overallStatus: "blocked",
        summary: "Operator trust is blocked because config blocked, review needs review.",
        review: { status: "warning", summary: "No structured Builder review exists yet.", reviewStatus: null, validationPassed: null, riskCount: 0, updatedAt: null },
        config: { status: "blocked", summary: "No .env.example schema is present yet.", schemaAvailable: false, projectReady: false, executionReady: false, missingProjectKeys: [], missingExecutionKeys: [] },
        runtime: { status: "trusted", summary: "Runtime artifacts are aligned; MCP snapshot state is captured.", activeAlertCount: 0, unresolvedAlertCount: 0, autoFixCount: 0, mcpState: "captured", driftDetected: false },
        approvals: { status: "trusted", summary: "No pending human approvals are waiting in the queue.", pendingCount: 0, pendingApprovals: [] },
        governance: { status: "warning", summary: "Builder capability gates that require explicit approval when invoked: governance_contracts, database_introspection, runtime_orchestration.", approvalRequiredCapabilities: ["governance_contracts", "database_introspection", "runtime_orchestration"] },
        artifactPaths: { markdown: ".builder/reports/operator-trust.md", json: ".builder/reports/operator-trust.json", latestReview: ".builder/reports/latest-review.md", processArtifacts: ".builder/processes" },
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
      dependencyContract: {
        runId: null,
        currentHash: null,
        state: "not_available",
        baseline: null,
        planning: null,
        drift: null,
      },
      fileTopologyContract: {
        runId: null,
        currentHash: "topo-hash-1",
        state: "pending_capture",
        baseline: null,
        planning: {
          baselineHash: null,
          currentHash: "topo-hash-1",
          driftDetected: true,
          relatedArchitectureDecisionKeys: ["topology_policy"],
          anchors: { appRoot: "src/app", libRoot: "src/lib", componentsRoot: "src/components", testsRoot: "tests", scriptsRoot: "scripts", prismaRoot: "prisma", tauriRoot: "src-tauri", builderProjectionRoot: ".builder" },
          topLevel: ["src", "tests", "scripts"],
          placementGuidance: ["Keep Builder-managed projection paths under .builder."],
          recommendations: ["Capture the current filesystem shape as the accepted file topology contract before broad structural work."],
          summary: "No accepted file topology contract baseline exists yet.",
        },
        drift: null,
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

  it("reconciles Builder workspace folders through the explicit collection action", async () => {
    const response = await postProjectReconcile();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.reconcileBuilderWorkspaceProjects).toHaveBeenCalledTimes(1);
    expect(payload.scanned).toBe(1);
    expect(payload.projects[0]?.workspaceState).toBe("present");
    expect(payload.summary).toContain("Scanned 1 Builder workspace folders");
  });

  it("returns Builder env readiness for a project", async () => {
    const response = await getProjectEnv(new NextRequest("http://localhost/api/builder/projects/project-1/env"), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.schema.keys).toEqual(["DATABASE_URL", "API_KEY"]);
    expect(payload.readiness.missingProjectKeys).toEqual(["DATABASE_URL"]);
  });

  it("writes Builder env entries through the project env action route", async () => {
    const response = await postProjectEnv(new NextRequest("http://localhost/api/builder/projects/project-1/env", {
      method: "POST",
      body: JSON.stringify({ action: "write", key: "DATABASE_URL", value: "postgres://demo", file: ".env.local" }),
      headers: { "Content-Type": "application/json" },
    }), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.writeBuilderProjectEnvFileEntry).toHaveBeenCalledWith("projects/demo", {
      key: "DATABASE_URL",
      value: "postgres://demo",
      file: ".env.local",
    });
    expect(payload.result.key).toBe("DATABASE_URL");
  });

  it("syncs .env.example through the project env action route", async () => {
    const response = await postProjectEnv(new NextRequest("http://localhost/api/builder/projects/project-1/env", {
      method: "POST",
      body: JSON.stringify({ action: "sync_example" }),
      headers: { "Content-Type": "application/json" },
    }), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.syncBuilderProjectEnvExample).toHaveBeenCalledWith("projects/demo");
    expect(payload.result.addedKeys).toEqual(["DATABASE_URL"]);
  });

  it("returns inspection details and triggers a live database probe", async () => {
    const getResponse = await getProjectInspect(new Request("http://localhost/api/builder/projects/project-1/inspect"), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const getPayload = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getPayload.capabilityAudit.totalEvents).toBe(2);
    expect(getPayload.databaseInspection.artifact.provider).toBe("sqlite");
    expect(getPayload.runtimeInspection.totalServices).toBe(2);

    const postResponse = await postProjectInspect(new NextRequest("http://localhost/api/builder/projects/project-1/inspect", {
      method: "POST",
      body: JSON.stringify({ action: "probe_live_database" }),
      headers: { "Content-Type": "application/json" },
    }), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const postPayload = await postResponse.json();

    expect(postResponse.status).toBe(200);
    expect(postPayload.status).toBe("completed");
    expect(mocks.probeBuilderDatabaseLiveMetadata).toHaveBeenCalledWith("project-1", "projects/demo");
  });

  it("returns runtime service log previews for a discovered service", async () => {
    const response = await getProjectRuntimeLogs(new NextRequest("http://localhost/api/builder/projects/project-1/runtime/logs?serviceId=script%3Adev"), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.service.serviceId).toBe("script:dev");
    expect(payload.logs).toBe("ready");
    expect(mocks.previewBuilderRuntimeServiceLogs).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      projectRelativePath: "projects/demo",
      serviceId: "script:dev",
    }));
  });

  it("executes runtime restart and exec control actions", async () => {
    const restartResponse = await postProjectRuntimeControl(new NextRequest("http://localhost/api/builder/projects/project-1/runtime/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restart_service", serviceId: "script:dev" }),
    }), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const restartPayload = await restartResponse.json();

    expect(restartResponse.status).toBe(200);
    expect(restartPayload.status).toBe("completed");
    expect(mocks.restartBuilderRuntimeService).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1", serviceId: "script:dev" }));

    const execResponse = await postProjectRuntimeControl(new NextRequest("http://localhost/api/builder/projects/project-1/runtime/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "exec_in_service", serviceId: "script:dev", command: "node", commandArgs: ["--version"] }),
    }), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const execPayload = await execResponse.json();

    expect(execResponse.status).toBe(200);
    expect(execPayload.commandResult.stdout).toContain("v22");
    expect(mocks.execBuilderRuntimeServiceCommand).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1", serviceId: "script:dev", command: "node" }));
  });

  it("executes runtime start and stop control actions", async () => {
    const startResponse = await postProjectRuntimeControl(new NextRequest("http://localhost/api/builder/projects/project-1/runtime/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start_service", serviceId: "script:dev" }),
    }), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const startPayload = await startResponse.json();

    const stopResponse = await postProjectRuntimeControl(new NextRequest("http://localhost/api/builder/projects/project-1/runtime/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop_service", serviceId: "script:dev" }),
    }), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const stopPayload = await stopResponse.json();

    expect(startResponse.status).toBe(200);
    expect(stopResponse.status).toBe(200);
    expect(startPayload.status).toBe("completed");
    expect(stopPayload.status).toBe("completed");
    expect(mocks.startBuilderRuntimeService).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1", serviceId: "script:dev" }));
    expect(mocks.stopBuilderRuntimeService).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1", serviceId: "script:dev" }));
  });

  it("streams runtime service logs through the runtime stream route", async () => {
    mocks.getBuilderRuntimeServiceLogs.mockResolvedValueOnce({
      service: {
        serviceId: "script:dev",
        label: "dev",
        source: "package_script",
        runner: "npm_script",
        declaredIn: "projects/demo/package.json",
        workingDirectory: "projects/demo",
        command: "next dev",
        processId: "proc-1",
        processStatus: "running",
        status: "running",
        startedAt: "2025-01-01T00:00:00.000Z",
        logPath: ".builder/processes/proc-1.log",
        auditPath: ".builder/processes/proc-1.audit.jsonl",
        supportsStart: false,
        supportsStop: true,
        supportsRestart: true,
        supportsExec: true,
        healthStatus: "healthy",
        healthReason: "Managed Builder process is running.",
        containerId: null,
        publishedPorts: [],
      },
      cursorUsed: 0,
      nextCursor: 5,
      logs: "ready",
      truncatedBeforeCursor: false,
      complete: true,
      followed: true,
      followTimedOut: false,
    });

    const response = await getProjectRuntimeLogStream(new NextRequest("http://localhost/api/builder/projects/project-1/runtime/logs/stream?serviceId=script%3Adev"), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("event: open");
    expect(body).toContain("event: log");
    expect(body).toContain("event: complete");
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
    expect(payload.dependencyContract.state).toBe("drifted");
    expect(payload.fileTopologyContract.state).toBe("drifted");
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
        confirmed: true,
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
      confirmed: true,
      reason: "Accept the new contract for this task.",
    });
    expect(payload.runId).toBe("run-1");
  });

  it("parses and forwards dependency drift resolution commands", async () => {
    const response = await postCommand(new NextRequest("http://localhost/api/builder/projects/project-1/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "resolve_dependency_contract_drift",
        runId: "run-1",
        decision: "approve",
        confirmed: true,
        reason: "Accept the package.json and lockfile rollover.",
      }),
    }), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.recordBuilderProjectCommand).toHaveBeenCalledWith(expect.objectContaining({ id: "project-1" }), {
      action: "resolve_dependency_contract_drift",
      runId: "run-1",
      decision: "approve",
      confirmed: true,
      reason: "Accept the package.json and lockfile rollover.",
    });
    expect(payload.runId).toBe("run-1");
  });

  it("parses and forwards file topology drift resolution commands", async () => {
    const response = await postCommand(new NextRequest("http://localhost/api/builder/projects/project-1/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "resolve_file_topology_contract_drift",
        runId: "run-1",
        decision: "approve",
        confirmed: true,
        reason: "Accept the structural rollover.",
      }),
    }), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.recordBuilderProjectCommand).toHaveBeenCalledWith(expect.objectContaining({ id: "project-1" }), {
      action: "resolve_file_topology_contract_drift",
      runId: "run-1",
      decision: "approve",
      confirmed: true,
      reason: "Accept the structural rollover.",
    });
    expect(payload.runId).toBe("run-1");
  });

  it("rejects governance commands without explicit confirmation", async () => {
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

    expect(response.status).toBe(500);
    expect(String(payload.error)).toContain("requires explicit operator confirmation");
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

  it("streams managed Builder process logs over SSE", async () => {
    const response = await getProcessStream(new NextRequest("http://localhost/api/builder/processes/proc-1/stream?tailBytes=64"), {
      params: Promise.resolve({ processId: "proc-1" }),
    });
    const payload = await response.text();

    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(payload).toContain("event: open");
    expect(payload).toContain("event: state");
    expect(payload).toContain("event: log");
    expect(payload).toContain("hello world");
    expect(payload).toContain("event: complete");
    expect(mocks.streamBuilderManagedProcessLogs).toHaveBeenCalledWith(expect.objectContaining({
      processId: "proc-1",
      tailBytes: 64,
    }));
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