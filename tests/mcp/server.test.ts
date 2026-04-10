import { describe, expect, it } from "vitest";
import { createBizBotMcpServer } from "@/lib/mcp/server";

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
});