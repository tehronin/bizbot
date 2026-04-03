import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/memory/service", () => ({
  getActiveMemoryFacts: vi.fn(),
  setMemoryFact: vi.fn(),
}));

import { POST } from "@/app/api/sidecar/interactions/route";
import "@/lib/agent/plugins/OraclePlugin";
import { resetActiveSidecarPanelsForTests, syncActiveSidecarPanel } from "@/lib/sidecar/state";
import { createValidatedSidecarPanel } from "@/lib/sidecar/validation";
import { getActiveMemoryFacts, setMemoryFact } from "@/lib/agent/memory/service";

const mockedGetActiveMemoryFacts = vi.mocked(getActiveMemoryFacts);
const mockedSetMemoryFact = vi.mocked(setMemoryFact);

describe("sidecar interaction route", () => {
  beforeEach(() => {
    process.env.BIZBOT_PLUGIN_ORACLE_ENABLED = "true";
    resetActiveSidecarPanelsForTests();
    mockedGetActiveMemoryFacts.mockReset();
    mockedSetMemoryFact.mockReset();
    mockedGetActiveMemoryFacts.mockResolvedValue([] as never);
    mockedSetMemoryFact.mockResolvedValue({ id: "fact-1", key: "oracle_bot_personality", value: "balanced" } as never);
  });

  it("returns a 400 when the panel is not active", async () => {
    const response = await POST(new Request("http://localhost:3000/api/sidecar/interactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        panelId: "missing-panel",
        actionId: "toggle",
        selectedItemIds: ["balanced"],
        conversationId: "conversation-1",
      }),
    }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Error: Sidecar panel is no longer active.",
    });
  });

  it("handles a live Oracle personality selection through the API route", async () => {
    const panel = createValidatedSidecarPanel({
      title: "Oracle personality",
      content: {
        type: "selection",
        title: "Choose Oracle personality",
        selectionMode: "single",
        items: [
          { id: "balanced", title: "Balanced" },
          { id: "bullish", title: "Bullish" },
        ],
        actions: [
          { id: "oracle_personality_toggle", label: "Choose", kind: "toggle" },
          { id: "oracle_personality_apply", label: "Save personality", kind: "apply" },
        ],
        interaction: { routeKey: "oracle.personality.select" },
      },
    });

    syncActiveSidecarPanel({
      action: "open",
      panel,
      conversationId: "conversation-1",
      userId: "user-1",
    });

    const response = await POST(new Request("http://localhost:3000/api/sidecar/interactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        panelId: panel.panelId,
        actionId: "oracle_personality_apply",
        selectedItemIds: ["bullish"],
        conversationId: "conversation-1",
        userId: "user-1",
      }),
    }) as never);

    expect(response.status).toBe(200);
    expect(mockedSetMemoryFact).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      key: "oracle_bot_personality",
      value: "bullish",
    }));
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      ok: true,
      action: "update",
      panel: expect.objectContaining({
        panelId: panel.panelId,
        content: expect.objectContaining({
          type: "markdown",
          markdown: expect.stringContaining("Oracle personality saved"),
        }),
      }),
    }));
  });
});