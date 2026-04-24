import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBizBotMcpServer } from "@/lib/mcp/server";
import { getStdioMcpServerOptions } from "@/lib/mcp/stdio";

function getAdvertisedCapabilities(options?: Parameters<typeof createBizBotMcpServer>[0]) {
  const server = createBizBotMcpServer(options);
  return (server.server as unknown as { getCapabilities: () => Record<string, unknown> }).getCapabilities();
}

describe("MCP server transport capability policy", () => {
  it("keeps default server behavior equivalent to HTTP without sampling", () => {
    const capabilities = getAdvertisedCapabilities();

    expect(capabilities.tools).toEqual(expect.objectContaining({ listChanged: true }));
    expect(capabilities.resources).toEqual(expect.objectContaining({ listChanged: true }));
    expect(capabilities.prompts).toEqual(expect.objectContaining({ listChanged: true }));
    expect(capabilities.logging).toEqual({});
    expect(capabilities.sampling).toBeUndefined();
  });

  it("advertises sampling for stdio when explicitly enabled", () => {
    const capabilities = getAdvertisedCapabilities({ transportKind: "stdio", enableSampling: true });

    expect(capabilities.sampling).toEqual({});
  });

  it("does not advertise sampling for HTTP even when enableSampling is passed", () => {
    const capabilities = getAdvertisedCapabilities({ transportKind: "http", enableSampling: true });

    expect(capabilities.sampling).toBeUndefined();
  });

  it("returns a structured stdio tool error envelope for failing tool calls", async () => {
    const server = createBizBotMcpServer(getStdioMcpServerOptions());
    const client = new Client(
      { name: "vitest-error-client", version: "1.0.0" },
      { capabilities: {} },
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const result = await client.callTool({
      name: "developer_invoke_imported_mcp_tool",
      arguments: {
        serverName: "missing-server",
        toolName: "missing-tool",
      },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({
        category: "ToolError",
        traceId: expect.any(String),
        failure: expect.objectContaining({
          version: 1,
          layer: expect.any(String),
          kind: expect.any(String),
          raw: expect.stringContaining("missing-server"),
        }),
      }),
    }));

    await Promise.all([client.close(), server.close()]);
  });
});