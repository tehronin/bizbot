#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function toWords(raw) {
  return raw.trim().split(/[^a-zA-Z0-9]+/).filter(Boolean);
}

function toPascalCase(raw) {
  return toWords(raw).map((part) => part[0].toUpperCase() + part.slice(1)).join("");
}

function toCamelCase(raw) {
  const [first = "", ...rest] = toWords(raw);
  return first.toLowerCase() + rest.map((part) => part[0].toUpperCase() + part.slice(1)).join("");
}

function toKebabCase(raw) {
  return toWords(raw).map((part) => part.toLowerCase()).join("-");
}

const rawName = process.argv[2];
if (!rawName) {
  console.error("Usage: npm run plugin:new -- <plugin-name>");
  process.exit(1);
}

const pascalName = toPascalCase(rawName);
const camelName = toCamelCase(rawName);
const kebabName = toKebabCase(rawName);

const pluginFile = path.join(process.cwd(), "src", "lib", "agent", "plugins", `${pascalName}Plugin.ts`);
const testFile = path.join(process.cwd(), "tests", "plugins", `${kebabName}.test.ts`);

for (const filePath of [pluginFile, testFile]) {
  if (fs.existsSync(filePath)) {
    console.error(`Refusing to overwrite existing file: ${filePath}`);
    process.exit(1);
  }
}

fs.mkdirSync(path.dirname(pluginFile), { recursive: true });
fs.mkdirSync(path.dirname(testFile), { recursive: true });

fs.writeFileSync(pluginFile, `import { createBizBotPlugin } from "@/lib/agent/plugins";
import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";

type ${pascalName}Args = Record<string, never>;

export const ${camelName}Plugin = createBizBotPlugin({
  metadata: {
    id: "${kebabName}",
    displayName: "${pascalName}",
    description: "Describe what the ${pascalName} plugin does.",
    tags: ["custom"],
  },
  tools: [
    registerTool(defineTool({
      name: "${kebabName}_ping",
      description: "Sanity-check tool for the ${pascalName} plugin.",
      parameters: { type: "object", properties: {} },
      execute: async (_args: ${pascalName}Args) => ({ ok: true, plugin: "${kebabName}" }),
    } satisfies ToolDefinition<${pascalName}Args, { ok: boolean; plugin: string }>)),
  ],
});
`);

fs.writeFileSync(testFile, `import { describe, expect, it } from "vitest";
import { ${camelName}Plugin } from "@/lib/agent/plugins/${pascalName}Plugin";

describe("${pascalName}Plugin", () => {
  it("exposes metadata and at least one tool", () => {
    expect(${camelName}Plugin.metadata.id).toBe("${kebabName}");
    expect(${camelName}Plugin.tools.length).toBeGreaterThan(0);
  });
});
`);

console.log(`Created ${pluginFile}`);
console.log(`Created ${testFile}`);