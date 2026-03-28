/** BuilderPlugin — Sandbox builder tools for an external project workspace. */

import type { BuilderPackageManager } from "@prisma/client";
import { runBuilderProjectBootstrap } from "@/lib/builder/bootstrap";
import { recordBuilderProjectCommand } from "@/lib/builder/commands";
import { createBuilderProject, deleteBuilderProject, getBuilderProject, getBuilderRun, listBuilderProjects, listBuilderRuns } from "@/lib/builder/projects";
import {
  createBuilderDirectory,
  getBuilderWorkspaceStatus,
  listBuilderFiles,
  readBuilderFile,
  runBuilderCommand,
  scaffoldBuilderNodePackage,
  writeBuilderFile,
} from "@/lib/builder/workspace";
import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";

interface BuilderListArgs {
  subdir?: string;
}

interface BuilderReadArgs {
  path: string;
}

interface BuilderWriteArgs {
  path: string;
  content: string;
}

interface BuilderCreateDirectoryArgs {
  path: string;
}

interface BuilderRunCommandArgs {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutSeconds?: number;
}

interface BuilderScaffoldArgs {
  projectDir: string;
  packageName: string;
  description?: string;
  entrypoint?: string;
}

interface BuilderCreateProjectArgs {
  name: string;
  slug?: string;
  relativePath?: string;
  template?: string;
  packageManager?: BuilderPackageManager;
}

interface BuilderProjectArgs {
  projectId: string;
}

interface BuilderDeleteProjectArgs {
  projectId: string;
  deleteFiles?: boolean;
}

interface BuilderBootstrapProjectArgs {
  projectId: string;
  initializeGit?: boolean;
  installDependencies?: boolean;
}

interface BuilderInstallDependenciesArgs {
  projectId: string;
  packages?: string[];
  dev?: boolean;
}

interface BuilderRunScriptArgs {
  projectId: string;
  script: string;
  args?: string[];
}

interface BuilderRunGeneratorArgs {
  projectId: string;
  generator: string;
  args?: string[];
}

interface BuilderRunAgenticTaskArgs {
  projectId: string;
  prompt: string;
  profile?: string;
  model?: string;
  args?: string[];
}

interface BuilderRunArgs {
  runId: string;
}

export const builderPlugin = {
  tools: [
    registerTool(defineTool({
      name: "builder_get_status",
      description: "Inspect the dedicated Builder Mode workspace, repository guard, and allowed command list.",
      parameters: { type: "object", properties: {} },
      execute: async () => getBuilderWorkspaceStatus(),
    } satisfies ToolDefinition<Record<string, never>, ReturnType<typeof getBuilderWorkspaceStatus>>)),
    registerTool(defineTool({
      name: "builder_list_projects",
      description: "List persisted Builder Mode projects managed inside the dedicated builder workspace.",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ projects: await listBuilderProjects() }),
    } satisfies ToolDefinition<Record<string, never>, { projects: Awaited<ReturnType<typeof listBuilderProjects>> }>)),
    registerTool(defineTool({
      name: "builder_create_project",
      description: "Create a named Builder Mode project and reserve its dedicated folder inside the builder workspace.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          slug: { type: "string" },
          relativePath: { type: "string" },
          template: { type: "string" },
          packageManager: { type: "string", enum: ["NPM", "PNPM"] },
        },
        required: ["name"],
      },
      execute: async ({ name, slug, relativePath, template, packageManager }: BuilderCreateProjectArgs) => ({
        project: await createBuilderProject({ name, slug, relativePath, template, packageManager }),
      }),
    } satisfies ToolDefinition<BuilderCreateProjectArgs, { project: Awaited<ReturnType<typeof createBuilderProject>> }>)),
    registerTool(defineTool({
      name: "builder_get_project",
      description: "Read a Builder Mode project and its recent run history.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId }: BuilderProjectArgs) => ({
        project: await getBuilderProject(projectId),
        runs: await listBuilderRuns(projectId, 25),
      }),
    } satisfies ToolDefinition<BuilderProjectArgs, { project: Awaited<ReturnType<typeof getBuilderProject>>; runs: Awaited<ReturnType<typeof listBuilderRuns>> }>)),
    registerTool(defineTool({
      name: "builder_delete_project",
      description: "Delete a Builder Mode project record and optionally remove its reserved folder.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          deleteFiles: { type: "boolean", default: false },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId, deleteFiles }: BuilderDeleteProjectArgs) => deleteBuilderProject(projectId, { deleteFiles }),
    } satisfies ToolDefinition<BuilderDeleteProjectArgs, Awaited<ReturnType<typeof deleteBuilderProject>>>)),
    registerTool(defineTool({
      name: "builder_bootstrap_project",
      description: "Bootstrap a Builder Mode project from its selected preset, then optionally initialize git and install dependencies.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          initializeGit: { type: "boolean" },
          installDependencies: { type: "boolean" },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId, initializeGit, installDependencies }: BuilderBootstrapProjectArgs) =>
        runBuilderProjectBootstrap(projectId, { initializeGit, installDependencies }),
    } satisfies ToolDefinition<BuilderBootstrapProjectArgs, Awaited<ReturnType<typeof runBuilderProjectBootstrap>>>)),
    registerTool(defineTool({
      name: "builder_initialize_git",
      description: "Initialize a git repository for a Builder Mode project.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId }: BuilderProjectArgs) => {
        const project = await getBuilderProject(projectId);
        return recordBuilderProjectCommand(project, { action: "initialize_git" });
      },
    } satisfies ToolDefinition<BuilderProjectArgs, Awaited<ReturnType<typeof recordBuilderProjectCommand>>>)),
    registerTool(defineTool({
      name: "builder_install_dependencies",
      description: "Install project dependencies or add packages using the project's configured package manager.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          packages: { type: "array", items: { type: "string" } },
          dev: { type: "boolean", default: false },
        },
        required: ["projectId"],
      },
      execute: async ({ projectId, packages, dev }: BuilderInstallDependenciesArgs) => {
        const project = await getBuilderProject(projectId);
        return recordBuilderProjectCommand(project, { action: "install_dependencies", packages, dev });
      },
    } satisfies ToolDefinition<BuilderInstallDependenciesArgs, Awaited<ReturnType<typeof recordBuilderProjectCommand>>>)),
    registerTool(defineTool({
      name: "builder_run_script",
      description: "Run a named package script inside a Builder Mode project.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          script: { type: "string" },
          args: { type: "array", items: { type: "string" } },
        },
        required: ["projectId", "script"],
      },
      execute: async ({ projectId, script, args }: BuilderRunScriptArgs) => {
        const project = await getBuilderProject(projectId);
        return recordBuilderProjectCommand(project, { action: "run_script", script, args });
      },
    } satisfies ToolDefinition<BuilderRunScriptArgs, Awaited<ReturnType<typeof recordBuilderProjectCommand>>>)),
    registerTool(defineTool({
      name: "builder_add_dependency",
      description: "Add one or more dependencies to a Builder Mode project using the configured package manager.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          packages: { type: "array", items: { type: "string" } },
          dev: { type: "boolean", default: false },
        },
        required: ["projectId", "packages"],
      },
      execute: async ({ projectId, packages, dev }: BuilderInstallDependenciesArgs) => {
        const project = await getBuilderProject(projectId);
        return recordBuilderProjectCommand(project, { action: "add_dependency", packages: packages ?? [], dev });
      },
    } satisfies ToolDefinition<BuilderInstallDependenciesArgs, Awaited<ReturnType<typeof recordBuilderProjectCommand>>>)),
    registerTool(defineTool({
      name: "builder_run_generator",
      description: "Run a one-shot generator package through npx inside a Builder Mode project.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          generator: { type: "string" },
          args: { type: "array", items: { type: "string" } },
        },
        required: ["projectId", "generator"],
      },
      execute: async ({ projectId, generator, args }: BuilderRunGeneratorArgs) => {
        const project = await getBuilderProject(projectId);
        return recordBuilderProjectCommand(project, { action: "run_generator", generator, args });
      },
    } satisfies ToolDefinition<BuilderRunGeneratorArgs, Awaited<ReturnType<typeof recordBuilderProjectCommand>>>)),
    registerTool(defineTool({
      name: "builder_run_agentic_task",
      description: "Run an optional non-interactive builder CLI profile such as Codex against a specific builder project.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          prompt: { type: "string" },
          profile: { type: "string", default: "codex" },
          model: { type: "string" },
          args: { type: "array", items: { type: "string" } },
        },
        required: ["projectId", "prompt"],
      },
      execute: async ({ projectId, prompt, profile, model, args }: BuilderRunAgenticTaskArgs) => {
        const project = await getBuilderProject(projectId);
        return recordBuilderProjectCommand(project, { action: "run_agentic_task", prompt, profile, model, args });
      },
    } satisfies ToolDefinition<BuilderRunAgenticTaskArgs, Awaited<ReturnType<typeof recordBuilderProjectCommand>>>)),
    registerTool(defineTool({
      name: "builder_list_runs",
      description: "List recent Builder Mode runs across all projects or a specific project.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
        },
      },
      execute: async ({ projectId }: Partial<BuilderProjectArgs>) => ({ runs: await listBuilderRuns(projectId, 25) }),
    } satisfies ToolDefinition<Partial<BuilderProjectArgs>, { runs: Awaited<ReturnType<typeof listBuilderRuns>> }>)),
    registerTool(defineTool({
      name: "builder_get_run",
      description: "Read a specific Builder Mode run record including its captured output summary.",
      parameters: {
        type: "object",
        properties: {
          runId: { type: "string" },
        },
        required: ["runId"],
      },
      execute: async ({ runId }: BuilderRunArgs) => ({ run: await getBuilderRun(runId) }),
    } satisfies ToolDefinition<BuilderRunArgs, { run: Awaited<ReturnType<typeof getBuilderRun>> }>)),
    registerTool(defineTool({
      name: "builder_list_files",
      description: "List files inside the external Builder Mode workspace.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string" },
        },
      },
      execute: async ({ subdir }: BuilderListArgs) => ({ files: listBuilderFiles(subdir ?? ".") }),
    } satisfies ToolDefinition<BuilderListArgs, { files: ReturnType<typeof listBuilderFiles> }>)),
    registerTool(defineTool({
      name: "builder_read_file",
      description: "Read a text file from the external Builder Mode workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
      execute: async ({ path }: BuilderReadArgs) => ({ content: readBuilderFile(path) }),
    } satisfies ToolDefinition<BuilderReadArgs, { content: string }>)),
    registerTool(defineTool({
      name: "builder_write_file",
      description: "Write or overwrite a text file inside the external Builder Mode workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
      execute: async ({ path, content }: BuilderWriteArgs) => {
        writeBuilderFile(path, content);
        return { written: true, path };
      },
    } satisfies ToolDefinition<BuilderWriteArgs, { written: boolean; path: string }>)),
    registerTool(defineTool({
      name: "builder_create_directory",
      description: "Create a directory inside the external Builder Mode workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
      execute: async ({ path }: BuilderCreateDirectoryArgs) => {
        createBuilderDirectory(path);
        return { created: true, path };
      },
    } satisfies ToolDefinition<BuilderCreateDirectoryArgs, { created: boolean; path: string }>)),
    registerTool(defineTool({
      name: "builder_scaffold_node_package",
      description: "Scaffold a minimal TypeScript Node package inside the external Builder Mode workspace.",
      parameters: {
        type: "object",
        properties: {
          projectDir: { type: "string" },
          packageName: { type: "string" },
          description: { type: "string" },
          entrypoint: { type: "string", default: "src/index.ts" },
        },
        required: ["projectDir", "packageName"],
      },
      execute: async ({ projectDir, packageName, description, entrypoint }: BuilderScaffoldArgs) => ({
        scaffolded: true,
        ...scaffoldBuilderNodePackage({ projectDir, packageName, description, entrypoint }),
      }),
    } satisfies ToolDefinition<BuilderScaffoldArgs, { scaffolded: boolean; root: string; files: string[] }>)),
    registerTool(defineTool({
      name: "builder_run_command",
      description: "Run an allowlisted command inside the external Builder Mode workspace without shell expansion.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          args: { type: "array", items: { type: "string" } },
          cwd: { type: "string" },
          timeoutSeconds: { type: "number", default: 60 },
        },
        required: ["command"],
      },
      execute: async ({ command, args, cwd, timeoutSeconds }: BuilderRunCommandArgs) => runBuilderCommand(command, args ?? [], { cwd, timeoutSeconds }),
    } satisfies ToolDefinition<BuilderRunCommandArgs, Awaited<ReturnType<typeof runBuilderCommand>>>)),
  ],
};