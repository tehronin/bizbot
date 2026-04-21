import { beforeEach, describe, expect, it, vi } from "vitest";

const registryMocks = vi.hoisted(() => ({
  getEnabledBuiltinPlugins: vi.fn(),
  createPluginRegistry: vi.fn(),
  getBuiltinPluginTooling: vi.fn(),
}));

const mcpClientMocks = vi.hoisted(() => ({
  getMcpClientTools: vi.fn(),
  getMcpClientToolCatalog: vi.fn(),
  getMcpClientPrompts: vi.fn(),
  getMcpClientResources: vi.fn(),
  getMcpClientStatus: vi.fn(),
}));

const importedCatalogMocks = vi.hoisted(() => ({
  buildImportedMcpServerSummaries: vi.fn(),
  getImportedMcpCatalogDiff: vi.fn(),
  listImportedMcpPromptCatalog: vi.fn(),
  listImportedMcpResourceCatalog: vi.fn(),
}));

vi.mock("@/lib/agent/plugins/registry", () => ({
  getEnabledBuiltinPlugins: registryMocks.getEnabledBuiltinPlugins,
  createPluginRegistry: registryMocks.createPluginRegistry,
  getBuiltinPluginTooling: registryMocks.getBuiltinPluginTooling,
  getBuiltinPlugins: vi.fn(() => []),
}));

vi.mock("@/lib/mcp/client", () => ({
  getMcpClientTools: mcpClientMocks.getMcpClientTools,
  getMcpClientToolCatalog: mcpClientMocks.getMcpClientToolCatalog,
  getMcpClientPrompts: mcpClientMocks.getMcpClientPrompts,
  getMcpClientResources: mcpClientMocks.getMcpClientResources,
  getMcpClientStatus: mcpClientMocks.getMcpClientStatus,
}));

vi.mock("@/lib/mcp/imported-catalog", () => ({
  buildImportedMcpServerSummaries: importedCatalogMocks.buildImportedMcpServerSummaries,
  getImportedMcpCatalogDiff: importedCatalogMocks.getImportedMcpCatalogDiff,
  listImportedMcpPromptCatalog: importedCatalogMocks.listImportedMcpPromptCatalog,
  listImportedMcpResourceCatalog: importedCatalogMocks.listImportedMcpResourceCatalog,
}));

import { getMcpDiscoveryBundle, listCurrentMcpToolDescriptors } from "@/lib/mcp/preview-catalog";

describe("MCP preview catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const creeperPlugin = {
      metadata: {
        id: "creeper",
        displayName: "Creeper",
        description: "Read-only company data source registration, profiling, and grounded retrieval planning.",
        version: "1.0.0",
        tags: ["creeper", "data", "research"],
        internal: true,
      },
      tools: [
        {
          name: "creeper_get_company_profile",
          description: "Return one company profile.",
          parameters: { type: "object", properties: { companyProfileId: { type: "string" } }, required: ["companyProfileId"], additionalProperties: false },
        },
        {
          name: "creeper_register_source",
          description: "Register a read-only Postgres company source.",
          parameters: { type: "object", properties: { sourceLabel: { type: "string" } }, required: ["sourceLabel"], additionalProperties: false },
        },
      ],
    };

    registryMocks.getEnabledBuiltinPlugins.mockReturnValue([creeperPlugin]);
    mcpClientMocks.getMcpClientTools.mockReturnValue([]);
    mcpClientMocks.getMcpClientToolCatalog.mockReturnValue([]);
    mcpClientMocks.getMcpClientPrompts.mockReturnValue([]);
    mcpClientMocks.getMcpClientResources.mockReturnValue([]);
    mcpClientMocks.getMcpClientStatus.mockReturnValue({ servers: [] });
    importedCatalogMocks.buildImportedMcpServerSummaries.mockReturnValue([]);
    importedCatalogMocks.getImportedMcpCatalogDiff.mockReturnValue({ generatedAt: new Date().toISOString(), servers: [] });
    importedCatalogMocks.listImportedMcpPromptCatalog.mockReturnValue([]);
    importedCatalogMocks.listImportedMcpResourceCatalog.mockReturnValue([]);
    registryMocks.getBuiltinPluginTooling.mockImplementation((id: string) => id === "creeper"
      ? { envKey: "BIZBOT_PLUGIN_CREEPER_ENABLED", defaultEnabled: false }
      : null);
    registryMocks.createPluginRegistry.mockReturnValue({
      plugins: [creeperPlugin],
      tools: creeperPlugin.tools,
      toolToPluginId: new Map([
        ["creeper_get_company_profile", "creeper"],
        ["creeper_register_source", "creeper"],
      ]),
    });
  });

  it("surfaces provenance-rich Creeper descriptors", () => {
    const descriptors = listCurrentMcpToolDescriptors();
    const profileTool = descriptors.find((tool) => tool.name === "creeper_get_company_profile");

    expect(profileTool).toEqual(expect.objectContaining({
      ownerId: "creeper",
      ownerKind: "builtin-plugin",
      ownerLabel: "Creeper",
      provenance: expect.objectContaining({
        source: "builtin-plugin",
        pluginId: "creeper",
        pluginVersion: "1.0.0",
        pluginTags: ["creeper", "data", "research"],
        envKey: "BIZBOT_PLUGIN_CREEPER_ENABLED",
        defaultEnabled: false,
      }),
    }));
  });

  it("includes a dedicated Creeper discovery bundle", () => {
    const bundle = getMcpDiscoveryBundle("creeper");

    expect(bundle).toBeDefined();
    expect(bundle?.title).toBe("Creeper");
    expect(bundle?.tools.map((tool) => tool.name)).toEqual([
      "creeper_get_company_profile",
      "creeper_register_source",
    ]);
    expect(bundle?.tools.every((tool) => tool.ownerId === "creeper")).toBe(true);
  });
});