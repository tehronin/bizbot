#!/usr/bin/env node

import { config } from "dotenv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CreateMessageRequestSchema } from "@modelcontextprotocol/sdk/types.js";

config({ quiet: true });

const repoRoot = process.cwd();

async function ensureBuilderOverview() {
  const [{ getCurrentBuilderProjectOverview }, { createBuilderProject, updateBuilderProject, deleteBuilderProject }, { createBuilderTask, updateBuilderTask }] = await Promise.all([
    import("../src/lib/builder/orchestrator.ts"),
    import("../src/lib/builder/projects.ts"),
    import("../src/lib/builder/tasks.ts"),
  ]);

  const existingOverview = await getCurrentBuilderProjectOverview();
  if (existingOverview) {
    return {
      source: "existing",
      projectId: existingOverview.project.id,
      cleanup: async () => {},
    };
  }

  const suffix = Date.now().toString(36);
  const project = await createBuilderProject({
    name: `MCP Sampling Smoke ${suffix}`,
    slug: `mcp-sampling-smoke-${suffix}`,
    relativePath: `smoke/mcp-sampling-smoke-${suffix}`,
  });
  await updateBuilderProject(project.id, { lifecycle: "ACTIVE" });

  const task = await createBuilderTask({
    projectId: project.id,
    title: "Exercise MCP stdio sampling",
    description: "Temporary Builder task created for the MCP stdio sampling smoke run.",
    acceptanceCriteria: [
      "Connect to the real stdio MCP server.",
      "Trigger developer_vscode_loop_assist.",
      "Receive one sampling/createMessage request.",
    ],
  });
  await updateBuilderTask(task.id, {
    status: "RUNNING",
    stage: "VERIFY",
    summary: "Temporary Builder task seeded for MCP stdio sampling smoke run.",
  });

  return {
    source: "seeded",
    projectId: project.id,
    cleanup: async () => {
      await deleteBuilderProject(project.id, { deleteFiles: true });
    },
  };
}

async function main() {
  const seeded = await ensureBuilderOverview();
  const stderrChunks = [];
  const transport = new StdioClientTransport({
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["run", "mcp:stdio"],
    cwd: repoRoot,
    env: process.env,
    stderr: "pipe",
  });

  if (transport.stderr) {
    transport.stderr.on("data", (chunk) => {
      stderrChunks.push(String(chunk));
    });
  }

  const client = new Client(
    { name: "manual-stdio-sampling-smoke", version: "1.0.0" },
    { capabilities: { sampling: {} } },
  );

  let samplingRequestCount = 0;
  client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
    samplingRequestCount += 1;
    return {
      role: "assistant",
      content: {
        type: "text",
        text: JSON.stringify({
          summary: "Manual stdio smoke client received the Builder dev-loop context and returned a diagnosis.",
          status: "warning",
          tripletHealth: {
            overall: "degraded",
            mcpSnapshot: "unknown",
            dependencyContract: "unknown",
            fileTopologyContract: "unknown",
          },
          latestFailure: request.params.messages.at(-1)?.content?.type === "text" ? "Context inspected successfully." : null,
          likelyRootCause: "This is a deterministic manual smoke response from the client sampling handler.",
          suggestedFix: "Inspect the sampled context payload and continue normal Builder verification.",
          nextSteps: ["confirm stdio transport", "confirm sampling guardrails"],
          confidence: "medium",
        }),
      },
      model: "gpt-5.4",
      stopReason: "endTurn",
    };
  });

  try {
    await client.connect(transport);

    const toolsResult = await client.listTools();
    const assistTool = toolsResult.tools.find((tool) => tool.name === "developer_vscode_loop_assist");
    if (!assistTool) {
      throw new Error("developer_vscode_loop_assist was not advertised by the stdio MCP server.");
    }

    const callResult = await client.callTool({ name: "developer_vscode_loop_assist", arguments: {} });
    const structured = callResult.structuredContent;
    const sampling = structured?.sampling;
    const result = structured?.result;

    if (samplingRequestCount < 1) {
      throw new Error(`Expected at least one sampling/createMessage request, received ${samplingRequestCount}. Tool result: ${JSON.stringify(structured)}`);
    }
    if (!sampling?.available) {
      throw new Error(`Sampling was not available during the stdio smoke run. Tool result: ${JSON.stringify(structured)}`);
    }

    console.log(JSON.stringify({
      ok: true,
      seededOverview: seeded.source,
      projectId: seeded.projectId,
      samplingRequestCount,
      sampling,
      result,
      serverStderr: stderrChunks.join("").trim() || null,
    }, null, 2));
  } finally {
    await client.close().catch(() => {});
    await seeded.cleanup().catch(() => {});
  }
}

main().catch((error) => {
  console.error("[mcp-stdio-sampling-smoke] failed");
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});