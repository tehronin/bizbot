import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod/v4";
import { createPluginRegistry, getBuiltinPlugins } from "@/lib/agent/plugins";
import {
  closeMcpClients,
  getMcpClientPrompt,
  getMcpClientPrompts,
  getMcpClientResources,
  getMcpClientStatus,
  getMcpClientTools,
  initMcpClients,
  invokeMcpClientTool,
  readMcpClientResource,
  resetMcpClientLogger,
  setMcpClientLogger,
} from "@/lib/mcp/client";

function registerFixtureTools(server: McpServer) {
  server.registerTool("echo", {
    description: "Echo fixture payloads for client integration tests",
    inputSchema: {
      name: z.string(),
    },
  }, async ({ name }: { name: string }) => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ echoed: name, source: "fixture-mcp" }),
      },
    ],
  }));

  server.registerTool("fail", {
    description: "Return an MCP tool error for client integration tests",
    inputSchema: {
      message: z.string().default("fixture failure"),
    },
  }, async ({ message }: { message?: string }) => ({
    isError: true,
    content: [
      {
        type: "text" as const,
        text: message ?? "fixture failure",
      },
    ],
  }));

  server.registerTool("plain_text", {
    description: "Return non-JSON plain text for client integration tests",
    inputSchema: {
      value: z.string(),
    },
  }, async ({ value }: { value: string }) => ({
    content: [
      {
        type: "text" as const,
        text: `plain:${value}`,
      },
    ],
  }));
}

function registerFixtureResources(server: McpServer) {
  server.registerResource(
    "fixture-status",
    "fixture://status",
    {
      title: "Fixture Status",
      description: "Fixture resource payload for MCP client integration tests",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "fixture://status",
          mimeType: "application/json",
          text: JSON.stringify({ status: "ok", source: "fixture-mcp" }),
        },
      ],
    }),
  );
}

function registerFixturePrompts(server: McpServer) {
  server.registerPrompt(
    "fixture-plan",
    {
      title: "Fixture Plan",
      description: "Fixture prompt payload for MCP client integration tests",
      argsSchema: {
        topic: z.string(),
      },
    },
    async ({ topic }: { topic: string }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Plan next steps for ${topic}`,
          },
        },
      ],
    }),
  );
}

async function startStreamableFixtureMcpServer(): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer(async (req, res) => {
    if (req.url !== "/mcp") {
      res.writeHead(404).end();
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null,
      }));
      return;
    }

    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    const parsedBody = body.length > 0 ? JSON.parse(body) : undefined;
    const mcpServer = new McpServer({ name: "fixture-mcp", version: "1.0.0" }, {
      capabilities: { tools: {}, resources: {}, prompts: {} },
    });
    registerFixtureTools(mcpServer);
    registerFixtureResources(mcpServer);
    registerFixturePrompts(mcpServer);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    try {
      await mcpServer.connect(transport);
      res.on("close", () => {
        void transport.close();
        void mcpServer.close();
      });
      await transport.handleRequest(req, res, parsedBody);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: String(error) },
          id: null,
        }));
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine fixture MCP server address");
  }

  return {
    server,
    url: `http://127.0.0.1:${address.port}/mcp`,
  };
}

async function startSseFixtureMcpServer(): Promise<{ server: http.Server; url: string }> {
  const transports = new Map<string, { transport: SSEServerTransport; server: McpServer }>();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/sse") {
      const transport = new SSEServerTransport("/messages", res);
      const mcpServer = new McpServer({ name: "fixture-sse", version: "1.0.0" }, {
        capabilities: { tools: {}, resources: {}, prompts: {} },
      });
      registerFixtureTools(mcpServer);
      registerFixtureResources(mcpServer);
      registerFixturePrompts(mcpServer);
      await mcpServer.connect(transport);
      transports.set(transport.sessionId, { transport, server: mcpServer });
      res.on("close", () => {
        transports.delete(transport.sessionId);
        void mcpServer.close();
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/messages") {
      const sessionId = url.searchParams.get("sessionId");
      const session = sessionId ? transports.get(sessionId) : undefined;
      if (!session) {
        res.writeHead(400).end("Invalid or missing session ID");
        return;
      }

      let body = "";
      for await (const chunk of req) {
        body += chunk;
      }

      const parsedBody = body.length > 0 ? JSON.parse(body) : undefined;
      const requestWithAuth = req as Parameters<typeof session.transport.handlePostMessage>[0];
      await session.transport.handlePostMessage(requestWithAuth, res, parsedBody);
      return;
    }

    res.writeHead(405).end();
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine fixture SSE server address");
  }

  return {
    server,
    url: `http://127.0.0.1:${address.port}/sse`,
  };
}

beforeEach(() => {
  setMcpClientLogger({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });
});

afterEach(async () => {
  delete process.env.MCP_SERVERS;
  await closeMcpClients();
  resetMcpClientLogger();
});

describe("external MCP client integration", () => {
  it("loads imported tools over Streamable HTTP and merges them into the BizBot plugin registry", async () => {
    const fixture = await startStreamableFixtureMcpServer();

    try {
      process.env.MCP_SERVERS = JSON.stringify([
        { name: "fixture", url: fixture.url },
      ]);

      await initMcpClients();

      const importedTools = getMcpClientTools();
      expect(importedTools.map((tool) => tool.name).sort()).toEqual([
        "mcp_fixture_echo",
        "mcp_fixture_fail",
        "mcp_fixture_plain_text",
      ]);

      const echoTool = importedTools.find((tool) => tool.name === "mcp_fixture_echo");
      expect(echoTool).toBeDefined();

      const result = await echoTool!.execute({ name: "bizbot" }, {});
      expect(result).toEqual({ echoed: "bizbot", source: "fixture-mcp" });

      const registry = createPluginRegistry(getBuiltinPlugins(), importedTools);
      expect(registry.toolToPluginId.get("mcp_fixture_echo")).toBe("external-mcp");
      expect(registry.tools.some((tool) => tool.name === "mcp_fixture_echo")).toBe(true);
      expect(getMcpClientStatus()).toEqual([
        expect.objectContaining({
          name: "fixture",
          url: fixture.url,
          connected: true,
          toolCount: 3,
          promptCount: 1,
          resourceCount: 1,
          hasAuthToken: false,
          latencyClass: expect.any(String),
          lastSeenAt: expect.any(String),
        }),
      ]);
    } finally {
      await closeMcpClients();
      await new Promise<void>((resolve, reject) => {
        fixture.server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("falls back to legacy SSE when Streamable HTTP is unavailable", async () => {
    const fixture = await startSseFixtureMcpServer();

    try {
      process.env.MCP_SERVERS = JSON.stringify([
        { name: "fixture-sse", url: fixture.url },
      ]);

      await initMcpClients();

      const importedTools = getMcpClientTools();
      const echoTool = importedTools.find((tool) => tool.name === "mcp_fixture-sse_echo");

      expect(echoTool).toBeDefined();
      await expect(echoTool!.execute({ name: "fallback" }, {})).resolves.toEqual({
        echoed: "fallback",
        source: "fixture-mcp",
      });
      expect(getMcpClientStatus()).toEqual([
        expect.objectContaining({
          name: "fixture-sse",
          url: fixture.url,
          connected: true,
          toolCount: 3,
          promptCount: 1,
          resourceCount: 1,
          hasAuthToken: false,
          latencyClass: expect.any(String),
          lastSeenAt: expect.any(String),
        }),
      ]);
    } finally {
      await closeMcpClients();
      await new Promise<void>((resolve, reject) => {
        fixture.server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("unwraps remote MCP tool errors and plain text payloads", async () => {
    const fixture = await startStreamableFixtureMcpServer();

    try {
      process.env.MCP_SERVERS = JSON.stringify([
        { name: "fixture", url: fixture.url },
      ]);

      await initMcpClients();

      const importedTools = getMcpClientTools();
      const failTool = importedTools.find((tool) => tool.name === "mcp_fixture_fail");
      const plainTextTool = importedTools.find((tool) => tool.name === "mcp_fixture_plain_text");

      expect(failTool).toBeDefined();
      expect(plainTextTool).toBeDefined();

      await expect(failTool!.execute({ message: "remote exploded" }, {})).rejects.toThrow("remote exploded");
      await expect(plainTextTool!.execute({ value: "hello" }, {})).resolves.toEqual({ result: "plain:hello" });
    } finally {
      await closeMcpClients();
      await new Promise<void>((resolve, reject) => {
        fixture.server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("invokes imported MCP tools directly by server and original tool name", async () => {
    const fixture = await startStreamableFixtureMcpServer();

    try {
      process.env.MCP_SERVERS = JSON.stringify([
        { name: "fixture", url: fixture.url },
      ]);

      await initMcpClients();

      await expect(invokeMcpClientTool("fixture", "echo", { name: "direct" })).resolves.toEqual({
        echoed: "direct",
        source: "fixture-mcp",
      });
    } finally {
      await closeMcpClients();
      await new Promise<void>((resolve, reject) => {
        fixture.server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("captures imported MCP resource catalogs and reads resource contents", async () => {
    const fixture = await startStreamableFixtureMcpServer();

    try {
      process.env.MCP_SERVERS = JSON.stringify([
        { name: "fixture", url: fixture.url },
      ]);

      await initMcpClients();

      expect(getMcpClientResources()).toEqual([
        {
          serverName: "fixture",
          resource: expect.objectContaining({
            name: "fixture-status",
            uri: "fixture://status",
            title: "Fixture Status",
            mimeType: "application/json",
          }),
        },
      ]);

      await expect(readMcpClientResource("fixture", "fixture://status")).resolves.toEqual({
        contents: [
          {
            uri: "fixture://status",
            mimeType: "application/json",
            text: JSON.stringify({ status: "ok", source: "fixture-mcp" }),
          },
        ],
      });
    } finally {
      await closeMcpClients();
      await new Promise<void>((resolve, reject) => {
        fixture.server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("captures imported MCP prompt catalogs and fetches prompt messages", async () => {
    const fixture = await startStreamableFixtureMcpServer();

    try {
      process.env.MCP_SERVERS = JSON.stringify([
        { name: "fixture", url: fixture.url },
      ]);

      await initMcpClients();

      expect(getMcpClientPrompts()).toEqual([
        {
          serverName: "fixture",
          prompt: expect.objectContaining({
            name: "fixture-plan",
            title: "Fixture Plan",
            description: "Fixture prompt payload for MCP client integration tests",
          }),
        },
      ]);

      await expect(getMcpClientPrompt("fixture", "fixture-plan", { topic: "crm triage" })).resolves.toEqual({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Plan next steps for crm triage",
            },
          },
        ],
      });
    } finally {
      await closeMcpClients();
      await new Promise<void>((resolve, reject) => {
        fixture.server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});