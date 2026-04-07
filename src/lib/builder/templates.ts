import path from "path";
import type { BuilderPackageManager, BuilderProject, BuilderTemplatePreset, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { listBuilderFilesRecursive, readBuilderFile, scaffoldBuilderNodePackage, writeBuilderFile } from "@/lib/builder/workspace";
import { runNpxPackage } from "@/lib/builder/adapters/npx";

export interface BuilderTemplateDefinition {
  key: string;
  displayName: string;
  description: string;
  defaultPackageManager: BuilderPackageManager;
  metadata?: Prisma.InputJsonValue;
}

export interface BuilderBootstrapResult {
  template: string;
  root: string;
  files: string[];
}

export interface BuilderTemplateVerificationContract {
  requiredFiles: string[];
  requiredScripts: string[];
  runtimeEntrypoint: string;
  requiredDependencies?: string[];
  requiredDevDependencies?: string[];
  deterministicChecks: Array<
    | { runner: "npm"; args: string[] }
    | { runner: "npx"; args: string[] }
  >;
}

export const BUILDER_TEMPLATE_VERIFICATION_CONTRACTS: Record<string, BuilderTemplateVerificationContract> = {
  "node-cli": {
    requiredFiles: ["package.json", "src/index.ts", "tsconfig.json"],
    requiredScripts: ["build", "start", "typecheck"],
    runtimeEntrypoint: "src/index.ts",
    requiredDevDependencies: ["@types/node", "typescript"],
    deterministicChecks: [
      { runner: "npm", args: ["install", "--no-fund", "--no-audit"] },
      { runner: "npm", args: ["run", "typecheck"] },
      { runner: "npm", args: ["run", "build"] },
    ],
  },
  "plugin-package": {
    requiredFiles: ["package.json", "src/plugin.ts", "tests/plugin.test.ts", "tsconfig.json"],
    requiredScripts: ["build", "start", "typecheck", "test"],
    runtimeEntrypoint: "src/plugin.ts",
    requiredDevDependencies: ["@types/node", "typescript", "vitest"],
    deterministicChecks: [
      { runner: "npm", args: ["install", "--no-fund", "--no-audit"] },
      { runner: "npm", args: ["run", "typecheck"] },
      { runner: "npm", args: ["run", "build"] },
    ],
  },
  "vite-app": {
    requiredFiles: ["package.json", "src/main.tsx", "src/App.tsx", "vite.config.ts", "tsconfig.json"],
    requiredScripts: ["build", "dev", "preview"],
    runtimeEntrypoint: "src/main.tsx",
    requiredDependencies: ["react", "react-dom"],
    requiredDevDependencies: ["typescript", "vite", "@vitejs/plugin-react"],
    deterministicChecks: [
      { runner: "npm", args: ["install", "--no-fund", "--no-audit"] },
      { runner: "npm", args: ["run", "build"] },
    ],
  },
  "next-app": {
    requiredFiles: ["package.json", "src/app/page.tsx", "src/app/layout.tsx", "next.config.ts", "tsconfig.json"],
    requiredScripts: ["build", "dev", "lint", "start"],
    runtimeEntrypoint: "src/app/page.tsx",
    requiredDependencies: ["next", "react", "react-dom"],
    requiredDevDependencies: ["typescript", "eslint"],
    deterministicChecks: [
      { runner: "npm", args: ["install", "--no-fund", "--no-audit"] },
      { runner: "npm", args: ["exec", "tsc", "--noEmit"] },
      { runner: "npm", args: ["run", "build"] },
      { runner: "npm", args: ["run", "lint"] },
    ],
  },
};

export const DEFAULT_BUILDER_TEMPLATE_PRESETS: BuilderTemplateDefinition[] = [
  {
    key: "node-cli",
    displayName: "Node CLI",
    description: "A minimal TypeScript CLI-style Node package scaffolded locally without network access.",
    defaultPackageManager: "NPM",
  },
  {
    key: "vite-app",
    displayName: "Vite App",
    description: "A Vite TypeScript app scaffolded through create-vite.",
    defaultPackageManager: "PNPM",
  },
  {
    key: "next-app",
    displayName: "Next App",
    description: "A Next.js App Router TypeScript app scaffolded through create-next-app.",
    defaultPackageManager: "NPM",
  },
  {
    key: "plugin-package",
    displayName: "Plugin Package",
    description: "A TypeScript package scaffold for plugin-style feature work.",
    defaultPackageManager: "NPM",
  },
];

export async function syncBuilderTemplatePresets(): Promise<BuilderTemplatePreset[]> {
  await Promise.all(
    DEFAULT_BUILDER_TEMPLATE_PRESETS.map((preset) =>
      db.builderTemplatePreset.upsert({
        where: { key: preset.key },
        update: {
          displayName: preset.displayName,
          description: preset.description,
          defaultPackageManager: preset.defaultPackageManager,
          enabled: true,
          metadata: preset.metadata,
        },
        create: {
          key: preset.key,
          displayName: preset.displayName,
          description: preset.description,
          defaultPackageManager: preset.defaultPackageManager,
          enabled: true,
          metadata: preset.metadata,
        },
      }),
    ),
  );

  return db.builderTemplatePreset.findMany({ where: { enabled: true }, orderBy: { displayName: "asc" } });
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
  await runNpxPackage(project.relativePath, ["create-vite@latest", ".", "--template", "react-ts"]);
  return {
    template: project.template,
    root: project.relativePath,
    files: listBuilderFilesRecursive(project.relativePath),
  };
}

async function bootstrapNextApp(project: BuilderProject): Promise<BuilderBootstrapResult> {
  await runNpxPackage(project.relativePath, [
    "create-next-app@latest",
    ".",
    "--ts",
    "--eslint",
    "--app",
    "--src-dir",
    packageManagerFlag(project.packageManager),
    "--yes",
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