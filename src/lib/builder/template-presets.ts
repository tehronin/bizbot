import type { BuilderPackageManager, BuilderTemplatePreset, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export interface BuilderTemplateDefinition {
  key: string;
  displayName: string;
  description: string;
  defaultPackageManager: BuilderPackageManager;
  metadata?: Prisma.InputJsonValue;
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