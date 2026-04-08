import { describe, expect, it } from "vitest";

import {
  BUILDER_CAPABILITY_CATALOG,
  BUILDER_CAPABILITY_DOMAINS,
  BUILDER_CAPABILITY_STATUSES,
  BUILDER_CAPABILITY_TIERS,
  getBuilderCapability,
  listBuilderCapabilities,
} from "@/lib/builder/capabilities";

describe("builder capability catalog", () => {
  it("keeps capability keys unique and typed", () => {
    const keys = BUILDER_CAPABILITY_CATALOG.map((capability) => capability.key);
    expect(new Set(keys).size).toBe(keys.length);

    for (const capability of BUILDER_CAPABILITY_CATALOG) {
      expect(BUILDER_CAPABILITY_TIERS).toContain(capability.tier);
      expect(BUILDER_CAPABILITY_STATUSES).toContain(capability.status);
      expect(BUILDER_CAPABILITY_DOMAINS).toContain(capability.domain);
      expect(capability.tools.length).toBeGreaterThan(0);
      expect(capability.audit.outcomeStatuses.length).toBeGreaterThan(0);
    }
  });

  it("returns defensive copies from the public helpers", () => {
    const allCapabilities = listBuilderCapabilities();
    allCapabilities[0]!.tools.push("builder_fake_tool");

    const workspaceCapability = getBuilderCapability("workspace_manipulation");
    expect(workspaceCapability?.tools).not.toContain("builder_fake_tool");
    expect(getBuilderCapability("missing_capability")).toBeNull();
  });
});