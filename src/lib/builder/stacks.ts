import type { BuilderPackageManager } from "@prisma/client";

export interface BuilderStackPreset {
  key: string;
  displayName: string;
  description: string;
  template: string;
  packageManager: BuilderPackageManager;
  tags: string[];
}

const BUILDER_STACK_PRESETS: BuilderStackPreset[] = [
  {
    key: "next-tailwind",
    displayName: "Next.js + Tailwind",
    description: "App Router React app with Tailwind CSS defaults.",
    template: "next-app",
    packageManager: "NPM",
    tags: ["react", "nextjs", "tailwind"],
  },
  {
    key: "next-tailwind-prisma",
    displayName: "Next.js + Prisma + Tailwind",
    description: "App Router React app with Prisma-backed server data and Tailwind styling.",
    template: "next-app",
    packageManager: "NPM",
    tags: ["react", "nextjs", "prisma", "tailwind"],
  },
  {
    key: "vite-react-tailwind",
    displayName: "Vite + React + Tailwind",
    description: "Client-side React app bootstrapped with Vite and Tailwind-friendly defaults.",
    template: "vite-app",
    packageManager: "PNPM",
    tags: ["react", "vite", "tailwind"],
  },
  {
    key: "vite-react-router-tailwind",
    displayName: "Vite + React Router + Tailwind",
    description: "Client-side React app with routing and Tailwind-oriented UI work.",
    template: "vite-app",
    packageManager: "PNPM",
    tags: ["react", "vite", "react-router", "tailwind"],
  },
];

export function listBuilderStackPresets(): BuilderStackPreset[] {
  return BUILDER_STACK_PRESETS.map((preset) => ({ ...preset, tags: [...preset.tags] }));
}

export function getBuilderStackPreset(key: string): BuilderStackPreset | null {
  const normalizedKey = key.trim();
  const preset = BUILDER_STACK_PRESETS.find((candidate) => candidate.key === normalizedKey);
  return preset ? { ...preset, tags: [...preset.tags] } : null;
}