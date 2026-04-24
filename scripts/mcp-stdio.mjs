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
import { loadLocalEnv } from "./load-local-env.mjs";

loadLocalEnv();

// Redirect all console output to stderr so it never pollutes the JSON-RPC
// channel on stdout. This must happen before any application module is
// imported, since console.log / console.info default to stdout in Node.js.
globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });

const { configureStdioMcpEnvironment, getStdioMcpServerOptions } = await import("../src/lib/mcp/stdio.ts");
configureStdioMcpEnvironment(process.env);
const [{ closeMcpClients }, { db }] = await Promise.all([
	import("../src/lib/mcp/client.ts"),
	import("../src/lib/db.ts"),
]);

// We need to dynamically import the server factory because it depends on
// Prisma and other app modules that need env vars loaded first.
const [{ createBizBotMcpServer }, { createInstrumentedStdioServerTransport }] = await Promise.all([
	import("../src/lib/mcp/server.ts"),
	import("../src/lib/mcp/stdio-runtime.ts"),
]);

const server = createBizBotMcpServer(getStdioMcpServerOptions());
const transport = createInstrumentedStdioServerTransport({
	debug: process.env.BIZBOT_MCP_STDIO_DEBUG === "true",
	logger: console,
});

let shuttingDown = false;
let runtimeReady = false;

async function shutdown(reason, exitCode = 0) {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	transport.markShutdownReason(reason);

	process.stderr.write(`[bizbot-mcp] shutting down (${reason})\n`);

	await Promise.allSettled([
		runtimeReady ? server.close() : Promise.resolve(),
		closeMcpClients(),
		db.$disconnect(),
	]);

	process.exit(exitCode);
}

process.on("SIGINT", () => {
	void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
	void shutdown("SIGTERM");
});

process.on("SIGHUP", () => {
	void shutdown("SIGHUP");
});

process.stdin.on("end", () => {
	void shutdown("stdin_end");
});

process.stdin.on("close", () => {
	void shutdown("stdin_close");
});

process.on("uncaughtException", (error) => {
	process.stderr.write(`[bizbot-mcp] uncaught exception\n${error instanceof Error ? `${error.stack ?? error.message}\n` : `${String(error)}\n`}`);
	transport.markProtocolError(error, { target: "uncaught_exception" });
	void shutdown("uncaughtException", 1);
});

process.on("unhandledRejection", (error) => {
	process.stderr.write(`[bizbot-mcp] unhandled rejection\n${error instanceof Error ? `${error.stack ?? error.message}\n` : `${String(error)}\n`}`);
	transport.markProtocolError(error, { target: "unhandled_rejection" });
	void shutdown("unhandledRejection", 1);
});

await server.connect(transport);
runtimeReady = true;

// Log to stderr (stdout is reserved for JSON-RPC)
process.stderr.write("[bizbot-mcp] stdio server started\n");
