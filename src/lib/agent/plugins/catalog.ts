import { db } from "@/lib/db";
import { readEnv, writeEnv } from "@/lib/env";
import {
  getConfiguredMcpServerConfigs,
  getMcpClientStatus,
  getMcpClientToolCatalog,
  reconnectMcpClients,
  type McpServerConfig,
} from "@/lib/mcp/client";
import { getBuiltinPluginToggle, isBuiltinPluginEnabled } from "./settings";
import { getBuiltinPlugins } from "./registry";

type PluginKind = "builtin" | "external";

export interface PluginCatalogEntry {
  id: string;
  kind: PluginKind;
  displayName: string;
  description: string;
  enabled: boolean;
  connected: boolean;
  installed: boolean;
  removable: boolean;
  removalLabel: string;
  managementSummary: string;
  toolNames: string[];
  tags: string[];
  version?: string;
  url?: string;
  envKey?: string;
  hasAuthToken?: boolean;
}

export interface ExternalPluginConfigInput {
  name: string;
  url: string;
  enabled?: boolean;
  authToken?: string;
  clearAuthToken?: boolean;
}

export interface PluginCatalogSection {
  installed: PluginCatalogEntry[];
  available: PluginCatalogEntry[];
}

export interface PluginCatalog {
  generatedAt: string;
  summary: {
    builtinEnabled: number;
    builtinDisabled: number;
    externalEnabled: number;
    externalDisabled: number;
    connectedExternal: number;
  };
  builtin: PluginCatalogSection;
  external: PluginCatalogSection;
}

function sortEntries(entries: PluginCatalogEntry[]): PluginCatalogEntry[] {
  return [...entries].sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function normalizeMcpServerConfigs(configs: McpServerConfig[]): McpServerConfig[] {
  return configs.map((config) => ({
    ...config,
    enabled: config.enabled ?? true,
  }));
}

async function resolveMcpServerConfigStore(): Promise<{ source: "env" | "db"; configs: McpServerConfig[] }> {
  const env = readEnv();
  const envValue = env.MCP_SERVERS ?? process.env.MCP_SERVERS;
  if (typeof envValue === "string" && envValue.trim().length > 0) {
    try {
      return {
        source: "env",
        configs: normalizeMcpServerConfigs(JSON.parse(envValue) as McpServerConfig[]),
      };
    } catch {
      throw new Error("MCP_SERVERS is not valid JSON.");
    }
  }

  const setting = await db.setting.findUnique({ where: { key: "mcp_servers" } });
  if (!setting) {
    return { source: "db", configs: [] };
  }

  try {
    return {
      source: "db",
      configs: normalizeMcpServerConfigs(JSON.parse(setting.value) as McpServerConfig[]),
    };
  } catch {
    throw new Error("Stored mcp_servers setting is not valid JSON.");
  }
}

async function persistMcpServerConfigs(configs: McpServerConfig[]): Promise<void> {
  const { source } = await resolveMcpServerConfigStore();
  const serialized = JSON.stringify(configs);

  if (source === "env") {
    writeEnv({ MCP_SERVERS: serialized });
    process.env.MCP_SERVERS = serialized;
    return;
  }

  await db.setting.upsert({
    where: { key: "mcp_servers" },
    update: { value: serialized },
    create: { key: "mcp_servers", value: serialized },
  });
}

function validateExternalPluginConfig(input: ExternalPluginConfigInput): ExternalPluginConfigInput {
  const name = input.name.trim();
  const url = input.url.trim();

  if (name.length === 0) {
    throw new Error("External plugin name is required.");
  }

  if (url.length === 0) {
    throw new Error("External plugin URL is required.");
  }

  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("External plugin URL must use http or https.");
    }
  } catch {
    throw new Error("External plugin URL must be a valid absolute URL.");
  }

  return {
    ...input,
    name,
    url,
    authToken: input.authToken?.trim(),
  };
}

export async function getPluginCatalog(): Promise<PluginCatalog> {
  const builtinEntries = sortEntries(
    getBuiltinPlugins({ includeDisabled: true }).map((plugin) => {
      const toggle = getBuiltinPluginToggle(plugin.metadata.id);
      const enabled = isBuiltinPluginEnabled(plugin.metadata.id);

      return {
        id: plugin.metadata.id,
        kind: "builtin" as const,
        displayName: plugin.metadata.displayName,
        description: plugin.metadata.description,
        enabled,
        connected: enabled,
        installed: enabled,
        removable: false,
        removalLabel: "source-managed",
        managementSummary: enabled ? "Enabled and exposed to the agent." : "Disabled and hidden from the live tool catalog.",
        toolNames: plugin.tools.map((tool) => tool.name).sort((left, right) => left.localeCompare(right)),
        tags: plugin.metadata.tags ?? [],
        version: plugin.metadata.version,
        envKey: toggle?.envKey,
      } satisfies PluginCatalogEntry;
    }),
  );

  const configuredExternal = await getConfiguredMcpServerConfigs();
  const externalStatus = new Map(getMcpClientStatus().map((status) => [status.name, status]));
  const externalTools = new Map<string, string[]>();
  for (const tool of getMcpClientToolCatalog()) {
    const current = externalTools.get(tool.serverName) ?? [];
    current.push(tool.prefixedName);
    externalTools.set(tool.serverName, current);
  }

  const externalEntries = sortEntries(configuredExternal.map((config) => {
    const enabled = config.enabled !== false;
    const status = externalStatus.get(config.name);
    return {
      id: config.name,
      kind: "external" as const,
      displayName: config.name,
      description: enabled
        ? "Imported MCP integration configured for live tool exposure."
        : "Configured MCP integration kept offline until re-enabled.",
      enabled,
      connected: status?.connected ?? false,
      installed: enabled,
      removable: true,
      removalLabel: "disconnect",
      managementSummary: enabled
        ? status?.connected
          ? "Connected and contributing imported tools."
          : "Enabled, but currently disconnected."
        : "Disabled and hidden from the live tool catalog.",
      toolNames: (externalTools.get(config.name) ?? []).sort((left, right) => left.localeCompare(right)),
      tags: ["mcp", "integration"],
      url: config.url,
      hasAuthToken: typeof config.authToken === "string" && config.authToken.trim().length > 0,
    } satisfies PluginCatalogEntry;
  }));

  const builtinInstalled = builtinEntries.filter((entry) => entry.installed);
  const builtinAvailable = builtinEntries.filter((entry) => !entry.installed);
  const externalInstalled = externalEntries.filter((entry) => entry.installed);
  const externalAvailable = externalEntries.filter((entry) => !entry.installed);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      builtinEnabled: builtinInstalled.length,
      builtinDisabled: builtinAvailable.length,
      externalEnabled: externalInstalled.length,
      externalDisabled: externalAvailable.length,
      connectedExternal: externalEntries.filter((entry) => entry.connected).length,
    },
    builtin: {
      installed: builtinInstalled,
      available: builtinAvailable,
    },
    external: {
      installed: externalInstalled,
      available: externalAvailable,
    },
  };
}

export function setBuiltinPluginEnabled(pluginId: string, enabled: boolean): void {
  const toggle = getBuiltinPluginToggle(pluginId);
  if (!toggle) {
    throw new Error(`Unknown builtin plugin: ${pluginId}`);
  }

  const value = enabled ? "true" : "false";
  writeEnv({ [toggle.envKey]: value });
  process.env[toggle.envKey] = value;
}

export async function setExternalPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
  const { configs } = await resolveMcpServerConfigStore();
  const nextConfigs = configs.map((config) => (
    config.name === pluginId
      ? { ...config, enabled }
      : config
  ));

  if (!nextConfigs.some((config) => config.name === pluginId)) {
    throw new Error(`Unknown external plugin: ${pluginId}`);
  }

  await persistMcpServerConfigs(nextConfigs);
  await reconnectMcpClients();
}

export async function createExternalPlugin(input: ExternalPluginConfigInput): Promise<void> {
  const config = validateExternalPluginConfig(input);
  const { configs } = await resolveMcpServerConfigStore();

  if (configs.some((entry) => entry.name === config.name)) {
    throw new Error(`External plugin already exists: ${config.name}`);
  }

  const nextConfig: McpServerConfig = {
    name: config.name,
    url: config.url,
    enabled: config.enabled ?? true,
    ...(config.authToken ? { authToken: config.authToken } : {}),
  };

  await persistMcpServerConfigs([...configs, nextConfig]);
  await reconnectMcpClients();
}

export async function updateExternalPlugin(pluginId: string, input: ExternalPluginConfigInput): Promise<void> {
  const config = validateExternalPluginConfig(input);
  const { configs } = await resolveMcpServerConfigStore();
  const index = configs.findIndex((entry) => entry.name === pluginId);

  if (index === -1) {
    throw new Error(`Unknown external plugin: ${pluginId}`);
  }

  if (config.name !== pluginId && configs.some((entry) => entry.name === config.name)) {
    throw new Error(`External plugin already exists: ${config.name}`);
  }

  const existing = configs[index];
  const nextConfig: McpServerConfig = {
    name: config.name,
    url: config.url,
    enabled: config.enabled ?? existing.enabled ?? true,
  };

  if (config.clearAuthToken) {
    // Intentionally omit auth token.
  } else if (typeof config.authToken === "string" && config.authToken.length > 0) {
    nextConfig.authToken = config.authToken;
  } else if (existing.authToken) {
    nextConfig.authToken = existing.authToken;
  }

  const nextConfigs = [...configs];
  nextConfigs[index] = nextConfig;

  await persistMcpServerConfigs(nextConfigs);
  await reconnectMcpClients();
}

export async function removeExternalPlugin(pluginId: string): Promise<void> {
  const { configs } = await resolveMcpServerConfigStore();
  const nextConfigs = configs.filter((config) => config.name !== pluginId);

  if (nextConfigs.length === configs.length) {
    throw new Error(`Unknown external plugin: ${pluginId}`);
  }

  await persistMcpServerConfigs(nextConfigs);
  await reconnectMcpClients();
}