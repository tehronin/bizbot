import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: [
      "tests/agent/**/*.test.ts",
      "tests/agent/**/*.test.tsx",
      "tests/builder/**/*.test.ts",
      "tests/builder/**/*.test.tsx",
      "tests/chat/**/*.test.ts",
      "tests/chat/**/*.test.tsx",
      "tests/ontology/**/*.test.ts",
      "tests/ontology/**/*.test.tsx",
      "tests/oracle/**/*.test.ts",
      "tests/oracle/**/*.test.tsx",
      "tests/platform/**/*.test.ts",
      "tests/platform/**/*.test.tsx",
      "tests/polymarket/**/*.test.ts",
      "tests/polymarket/**/*.test.tsx",
      "tests/settings/**/*.test.ts",
      "tests/settings/**/*.test.tsx",
      "tests/sidecar/**/*.test.ts",
      "tests/sidecar/**/*.test.tsx",
    ],
    exclude: ["node_modules", ".next", "workspace"],
  },
});