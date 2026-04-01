import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { builderPlugin } from "@/lib/agent/plugins/BuilderPlugin";
import { executeTool, getAllToolDefinitions, getBuiltinPlugins } from "@/lib/agent/plugins";
import { canProfileUseTool } from "@/lib/agent/profiles";

function asObjectResult<T extends object>(value: unknown): T {
  return value as T;
}

function requireTool(name: string) {
  const tool = builderPlugin.tools.find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

function createTempBuilderWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-builder-"));
}

afterEach(() => {
  delete process.env.BIZBOT_BUILDER_WORKSPACE_PATH;
  delete process.env.BIZBOT_BUILDER_ALLOWED_COMMANDS;
});

describe("builder plugin", () => {
  it("is included in the builtin plugin registry", () => {
    const plugin = getBuiltinPlugins().find((entry) => entry.metadata.id === "builder");

    expect(plugin?.metadata.displayName).toBe("Builder");
    expect(plugin?.tools.map((tool) => tool.name)).toContain("builder_run_command");
    expect(plugin?.tools.map((tool) => tool.name)).toContain("builder_run_agentic_task");
  });

  it("reports an unsafe default workspace when it overlaps the repo", async () => {
    const tool = requireTool("builder_get_status");
    const result = asObjectResult<{ safe: boolean; reason: string }>(await tool.execute({}, {}));

    expect(result.safe).toBe(false);
    expect(String(result.reason)).toContain("BIZBOT_BUILDER_WORKSPACE_PATH");
  });

  it("writes, reads, lists, and scaffolds inside the dedicated builder workspace", async () => {
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = createTempBuilderWorkspace();

    await requireTool("builder_create_directory").execute({ path: "apps/demo/src" }, {});
    await requireTool("builder_write_file").execute({ path: "apps/demo/src/value.txt", content: "42" }, {});
    const readResult = await requireTool("builder_read_file").execute({ path: "apps/demo/src/value.txt" }, {});
    const listResult = asObjectResult<{ files: Array<{ path: string }> }>(await requireTool("builder_list_files").execute({ subdir: "apps/demo/src" }, {}));
    const scaffoldResult = await requireTool("builder_scaffold_node_package").execute({
      projectDir: "apps/pkg",
      packageName: "pkg-demo",
      description: "fixture package",
    }, {});

    expect(readResult).toEqual({ content: "42" });
    expect(listResult.files.map((entry: { path: string }) => entry.path)).toContain("apps/demo/src/value.txt");
    expect(scaffoldResult).toEqual({
      scaffolded: true,
      root: "apps/pkg",
      files: [
        "apps/pkg/package.json",
        "apps/pkg/tsconfig.json",
        "apps/pkg/.gitignore",
        "apps/pkg/README.md",
        "apps/pkg/src/index.ts",
      ],
    });
  });

  it("runs only allowlisted commands and blocks repo path references", async () => {
    process.env.BIZBOT_BUILDER_WORKSPACE_PATH = createTempBuilderWorkspace();
    process.env.BIZBOT_BUILDER_ALLOWED_COMMANDS = "node";

    const commandResult = await requireTool("builder_run_command").execute({
      command: "node",
      args: ["-e", "console.log('builder-ok')"],
    }, {});
    const command = asObjectResult<{ ok: boolean; stdout: string }>(commandResult);

    expect(command.ok).toBe(true);
    expect(command.stdout.trim()).toBe("builder-ok");

    await expect(() => requireTool("builder_run_command").execute({
      command: "npm",
      args: ["--version"],
    }, {})).rejects.toThrow("Builder command not allowed");

    await expect(() => requireTool("builder_run_command").execute({
      command: "node",
      args: [process.cwd()],
    }, {})).rejects.toThrow("Builder command arguments reference the BizBot repository");
  });

  it("enforces lane gating for builder tools and exposes them to the MCP lane", () => {
    expect(canProfileUseTool("builder_operator", "builder_get_status")).toBe(true);
    expect(canProfileUseTool("builder_operator", "builder_continue_task")).toBe(false);
    expect(canProfileUseTool("builder_operator", "builder_run_agentic_task")).toBe(false);
    expect(canProfileUseTool("builder_operator", "builder_run_script")).toBe(false);
    expect(canProfileUseTool("builder_operator", "builder_run_command")).toBe(false);
    expect(canProfileUseTool("general_operator", "builder_get_status")).toBe(false);
    expect(canProfileUseTool("mcp_operator", "builder_get_status")).toBe(true);

    const mcpTools = getAllToolDefinitions(undefined, { agentProfile: "mcp_operator" }).map((tool) => tool.name);
    expect(mcpTools).toContain("builder_get_status");
    expect(mcpTools).toContain("builder_run_command");
  });

  it("rejects unsafe builder workspace execution through the shared tool executor", async () => {
    await expect(() => executeTool("builder_write_file", { path: "demo.txt", content: "bad" }, {
      access: { agentProfile: "builder_operator" },
    })).rejects.toThrow("Builder workspace overlaps the BizBot repository");
  });
});