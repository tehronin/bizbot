import crypto from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage, JSONRPCRequest, JSONRPCResponse, JSONRPCNotification } from "@modelcontextprotocol/sdk/types.js";
import { createMcpTraceCorrelationId, listMcpTraceEvents, recordMcpTraceEvent, type McpTraceEvent } from "@/lib/mcp/trace";

export const LOCAL_STDIO_MCP_SERVER_NAME = "bizbot-local-stdio";
const HEARTBEAT_EVENT_INTERVAL_MS = 15_000;

type StdioRuntimeLogger = Pick<typeof console, "info" | "warn" | "error">;

export interface StdioRuntimeSnapshot {
  sessionId: string;
  startedAt: string;
  lastHeartbeatAt: string | null;
  lastHeartbeatEventAt: string | null;
  lastShutdownReason: string | null;
  connected: boolean;
  clientName: string | null;
  clientVersion: string | null;
  clientSupportsSampling: boolean;
  clientSupportsSamplingTools: boolean;
  inboundMessageCount: number;
  outboundMessageCount: number;
  malformedFrameCount: number;
  droppedMessageCount: number;
  protocolErrorCount: number;
  transportErrorCount: number;
  initializeCount: number;
  capabilitySyncCount: number;
}

export interface CreateStdioServerRuntimeOptions {
  debug?: boolean;
  logger?: StdioRuntimeLogger;
  transport?: Transport;
}

function isJsonRpcRequest(message: JSONRPCMessage): message is JSONRPCRequest {
  return "method" in message && "id" in message;
}

function isJsonRpcNotification(message: JSONRPCMessage): message is JSONRPCNotification {
  return "method" in message && !("id" in message);
}

function isJsonRpcResponse(message: JSONRPCMessage): message is JSONRPCResponse {
  return "id" in message && !("method" in message);
}

function summarizeCapabilities(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "none";
  }

  const keys = Object.keys(value as Record<string, unknown>).sort();
  return keys.length > 0 ? keys.join(",") : "none";
}

function buildCapabilitySyncSummary(message: JSONRPCResponse): string {
  const result = "result" in message && message.result && typeof message.result === "object" && !Array.isArray(message.result)
    ? message.result as Record<string, unknown>
    : null;

  const capabilities = result?.capabilities;
  const protocolVersion = typeof result?.protocolVersion === "string" ? result.protocolVersion : "unknown";
  return `protocol=${protocolVersion}; serverCapabilities=${summarizeCapabilities(capabilities)}`;
}

function getLatestOpenStdioSession(): McpTraceEvent | null {
  const events = listMcpTraceEvents({
    limit: 250,
    serverName: LOCAL_STDIO_MCP_SERVER_NAME,
    transportKind: "stdio",
  });

  for (const event of events) {
    if (event.operation !== "session_start" || !event.sessionId) {
      continue;
    }

    const closed = events.some((candidate) => candidate.sessionId === event.sessionId && candidate.operation === "session_end");
    if (!closed) {
      return event;
    }
  }

  return null;
}

export class InstrumentedStdioServerTransport implements Transport {
  readonly sessionId: string;
  readonly correlationId: string;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T) => void;

  private readonly delegate: Transport;
  private readonly logger: StdioRuntimeLogger;
  private readonly debug: boolean;
  private readonly startedAt: string;
  private readonly traceServerName: string;
  private connected = false;
  private closing = false;
  private initializeRequestId: string | number | null = null;
  private clientName: string | null = null;
  private clientVersion: string | null = null;
  private clientSupportsSampling = false;
  private clientSupportsSamplingTools = false;
  private lastHeartbeatAt: string | null = null;
  private lastHeartbeatEventAt: string | null = null;
  private lastShutdownReason: string | null = null;
  private inboundMessageCount = 0;
  private outboundMessageCount = 0;
  private malformedFrameCount = 0;
  private droppedMessageCount = 0;
  private protocolErrorCount = 0;
  private transportErrorCount = 0;
  private initializeCount = 0;
  private capabilitySyncCount = 0;

  constructor(options: CreateStdioServerRuntimeOptions = {}) {
    this.delegate = options.transport ?? new StdioServerTransport();
    this.logger = options.logger ?? console;
    this.debug = options.debug === true;
    this.traceServerName = LOCAL_STDIO_MCP_SERVER_NAME;
    this.sessionId = `stdio-session-${crypto.randomUUID()}`;
    this.correlationId = createMcpTraceCorrelationId();
    this.startedAt = new Date().toISOString();
  }

  async start(): Promise<void> {
    const staleSession = getLatestOpenStdioSession();
    if (staleSession?.sessionId) {
      recordMcpTraceEvent({
        correlationId: staleSession.correlationId,
        serverName: this.traceServerName,
        operation: "session_end",
        target: "stdio_session",
        success: false,
        error: "Previous stdio session ended without a recorded shutdown.",
        resultSummary: "recovered stale local stdio session on startup",
        transportKind: "stdio",
        direction: "local",
        sessionId: staleSession.sessionId,
        trustLevel: "local",
      });
    }

    this.delegate.onmessage = (message) => {
      this.handleInboundMessage(message);
      this.onmessage?.(message);
    };
    this.delegate.onerror = (error) => {
      this.handleTransportError(error);
      this.onerror?.(error);
    };
    this.delegate.onclose = () => {
      void this.recordSessionEnd(this.lastShutdownReason ?? "transport_close", true);
      this.onclose?.();
    };

    this.recordTrace("session_start", {
      target: "stdio_session",
      success: true,
      direction: "local",
      resultSummary: this.debug ? "stdio runtime started with debug logging enabled" : "stdio runtime started",
    });
    this.debugLog(`session_start sessionId=${this.sessionId}`);
    await this.delegate.start();
    this.connected = true;
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    const startedAt = Date.now();
    this.outboundMessageCount += 1;
    this.touchHeartbeat();

    if (isJsonRpcResponse(message) && this.initializeRequestId !== null && String(message.id) === String(this.initializeRequestId)) {
      this.capabilitySyncCount += 1;
      this.recordTrace("capability_sync", {
        target: "initialize",
        success: !("error" in message),
        direction: "outbound",
        durationMs: Date.now() - startedAt,
        requestId: message.id,
        clientName: this.clientName,
        clientVersion: this.clientVersion,
        trustLevel: "local",
        resultSummary: buildCapabilitySyncSummary(message),
      });
      this.debugLog(`capability_sync sessionId=${this.sessionId} requestId=${String(message.id)}`);
    }

    try {
      await this.delegate.send(message, options);
    } catch (error) {
      this.transportErrorCount += 1;
      this.recordTrace("transport_error", {
        target: isJsonRpcResponse(message) ? "response_send" : isJsonRpcRequest(message) ? message.method : isJsonRpcNotification(message) ? message.method : "unknown_send",
        success: false,
        direction: "outbound",
        durationMs: Date.now() - startedAt,
        requestId: isJsonRpcResponse(message) || isJsonRpcRequest(message) ? message.id : options?.relatedRequestId,
        clientName: this.clientName,
        clientVersion: this.clientVersion,
        trustLevel: "local",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.recordSessionEnd(this.lastShutdownReason ?? "close", true);
    await this.delegate.close();
  }

  markShutdownReason(reason: string): void {
    this.lastShutdownReason = reason;
    this.debugLog(`shutdown_reason sessionId=${this.sessionId} reason=${reason}`);
  }

  markProtocolError(error: unknown, details?: { malformedFrame?: boolean; droppedMessage?: boolean; target?: string }): void {
    this.protocolErrorCount += 1;
    if (details?.malformedFrame) {
      this.malformedFrameCount += 1;
    }
    if (details?.droppedMessage) {
      this.droppedMessageCount += 1;
    }
    this.recordTrace("protocol_error", {
      target: details?.target ?? "stdio_protocol",
      success: false,
      direction: "local",
      error: error instanceof Error ? error.message : String(error),
      malformedFrameCount: this.malformedFrameCount,
      droppedMessageCount: this.droppedMessageCount,
      clientName: this.clientName,
      clientVersion: this.clientVersion,
      trustLevel: "local",
    });
  }

  getSnapshot(): StdioRuntimeSnapshot {
    return {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      lastHeartbeatAt: this.lastHeartbeatAt,
      lastHeartbeatEventAt: this.lastHeartbeatEventAt,
      lastShutdownReason: this.lastShutdownReason,
      connected: this.connected,
      clientName: this.clientName,
      clientVersion: this.clientVersion,
      clientSupportsSampling: this.clientSupportsSampling,
      clientSupportsSamplingTools: this.clientSupportsSamplingTools,
      inboundMessageCount: this.inboundMessageCount,
      outboundMessageCount: this.outboundMessageCount,
      malformedFrameCount: this.malformedFrameCount,
      droppedMessageCount: this.droppedMessageCount,
      protocolErrorCount: this.protocolErrorCount,
      transportErrorCount: this.transportErrorCount,
      initializeCount: this.initializeCount,
      capabilitySyncCount: this.capabilitySyncCount,
    };
  }

  private async recordSessionEnd(reason: string, success: boolean): Promise<void> {
    if (this.closing) {
      return;
    }

    this.closing = true;
    this.connected = false;
    this.lastShutdownReason = reason;
    this.recordTrace("session_end", {
      target: "stdio_session",
      success,
      direction: "local",
      resultSummary: `shutdownReason=${reason}`,
      clientName: this.clientName,
      clientVersion: this.clientVersion,
      malformedFrameCount: this.malformedFrameCount,
      droppedMessageCount: this.droppedMessageCount,
      trustLevel: "local",
    });
    this.debugLog(`session_end sessionId=${this.sessionId} reason=${reason} success=${String(success)}`);
  }

  private handleInboundMessage(message: JSONRPCMessage): void {
    this.inboundMessageCount += 1;
    this.touchHeartbeat();

    if (isJsonRpcRequest(message) && message.method === "initialize") {
      this.initializeCount += 1;
      this.initializeRequestId = message.id;
      const params = message.params && typeof message.params === "object" && !Array.isArray(message.params)
        ? message.params as Record<string, unknown>
        : null;
      const clientInfo = params?.clientInfo && typeof params.clientInfo === "object" && !Array.isArray(params.clientInfo)
        ? params.clientInfo as Record<string, unknown>
        : null;
      const capabilities = params?.capabilities && typeof params.capabilities === "object" && !Array.isArray(params.capabilities)
        ? params.capabilities as Record<string, unknown>
        : null;

      this.clientName = typeof clientInfo?.name === "string" ? clientInfo.name : null;
      this.clientVersion = typeof clientInfo?.version === "string" ? clientInfo.version : null;
      this.clientSupportsSampling = Boolean(capabilities?.sampling);
      this.clientSupportsSamplingTools = Boolean(
        capabilities?.sampling && typeof capabilities.sampling === "object" && !Array.isArray(capabilities.sampling)
          && "tools" in (capabilities.sampling as Record<string, unknown>),
      );

      this.recordTrace("initialize_received", {
        target: "initialize",
        success: true,
        direction: "inbound",
        requestId: message.id,
        requestKeys: params ? Object.keys(params) : [],
        clientName: this.clientName,
        clientVersion: this.clientVersion,
        trustLevel: "local",
        resultSummary: `clientCapabilities=${summarizeCapabilities(capabilities)}`,
      });
      this.debugLog(`initialize_received sessionId=${this.sessionId} requestId=${String(message.id)} client=${this.clientName ?? "unknown"}`);
    }
  }

  private handleTransportError(error: Error): void {
    this.transportErrorCount += 1;
    this.recordTrace("transport_error", {
      target: "stdio_transport",
      success: false,
      direction: "local",
      error: error.message,
      clientName: this.clientName,
      clientVersion: this.clientVersion,
      malformedFrameCount: this.malformedFrameCount,
      droppedMessageCount: this.droppedMessageCount,
      trustLevel: "local",
    });
    this.debugLog(`transport_error sessionId=${this.sessionId} error=${error.message}`);
  }

  private touchHeartbeat(): void {
    const now = new Date();
    this.lastHeartbeatAt = now.toISOString();
    const lastHeartbeatEventMs = this.lastHeartbeatEventAt ? Date.parse(this.lastHeartbeatEventAt) : 0;
    if (Number.isFinite(lastHeartbeatEventMs) && now.getTime() - lastHeartbeatEventMs < HEARTBEAT_EVENT_INTERVAL_MS) {
      return;
    }

    this.lastHeartbeatEventAt = now.toISOString();
    this.recordTrace("heartbeat", {
      target: "stdio_session",
      success: true,
      direction: "local",
      resultSummary: `inbound=${this.inboundMessageCount}; outbound=${this.outboundMessageCount}`,
      clientName: this.clientName,
      clientVersion: this.clientVersion,
      malformedFrameCount: this.malformedFrameCount,
      droppedMessageCount: this.droppedMessageCount,
      trustLevel: "local",
    });
  }

  private recordTrace(operation: Parameters<typeof recordMcpTraceEvent>[0]["operation"], input: Omit<Parameters<typeof recordMcpTraceEvent>[0], "correlationId" | "serverName" | "operation" | "transportKind" | "sessionId">): void {
    recordMcpTraceEvent({
      correlationId: this.correlationId,
      serverName: this.traceServerName,
      operation,
      transportKind: "stdio",
      sessionId: this.sessionId,
      ...input,
    });
  }

  private debugLog(message: string): void {
    if (!this.debug) {
      return;
    }

    this.logger.info(`[bizbot-mcp][stdio-debug] ${message}`);
  }
}

export function createInstrumentedStdioServerTransport(options: CreateStdioServerRuntimeOptions = {}): InstrumentedStdioServerTransport {
  return new InstrumentedStdioServerTransport(options);
}