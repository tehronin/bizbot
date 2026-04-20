import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    setting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/env", () => ({
  readEnv: vi.fn(),
  writeEnv: vi.fn(),
}));

vi.mock("@/lib/mcp/client", () => ({
  getConfiguredMcpServerConfigs: vi.fn(),
  getMcpClientPrompts: vi.fn(),
  getMcpClientResources: vi.fn(),
  getMcpClientStatus: vi.fn(),
  getMcpClientTools: vi.fn(() => []),
  getMcpClientToolCatalog: vi.fn(),
  reconnectMcpClients: vi.fn(),
}));

vi.mock("@/lib/mcp/imported-catalog", () => ({
  buildImportedMcpServerSummaries: vi.fn(),
  getImportedMcpCatalogDiff: vi.fn(),
  listImportedMcpPromptCatalog: vi.fn(() => []),
  listImportedMcpResourceCatalog: vi.fn(() => []),
}));

vi.mock("@/lib/agent/plugins/registry", () => ({
  getBuiltinPlugins: vi.fn(),
  getEnabledBuiltinPlugins: vi.fn(() => []),
  createPluginRegistry: vi.fn((plugins = [], importedTools = []) => ({
    plugins,
    tools: [
      ...plugins.flatMap((plugin: { tools: unknown[] }) => plugin.tools),
      ...importedTools,
    ],
  })),
}));

vi.mock("@/lib/agent/plugins/settings", () => ({
  getBuiltinPluginToggle: vi.fn(),
  isBuiltinPluginEnabled: vi.fn(),
}));

import { db } from "@/lib/db";
import { readEnv, writeEnv } from "@/lib/env";
import {
  getConfiguredMcpServerConfigs,
  getMcpClientPrompts,
  getMcpClientResources,
  getMcpClientStatus,
  getMcpClientToolCatalog,
  reconnectMcpClients,
} from "@/lib/mcp/client";
import { buildImportedMcpServerSummaries, getImportedMcpCatalogDiff } from "@/lib/mcp/imported-catalog";
import { getBuiltinPlugins } from "@/lib/agent/plugins/registry";
import { getBuiltinPluginToggle, isBuiltinPluginEnabled } from "@/lib/agent/plugins/settings";
import {
  createExternalPlugin,
  getPluginCatalog,
  removeExternalPlugin,
  setBuiltinPluginEnabled,
  setExternalPluginEnabled,
  updateExternalPlugin,
} from "@/lib/agent/plugins/catalog";

const mockedReadEnv = vi.mocked(readEnv);
const mockedWriteEnv = vi.mocked(writeEnv);
const mockedGetConfiguredMcpServerConfigs = vi.mocked(getConfiguredMcpServerConfigs);
const mockedGetMcpClientPrompts = vi.mocked(getMcpClientPrompts);
const mockedGetMcpClientResources = vi.mocked(getMcpClientResources);
const mockedGetMcpClientStatus = vi.mocked(getMcpClientStatus);
const mockedGetMcpClientToolCatalog = vi.mocked(getMcpClientToolCatalog);
const mockedReconnectMcpClients = vi.mocked(reconnectMcpClients);
const mockedBuildImportedMcpServerSummaries = vi.mocked(buildImportedMcpServerSummaries);
const mockedGetImportedMcpCatalogDiff = vi.mocked(getImportedMcpCatalogDiff);
const mockedGetBuiltinPlugins = vi.mocked(getBuiltinPlugins);
const mockedGetBuiltinPluginToggle = vi.mocked(getBuiltinPluginToggle);
const mockedIsBuiltinPluginEnabled = vi.mocked(isBuiltinPluginEnabled);
const mockedSettingFindUnique = db.setting.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedSettingUpsert = db.setting.upsert as unknown as ReturnType<typeof vi.fn>;

describe("plugin catalog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.BIZBOT_PLUGIN_SOCIAL_ENABLED;
    delete process.env.BIZBOT_PLUGIN_CONVERSATION_BRIDGE_ENABLED;
    delete process.env.MCP_SERVERS;

    mockedGetBuiltinPlugins.mockReturnValue([
      {
        metadata: {
          id: "social",
          displayName: "Social",
          description: "Social workflows.",
          version: "1.0.0",
          tags: ["social"],
        },
        tools: [{ name: "social_post" }, { name: "social_reply" }],
      },
      {
        metadata: {
          id: "conversation-bridge",
          displayName: "Conversation Bridge",
          description: "Bridge workflows.",
          version: "1.0.0",
          tags: ["bridge"],
        },
        tools: [{ name: "conversation_bridge_inspect" }],
      },
    ] as never);

    mockedGetBuiltinPluginToggle.mockImplementation((id: string) => {
      if (id === "social") {
        return {
          id,
          displayName: "Social",
          description: "Social workflows.",
          tags: ["social"],
          envKey: "BIZBOT_PLUGIN_SOCIAL_ENABLED",
          defaultEnabled: true,
        };
      }

      if (id === "conversation-bridge") {
        return {
          id,
          displayName: "Conversation Bridge",
          description: "Bridge workflows.",
          tags: ["bridge"],
          envKey: "BIZBOT_PLUGIN_CONVERSATION_BRIDGE_ENABLED",
          defaultEnabled: false,
        };
      }

      return null;
    });

    mockedIsBuiltinPluginEnabled.mockImplementation((id: string) => id === "social");
    mockedGetMcpClientPrompts.mockReturnValue([]);
    mockedGetMcpClientResources.mockReturnValue([]);
    mockedBuildImportedMcpServerSummaries.mockReturnValue([]);
    mockedGetImportedMcpCatalogDiff.mockResolvedValue({
      generatedAt: new Date().toISOString(),
      baselinePresent: false,
      baselineAcceptedAt: null,
      auditState: "unaudited",
      serverName: null,
      summary: {
        toolChanges: 0,
        promptChanges: 0,
        resourceChanges: 0,
        serverChanges: 0,
      },
      servers: [],
      diff: {
        tools: { added: [], removed: [], changed: [] },
        prompts: { added: [], removed: [], changed: [] },
        resources: { added: [], removed: [], changed: [] },
        servers: { added: [], removed: [], changed: [] },
      },
    });
  });

  it("groups builtin and external plugins into installed and available sections", async () => {
    mockedGetConfiguredMcpServerConfigs.mockResolvedValue([
      { name: "github", url: "http://localhost:4100/mcp", enabled: true },
      { name: "slack", url: "http://localhost:4200/mcp", enabled: false },
    ]);
    mockedGetMcpClientStatus.mockReturnValue([
      { name: "github", url: "http://localhost:4100/mcp", connected: true, toolCount: 2, promptCount: 1, resourceCount: 1, hasAuthToken: false, lastSeenAt: null, latencyClass: "fast" },
    ]);
    mockedGetMcpClientToolCatalog.mockReturnValue([
      {
        prefixedName: "mcp_github_list_prs",
        originalName: "list_prs",
        serverName: "github",
        description: "List PRs",
      },
    ]);
    mockedBuildImportedMcpServerSummaries.mockReturnValue([
      {
        name: "github",
        url: "http://localhost:4100/mcp",
        connected: true,
        toolCount: 1,
        promptCount: 1,
        resourceCount: 1,
        hasAuthToken: false,
        destructiveToolCount: 0,
        readOnlyToolCount: 1,
        openWorldToolCount: 0,
        lastSeenAt: "2026-04-19T12:00:00.000Z",
        latencyClass: "fast",
        auditState: "audited",
      },
    ]);
    mockedGetImportedMcpCatalogDiff.mockResolvedValue({
      generatedAt: new Date().toISOString(),
      baselinePresent: true,
      baselineAcceptedAt: "2026-04-19T11:59:00.000Z",
      auditState: "audited",
      serverName: null,
      summary: {
        toolChanges: 0,
        promptChanges: 0,
        resourceChanges: 0,
        serverChanges: 0,
      },
      servers: [{ name: "github", auditState: "audited" }],
      diff: {
        tools: { added: [], removed: [], changed: [] },
        prompts: { added: [], removed: [], changed: [] },
        resources: { added: [], removed: [], changed: [] },
        servers: { added: [], removed: [], changed: [] },
      },
    });

    const catalog = await getPluginCatalog();

    expect(catalog.summary).toEqual({
      builtinEnabled: 1,
      builtinDisabled: 1,
      externalEnabled: 1,
      externalDisabled: 1,
      connectedExternal: 1,
    });
    expect(catalog.builtin.installed).toEqual([
      expect.objectContaining({ id: "social", enabled: true, toolNames: ["social_post", "social_reply"] }),
    ]);
    expect(catalog.builtin.available).toEqual([
      expect.objectContaining({ id: "conversation-bridge", enabled: false }),
    ]);
    expect(catalog.external.installed).toEqual([
      expect.objectContaining({ id: "github", connected: true, toolNames: ["mcp_github_list_prs"], promptCount: 1, resourceCount: 1, auditState: "audited", latencyClass: "fast" }),
    ]);
    expect(catalog.external.available).toEqual([
      expect.objectContaining({ id: "slack", enabled: false, connected: false }),
    ]);
    expect(catalog.discovery).toEqual(expect.objectContaining({
      bundles: expect.arrayContaining([
        expect.objectContaining({ bundleId: "plugin-authoring" }),
      ]),
      skillResources: expect.arrayContaining([
        expect.objectContaining({ uri: "bizbot://skills/plugin-authoring" }),
      ]),
      importedCatalog: {
        promptCount: 0,
        resourceCount: 0,
        driftState: "audited",
        driftedServerCount: 0,
      },
      taskRecipes: expect.arrayContaining([
        expect.objectContaining({ recipeId: "debug-imported-mcp-server" }),
      ]),
      devLoop: expect.objectContaining({
        preferredAppCommand: "npm run dev:vscode",
        preferredMcpCommand: "npm run mcp:stdio",
        traceResourceUri: "bizbot://debug/mcp-trace",
      }),
    }));
  });

  it("writes builtin enablement to env-backed plugin flags", () => {
    setBuiltinPluginEnabled("conversation-bridge", true);

    expect(mockedWriteEnv).toHaveBeenCalledWith({ BIZBOT_PLUGIN_CONVERSATION_BRIDGE_ENABLED: "true" });
    expect(process.env.BIZBOT_PLUGIN_CONVERSATION_BRIDGE_ENABLED).toBe("true");
  });

  it("updates external plugin config in MCP_SERVERS and reconnects clients", async () => {
    mockedReadEnv.mockReturnValue({
      MCP_SERVERS: JSON.stringify([
        { name: "github", url: "http://localhost:4100/mcp", enabled: true },
        { name: "slack", url: "http://localhost:4200/mcp", enabled: true },
      ]),
    });

    await setExternalPluginEnabled("github", false);

    expect(mockedWriteEnv).toHaveBeenCalledWith({
      MCP_SERVERS: JSON.stringify([
        { name: "github", url: "http://localhost:4100/mcp", enabled: false },
        { name: "slack", url: "http://localhost:4200/mcp", enabled: true },
      ]),
    });
    expect(mockedReconnectMcpClients).toHaveBeenCalledTimes(1);
  });

  it("creates a new external plugin in MCP_SERVERS", async () => {
    mockedReadEnv.mockReturnValue({
      MCP_SERVERS: JSON.stringify([
        { name: "github", url: "http://localhost:4100/mcp", enabled: true },
      ]),
    });

    await createExternalPlugin({
      name: "slack",
      url: "http://localhost:4200/mcp",
      enabled: false,
      authToken: "secret-token",
    });

    expect(mockedWriteEnv).toHaveBeenCalledWith({
      MCP_SERVERS: JSON.stringify([
        { name: "github", url: "http://localhost:4100/mcp", enabled: true },
        { name: "slack", url: "http://localhost:4200/mcp", enabled: false, authToken: "secret-token" },
      ]),
    });
    expect(mockedReconnectMcpClients).toHaveBeenCalledTimes(1);
  });

  it("updates an external plugin while preserving the existing auth token when left blank", async () => {
    mockedReadEnv.mockReturnValue({
      MCP_SERVERS: JSON.stringify([
        { name: "github", url: "http://localhost:4100/mcp", enabled: true, authToken: "keep-me" },
      ]),
    });

    await updateExternalPlugin("github", {
      name: "github-enterprise",
      url: "https://github.example.com/mcp",
      enabled: true,
      authToken: "",
    });

    expect(mockedWriteEnv).toHaveBeenCalledWith({
      MCP_SERVERS: JSON.stringify([
        { name: "github-enterprise", url: "https://github.example.com/mcp", enabled: true, authToken: "keep-me" },
      ]),
    });
    expect(mockedReconnectMcpClients).toHaveBeenCalledTimes(1);
  });

  it("can clear an external plugin auth token explicitly", async () => {
    mockedReadEnv.mockReturnValue({
      MCP_SERVERS: JSON.stringify([
        { name: "github", url: "http://localhost:4100/mcp", enabled: true, authToken: "remove-me" },
      ]),
    });

    await updateExternalPlugin("github", {
      name: "github",
      url: "http://localhost:4100/mcp",
      enabled: true,
      clearAuthToken: true,
    });

    expect(mockedWriteEnv).toHaveBeenCalledWith({
      MCP_SERVERS: JSON.stringify([
        { name: "github", url: "http://localhost:4100/mcp", enabled: true },
      ]),
    });
    expect(mockedReconnectMcpClients).toHaveBeenCalledTimes(1);
  });

  it("removes external plugin config from the database store when env is not set", async () => {
    mockedReadEnv.mockReturnValue({});
    mockedSettingFindUnique.mockResolvedValue({
      key: "mcp_servers",
      value: JSON.stringify([
        { name: "github", url: "http://localhost:4100/mcp", enabled: true },
        { name: "slack", url: "http://localhost:4200/mcp", enabled: false },
      ]),
    });

    await removeExternalPlugin("slack");

    expect(mockedSettingUpsert).toHaveBeenCalledWith({
      where: { key: "mcp_servers" },
      update: { value: JSON.stringify([{ name: "github", url: "http://localhost:4100/mcp", enabled: true }]) },
      create: { key: "mcp_servers", value: JSON.stringify([{ name: "github", url: "http://localhost:4100/mcp", enabled: true }]) },
    });
    expect(mockedReconnectMcpClients).toHaveBeenCalledTimes(1);
  });
});