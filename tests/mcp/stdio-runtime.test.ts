import { describe, expect, it, beforeEach } from "vitest";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { clearMcpTraceEvents, listMcpTraceEvents } from "@/lib/mcp/trace";
import { createInstrumentedStdioServerTransport, LOCAL_STDIO_MCP_SERVER_NAME } from "@/lib/mcp/stdio-runtime";

class FakeTransport implements Transport {
  sessionId?: string;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T) => void;
  sent: JSONRPCMessage[] = [];

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    this.sent.push(message);
  }

  async close(): Promise<void> {
    this.onclose?.();
  }
}

describe("stdio runtime transport", () => {
  beforeEach(() => {
    clearMcpTraceEvents();
  });

  it("records session lifecycle, initialize posture, and capability sync", async () => {
    const delegate = new FakeTransport();
    const transport = createInstrumentedStdioServerTransport({ transport: delegate });

    await transport.start();

    delegate.onmessage?.({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        clientInfo: { name: "vitest-client", version: "1.0.0" },
        capabilities: { sampling: { tools: {} }, roots: {} },
      },
    });

    await transport.send({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {}, sampling: {} },
        serverInfo: { name: "bizbot", version: "0.1.0" },
      },
    });

    transport.markShutdownReason("test_complete");
    await transport.close();

    const events = listMcpTraceEvents({
      limit: 20,
      serverName: LOCAL_STDIO_MCP_SERVER_NAME,
      transportKind: "stdio",
    });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "session_start", sessionId: transport.sessionId }),
      expect.objectContaining({
        operation: "initialize_received",
        sessionId: transport.sessionId,
        requestId: "1",
        clientName: "vitest-client",
        clientVersion: "1.0.0",
      }),
      expect.objectContaining({
        operation: "capability_sync",
        sessionId: transport.sessionId,
        requestId: "1",
        clientName: "vitest-client",
        clientVersion: "1.0.0",
      }),
      expect.objectContaining({
        operation: "session_end",
        sessionId: transport.sessionId,
        resultSummary: "shutdownReason=test_complete",
      }),
    ]));
  });

  it("marks a stale prior session as unclean on next startup", async () => {
    const first = createInstrumentedStdioServerTransport({ transport: new FakeTransport() });
    await first.start();

    const second = createInstrumentedStdioServerTransport({ transport: new FakeTransport() });
    await second.start();
    second.markShutdownReason("second_complete");
    await second.close();

    const events = listMcpTraceEvents({
      limit: 20,
      serverName: LOCAL_STDIO_MCP_SERVER_NAME,
      transportKind: "stdio",
    });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: "session_end",
        sessionId: first.sessionId,
        success: false,
        error: "Previous stdio session ended without a recorded shutdown.",
      }),
      expect.objectContaining({
        operation: "session_end",
        sessionId: second.sessionId,
        success: true,
      }),
    ]));
  });
});