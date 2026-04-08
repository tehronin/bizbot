import path from "path";
import type { BuilderPackageManager, BuilderProject } from "@prisma/client";
import { createBuilderDirectory, listBuilderFilesRecursive, readBuilderFile, scaffoldBuilderNodePackage, writeBuilderFile } from "@/lib/builder/workspace";

export interface BuilderBootstrapResult {
  template: string;
  root: string;
  files: string[];
}

function packageManagerFlag(packageManager: BuilderPackageManager): "--use-npm" | "--use-pnpm" {
  return packageManager === "PNPM" ? "--use-pnpm" : "--use-npm";
}

async function bootstrapNodeCli(project: BuilderProject): Promise<BuilderBootstrapResult> {
  const scaffold = scaffoldBuilderNodePackage({
    projectDir: project.relativePath,
    packageName: project.slug,
    description: `${project.name} scaffolded by BizBot Builder Mode.`,
  });

  return { template: project.template, ...scaffold };
}

async function bootstrapPluginPackage(project: BuilderProject): Promise<BuilderBootstrapResult> {
  const scaffold = scaffoldBuilderNodePackage({
    projectDir: project.relativePath,
    packageName: project.slug,
    description: `${project.name} plugin package scaffolded by BizBot Builder Mode.`,
    entrypoint: "src/plugin.ts",
  });

  const packageJsonPath = path.posix.join(project.relativePath, "package.json");
  const packageJson = JSON.parse(readBuilderFile(packageJsonPath)) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  packageJson.scripts = {
    ...(packageJson.scripts ?? {}),
    test: "vitest run",
  };
  packageJson.devDependencies = {
    ...(packageJson.devDependencies ?? {}),
    vitest: "^3.2.4",
  };
  writeBuilderFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const testPath = path.posix.join(project.relativePath, "tests/plugin.test.ts");
  writeBuilderFile(testPath, [
    'import { describe, expect, it } from "vitest";',
    'import { pluginName } from "../src/plugin";',
    "",
    'describe("plugin package", () => {',
    '  it("exports a stable name", () => {',
    `    expect(pluginName).toBe("${project.slug}");`,
    "  });",
    "});",
    "",
  ].join("\n"));
  writeBuilderFile(path.posix.join(project.relativePath, "src/plugin.ts"), [
    `export const pluginName = "${project.slug}";`,
    "",
    "export function registerPlugin(): string {",
    "  return pluginName;",
    "}",
    "",
  ].join("\n"));

  return {
    template: project.template,
    root: scaffold.root,
    files: [...scaffold.files, path.posix.join(project.relativePath, "tests/plugin.test.ts")],
  };
}

async function bootstrapViteApp(project: BuilderProject): Promise<BuilderBootstrapResult> {
  const { runNpmCreatePackage } = await import("@/lib/builder/adapters/npx");
  createBuilderDirectory(project.relativePath);
  await runNpmCreatePackage(project.relativePath, "vite@latest", ["--template", "react-ts"]);
  return {
    template: project.template,
    root: project.relativePath,
    files: listBuilderFilesRecursive(project.relativePath),
  };
}

async function bootstrapNextApp(project: BuilderProject): Promise<BuilderBootstrapResult> {
  const { runNpmCreatePackage } = await import("@/lib/builder/adapters/npx");
  createBuilderDirectory(project.relativePath);
  await runNpmCreatePackage(project.relativePath, "next-app@latest", [
    "--ts",
    "--eslint",
    "--app",
    "--src-dir",
    packageManagerFlag(project.packageManager),
  ]);

  return {
    template: project.template,
    root: project.relativePath,
    files: listBuilderFilesRecursive(project.relativePath),
  };
}

export async function bootstrapBuilderProject(project: BuilderProject): Promise<BuilderBootstrapResult> {
  switch (project.template) {
    case "node-cli":
      return bootstrapNodeCli(project);
    case "plugin-package":
      return bootstrapPluginPackage(project);
    case "vite-app":
      return bootstrapViteApp(project);
    case "next-app":
      return bootstrapNextApp(project);
    default:
      throw new Error(`Unsupported builder template: ${project.template}`);
  }
}