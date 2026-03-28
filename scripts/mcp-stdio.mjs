#!/usr/bin/env node

/**
 * BizBot MCP stdio server entry point.
 *
 * Usage with Claude Desktop (claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "bizbot": {
 *         "command": "npm",
 *         "args": ["run", "mcp:stdio"],
 *         "cwd": "/path/to/bizbot"
 *       }
 *     }
 *   }
 *
 * For development, the checked-in VS Code workspace MCP config also uses:
 *   npm run mcp:stdio
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Load env from .env file if present
import { config } from "dotenv";
config();

const { configureStdioMcpEnvironment } = await import("../src/lib/mcp/stdio.ts");
configureStdioMcpEnvironment(process.env);

// We need to dynamically import the server factory because it depends on
// Prisma and other app modules that need env vars loaded first.
const { createBizBotMcpServer } = await import("../src/lib/mcp/server.ts");

const server = createBizBotMcpServer();
const transport = new StdioServerTransport();

await server.connect(transport);

// Log to stderr (stdout is reserved for JSON-RPC)
process.stderr.write("[bizbot-mcp] stdio server started\n");
