import { db } from "@/lib/db";
import { getToolAnnotations } from "@/lib/mcp/tool-presentation";
import { getMcpClientPrompts, getMcpClientResources, getMcpClientStatus, getMcpClientToolCatalog } from "@/lib/mcp/client";
import { getMcpTraceServerSummary } from "@/lib/mcp/trace";

const IMPORTED_MCP_BASELINE_SETTING_KEY = "imported_mcp_catalog_baseline";
const IMPORTED_MCP_BASELINE_VERSION = 1;

export type ImportedMcpAuditState = "unaudited" | "audited" | "drifted";

export interface ImportedMcpTrustMetadata {
  connected: boolean;
  requiresAuth: boolean;
  lastSeenAt: string | null;
  latencyClass: "unknown" | "fast" | "moderate" | "slow";
  auditState: ImportedMcpAuditState;
}

export interface ImportedMcpToolCatalogEntry {
  serverName: string;
  prefixedName: string;
  originalName: string;
  description: string;
  annotations: ReturnType<typeof getToolAnnotations>;
  trust: ImportedMcpTrustMetadata;
}

export interface ImportedMcpResourceCatalogEntry {
  serverName: string;
  name: string | null;
  uri: string;
  title: string | null;
  description: string | null;
  mimeType: string | null;
  sourceKind: "imported-mcp";
  trust: ImportedMcpTrustMetadata;
}

export interface ImportedMcpPromptCatalogEntry {
  serverName: string;
  name: string;
  title: string | null;
  description: string | null;
  arguments: Array<{ name: string; required?: boolean; description?: string }>;
  sourceKind: "imported-mcp";
  trust: ImportedMcpTrustMetadata;
}

export interface ImportedMcpServerSummary {
  name: string;
  url: string;
  connected: boolean;
  toolCount: number;
  promptCount: number;
  resourceCount: number;
  hasAuthToken: boolean;
  destructiveToolCount: number;
  readOnlyToolCount: number;
  openWorldToolCount: number;
  lastSeenAt: string | null;
  latencyClass: "unknown" | "fast" | "moderate" | "slow";
  auditState: ImportedMcpAuditState;
}

interface ImportedMcpCatalogSnapshot {
  version: number;
  acceptedAt: string;
  tools: Array<{ serverName: string; originalName: string; description: string }>;
  prompts: Array<{ serverName: string; name: string; description: string | null; arguments: string[] }>;
  resources: Array<{ serverName: string; uri: string; mimeType: string | null; title: string | null; description: string | null }>;
}

type SnapshotDiffEntry = {
  key: string;
  serverName: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

function indexByKey<T extends { key: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.key, item]));
}

function getServerTrustMap(): Map<string, ImportedMcpTrustMetadata> {
  const serverStatuses = getMcpClientStatus();
  const baseline = getImportedMcpCatalogBaselineSync();
  const baselineDiff = diffImportedMcpCatalogSnapshot(baseline, buildImportedMcpCatalogSnapshot());
  const driftedServers = new Set(baselineDiff.servers.changed.map((entry) => entry.serverName));
  const addedServers = new Set(baselineDiff.servers.added.map((entry) => entry.serverName));
  const removedServers = new Set(baselineDiff.servers.removed.map((entry) => entry.serverName));

  return new Map(serverStatuses.map((status) => {
    const traceSummary = getMcpTraceServerSummary(status.name);
    const auditState: ImportedMcpAuditState = !baseline
      ? "unaudited"
      : driftedServers.has(status.name) || addedServers.has(status.name) || removedServers.has(status.name)
        ? "drifted"
        : "audited";
    return [status.name, {
      connected: status.connected,
      requiresAuth: status.hasAuthToken,
      lastSeenAt: traceSummary.lastSeenAt ?? status.lastSeenAt ?? null,
      latencyClass: traceSummary.latencyClass,
      auditState,
    } satisfies ImportedMcpTrustMetadata];
  }));
}

function buildImportedMcpCatalogSnapshot(): ImportedMcpCatalogSnapshot {
  return {
    version: IMPORTED_MCP_BASELINE_VERSION,
    acceptedAt: new Date().toISOString(),
    tools: getMcpClientToolCatalog()
      .map((tool) => ({
        serverName: tool.serverName,
        originalName: tool.originalName,
        description: tool.description,
      }))
      .sort((left, right) => `${left.serverName}:${left.originalName}`.localeCompare(`${right.serverName}:${right.originalName}`)),
    prompts: getMcpClientPrompts()
      .map(({ serverName, prompt }) => ({
        serverName,
        name: prompt.name,
        description: typeof prompt.description === "string" ? prompt.description : null,
        arguments: Array.isArray(prompt.arguments)
          ? prompt.arguments.map((argument) => `${argument.name}:${argument.required === true ? "required" : "optional"}`).sort()
          : [],
      }))
      .sort((left, right) => `${left.serverName}:${left.name}`.localeCompare(`${right.serverName}:${right.name}`)),
    resources: getMcpClientResources()
      .map(({ serverName, resource }) => ({
        serverName,
        uri: resource.uri,
        mimeType: typeof resource.mimeType === "string" ? resource.mimeType : null,
        title: typeof resource.title === "string" ? resource.title : null,
        description: typeof resource.description === "string" ? resource.description : null,
      }))
      .sort((left, right) => `${left.serverName}:${left.uri}`.localeCompare(`${right.serverName}:${right.uri}`)),
  };
}

function buildSnapshotKey(section: "tool" | "prompt" | "resource", serverName: string, identifier: string): string {
  return `${section}:${serverName}:${identifier}`;
}

function diffSnapshotSection(
  baselineItems: Array<Record<string, unknown>>,
  currentItems: Array<Record<string, unknown>>,
  getKey: (item: Record<string, unknown>) => string,
): {
  added: SnapshotDiffEntry[];
  removed: SnapshotDiffEntry[];
  changed: SnapshotDiffEntry[];
} {
  const baselineIndexed = indexByKey(baselineItems.map((item) => ({ key: getKey(item), item })));
  const currentIndexed = indexByKey(currentItems.map((item) => ({ key: getKey(item), item })));

  const added = [...currentIndexed.values()]
    .filter(({ key }) => !baselineIndexed.has(key))
    .map(({ key, item }) => ({ key, serverName: String(item.serverName ?? "unknown"), after: item }));
  const removed = [...baselineIndexed.values()]
    .filter(({ key }) => !currentIndexed.has(key))
    .map(({ key, item }) => ({ key, serverName: String(item.serverName ?? "unknown"), before: item }));
  const changed = [...currentIndexed.values()]
    .filter(({ key, item }) => {
      const baselineItem = baselineIndexed.get(key)?.item;
      return baselineItem && JSON.stringify(baselineItem) !== JSON.stringify(item);
    })
    .map(({ key, item }) => ({
      key,
      serverName: String(item.serverName ?? "unknown"),
      before: baselineIndexed.get(key)?.item,
      after: item,
    }));

  return { added, removed, changed };
}

function diffImportedMcpCatalogSnapshot(baseline: ImportedMcpCatalogSnapshot | null, current: ImportedMcpCatalogSnapshot) {
  const empty: ImportedMcpCatalogSnapshot = {
    version: IMPORTED_MCP_BASELINE_VERSION,
    acceptedAt: "",
    tools: [],
    prompts: [],
    resources: [],
  };
  const source = baseline ?? empty;
  const baselineServers = new Map([...source.tools, ...source.prompts, ...source.resources].map((item) => [String(item.serverName), true]));
  const currentServers = new Map([...current.tools, ...current.prompts, ...current.resources].map((item) => [String(item.serverName), true]));

  const serverAdded = [...currentServers.keys()].filter((name) => !baselineServers.has(name)).map((serverName) => ({ key: `server:${serverName}`, serverName, after: { serverName } }));
  const serverRemoved = [...baselineServers.keys()].filter((name) => !currentServers.has(name)).map((serverName) => ({ key: `server:${serverName}`, serverName, before: { serverName } }));
  const toolDiff = diffSnapshotSection(source.tools as Array<Record<string, unknown>>, current.tools as Array<Record<string, unknown>>, (item) => buildSnapshotKey("tool", String(item.serverName), String(item.originalName)));
  const promptDiff = diffSnapshotSection(source.prompts as Array<Record<string, unknown>>, current.prompts as Array<Record<string, unknown>>, (item) => buildSnapshotKey("prompt", String(item.serverName), String(item.name)));
  const resourceDiff = diffSnapshotSection(source.resources as Array<Record<string, unknown>>, current.resources as Array<Record<string, unknown>>, (item) => buildSnapshotKey("resource", String(item.serverName), String(item.uri)));
  const changedServerNames = [...new Set([
    ...toolDiff.added,
    ...toolDiff.removed,
    ...toolDiff.changed,
    ...promptDiff.added,
    ...promptDiff.removed,
    ...promptDiff.changed,
    ...resourceDiff.added,
    ...resourceDiff.removed,
    ...resourceDiff.changed,
  ].map((entry) => entry.serverName))];

  return {
    baselinePresent: Boolean(baseline),
    baselineAcceptedAt: baseline?.acceptedAt ?? null,
    servers: {
      added: serverAdded,
      removed: serverRemoved,
      changed: changedServerNames.map((serverName) => ({ key: `server:${serverName}`, serverName })),
    },
    tools: toolDiff,
    prompts: promptDiff,
    resources: resourceDiff,
  };
}

function parseImportedMcpCatalogBaseline(value: string): ImportedMcpCatalogSnapshot | null {
  try {
    const parsed = JSON.parse(value) as ImportedMcpCatalogSnapshot;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.version !== IMPORTED_MCP_BASELINE_VERSION) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

let cachedImportedMcpCatalogBaseline: ImportedMcpCatalogSnapshot | null | undefined;

function getImportedMcpCatalogBaselineSync(): ImportedMcpCatalogSnapshot | null {
  return cachedImportedMcpCatalogBaseline ?? null;
}

export async function loadImportedMcpCatalogBaseline(): Promise<ImportedMcpCatalogSnapshot | null> {
  if (cachedImportedMcpCatalogBaseline !== undefined) {
    return cachedImportedMcpCatalogBaseline;
  }

  const setting = await db.setting.findUnique({ where: { key: IMPORTED_MCP_BASELINE_SETTING_KEY } });
  cachedImportedMcpCatalogBaseline = setting?.value ? parseImportedMcpCatalogBaseline(setting.value) : null;
  return cachedImportedMcpCatalogBaseline;
}

export async function acceptImportedMcpCatalogBaseline(): Promise<ImportedMcpCatalogSnapshot> {
  const snapshot = buildImportedMcpCatalogSnapshot();
  await db.setting.upsert({
    where: { key: IMPORTED_MCP_BASELINE_SETTING_KEY },
    update: { value: JSON.stringify(snapshot) },
    create: { key: IMPORTED_MCP_BASELINE_SETTING_KEY, value: JSON.stringify(snapshot) },
  });
  cachedImportedMcpCatalogBaseline = snapshot;
  return snapshot;
}

export async function getImportedMcpCatalogDiff(serverName?: string) {
  const baseline = await loadImportedMcpCatalogBaseline();
  const current = buildImportedMcpCatalogSnapshot();
  const diff = diffImportedMcpCatalogSnapshot(baseline, current);
  const trustMap = getServerTrustMap();

  const filterEntries = (entries: SnapshotDiffEntry[]) => serverName
    ? entries.filter((entry) => entry.serverName === serverName)
    : entries;

  return {
    generatedAt: new Date().toISOString(),
    baselinePresent: diff.baselinePresent,
    baselineAcceptedAt: diff.baselineAcceptedAt,
    auditState: !diff.baselinePresent
      ? "unaudited"
      : [diff.tools, diff.prompts, diff.resources, diff.servers].some((section) => section.added.length > 0 || section.removed.length > 0 || section.changed.length > 0)
        ? "drifted"
        : "audited",
    serverName: serverName ?? null,
    summary: {
      toolChanges: filterEntries([...diff.tools.added, ...diff.tools.removed, ...diff.tools.changed]).length,
      promptChanges: filterEntries([...diff.prompts.added, ...diff.prompts.removed, ...diff.prompts.changed]).length,
      resourceChanges: filterEntries([...diff.resources.added, ...diff.resources.removed, ...diff.resources.changed]).length,
      serverChanges: filterEntries([...diff.servers.added, ...diff.servers.removed, ...diff.servers.changed]).length,
    },
    servers: buildImportedMcpServerSummaries().filter((entry) => !serverName || entry.name === serverName).map((entry) => ({
      ...entry,
      trust: trustMap.get(entry.name) ?? null,
    })),
    diff: {
      tools: {
        added: filterEntries(diff.tools.added),
        removed: filterEntries(diff.tools.removed),
        changed: filterEntries(diff.tools.changed),
      },
      prompts: {
        added: filterEntries(diff.prompts.added),
        removed: filterEntries(diff.prompts.removed),
        changed: filterEntries(diff.prompts.changed),
      },
      resources: {
        added: filterEntries(diff.resources.added),
        removed: filterEntries(diff.resources.removed),
        changed: filterEntries(diff.resources.changed),
      },
      servers: {
        added: filterEntries(diff.servers.added),
        removed: filterEntries(diff.servers.removed),
        changed: filterEntries(diff.servers.changed),
      },
    },
  };
}

export function listImportedMcpToolCatalog(): ImportedMcpToolCatalogEntry[] {
  const serverTrust = getServerTrustMap();
  return getMcpClientToolCatalog()
    .map((tool) => ({
      serverName: tool.serverName,
      prefixedName: tool.prefixedName,
      originalName: tool.originalName,
      description: tool.description,
      annotations: getToolAnnotations(tool.prefixedName),
      trust: serverTrust.get(tool.serverName) ?? {
        connected: true,
        requiresAuth: false,
        lastSeenAt: null,
        latencyClass: "unknown",
        auditState: "unaudited",
      },
    }))
    .sort((left, right) => left.prefixedName.localeCompare(right.prefixedName));
}

export function listImportedMcpResourceCatalog(): ImportedMcpResourceCatalogEntry[] {
  const serverTrust = getServerTrustMap();
  return getMcpClientResources()
    .map(({ serverName, resource }) => ({
      serverName,
      name: typeof resource.name === "string" ? resource.name : null,
      uri: resource.uri,
      title: typeof resource.title === "string" ? resource.title : null,
      description: typeof resource.description === "string" ? resource.description : null,
      mimeType: typeof resource.mimeType === "string" ? resource.mimeType : null,
      sourceKind: "imported-mcp" as const,
      trust: serverTrust.get(serverName) ?? {
        connected: true,
        requiresAuth: false,
        lastSeenAt: null,
        latencyClass: "unknown",
        auditState: "unaudited",
      },
    }))
    .sort((left, right) => left.uri.localeCompare(right.uri));
}

export function listImportedMcpPromptCatalog(): ImportedMcpPromptCatalogEntry[] {
  const serverTrust = getServerTrustMap();
  return getMcpClientPrompts()
    .map(({ serverName, prompt }) => ({
      serverName,
      name: prompt.name,
      title: typeof prompt.title === "string" ? prompt.title : null,
      description: typeof prompt.description === "string" ? prompt.description : null,
      arguments: Array.isArray(prompt.arguments)
        ? prompt.arguments.map((argument) => ({
            name: argument.name,
            required: argument.required,
            description: argument.description,
          }))
        : [],
      sourceKind: "imported-mcp" as const,
      trust: serverTrust.get(serverName) ?? {
        connected: true,
        requiresAuth: false,
        lastSeenAt: null,
        latencyClass: "unknown",
        auditState: "unaudited",
      },
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function buildImportedMcpServerSummaries(): ImportedMcpServerSummary[] {
  const serverTrust = getServerTrustMap();
  const toolsByServer = new Map<string, ImportedMcpToolCatalogEntry[]>();
  for (const tool of listImportedMcpToolCatalog()) {
    const current = toolsByServer.get(tool.serverName) ?? [];
    current.push(tool);
    toolsByServer.set(tool.serverName, current);
  }

  return getMcpClientStatus()
    .map((status) => {
      const tools = toolsByServer.get(status.name) ?? [];
      const traceSummary = getMcpTraceServerSummary(status.name);
      const trust = serverTrust.get(status.name);
      return {
        name: status.name,
        url: status.url,
        connected: status.connected,
        toolCount: status.toolCount,
        promptCount: status.promptCount,
        resourceCount: status.resourceCount,
        hasAuthToken: status.hasAuthToken,
        destructiveToolCount: tools.filter((tool) => tool.annotations.destructiveHint).length,
        readOnlyToolCount: tools.filter((tool) => tool.annotations.readOnlyHint).length,
        openWorldToolCount: tools.filter((tool) => tool.annotations.openWorldHint).length,
        lastSeenAt: traceSummary.lastSeenAt ?? status.lastSeenAt ?? null,
        latencyClass: traceSummary.latencyClass,
        auditState: trust?.auditState ?? "unaudited",
      } satisfies ImportedMcpServerSummary;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}