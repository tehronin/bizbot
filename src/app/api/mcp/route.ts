/**
 * MCP Streamable HTTP transport endpoint.
 * POST /api/mcp — handle JSON-RPC requests (initialize, tools/list, tools/call, etc.)
 * GET  /api/mcp — SSE notification stream (optional, for stateful sessions)
 * DELETE /api/mcp — terminate session
 *
 * Uses the Web Standard transport so it works natively with Next.js route handlers.
 */

import { createBizBotMcpServer } from "@/lib/mcp/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

/**
 * Verify the MCP_AUTH_TOKEN if one is configured.
 * Returns null if auth passes, or an error Response if it fails.
 */
function checkAuth(req: Request): Response | null {
  const expectedToken = process.env.MCP_AUTH_TOKEN;
  if (!expectedToken) return null; // no auth configured

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (token !== expectedToken) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null },
      { status: 401 },
    );
  }
  return null;
}

/**
 * Create a stateless transport + server pair and handle a single request.
 * Stateless mode: no session tracking, each request is independent.
 */
async function handleMcpRequest(req: Request): Promise<Response> {
  const server = createBizBotMcpServer();

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });

  await server.connect(transport);

  try {
    return await transport.handleRequest(req);
  } finally {
    // Clean up the transport (stateless — one per request)
    await transport.close();
    await server.close();
  }
}

export async function POST(req: Request) {
  const authError = checkAuth(req);
  if (authError) return authError;
  return handleMcpRequest(req);
}

export async function GET(req: Request) {
  const authError = checkAuth(req);
  if (authError) return authError;
  // Stateless mode doesn't support standalone SSE streams
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "SSE not supported in stateless mode" }, id: null },
    { status: 405 },
  );
}

export async function DELETE(req: Request) {
  const authError = checkAuth(req);
  if (authError) return authError;
  // Stateless mode — no sessions to terminate
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Session management not supported in stateless mode" }, id: null },
    { status: 405 },
  );
}
