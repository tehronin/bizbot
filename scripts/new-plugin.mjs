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

// Replace this with the smallest argument shape that still matches the tool contract.
interface ${pascalName}PingArgs {
  target?: string;
}

export const ${camelName}Plugin = createBizBotPlugin({
  metadata: {
    id: "${kebabName}",
    displayName: "${pascalName}",
    description: "Describe what the ${pascalName} plugin does, which workflow it owns, and why it belongs in its own plugin boundary.",
    tags: ["custom", "todo-scope"],
  },
  tools: [
    registerTool(defineTool({
      name: "${kebabName}_ping",
      description: "Sanity-check tool for the ${pascalName} plugin. Replace this with a real task description before shipping.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "Optional target or record id for the first real tool path." },
        },
        additionalProperties: false,
      },
      execute: async ({ target }: ${pascalName}PingArgs) => ({ ok: true, plugin: "${kebabName}", target: target ?? null }),
    } satisfies ToolDefinition<${pascalName}PingArgs, { ok: boolean; plugin: string; target: string | null }>)),
  ],
});
`);

fs.writeFileSync(testFile, `import { describe, expect, it } from "vitest";
import { ${camelName}Plugin } from "@/lib/agent/plugins/${pascalName}Plugin";
import { createPluginRegistry } from "@/lib/agent/plugins";

describe("${pascalName}Plugin", () => {
  it("exposes plugin metadata", () => {
    expect(${camelName}Plugin.metadata.id).toBe("${kebabName}");
    expect(${camelName}Plugin.metadata.displayName).toBe("${pascalName}");
    expect(${camelName}Plugin.metadata.description.length).toBeGreaterThan(20);
  });

  it("exposes at least one namespaced tool", () => {
    expect(${camelName}Plugin.tools.length).toBeGreaterThan(0);
    expect(${camelName}Plugin.tools[0]?.name.startsWith("${kebabName.replace(/-/g, "_")}_") || ${camelName}Plugin.tools[0]?.name.startsWith("${kebabName}_")).toBe(true);
    expect(${camelName}Plugin.tools[0]?.description.length).toBeGreaterThan(20);
  });

  it("uses a registry-compatible tool surface", () => {
    const registry = createPluginRegistry([${camelName}Plugin]);

    expect(registry.plugins).toHaveLength(1);
    expect(registry.tools.map((tool) => tool.name)).toContain("${kebabName}_ping");
    expect(registry.toolToPluginId.get("${kebabName}_ping")).toBe("${kebabName}");
  });

  it("defines a starter schema for the scaffolded tool", () => {
    expect(${camelName}Plugin.tools[0]?.parameters.type).toBe("object");
    expect(${camelName}Plugin.tools[0]?.parameters.additionalProperties).toBe(false);
  });

  it("returns a stable structured response for the starter tool", async () => {
    const result = await ${camelName}Plugin.tools[0].execute({ target: "fixture" }, {});

    expect(result).toEqual({ ok: true, plugin: "${kebabName}", target: "fixture" });
  });
});

// Next authoring steps:
// - replace the ping tool with real workflow-specific tools
// - add failure-path tests for missing/invalid arguments
// - run developer_check_tool_naming and developer_check_mcp_contract_impact
// - review tests/mcp/contracts.test.ts if this plugin changes MCP tools, prompts, or resources
// - review tests/mcp/http-route.test.ts if this plugin needs MCP prompt/resource reads or route-visible behavior changes
`);

console.log(`Created ${pluginFile}`);
console.log(`Created ${testFile}`);