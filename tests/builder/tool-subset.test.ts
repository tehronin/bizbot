import { describe, expect, it } from "vitest";
import { canProfileUseTool } from "@/lib/agent/profiles";
import { BUILDER_CAPABILITY_CATALOG } from "@/lib/builder/capabilities";
import { selectRelevantBuilderToolSubset } from "@/lib/builder/tool-subset";

const builderProfileAllowed = Array.from(new Set([
  ...BUILDER_CAPABILITY_CATALOG
    .flatMap((capability) => capability.tools)
    .filter((toolName) => canProfileUseTool("builder_operator", toolName)),
  "memory_recall_semantic",
  "sidecar_open_panel",
]));

describe("builder tool subset selector", () => {
  it("selects container and scaffold families for dockerization tasks", () => {
    const result = selectRelevantBuilderToolSubset({
      taskSpec: {
        title: "Dockerize the API service",
        summary: "Add Docker and compose support for the web runtime.",
        validators: ["BUILD"],
        architecturalDecisionKeys: ["docker_stage_contract"],
      },
      adherenceMode: "scaffold",
      request: "Dockerize the express service and wire compose startup.",
      profileAllowed: builderProfileAllowed,
    });

    expect(result).toBeDefined();
    expect(result?.familyLabels).toEqual(expect.arrayContaining(["container", "deps", "env"]));
    expect(result?.allowedToolNames).toEqual(expect.arrayContaining([
      "builder_get_project",
      "builder_read_file",
      "builder_validate_container_stage",
      "builder_exec_in_container",
      "builder_service_logs",
      "memory_recall_semantic",
      "sidecar_open_panel",
    ]));
  });

  it("narrows git-focused tasks to version control tools plus core", () => {
    const result = selectRelevantBuilderToolSubset({
      taskSpec: {
        title: "Commit the ready changes",
        summary: "Create a clean git commit for the current task.",
        validators: ["MANUAL_REVIEW"],
        architecturalDecisionKeys: [],
      },
      adherenceMode: "implementation",
      request: "Commit the changes to main with a clean message.",
      profileAllowed: builderProfileAllowed,
    });

    expect(result).toBeDefined();
    expect(result?.familyLabels).toEqual(expect.arrayContaining(["git"]));
    expect(result?.allowedToolNames).toEqual(expect.arrayContaining([
      "builder_git_commit",
      "builder_repo_status",
      "builder_get_project",
    ]));
    expect(result?.allowedToolNames).not.toContain("builder_exec_in_container");
  });

  it("fails open for implementation tasks without clear signals", () => {
    const result = selectRelevantBuilderToolSubset({
      taskSpec: {
        title: "Explore the codebase",
        summary: "Inspect the current project and summarize findings.",
        validators: ["MANUAL_REVIEW"],
        architecturalDecisionKeys: [],
      },
      adherenceMode: "implementation",
      request: "Explore the codebase.",
      profileAllowed: builderProfileAllowed,
    });

    expect(result).toBeUndefined();
  });

  it("returns a core-only subset for analysis-only tasks", () => {
    const result = selectRelevantBuilderToolSubset({
      taskSpec: {
        title: "Capture runtime decisions",
        summary: "Review Docker and process architecture.",
        validators: ["MANUAL_REVIEW"],
        architecturalDecisionKeys: ["docker_stage_contract"],
      },
      adherenceMode: "analysis_only",
      request: "Review the Docker runtime and summarize tradeoffs.",
      profileAllowed: builderProfileAllowed,
    });

    expect(result).toEqual(expect.objectContaining({
      familyLabels: ["core"],
      allowedToolNames: expect.arrayContaining([
        "builder_get_project",
        "builder_read_file",
        "builder_write_file",
      ]),
    }));
    expect(result?.allowedToolNames).not.toContain("builder_exec_in_container");
  });

  it("never returns tools outside the builder profile ceiling", () => {
    const result = selectRelevantBuilderToolSubset({
      taskSpec: {
        title: "Bootstrap the project",
        summary: "Install dependencies and prepare env files.",
        validators: ["BUILD"],
        architecturalDecisionKeys: ["dependency_manager_npm"],
      },
      adherenceMode: "scaffold",
      request: "Bootstrap the project, install npm dependencies, and sync the env example.",
      profileAllowed: builderProfileAllowed,
    });

    expect(result).toBeDefined();
    for (const toolName of result?.allowedToolNames ?? []) {
      expect(builderProfileAllowed).toContain(toolName);
    }
    expect(result?.allowedToolNames).not.toEqual(expect.arrayContaining([
      "builder_plan_task",
      "builder_continue_task",
      "builder_run_agentic_task",
      "builder_run_script",
      "builder_run_command",
    ]));
  });
});