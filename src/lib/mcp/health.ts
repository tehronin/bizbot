import { buildCurrentBuilderDevLoopContext } from "@/lib/mcp/devloop-context";
import { getImportedMcpCatalogDiff } from "@/lib/mcp/imported-catalog";
import { getMcpClientStatus } from "@/lib/mcp/client";
import { getMcpQueueStatus } from "@/lib/mcp/job-status";
import { getMcpSamplingPolicy } from "@/lib/mcp/policy";
import { getDevLoopSamplingToolDescriptors, getDevLoopSamplingTelemetrySnapshot } from "@/lib/mcp/sampling";
import { getMcpTracePersistenceInfo, listMcpTraceEvents, listMcpTraceServerSummaries } from "@/lib/mcp/trace";
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