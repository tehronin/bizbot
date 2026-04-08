import path from "path";
import type { BuilderPackageManager, BuilderProject } from "@prisma/client";
import { buildBuilderDependencyContractBaseline, buildCurrentBuilderDependencyContractSnapshot } from "@/lib/builder/dependency-contract";
import { buildBuilderFileTopologyContractBaseline, buildCurrentBuilderFileTopologyContractSnapshot } from "@/lib/builder/file-topology-snapshots";
import { buildCurrentBuilderMcpContractSnapshot, hashBuilderMcpContractSnapshot } from "@/lib/builder/mcp-snapshots";
import { writeBuilderMcpPolicyArtifact, type BuilderMcpPolicyArtifactState } from "@/lib/builder/mcp-policy";
import type { BuilderDependencyContractBaselineState, BuilderFileTopologyContractBaselineState, BuilderMcpPolicyBaselineState } from "@/lib/builder/types";
import { createBuilderDirectory, listBuilderFilesRecursive, readBuilderFile, scaffoldBuilderNodePackage, writeBuilderFile } from "@/lib/builder/workspace";

export interface BuilderBootstrapResult {
  template: string;
  root: string;
  files: string[];
  dependencyContract: BuilderDependencyContractBaselineState | null;
  fileTopologyContract: BuilderFileTopologyContractBaselineState;
  mcpPolicy: {
    artifactPath: string;
    policy: BuilderMcpPolicyArtifactState;
    baseline: BuilderMcpPolicyBaselineState;
  };
}

type BuilderTemplateScaffoldResult = Omit<BuilderBootstrapResult, "mcpPolicy" | "dependencyContract" | "fileTopologyContract">;

function packageManagerFlag(packageManager: BuilderPackageManager): "--use-npm" | "--use-pnpm" {
  return packageManager === "PNPM" ? "--use-pnpm" : "--use-npm";
}

async function bootstrapNodeCli(project: BuilderProject): Promise<BuilderTemplateScaffoldResult> {
  const scaffold = scaffoldBuilderNodePackage({
    projectDir: project.relativePath,
    packageName: project.slug,
    description: `${project.name} scaffolded by BizBot Builder Mode.`,
  });

  return { template: project.template, ...scaffold };
}

async function bootstrapPluginPackage(project: BuilderProject): Promise<BuilderTemplateScaffoldResult> {
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

async function bootstrapViteApp(project: BuilderProject): Promise<BuilderTemplateScaffoldResult> {
  const { runNpmCreatePackage } = await import("@/lib/builder/adapters/npx");
  createBuilderDirectory(project.relativePath);
  await runNpmCreatePackage(project.relativePath, "vite@latest", ["--template", "react-ts"]);
  return {
    template: project.template,
    root: project.relativePath,
    files: listBuilderFilesRecursive(project.relativePath),
  };
}

async function bootstrapNextApp(project: BuilderProject): Promise<BuilderTemplateScaffoldResult> {
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
  const scaffold = await (async () => {
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
  })();

  const expectedMcpContractHash = hashBuilderMcpContractSnapshot(buildCurrentBuilderMcpContractSnapshot());
  const mcpPolicy = writeBuilderMcpPolicyArtifact({
    relativePath: project.relativePath,
    template: project.template,
    packageManager: project.packageManager,
    expectedMcpContractHash,
  });
  const dependencySnapshot = buildCurrentBuilderDependencyContractSnapshot({
    projectRelativePath: project.relativePath,
    packageManager: project.packageManager,
  });
  const dependencyContract = dependencySnapshot
    ? buildBuilderDependencyContractBaseline({
        packageManager: project.packageManager,
        snapshot: dependencySnapshot,
      })
    : null;
  const fileTopologyContract = buildBuilderFileTopologyContractBaseline({
    snapshot: buildCurrentBuilderFileTopologyContractSnapshot({
      projectRelativePath: project.relativePath,
    }),
  });

  return {
    ...scaffold,
    files: Array.from(new Set([...scaffold.files, mcpPolicy.artifactPath])),
    dependencyContract,
    fileTopologyContract,
    mcpPolicy,
  };
}