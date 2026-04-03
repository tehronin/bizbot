import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/mcp/route";

async function callMcp(method: string, params: Record<string, unknown>, id: string) {
  const response = await POST(new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }),
  }));

  return response.json();
}

describe("oracle MCP exposure", () => {
  afterEach(() => {
    delete process.env.BIZBOT_PLUGIN_ORACLE_ENABLED;
    vi.unstubAllGlobals();
  });

  it("stays hidden until explicitly enabled", async () => {
    delete process.env.BIZBOT_PLUGIN_ORACLE_ENABLED;
    const disabledResult = await callMcp("tools/list", {}, "oracle-tools-disabled");
    const disabledTools = disabledResult.result.tools.map((tool: { name: string }) => tool.name);
    expect(disabledTools).not.toContain("oracle_search_markets");

    process.env.BIZBOT_PLUGIN_ORACLE_ENABLED = "true";
    const enabledResult = await callMcp("tools/list", {}, "oracle-tools-enabled");
    const enabledTools = enabledResult.result.tools.map((tool: { name: string }) => tool.name);
    expect(enabledTools).toContain("oracle_open_personality_selector");
    expect(enabledTools).toContain("oracle_analyze_prediction");
    expect(enabledTools).toContain("oracle_search_markets");
    expect(enabledTools).toContain("oracle_get_market_verdict");
  });

  it("executes a read-only Oracle tool through MCP when enabled", async () => {
    process.env.BIZBOT_PLUGIN_ORACLE_ENABLED = "true";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ([
        {
          id: "market-1",
          question: "Will BTC hit 150k?",
          active: true,
          closed: false,
          outcomes: ["Yes", "No"],
          outcomePrices: [0.41, 0.59],
        },
      ]),
    })));

    const result = await callMcp("tools/call", {
      name: "oracle_search_markets",
      arguments: {
        query: "btc",
        interactive: false,
      },
    }, "oracle-call-1");

    expect(result.result.structuredContent).toEqual(expect.objectContaining({
      query: "btc",
      markets: [expect.objectContaining({ id: "market-1" })],
      summary: expect.stringContaining("Will BTC hit 150k?"),
    }));
    expect(result.result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text" }),
    ]));
  });
});