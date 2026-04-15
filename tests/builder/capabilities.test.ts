import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import {
  BUILDER_CAPABILITY_CATALOG,
  BUILDER_CAPABILITY_DOMAINS,
  BUILDER_CAPABILITY_STATUSES,
  BUILDER_CAPABILITY_TIERS,
  getBuilderCapability,
  listBuilderCapabilities,
} from "@/lib/builder/capabilities";

const builderPluginSource = fs.readFileSync(path.join(process.cwd(), "src/lib/agent/plugins/BuilderPlugin.ts"), "utf-8");
const builderCommandsRouteSource = fs.readFileSync(path.join(process.cwd(), "src/app/api/builder/projects/[id]/commands/route.ts"), "utf-8");

describe("builder capability catalog", () => {
  it("keeps capability keys unique and typed", () => {
    const keys = BUILDER_CAPABILITY_CATALOG.map((capability) => capability.key);
    expect(new Set(keys).size).toBe(keys.length);

    for (const capability of BUILDER_CAPABILITY_CATALOG) {
      expect(BUILDER_CAPABILITY_TIERS).toContain(capability.tier);
      expect(BUILDER_CAPABILITY_STATUSES).toContain(capability.status);
      expect(BUILDER_CAPABILITY_DOMAINS).toContain(capability.domain);
      expect(capability.tools.length).toBeGreaterThan(0);
      expect(capability.audit.outcomeStatuses.length).toBeGreaterThan(0);
    }
  });

  it("returns defensive copies from the public helpers", () => {
    const allCapabilities = listBuilderCapabilities();
    allCapabilities[0]!.tools.push("builder_fake_tool");

    const workspaceCapability = getBuilderCapability("workspace_manipulation");
    expect(workspaceCapability?.tools).not.toContain("builder_fake_tool");
    expect(getBuilderCapability("missing_capability")).toBeNull();
  });

  it("keeps capability tool catalogs aligned with the Builder plugin tool surface", () => {
    for (const capability of BUILDER_CAPABILITY_CATALOG) {
      for (const toolName of capability.tools) {
        expect(
          builderPluginSource.includes(`name: "${toolName}"`) || builderCommandsRouteSource.includes(`"${toolName}"`),
          `Expected ${toolName} to be exposed through the Builder plugin or Builder command route.`,
        ).toBe(true);
      }
    }
  });

  it("marks shipped extension surfaces as available and keeps runtime orchestration experimental", () => {
    expect(getBuilderCapability("network_http")?.status).toBe("available");
    expect(getBuilderCapability("database_introspection")?.status).toBe("available");
    expect(getBuilderCapability("container_inspection")?.tools).toEqual(expect.arrayContaining([
      "builder_list_containers",
      "builder_list_managed_containers",
      "builder_get_container",
      "builder_container_logs",
      "builder_stat_path_in_container",
      "builder_list_files_in_container",
      "builder_read_file_in_container",
    ]));
    expect(getBuilderCapability("container_execution")?.tools).toEqual(expect.arrayContaining([
      "builder_validate_container_stage",
      "builder_test_in_container",
      "builder_exec_in_container",
      "builder_remove_managed_containers",
      "builder_clean_stale_containers",
    ]));
    expect(getBuilderCapability("version_control")?.tools).toEqual(expect.arrayContaining([
      "builder_repo_diff",
      "builder_repo_log",
      "builder_repo_show",
      "builder_git_add",
      "builder_git_commit",
      "builder_git_branch",
      "builder_git_checkout",
    ]));
    expect(getBuilderCapability("version_control_remote")?.tools).toEqual(expect.arrayContaining([
      "builder_git_remote_add",
      "builder_git_fetch",
      "builder_git_pull",
      "builder_git_push",
      "builder_git_clone",
    ]));
    expect(getBuilderCapability("container_execution")?.policy.requiresExplicitApproval).toBe(true);
    expect(getBuilderCapability("runtime_orchestration")?.tier).toBe("experimental");
    expect(getBuilderCapability("runtime_orchestration")?.status).toBe("partial");
  });
});