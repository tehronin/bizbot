import { describe, expect, it } from "vitest";
import { BIZBOT_PLATFORM_CONTRACT_VERSION, classifyBizBotContractDrift, getBizBotPlatformContract } from "@/lib/platform/contract";

describe("platform contract", () => {
  it("exposes the v1 contract source of truth", () => {
    const contract = getBizBotPlatformContract();

    expect(contract.version).toBe(BIZBOT_PLATFORM_CONTRACT_VERSION);
    expect(contract.docs).toEqual({
      spec: "docs/platform-contract-v1.md",
      changelog: "docs/platform-contract-changelog.json",
    });
    expect(contract.mcpExposureContract.mcpLane).toBe("mcp_operator");
  });

  it("classifies additive drift as non-breaking", () => {
    const impact = classifyBizBotContractDrift({
      previousHash: "old",
      currentHash: "new",
      changed: true,
      tools: { added: ["builder_new_tool"], removed: [], changed: [] },
      prompts: { added: [], removed: [], changed: [] },
      resources: { added: [], removed: [], changed: [] },
      profileChanged: false,
      contractChanged: false,
    });

    expect(impact.classification).toBe("non_breaking");
    expect(impact.requiresVersionBump).toBe(false);
  });

  it("classifies descriptor or lane changes as breaking", () => {
    const impact = classifyBizBotContractDrift({
      previousHash: "old",
      currentHash: "new",
      changed: true,
      tools: { added: [], removed: [], changed: ["builder_get_project"] },
      prompts: { added: [], removed: [], changed: [] },
      resources: { added: [], removed: [], changed: [] },
      profileChanged: true,
      contractChanged: false,
    });

    expect(impact.classification).toBe("breaking");
    expect(impact.requiresVersionBump).toBe(true);
    expect(impact.changedSurfaces).toEqual(expect.arrayContaining(["lane-profile", "tools"]));
  });
});