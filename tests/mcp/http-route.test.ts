import { describe, expect, it } from "vitest";
import { DELETE, GET, POST } from "@/app/api/mcp/route";

async function callMcp(
  method: string,
  params: Record<string, unknown>,
  id: string,
  headers?: Record<string, string>,
) {
  const response = await POST(new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }),
  }));

  return {
    status: response.status,
    body: await response.json(),
  };
}

describe("MCP HTTP route", () => {
  it("initializes with server metadata", async () => {
    const result = await callMcp("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "vitest",
        version: "1.0.0",
      },
    }, "init-1");

    expect(result.status).toBe(200);
    expect(result.body.jsonrpc).toBe("2.0");
    expect(result.body.id).toBe("init-1");
    expect(result.body.result.serverInfo.name).toBe("bizbot");
    expect(result.body.result.capabilities).toMatchObject({
      tools: expect.any(Object),
      resources: expect.any(Object),
      prompts: expect.any(Object),
    });
  });

  it("lists exposed tools and keeps blocked tools hidden", async () => {
    const result = await callMcp("tools/list", {}, "tools-1");

    expect(result.status).toBe(200);
    expect(result.body.result.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "developer_list_agent_runs" }),
      expect.objectContaining({ name: "crm_list_contacts" }),
      expect.objectContaining({ name: "local_business_get_status" }),
    ]));
    expect(result.body.result.tools).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "agent_delegate_run" }),
    ]));
  });

  it("executes a real tool call through JSON-RPC", async () => {
    const result = await callMcp("tools/call", {
      name: "developer_list_agent_runs",
      arguments: { limit: 1 },
    }, "call-1");

    expect(result.status).toBe(200);
    expect(result.body.result.structuredContent).toEqual({
      runs: expect.any(Array),
    });
    expect(result.body.result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text" }),
    ]));
  });

  it("lists registered MCP resources including plugin discovery resources", async () => {
    const result = await callMcp("resources/list", {}, "resources-1");

    expect(result.status).toBe(200);
    expect(result.body.result.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        uri: "bizbot://plugins/installed",
        name: "plugins-installed",
        mimeType: "application/json",
      }),
      expect.objectContaining({
        uri: "bizbot://plugins/tool-map",
        name: "plugins-tool-map",
        mimeType: "application/json",
      }),
      expect.objectContaining({
        uri: "bizbot://debug/system-status",
        name: "debug-system-status",
        mimeType: "application/json",
      }),
    ]));
  });

  it("reads a plugin discovery resource through JSON-RPC", async () => {
    const result = await callMcp("resources/read", {
      uri: "bizbot://plugins/installed",
    }, "read-1");

    expect(result.status).toBe(200);
    expect(result.body.result.contents).toHaveLength(1);
    expect(result.body.result.contents[0]).toEqual(expect.objectContaining({
      uri: "bizbot://plugins/installed",
      mimeType: "application/json",
      text: expect.any(String),
    }));

    const parsed = JSON.parse(result.body.result.contents[0].text);
    expect(parsed).toEqual(expect.objectContaining({
      generatedAt: expect.any(String),
      plugins: expect.any(Array),
      externalTools: expect.any(Array),
    }));
    expect(parsed.plugins).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "crm",
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "crm_list_contacts" }),
        ]),
      }),
      expect.objectContaining({
        id: "local-business",
      }),
    ]));
  });

  it("lists registered MCP prompts", async () => {
    const result = await callMcp("prompts/list", {}, "prompts-1");

    expect(result.status).toBe(200);
    expect(result.body.result.prompts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "debug-runtime",
        title: "Debug Runtime",
        arguments: expect.arrayContaining([
          expect.objectContaining({ name: "symptom", required: false }),
        ]),
      }),
      expect.objectContaining({
        name: "content-brief",
        title: "Content Brief",
      }),
      expect.objectContaining({
        name: "debug-vscode-mcp-loop",
        title: "Debug VS Code MCP Loop",
      }),
      expect.objectContaining({
        name: "inspect-agent-run",
        title: "Inspect Agent Run",
        arguments: expect.arrayContaining([
          expect.objectContaining({ name: "runId", required: true }),
        ]),
      }),
    ]));
  });

  it("gets a real prompt with interpolated arguments", async () => {
    const result = await callMcp("prompts/get", {
      name: "debug-runtime",
      arguments: { symptom: "worker is stalled" },
    }, "prompt-1");

    expect(result.status).toBe(200);
    expect(result.body.result.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: expect.objectContaining({
          type: "text",
          text: expect.stringContaining("Symptom: worker is stalled."),
        }),
      }),
    ]);

    const messageText = result.body.result.messages[0].content.text;
    expect(messageText).toContain("bizbot://debug/system-status");
    expect(messageText).toContain("bizbot://debug/recent-heartbeat");
    expect(messageText).toContain("smallest safe fix");
  });

  it("rejects unauthorized MCP requests when MCP_AUTH_TOKEN is configured", async () => {
    process.env.MCP_AUTH_TOKEN = "secret-token";

    try {
      const result = await callMcp("tools/list", {}, "auth-1");

      expect(result.status).toBe(401);
      expect(result.body).toEqual({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Unauthorized",
        },
        id: null,
      });
    } finally {
      delete process.env.MCP_AUTH_TOKEN;
    }
  });

  it("allows authorized MCP POST requests when MCP_AUTH_TOKEN is configured", async () => {
    process.env.MCP_AUTH_TOKEN = "secret-token";

    try {
      const result = await callMcp("tools/list", {}, "auth-ok", {
        authorization: "Bearer secret-token",
      });

      expect(result.status).toBe(200);
      expect(result.body.result.tools).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "developer_list_agent_runs" }),
      ]));
    } finally {
      delete process.env.MCP_AUTH_TOKEN;
    }
  });

  it("returns stateless-mode 405 for GET /api/mcp", async () => {
    const response = await GET(new Request("http://localhost:3000/api/mcp", {
      method: "GET",
      headers: {
        accept: "application/json, text/event-stream",
      },
    }));

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "SSE not supported in stateless mode",
      },
      id: null,
    });
  });

  it("returns stateless-mode 405 for DELETE /api/mcp", async () => {
    const response = await DELETE(new Request("http://localhost:3000/api/mcp", {
      method: "DELETE",
      headers: {
        accept: "application/json, text/event-stream",
      },
    }));

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Session management not supported in stateless mode",
      },
      id: null,
    });
  });

  it("rejects unauthorized GET /api/mcp requests when MCP_AUTH_TOKEN is configured", async () => {
    process.env.MCP_AUTH_TOKEN = "secret-token";

    try {
      const response = await GET(new Request("http://localhost:3000/api/mcp", {
        method: "GET",
        headers: {
          accept: "application/json, text/event-stream",
        },
      }));

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Unauthorized",
        },
        id: null,
      });
    } finally {
      delete process.env.MCP_AUTH_TOKEN;
    }
  });

  it("rejects unauthorized DELETE /api/mcp requests when MCP_AUTH_TOKEN is configured", async () => {
    process.env.MCP_AUTH_TOKEN = "secret-token";

    try {
      const response = await DELETE(new Request("http://localhost:3000/api/mcp", {
        method: "DELETE",
        headers: {
          accept: "application/json, text/event-stream",
        },
      }));

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Unauthorized",
        },
        id: null,
      });
    } finally {
      delete process.env.MCP_AUTH_TOKEN;
    }
  });

  it("returns method not found for unsupported MCP methods", async () => {
    const result = await callMcp("bogus/method", {}, "bad-method");

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      jsonrpc: "2.0",
      id: "bad-method",
      error: {
        code: -32601,
        message: "Method not found",
      },
    });
  });

  it("returns a parse error for malformed JSON-RPC payloads", async () => {
    const response = await POST(new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ nope: true }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32700,
        message: "Parse error: Invalid JSON-RPC message",
      },
      id: null,
    });
  });

  it("returns a parse error for invalid JSON request bodies", async () => {
    const response = await POST(new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: "{not-json",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32700,
        message: "Parse error: Invalid JSON",
      },
      id: null,
    });
  });

  it("returns invalid params when a required prompt argument is missing", async () => {
    const result = await callMcp("prompts/get", {
      name: "inspect-agent-run",
      arguments: {},
    }, "prompt-missing");

    expect(result.status).toBe(200);
    expect(result.body.error.code).toBe(-32602);
    expect(result.body.error.message).toContain("Invalid arguments for prompt inspect-agent-run");
    expect(result.body.error.message).toContain("runId");
  });
});