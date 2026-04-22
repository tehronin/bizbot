import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/memory/service", () => ({
  getActiveMemoryFacts: vi.fn(),
  setMemoryFact: vi.fn(),
}));

import { POST } from "@/app/api/sidecar/interactions/route";
import "@/lib/agent/plugins/OraclePlugin";
import { getActiveSidecarContextForConversation, resetActiveSidecarPanelsForTests, syncActiveSidecarPanel } from "@/lib/sidecar/state";
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
      context: {
        contextId: "oracle.personality.preferences",
        readKeys: ["selectedPersonality"],
        writeKeys: ["selectedPersonality"],
        selectionKey: "selectedPersonality",
      },
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
        expectedStackRevision: 1,
        contextPatch: {
          contextId: "oracle.personality.preferences",
          values: {
            selectedPersonality: "bullish",
          },
        },
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
      action: "open",
      panel: expect.objectContaining({
        panelId: expect.any(String),
        context: {
          contextId: "oracle.personality.preferences",
          readKeys: ["selectedPersonality"],
        },
        content: expect.objectContaining({
          type: "key_value",
          entries: expect.arrayContaining([
            expect.objectContaining({ label: "default personality", contextKey: "selectedPersonality" }),
          ]),
        }),
      }),
      stack: expect.objectContaining({
        stackRevision: 2,
      }),
      context: {
        contextId: "oracle.personality.preferences",
        conversationId: "conversation-1",
        rootPanelId: panel.panelId,
        activePanelId: expect.any(String),
        stackRevision: 2,
        values: {
          selectedPersonality: "bullish",
        },
      },
    }));
    expect(getActiveSidecarContextForConversation("conversation-1")).toEqual({
      contextId: "oracle.personality.preferences",
      conversationId: "conversation-1",
      rootPanelId: panel.panelId,
      activePanelId: expect.any(String),
      stackRevision: 2,
      values: {
        selectedPersonality: "bullish",
      },
    });
  });

  it("accepts bounded context patches and returns context with the latest stack snapshot", async () => {
    const panel = createValidatedSidecarPanel({
      panelId: "plan-review",
      title: "Plan review",
      context: {
        contextId: "plan.review",
        writeKeys: ["decision", "reviewer"],
      },
      content: {
        type: "selection",
        title: "Approve the plan",
        selectionMode: "single",
        items: [
          { id: "approved", title: "Approve" },
          { id: "rework", title: "Request rework" },
        ],
        actions: [
          { id: "plan_review_toggle", label: "Choose", kind: "toggle" },
        ],
        interaction: { routeKey: "sidecar.selection.apply" },
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
        actionId: "plan_review_toggle",
        selectedItemIds: ["approved"],
        expectedStackRevision: 1,
        contextPatch: {
          contextId: "plan.review",
          values: {
            decision: "approved",
            reviewer: "user-1",
          },
        },
        conversationId: "conversation-1",
        userId: "user-1",
      }),
    }) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      ok: true,
      action: "update",
      panel: expect.objectContaining({ panelId: panel.panelId }),
      stack: expect.objectContaining({
        activePanelId: panel.panelId,
        stackRevision: 2,
      }),
      context: {
        contextId: "plan.review",
        conversationId: "conversation-1",
        rootPanelId: "plan-review",
        activePanelId: "plan-review",
        stackRevision: 2,
        values: {
          decision: "approved",
          reviewer: "user-1",
        },
      },
    }));
    expect(getActiveSidecarContextForConversation("conversation-1")).toEqual({
      contextId: "plan.review",
      conversationId: "conversation-1",
      rootPanelId: "plan-review",
      activePanelId: "plan-review",
      stackRevision: 2,
      values: {
        decision: "approved",
        reviewer: "user-1",
      },
    });
  });

  it("rejects context patches outside the panel write scope", async () => {
    const panel = createValidatedSidecarPanel({
      panelId: "plan-review",
      title: "Plan review",
      context: {
        contextId: "plan.review",
        writeKeys: ["decision"],
      },
      content: {
        type: "selection",
        title: "Approve the plan",
        selectionMode: "single",
        items: [
          { id: "approved", title: "Approve" },
        ],
        actions: [
          { id: "plan_review_toggle", label: "Choose", kind: "toggle" },
        ],
        interaction: { routeKey: "sidecar.selection.apply" },
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
        actionId: "plan_review_toggle",
        selectedItemIds: ["approved"],
        contextPatch: {
          contextId: "plan.review",
          values: {
            reviewer: "user-1",
          },
        },
        conversationId: "conversation-1",
      }),
    }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Error: Sidecar context key 'reviewer' is not writable from this panel.",
    });
  });
});