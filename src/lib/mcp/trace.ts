import fs from "node:fs";
import path from "node:path";
import { resolveFromAppHome } from "@/lib/runtime-paths";

export type McpTraceOperation = "connect" | "disconnect" | "inventory_sync" | "tool_call" | "resource_read" | "prompt_get";

const MCP_TRACE_PERSISTENCE_VERSION = 1;
const MCP_TRACE_LIMIT = 250;
const MCP_TRACE_PERSISTENCE_PATH = resolveFromAppHome(".bizbot", "mcp-trace.json");

export interface McpTraceEvent {
  id: string;
  correlationId: string;
  timestamp: string;
  serverName: string;
  serverUrl: string | null;
  operation: McpTraceOperation;
  target: string;
  success: boolean;
  durationMs: number | null;
  error: string | null;
  requestKeys: string[];
  resultSummary: string | null;
  provenance: {
    prefixedToolName?: string;
    originalToolName?: string;
  } | null;
}

interface RecordMcpTraceEventInput {
  correlationId?: string;
  serverName: string;
  serverUrl?: string | null;
  operation: McpTraceOperation;
  target: string;
  success: boolean;
  durationMs?: number | null;
  error?: string | null;
  requestKeys?: string[];
  resultSummary?: string | null;
  provenance?: {
    prefixedToolName?: string;
    originalToolName?: string;
  } | null;
}

interface ListMcpTraceEventsArgs {
  limit?: number;
  serverName?: string;
  operation?: McpTraceOperation;
}

export interface McpTraceServerSummary {
  serverName: string;
  lastSeenAt: string | null;
  successCount: number;
  failureCount: number;
  averageDurationMs: number | null;
  latencyClass: "unknown" | "fast" | "moderate" | "slow";
}

const mcpTraceEvents: McpTraceEvent[] = [];
let persistenceWritePending = false;

interface PersistedMcpTraceState {
  version: number;
  updatedAt: string;
  events: McpTraceEvent[];
}

function classifyLatency(value: number | null): McpTraceServerSummary["latencyClass"] {
  if (value === null || !Number.isFinite(value)) {
    return "unknown";
  }
  if (value <= 150) {
    return "fast";
  }
  if (value <= 800) {
    return "moderate";
  }
  return "slow";
}

export function clearMcpTraceEvents(): void {
  mcpTraceEvents.length = 0;
  scheduleTracePersistence();
}

function parsePersistedTraceState(raw: string): PersistedMcpTraceState | null {
  try {
    const parsed = JSON.parse(raw) as PersistedMcpTraceState;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    if (parsed.version !== MCP_TRACE_PERSISTENCE_VERSION || !Array.isArray(parsed.events)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function normalizeTraceEvent(event: Partial<McpTraceEvent>): McpTraceEvent | null {
  if (typeof event.serverName !== "string" || typeof event.operation !== "string" || typeof event.target !== "string") {
    return null;
  }

  return {
    id: typeof event.id === "string" && event.id.trim() ? event.id : `mcp-trace-${crypto.randomUUID()}`,
    correlationId: typeof event.correlationId === "string" && event.correlationId.trim() ? event.correlationId : `mcp-correlation-${crypto.randomUUID()}`,
    timestamp: typeof event.timestamp === "string" && event.timestamp.trim() ? event.timestamp : new Date().toISOString(),
    serverName: event.serverName,
    serverUrl: typeof event.serverUrl === "string" && event.serverUrl.trim() ? event.serverUrl : null,
    operation: event.operation as McpTraceOperation,
    target: event.target,
    success: event.success === true,
    durationMs: typeof event.durationMs === "number" && Number.isFinite(event.durationMs) ? Math.max(0, Math.round(event.durationMs)) : null,
    error: typeof event.error === "string" && event.error.trim() ? event.error.trim() : null,
    requestKeys: Array.isArray(event.requestKeys) ? [...new Set(event.requestKeys.filter((value): value is string => typeof value === "string" && value.trim().length > 0))].sort() : [],
    resultSummary: typeof event.resultSummary === "string" && event.resultSummary.trim() ? event.resultSummary.trim() : null,
    provenance: event.provenance && typeof event.provenance === "object" && !Array.isArray(event.provenance) ? {
      ...(typeof event.provenance.prefixedToolName === "string" && event.provenance.prefixedToolName.trim() ? { prefixedToolName: event.provenance.prefixedToolName } : {}),
      ...(typeof event.provenance.originalToolName === "string" && event.provenance.originalToolName.trim() ? { originalToolName: event.provenance.originalToolName } : {}),
    } : null,
  };
}

function getPersistedTraceState(): PersistedMcpTraceState {
  return {
    version: MCP_TRACE_PERSISTENCE_VERSION,
    updatedAt: new Date().toISOString(),
    events: mcpTraceEvents,
  };
}

function writeTraceStateToDisk(): void {
  persistenceWritePending = false;

  try {
    fs.mkdirSync(path.dirname(MCP_TRACE_PERSISTENCE_PATH), { recursive: true });
    fs.writeFileSync(MCP_TRACE_PERSISTENCE_PATH, JSON.stringify(getPersistedTraceState()), "utf8");
  } catch {
    // Best effort local persistence only.
  }
}

function scheduleTracePersistence(): void {
  if (persistenceWritePending) {
    return;
  }

  persistenceWritePending = true;
  queueMicrotask(writeTraceStateToDisk);
}

function hydrateTraceEventsFromDisk(): void {
  try {
    if (!fs.existsSync(MCP_TRACE_PERSISTENCE_PATH)) {
      return;
    }

    const parsed = parsePersistedTraceState(fs.readFileSync(MCP_TRACE_PERSISTENCE_PATH, "utf8"));
    if (!parsed) {
      return;
    }

    mcpTraceEvents.push(
      ...parsed.events
        .map((event) => normalizeTraceEvent(event))
        .filter((event): event is McpTraceEvent => Boolean(event))
        .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
        .slice(0, MCP_TRACE_LIMIT),
    );
  } catch {
    // Ignore corrupt or unreadable local trace persistence.
  }
}

export function createMcpTraceCorrelationId(): string {
  return `mcp-correlation-${crypto.randomUUID()}`;
}

export function recordMcpTraceEvent(input: RecordMcpTraceEventInput): McpTraceEvent {
  const event: McpTraceEvent = {
    id: `mcp-trace-${crypto.randomUUID()}`,
    correlationId: typeof input.correlationId === "string" && input.correlationId.trim() ? input.correlationId : createMcpTraceCorrelationId(),
    timestamp: new Date().toISOString(),
    serverName: input.serverName,
    serverUrl: input.serverUrl ?? null,
    operation: input.operation,
    target: input.target,
    success: input.success,
    durationMs: typeof input.durationMs === "number" && Number.isFinite(input.durationMs)
      ? Math.max(0, Math.round(input.durationMs))
      : null,
    error: typeof input.error === "string" && input.error.trim() ? input.error.trim() : null,
    requestKeys: Array.isArray(input.requestKeys) ? [...new Set(input.requestKeys.filter((value) => typeof value === "string" && value.trim().length > 0))].sort() : [],
    resultSummary: typeof input.resultSummary === "string" && input.resultSummary.trim() ? input.resultSummary.trim() : null,
    provenance: input.provenance ?? null,
  };

  mcpTraceEvents.unshift(event);
  if (mcpTraceEvents.length > MCP_TRACE_LIMIT) {
    mcpTraceEvents.length = MCP_TRACE_LIMIT;
  }
  scheduleTracePersistence();

  return event;
}

export function listMcpTraceEvents(args?: ListMcpTraceEventsArgs): McpTraceEvent[] {
  return mcpTraceEvents
    .filter((event) => (!args?.serverName || event.serverName === args.serverName) && (!args?.operation || event.operation === args.operation))
    .slice(0, Math.max(1, args?.limit ?? 50));
}

export function getMcpTraceServerSummary(serverName: string): McpTraceServerSummary {
  const events = listMcpTraceEvents({ limit: MCP_TRACE_LIMIT, serverName });
  const durationValues = events
    .map((event) => event.durationMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const averageDurationMs = durationValues.length > 0
    ? Math.round(durationValues.reduce((sum, value) => sum + value, 0) / durationValues.length)
    : null;

  return {
    serverName,
    lastSeenAt: events[0]?.timestamp ?? null,
    successCount: events.filter((event) => event.success).length,
    failureCount: events.filter((event) => !event.success).length,
    averageDurationMs,
    latencyClass: classifyLatency(averageDurationMs),
  };
}

export function listMcpTraceServerSummaries(): McpTraceServerSummary[] {
  return [...new Set(mcpTraceEvents.map((event) => event.serverName))]
    .sort((left, right) => left.localeCompare(right))
    .map((serverName) => getMcpTraceServerSummary(serverName));
}

export function getMcpTracePersistenceInfo() {
  return {
    path: MCP_TRACE_PERSISTENCE_PATH,
    version: MCP_TRACE_PERSISTENCE_VERSION,
    limit: MCP_TRACE_LIMIT,
    eventCount: mcpTraceEvents.length,
  };
}

hydrateTraceEventsFromDisk();