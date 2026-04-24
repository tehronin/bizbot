import { buildCurrentBuilderDevLoopContext } from "@/lib/mcp/devloop-context";
import { getImportedMcpCatalogDiff } from "@/lib/mcp/imported-catalog";
import { getMcpClientStatus } from "@/lib/mcp/client";
import { getMcpQueueStatus } from "@/lib/mcp/job-status";
import { getMcpSamplingPolicy } from "@/lib/mcp/policy";
import { getDevLoopSamplingToolDescriptors, getDevLoopSamplingTelemetrySnapshot } from "@/lib/mcp/sampling";
import { getMcpTracePersistenceInfo, listMcpTraceEvents, listMcpTraceServerSummaries } from "@/lib/mcp/trace";
import { LOCAL_STDIO_MCP_SERVER_NAME } from "@/lib/mcp/stdio-runtime";
import { normalizeFailure, type FailureEnvelope } from "@/lib/failures";

export interface McpHealthSnapshot {
  generatedAt: string;
  status: "ok" | "warning" | "blocked";
  summary: string;
  recommendations: string[];
  importedServers: {
    total: number;
    connected: number;
    disconnected: string[];
    latency: Array<{ serverName: string; latencyClass: "unknown" | "fast" | "moderate" | "slow" }>;
  };
  importedCatalog: {
    auditState: string;
    summary: {
      toolChanges: number;
      promptChanges: number;
      resourceChanges: number;
      serverChanges: number;
    };
  };
  queues: {
    workerRunning: boolean;
    lastSeenAt: string | null;
    activeQueueNames: string[];
    pendingJobs: number;
    failedJobs: number;
  };
  trace: {
    persistence: ReturnType<typeof getMcpTracePersistenceInfo>;
    recentFailureCount: number;
    recentFailures: Array<{ correlationId: string; serverName: string; operation: string; target: string; error: string | null; timestamp: string; failure: FailureEnvelope | null }>;
    servers: ReturnType<typeof listMcpTraceServerSummaries>;
  };
  localStdio: {
    available: boolean;
    sessionsStarted: number;
    sessionsEnded: number;
    uncleanExits: number;
    initializeCount: number;
    capabilitySyncCount: number;
    toolCallCount: number;
    samplingRequestCount: number;
    protocolErrorCount: number;
    transportErrorCount: number;
    malformedFrameCount: number;
    droppedMessageCount: number;
    averageToolCallDurationMs: number | null;
    lastSeenAt: string | null;
    lastActiveSessionId: string | null;
    lastShutdownReason: string | null;
    lastClientName: string | null;
    lastClientVersion: string | null;
    lastCapabilitySyncSummary: string | null;
  };
  sampling: {
    allowTools: boolean;
    toolCount: number;
    toolNames: string[];
    telemetry: ReturnType<typeof getDevLoopSamplingTelemetrySnapshot>;
  };
  builder: {
    available: boolean;
    projectId: string | null;
    contracts: { mcpSnapshot: string; dependency: string; fileTopology: string } | null;
    latestFailure: string | null;
  };
}

function sumQueueMetric(counts: Record<string, { waiting: number; active: number; delayed: number; completed: number; failed: number }>, key: "waiting" | "active" | "delayed" | "failed"): number {
  return Object.values(counts).reduce((total, entry) => total + (entry[key] ?? 0), 0);
}

function parseShutdownReason(summary: string | null): string | null {
  if (!summary) {
    return null;
  }

  const match = summary.match(/shutdownReason=([^;]+)/i);
  return match?.[1]?.trim() ?? null;
}

export function buildLocalStdioTraceSummary() {
  const events = listMcpTraceEvents({
    limit: 250,
    serverName: LOCAL_STDIO_MCP_SERVER_NAME,
    transportKind: "stdio",
  });
  const toolCalls = events.filter((event) => event.operation === "tool_call");
  const sessionStarts = events.filter((event) => event.operation === "session_start");
  const sessionEnds = events.filter((event) => event.operation === "session_end");
  const capabilitySyncEvents = events.filter((event) => event.operation === "capability_sync");
  const transportErrors = events.filter((event) => event.operation === "transport_error");
  const protocolErrors = events.filter((event) => event.operation === "protocol_error");
  const openSession = sessionStarts.find((start) => start.sessionId && !sessionEnds.some((end) => end.sessionId === start.sessionId));
  const durationValues = toolCalls
    .map((event) => event.durationMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return {
    available: events.length > 0,
    sessionsStarted: sessionStarts.length,
    sessionsEnded: sessionEnds.length,
    uncleanExits: sessionEnds.filter((event) => event.success === false).length,
    initializeCount: events.filter((event) => event.operation === "initialize_received").length,
    capabilitySyncCount: capabilitySyncEvents.length,
    toolCallCount: toolCalls.length,
    samplingRequestCount: toolCalls.filter((event) => event.sampled === true).length,
    protocolErrorCount: protocolErrors.length,
    transportErrorCount: transportErrors.length,
    malformedFrameCount: sessionEnds.reduce((total, event) => total + (event.malformedFrameCount ?? 0), 0),
    droppedMessageCount: sessionEnds.reduce((total, event) => total + (event.droppedMessageCount ?? 0), 0),
    averageToolCallDurationMs: durationValues.length > 0
      ? Math.round(durationValues.reduce((sum, value) => sum + value, 0) / durationValues.length)
      : null,
    lastSeenAt: events[0]?.timestamp ?? null,
    lastActiveSessionId: openSession?.sessionId ?? null,
    lastShutdownReason: parseShutdownReason(sessionEnds[0]?.resultSummary ?? null),
    lastClientName: events.find((event) => event.clientName)?.clientName ?? null,
    lastClientVersion: events.find((event) => event.clientVersion)?.clientVersion ?? null,
    lastCapabilitySyncSummary: capabilitySyncEvents[0]?.resultSummary ?? null,
  };
}

export async function buildMcpHealthSnapshot(): Promise<McpHealthSnapshot> {
  const [queueStatus, importedCatalogDiff, builderContext] = await Promise.all([
    getMcpQueueStatus(),
    getImportedMcpCatalogDiff(),
    buildCurrentBuilderDevLoopContext(),
  ]);

  const importedServers = getMcpClientStatus();
  const traceServers = listMcpTraceServerSummaries();
  const recentTraceEvents = listMcpTraceEvents({ limit: 40 });
  const recentFailures = recentTraceEvents
    .filter((event) => !event.success)
    .slice(0, 10)
    .map((event) => ({
      correlationId: event.correlationId,
      serverName: event.serverName,
      operation: event.operation,
      target: event.target,
      error: event.error,
      timestamp: event.timestamp,
      failure: event.error
        ? normalizeFailure(event.error, {
            component: "mcp_health",
            operation: event.operation,
            serverName: event.serverName,
            target: event.target,
          })
        : null,
    }));

  const disconnectedServers = importedServers.filter((server) => !server.connected).map((server) => server.name);
  const pendingJobs = sumQueueMetric(queueStatus.counts, "waiting") + sumQueueMetric(queueStatus.counts, "active") + sumQueueMetric(queueStatus.counts, "delayed");
  const failedJobs = sumQueueMetric(queueStatus.counts, "failed");
  const stdioPolicy = getMcpSamplingPolicy("developer_devloop_status", "stdio", true);
  const samplingTools = getDevLoopSamplingToolDescriptors();
  const localStdio = buildLocalStdioTraceSummary();

  const recommendations: string[] = [];
  let status: McpHealthSnapshot["status"] = "ok";
  let summary = "MCP loop looks healthy.";
  const markWarning = () => {
    if (status !== "blocked") {
      status = "warning";
    }
  };

  if (disconnectedServers.length > 0) {
    status = "warning";
    summary = `Disconnected imported MCP servers: ${disconnectedServers.join(", ")}.`;
    recommendations.push("Reconnect the disconnected imported MCP servers and inspect the latest trace failures for the first bad endpoint.");
  }

  if (importedCatalogDiff.auditState === "drifted") {
    markWarning();
    summary = summary === "MCP loop looks healthy."
      ? "Imported MCP catalog drift needs review."
      : summary;
    recommendations.push("Inspect imported MCP catalog drift and accept the new baseline only if the inventory change is intentional.");
  }

  if (!queueStatus.workerRunning && pendingJobs > 0) {
    status = "blocked";
    summary = "MCP worker is not running while MCP jobs are still pending.";
    recommendations.push("Restart the MCP worker and inspect the queue backlog before retrying failed MCP work.");
  } else if (failedJobs > 0) {
    markWarning();
    if (summary === "MCP loop looks healthy.") {
      summary = "Recent MCP worker failures need attention.";
    }
    recommendations.push("Inspect the failed MCP jobs and retry the first failed queue item after fixing the underlying issue.");
  }

  if (recentFailures.length > 0) {
    markWarning();
    if (summary === "MCP loop looks healthy.") {
      summary = "Recent imported MCP operations include failures.";
    }
    recommendations.push("Inspect the latest MCP trace correlation ids to separate transport failures from tool or prompt failures.");
  }

  if (localStdio.uncleanExits > 0 || localStdio.protocolErrorCount > 0 || localStdio.transportErrorCount > 0) {
    markWarning();
    if (summary === "MCP loop looks healthy.") {
      summary = "Local stdio MCP sessions need review.";
    }
    recommendations.push("Inspect the local stdio lifecycle summary and trace to confirm the last session shut down cleanly and did not drop protocol messages.");
  }

  if (builderContext && (builderContext.diagnosticSummary.contracts.mcpSnapshotState === "drifted" || builderContext.diagnosticSummary.validation.passed === false)) {
    markWarning();
    if (summary === "MCP loop looks healthy.") {
      summary = "Builder dev-loop state indicates MCP or verification drift.";
    }
    recommendations.push("Inspect the current Builder dev-loop diagnosis and resolve the first MCP snapshot or verification failure before expanding the loop.");
  }

  if (recommendations.length === 0) {
    recommendations.push("Run the MCP health inspector again after the next imported MCP inventory sync or Builder verification pass.");
  }

  return {
    generatedAt: new Date().toISOString(),
    status,
    summary,
    recommendations,
    importedServers: {
      total: importedServers.length,
      connected: importedServers.filter((server) => server.connected).length,
      disconnected: disconnectedServers,
      latency: importedServers.map((server) => ({ serverName: server.name, latencyClass: server.latencyClass })),
    },
    importedCatalog: {
      auditState: importedCatalogDiff.auditState,
      summary: importedCatalogDiff.summary,
    },
    queues: {
      workerRunning: queueStatus.workerRunning,
      lastSeenAt: queueStatus.workerLastSeenAt,
      activeQueueNames: queueStatus.queueNames,
      pendingJobs,
      failedJobs,
    },
    trace: {
      persistence: getMcpTracePersistenceInfo(),
      recentFailureCount: recentFailures.length,
      recentFailures,
      servers: traceServers,
    },
    localStdio,
    sampling: {
      allowTools: stdioPolicy.allowTools,
      toolCount: samplingTools.length,
      toolNames: samplingTools.map((tool) => tool.name),
      telemetry: getDevLoopSamplingTelemetrySnapshot(),
    },
    builder: {
      available: Boolean(builderContext),
      projectId: builderContext?.project.id ?? null,
      contracts: builderContext ? {
        mcpSnapshot: builderContext.diagnosticSummary.contracts.mcpSnapshotState,
        dependency: builderContext.diagnosticSummary.contracts.dependencyContractState,
        fileTopology: builderContext.diagnosticSummary.contracts.fileTopologyContractState,
      } : null,
      latestFailure: builderContext?.currentBlockerOrLastErrorSignal.activeRunBlockedReason
        ?? builderContext?.currentBlockerOrLastErrorSignal.latestFailedRun?.blockedReason
        ?? null,
    },
  };
}