import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/mcp/route";

async function listTools() {
  const response = await POST(new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "oracle-tools",
      method: "tools/list",
      params: {},
    }),
  }));

  return response.json();
}

describe("oracle MCP exposure", () => {
  afterEach(() => {
    delete process.env.BIZBOT_PLUGIN_ORACLE_ENABLED;
  });

  it("stays hidden until explicitly enabled", async () => {
    delete process.env.BIZBOT_PLUGIN_ORACLE_ENABLED;
    const disabledResult = await listTools();
    const disabledTools = disabledResult.result.tools.map((tool: { name: string }) => tool.name);
    expect(disabledTools).not.toContain("oracle_search_markets");

    process.env.BIZBOT_PLUGIN_ORACLE_ENABLED = "true";
    const enabledResult = await listTools();
    const enabledTools = enabledResult.result.tools.map((tool: { name: string }) => tool.name);
    expect(enabledTools).toContain("oracle_open_personality_selector");
    expect(enabledTools).toContain("oracle_search_markets");
    expect(enabledTools).toContain("oracle_get_market_verdict");
  });
});