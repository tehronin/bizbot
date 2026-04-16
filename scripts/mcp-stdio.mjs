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

import { Console } from "node:console";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadLocalEnv } from "./load-local-env.mjs";

loadLocalEnv();

// Redirect all console output to stderr so it never pollutes the JSON-RPC
// channel on stdout. This must happen before any application module is
// imported, since console.log / console.info default to stdout in Node.js.
globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });

const { configureStdioMcpEnvironment, getStdioMcpServerOptions } = await import("../src/lib/mcp/stdio.ts");
configureStdioMcpEnvironment(process.env);

// We need to dynamically import the server factory because it depends on
// Prisma and other app modules that need env vars loaded first.
const { createBizBotMcpServer } = await import("../src/lib/mcp/server.ts");

const server = createBizBotMcpServer(getStdioMcpServerOptions());
const transport = new StdioServerTransport();

await server.connect(transport);

// Log to stderr (stdout is reserved for JSON-RPC)
process.stderr.write("[bizbot-mcp] stdio server started\n");
