import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBuilderPlanAdherence, composeBuilderPlannerPrompt, composeBuilderTaskPrompt } from "@/lib/builder/prompt";

describe("builder prompt synthesis", () => {
  it("preserves the live express-prisma analysis-only regression evidence", () => {
    const fixturePath = resolve(process.cwd(), "tests/builder/fixtures/express-prisma-plan-adherence.json");
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      adherence: {
        status: string;
        mode: string;
        requiredDecisionKeys: string[];
      };
      operatorInstruction: string;
      earlyToolCalls: string[];
      disallowedEarlyToolCalls: string[];
      completion: {
        status: string;
        changedFiles: string[];
      };
    };

    expect(fixture.adherence.status).toBe("aligned");
    expect(fixture.adherence.mode).toBe("analysis_only");
    expect(fixture.adherence.requiredDecisionKeys).toEqual([
      "tech_stack_runtime",
      "tech_stack_framework",
      "service_surface_rest_api",
      "response_format_json",
      "orm_prisma",
      "database_strategy_sqlite",
      "persistence_relational",
    ]);
    expect(fixture.operatorInstruction).toContain("hard boundary");
    expect(fixture.earlyToolCalls).toEqual([
      "builder_get_project",
      "builder_write_project_instructions",
      "builder_list_files",
      "builder_list_files",
      "builder_read_file",
      "builder_read_file",
      "builder_list_files",
      "builder_read_file",
    ]);
    expect(fixture.earlyToolCalls.some((name) => fixture.disallowedEarlyToolCalls.includes(name))).toBe(false);
    expect(fixture.completion.status).toBe("COMPLETED");
    expect(fixture.completion.changedFiles).toEqual(expect.arrayContaining([
      "projects/express-prisma-items-api/.builder/project-context.md",
      "projects/express-prisma-items-api/.builder/task-board.md",
      "projects/express-prisma-items-api/AGENTS.md",
    ]));
    expect(fixture.completion.changedFiles.every((path) => path.startsWith("projects/express-prisma-items-api/.builder/") || path === "projects/express-prisma-items-api/AGENTS.md")).toBe(true);
  });

  it("preserves the live node-cli implementation verification evidence", () => {
    const fixturePath = resolve(process.cwd(), "tests/builder/fixtures/node-cli-implementation-verification.json");
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      project: {
        template: string;
        packageManager: string;
      };
      task: {
        title: string;
        validators: string[];
      };
      prompt: {
        contains: string[];
      };
      completion: {
        status: string;
        summary: string;
        changedFiles: string[];
        validation: {
          passed: boolean;
          skipped: boolean;
          scripts: string[];
        };
        sourceMarkers: string[];
      };
    };

    expect(fixture.project.template).toBe("node-cli");
    expect(fixture.project.packageManager).toBe("NPM");
    expect(fixture.task.title).toBe("Implement health and items endpoints");
    expect(fixture.task.validators).toEqual(["BUILD", "TYPECHECK"]);
    expect(fixture.prompt.contains).toEqual(expect.arrayContaining([
      "Node CLI template guidance:",
      "Validators: build, typecheck.",
    ]));
    expect(fixture.completion.status).toBe("SUCCEEDED");
    expect(fixture.completion.summary).toBe("Builder loop completed after 1 iteration. Verification passed.");
    expect(fixture.completion.changedFiles).toEqual(["projects/node-cli-e2e-20260404-132415/src/index.ts"]);
    expect(fixture.completion.validation).toEqual({
      passed: true,
      skipped: false,
      scripts: ["typecheck", "build"],
    });
    expect(fixture.completion.sourceMarkers).toEqual(expect.arrayContaining([
      "app.use(express.json());",
      "app.get('/items', (req, res) => {",
      "app.post('/items', (req, res) => {",
    ]));
  });

  it("builds a compact task prompt from project state and selected fragments", () => {
    const adherence = buildBuilderPlanAdherence({
      task: {
        title: "Add planning tables",
        acceptanceCriteria: ["Add the endpoint", "Run tests"],
        metadata: { planSteps: [{ id: "1", label: "Implement Add planning tables.", status: "in_progress" }] },
      },
      context: {
        objective: "Ship the demo app.",
        plannedStack: null,
        architectureNotes: [],
        architecture: {
          active: [],
          stale: [{
            key: "planning_schema",
            canonicalKey: "builder:project-1:planning_schema",
            displayName: "planning_schema",
            description: "Planning schema remains canonical.",
            confidence: 0.9,
            status: "deprecated",
            source: "builder_adr",
            updatedAt: new Date("2026-04-04T00:00:00.000Z").toISOString(),
          }],
        },
        codingConventions: ["Use App Router."],
        constraints: ["Stay inside the external workspace."],
        importantCommands: ["pnpm test"],
        currentPlan: [{ id: "1", label: "Implement Add planning tables.", status: "in_progress" }],
        latestSessionSummary: "Previous test failed.",
        knownFailures: ["pnpm test currently fails."],
        nextSteps: ["Fix the test."],
        instructionNotes: null,
        updatedAt: null,
      },
      currentMilestone: {
        id: "milestone-1",
        title: "Plan foundation",
        summary: "Persist the brief and milestones.",
        status: "ACTIVE",
        sortOrder: 1,
        taskSpecs: [],
      },
      currentTaskSpec: {
        id: "task-spec-1",
        milestoneId: "milestone-1",
        title: "Add planning tables",
        summary: "Extend the Builder schema.",
        status: "ACTIVE",
        sortOrder: 1,
        completionCriteria: ["Add the endpoint", "Run tests"],
        validators: ["TYPECHECK", "MANUAL_REVIEW"],
        architecturalDecisionKeys: ["planning_schema"],
        dependencyIds: [],
      },
    });

    const prompt = composeBuilderTaskPrompt({
      project: {
        name: "Demo",
        relativePath: "projects/demo",
        template: "next-app",
        packageManager: "PNPM",
      } as never,
      task: {
        title: "Add a health endpoint",
        acceptanceCriteria: ["Add the endpoint", "Run tests"],
        metadata: { planSteps: [{ id: "1", label: "Implement endpoint", status: "in_progress" }] },
      } as never,
      context: {
        objective: "Ship the demo app.",
        plannedStack: {
          presetKey: "next-tailwind-prisma",
          label: "Next.js + Prisma + Tailwind",
          template: "next-app",
          packageManager: "NPM",
          tags: ["react", "nextjs", "prisma", "tailwind"],
        },
        architectureNotes: [],
        codingConventions: ["Use App Router."],
        constraints: ["Stay inside the external workspace."],
        importantCommands: ["pnpm test"],
        currentPlan: [],
        latestSessionSummary: "Previous test failed.",
        knownFailures: ["pnpm test currently fails."],
        nextSteps: ["Fix the test."],
        instructionNotes: null,
        updatedAt: null,
      },
      lifecycle: "ACTIVE",
      brief: {
        id: "brief-1",
        projectId: "project-1",
        title: "Demo brief",
        summary: "Drive Builder through a staged project planner.",
        goals: [],
        constraints: [],
        deliverables: [],
        notes: null,
      } as never,
      currentMilestone: {
        id: "milestone-1",
        title: "Plan foundation",
        summary: "Persist the brief and milestones.",
        status: "ACTIVE",
        sortOrder: 1,
        taskSpecs: [],
      },
      currentTaskSpec: {
        id: "task-spec-1",
        milestoneId: "milestone-1",
        title: "Add planning tables",
        summary: "Extend the Builder schema.",
        status: "ACTIVE",
        sortOrder: 1,
        completionCriteria: ["Add the endpoint", "Run tests"],
        validators: ["TYPECHECK", "MANUAL_REVIEW"],
        architecturalDecisionKeys: ["planning_schema"],
        dependencyIds: [],
      },
      request: "Add a health endpoint and rerun the tests.",
      stage: "IMPLEMENTING",
      fragments: [{ source: "AGENTS.md", heading: "Mission", content: "Keep edits small and reviewable." }],
      adherence,
    });

    expect(prompt).toContain("Builder mission");
    expect(prompt).toContain("Project lifecycle: active.");
    expect(prompt).toContain("Planned stack: Next.js + Prisma + Tailwind");
    expect(prompt).toContain("Current milestone: Plan foundation");
    expect(prompt).toContain("Validators: typecheck, manual_review.");
    expect(prompt).toContain("Next App template guidance:");
    expect(prompt).toContain("[Plan Adherence]");
    expect(prompt).toContain("Relevant MCP context: none selected.");
    expect(prompt).toContain("Only introduce or revise architecture needed for: planning_schema.");
    expect(prompt).toContain("Add a health endpoint");
    expect(prompt).toContain("Keep edits small and reviewable.");
    expect(prompt).not.toContain("undefined");
  });

  it("injects only the bounded relevant MCP slice into task and planner prompts", () => {
    const taskPrompt = composeBuilderTaskPrompt({
      project: {
        name: "Demo",
        relativePath: "projects/demo",
        template: "node-cli",
        packageManager: "NPM",
      } as never,
      task: {
        title: "Verify the health route",
        acceptanceCriteria: ["Run tests"],
        metadata: null,
      } as never,
      context: {
        objective: "Ship the demo app.",
        plannedStack: null,
        architectureNotes: [],
        codingConventions: [],
        constraints: [],
        importantCommands: [],
        currentPlan: [],
        latestSessionSummary: null,
        knownFailures: [],
        nextSteps: [],
        instructionNotes: null,
        updatedAt: null,
      },
      lifecycle: "ACTIVE",
      brief: null,
      currentMilestone: null,
      currentTaskSpec: null,
      request: "Run the targeted verification.",
      stage: "TESTING",
      fragments: [],
      mcpContext: {
        currentHash: "hash-verify",
        reasons: ["mode:verification", "validator:test"],
        tools: [{ name: "builder_run_script", title: "Run Script", description: "Run a package script.", ownerId: "builder", ownerKind: "builtin-plugin", annotations: null, parameters: null }],
        prompts: [{ sourceKind: "builtin", serverName: null, name: "debug-runtime", title: "Debug Runtime", description: "Investigate runtime issues.", ownerId: "developer", group: "developer", arguments: [] }],
        resources: [{ sourceKind: "builtin", serverName: null, name: "builder-current-runs", uri: "bizbot://builder/current-runs", title: "Current Builder Runs", description: "Recent Builder runs.", ownerId: "builder", group: "builder", mimeType: "application/json" }],
      },
    });
    const plannerPrompt = composeBuilderPlannerPrompt({
      project: {
        name: "Demo",
        relativePath: "projects/demo",
        template: "next-app",
        packageManager: "PNPM",
      } as never,
      brief: {
        id: "brief-1",
        projectId: "project-1",
        title: "Planner brief",
        summary: "Plan the external project.",
        goals: [],
        constraints: [],
        deliverables: [],
        notes: null,
      } as never,
      context: {
        objective: "Plan the project.",
        plannedStack: null,
        architectureNotes: [],
        codingConventions: [],
        constraints: [],
        importantCommands: [],
        currentPlan: [],
        latestSessionSummary: null,
        knownFailures: [],
        nextSteps: [],
        instructionNotes: null,
        updatedAt: null,
      },
      constraints: [],
      nonGoals: [],
      acceptanceCriteria: [],
      activeArchitecture: [],
      staleArchitecture: [],
      dependencyContext: {
        currentHash: "dep-hash-plan",
        packageManager: "pnpm",
        highlightedPackages: ["next", "react", "@prisma/client"],
        classifications: {
          framework: ["next"],
          ui: ["react"],
          database: ["@prisma/client"],
          mcp: [],
          queue: [],
          desktop: [],
          validation: [],
          graph: [],
          ai: [],
        },
        reasons: ["mode:analysis_only", "template:next-app"],
      },
      mcpContext: {
        currentHash: "hash-plan",
        reasons: ["mode:analysis_only", "template:next-app"],
        tools: [{ name: "developer_preview_mcp_exposure", title: "Preview MCP Exposure", description: "Inspect the MCP surface.", ownerId: "developer", ownerKind: "builtin-plugin", annotations: null, parameters: null }],
        prompts: [],
        resources: [{ sourceKind: "builtin", serverName: null, name: "plugins-mcp-surface-preview", uri: "bizbot://plugins/mcp-surface-preview", title: "Plugin MCP Surface Preview", description: "Current MCP tool, prompt, and resource catalogs.", ownerId: "developer", group: "plugins", mimeType: "application/json" }],
      },
      dependencyPlanningContext: {
        baselineHash: "dep-hash-baseline",
        currentHash: "dep-hash-plan",
        driftDetected: true,
        packageManager: "pnpm",
        relatedArchitectureDecisionKeys: ["dependency_manager_pnpm", "framework_next", "orm_prisma"],
        highlightedPackages: ["next", "react", "@prisma/client"],
        recommendations: ["Review package.json and the active lockfile together."],
        summary: "Dependency contract drift detected.",
        drift: {
          previousHash: "dep-hash-baseline",
          currentHash: "dep-hash-plan",
          changed: true,
          packageManagerChanged: false,
          lockfileChanged: true,
          packages: {
            added: ["zod"],
            removed: [],
            changed: ["next"],
            reclassified: [],
          },
          scripts: {
            added: [],
            removed: [],
            changed: ["build"],
          },
        },
      },
    });

    expect(taskPrompt).toContain("[Relevant MCP Context]");
    expect(taskPrompt).toContain("builder_run_script");
    expect(taskPrompt).toContain("debug-runtime");
    expect(taskPrompt).toContain("bizbot://builder/current-runs");
    expect(taskPrompt).not.toContain("developer_preview_mcp_exposure");
    expect(plannerPrompt).toContain("[Relevant Dependency Context]");
    expect(plannerPrompt).toContain("dep-hash-plan");
    expect(plannerPrompt).toContain("@prisma/client");
    expect(plannerPrompt).toContain("[Dependency Contract Evolution]");
    expect(plannerPrompt).toContain("Dependency contract drift detected.");
    expect(plannerPrompt).toContain("hash-plan");
    expect(plannerPrompt).toContain("developer_preview_mcp_exposure");
    expect(plannerPrompt).toContain("bizbot://plugins/mcp-surface-preview");
    expect(plannerPrompt).not.toContain("builder_run_script");
  });

  it("adds node-cli guidance for dist outputs, cross-platform scripts, and Prisma runtime alignment", () => {
    const adherence = buildBuilderPlanAdherence({
      task: {
        title: "Set up the Express server shell",
        acceptanceCriteria: ["Create the server shell"],
        metadata: { planSteps: [{ id: "1", label: "Implement Set up the Express server shell.", status: "in_progress" }] },
      },
      context: {
        objective: "Ship the demo app.",
        plannedStack: null,
        architectureNotes: [],
        architecture: { active: [], stale: [] },
        codingConventions: [],
        constraints: ["Stay inside the external workspace."],
        importantCommands: [],
        currentPlan: [{ id: "1", label: "Implement Set up the Express server shell.", status: "in_progress" }],
        latestSessionSummary: null,
        knownFailures: [],
        nextSteps: [],
        instructionNotes: null,
        updatedAt: null,
      },
      currentMilestone: {
        id: "milestone-1",
        title: "Build the API",
        summary: "Implement the service shell.",
        status: "ACTIVE",
        sortOrder: 1,
        taskSpecs: [],
      },
      currentTaskSpec: {
        id: "task-spec-1",
        milestoneId: "milestone-1",
        title: "Set up the Express server shell",
        summary: "Create the runtime shell and package wiring.",
        status: "ACTIVE",
        sortOrder: 1,
        completionCriteria: ["Create the server shell"],
        validators: ["MANUAL_REVIEW"],
        architecturalDecisionKeys: [],
        dependencyIds: [],
      },
    });

    const prompt = composeBuilderTaskPrompt({
      project: {
        name: "Demo CLI",
        relativePath: "projects/demo-cli",
        template: "node-cli",
        packageManager: "NPM",
      } as never,
      task: {
        title: "Set up the Express server shell",
        acceptanceCriteria: ["Create the server shell"],
        metadata: { planSteps: [{ id: "1", label: "Implement Set up the Express server shell.", status: "in_progress" }] },
      } as never,
      context: {
        objective: "Ship the demo app.",
        plannedStack: null,
        architectureNotes: [],
        codingConventions: [],
        constraints: ["Stay inside the external workspace."],
        importantCommands: [],
        currentPlan: [],
        latestSessionSummary: null,
        knownFailures: [],
        nextSteps: [],
        instructionNotes: null,
        updatedAt: null,
      },
      lifecycle: "ACTIVE",
      brief: {
        id: "brief-1",
        projectId: "project-1",
        title: "Demo brief",
        summary: "Build a service shell.",
        goals: [],
        constraints: [],
        deliverables: [],
        notes: null,
      } as never,
      currentMilestone: {
        id: "milestone-1",
        title: "Build the API",
        summary: "Implement the service shell.",
        status: "ACTIVE",
        sortOrder: 1,
        taskSpecs: [],
      },
      currentTaskSpec: {
        id: "task-spec-1",
        milestoneId: "milestone-1",
        title: "Set up the Express server shell",
        summary: "Create the runtime shell and package wiring.",
        status: "ACTIVE",
        sortOrder: 1,
        completionCriteria: ["Create the server shell"],
        validators: ["MANUAL_REVIEW"],
        architecturalDecisionKeys: [],
        dependencyIds: [],
      },
      request: "Set up the Express server shell.",
      stage: "IMPLEMENTING",
      fragments: [],
      adherence,
    });

    expect(prompt).toContain("Node CLI template guidance:");
    expect(prompt).toContain("Keep TypeScript builds emitting to dist");
    expect(prompt).toContain("avoid shell-specific env assignment");
    expect(prompt).toContain("PrismaClient");
  });

  it("builds a blocking adherence state when the task record drifts from the active task spec", () => {
    const adherence = buildBuilderPlanAdherence({
      task: {
        title: "Capture scope and authority split",
        acceptanceCriteria: ["Record scope"],
        metadata: { planSteps: [{ id: "1", label: "Implement health endpoints.", status: "in_progress" }] },
      },
      context: {
        objective: "Ship the demo app.",
        plannedStack: null,
        architectureNotes: [],
        architecture: { active: [], stale: [] },
        codingConventions: [],
        constraints: [],
        importantCommands: [],
        currentPlan: [],
        latestSessionSummary: null,
        knownFailures: [],
        nextSteps: [],
        instructionNotes: null,
        updatedAt: null,
      },
      currentMilestone: {
        id: "milestone-1",
        title: "Confirm API contract",
        summary: "Capture the contract.",
        status: "ACTIVE",
        sortOrder: 1,
        taskSpecs: [],
      },
      currentTaskSpec: {
        id: "task-spec-1",
        milestoneId: "milestone-1",
        title: "Capture runtime and endpoint decisions",
        summary: "Record the contract.",
        status: "ACTIVE",
        sortOrder: 1,
        completionCriteria: ["Record the contract."],
        validators: ["MANUAL_REVIEW"],
        architecturalDecisionKeys: [],
        dependencyIds: [],
      },
    });

    expect(adherence.allowsExecution).toBe(false);
    expect(adherence.blockingIssues).toEqual(expect.arrayContaining([
      expect.stringContaining("does not match current task spec"),
      expect.stringContaining("Active plan step"),
    ]));
  });

  it("builds a planner prompt with exact brief and architecture context blocks", () => {
    const prompt = composeBuilderPlannerPrompt({
      project: {
        id: "project-1",
        name: "Demo",
        relativePath: "projects/demo",
        template: "next-app",
        packageManager: "PNPM",
      } as never,
      brief: {
        id: "brief-1",
        projectId: "project-1",
        title: "Builder v3.1 second pass",
        summary: "Harden planning and ADR reconciliation without changing the execution loop.",
        goals: ["Keep the current route and plugin surfaces."],
        constraints: ["No new Prisma models."],
        deliverables: ["Planner hardening", "Living ADR reconciliation"],
        notes: "Non-goals: execution loop rewrites, new routes",
      } as never,
      context: {
        objective: "Harden Builder planning.",
        plannedStack: {
          presetKey: "next-tailwind-prisma",
          label: "Next.js + Prisma + Tailwind",
          template: "next-app",
          packageManager: "NPM",
          tags: ["react", "nextjs", "prisma", "tailwind"],
        },
        architectureNotes: [],
        architecture: {
          active: [{
            key: "planning_authority_split",
            canonicalKey: "builder:project-1:planning_authority_split",
            displayName: "planning_authority_split",
            description: "Database planning remains canonical.",
            confidence: 0.9,
            status: "active",
            source: "builder_adr",
            updatedAt: new Date("2026-04-04T00:00:00.000Z").toISOString(),
          }],
          stale: [{
            key: "legacy_projection_path",
            canonicalKey: "builder:project-1:legacy_projection_path",
            displayName: "legacy_projection_path",
            description: "Old projection path needs reconfirmation.",
            confidence: 0.8,
            status: "deprecated",
            source: "builder_adr",
            updatedAt: new Date("2026-04-04T00:00:00.000Z").toISOString(),
          }],
        },
        codingConventions: [],
        constraints: ["Preserve the execution loop."],
        importantCommands: [],
        currentPlan: [],
        latestSessionSummary: null,
        knownFailures: [],
        nextSteps: [],
        instructionNotes: "Keep the planner output structured.",
        updatedAt: null,
      },
      constraints: ["No new routes.", "No new models."],
      nonGoals: ["Execution loop rewrites", "New plugin entry points"],
      acceptanceCriteria: ["Planner validates stale ADR reconciliation", "Planner output stays dependency-safe"],
      activeArchitecture: [{
        key: "planning_authority_split",
        canonicalKey: "builder:project-1:planning_authority_split",
        displayName: "planning_authority_split",
        description: "Database planning remains canonical.",
        confidence: 0.9,
        status: "active",
        source: "builder_adr",
        updatedAt: new Date("2026-04-04T00:00:00.000Z").toISOString(),
      }],
      staleArchitecture: [{
        key: "legacy_projection_path",
        canonicalKey: "builder:project-1:legacy_projection_path",
        displayName: "legacy_projection_path",
        description: "Old projection path needs reconfirmation.",
        confidence: 0.8,
        status: "deprecated",
        source: "builder_adr",
        updatedAt: new Date("2026-04-04T00:00:00.000Z").toISOString(),
      }],
    });

    expect(prompt).toContain("[Brief]");
    expect(prompt).toContain("[Constraints]");
    expect(prompt).toContain("[Non-Goals]");
    expect(prompt).toContain("[Acceptance Criteria]");
    expect(prompt).toContain("[Template Guidance]");
    expect(prompt).toContain("Planned stack: Next.js + Prisma + Tailwind");
    expect(prompt).toContain("[Active Architecture]");
    expect(prompt).toContain("[Stale Architecture - Needs Reconfirmation]");
    expect(prompt).toContain("No new models.");
    expect(prompt).toContain("Execution loop rewrites");
    expect(prompt).toContain("Planner validates stale ADR reconciliation");
    expect(prompt).toContain("Active architecture should be carried forward when it still governs the plan");
    expect(prompt).toContain("next-app");
  });
});