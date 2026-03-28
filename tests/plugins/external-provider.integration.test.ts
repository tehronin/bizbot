import { describe, expect, it } from "vitest";
import { createPluginRegistry } from "@/lib/agent/plugins";
import { createExternalProviderFixturePlugin } from "../fixtures/plugin-fixtures";

describe("external-provider fixture plugin", () => {
  it("executes through the plugin registry with deterministic fixture data", async () => {
    const fixture = createExternalProviderFixturePlugin();
    const registry = createPluginRegistry([fixture.plugin]);
    const tool = registry.tools.find((entry) => entry.name === "fixture_provider_fetch");

    expect(tool).toBeDefined();

    const result = await tool!.execute({ resourceId: "lead-42", includeHistory: true }, {});

    expect(result).toEqual({
      provider: "fixture-provider",
      record: fixture.responses["lead-42"],
      historyIncluded: true,
    });
    expect(fixture.calls).toEqual([{ resourceId: "lead-42", includeHistory: true }]);
    expect(registry.toolToPluginId.get("fixture_provider_fetch")).toBe("fixture-provider");
  });

  it("uses schema defaults when optional provider flags are omitted", async () => {
    const fixture = createExternalProviderFixturePlugin();
    const registry = createPluginRegistry([fixture.plugin]);
    const tool = registry.tools.find((entry) => entry.name === "fixture_provider_fetch");

    const result = await tool!.execute({ resourceId: "deal-7" }, {});

    expect(result).toEqual({
      provider: "fixture-provider",
      record: fixture.responses["deal-7"],
      historyIncluded: false,
    });
    expect(fixture.calls).toEqual([{ resourceId: "deal-7", includeHistory: false }]);
  });
});