import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/sidecar/state/route";
import { getActiveSidecarPanelForConversation, getActiveSidecarStackForConversation, resetActiveSidecarPanelsForTests, syncActiveSidecarPanel } from "@/lib/sidecar/state";
import { createValidatedSidecarPanel } from "@/lib/sidecar/validation";

describe("sidecar state route", () => {
  beforeEach(() => {
    resetActiveSidecarPanelsForTests();
  });

  it("clears the active panel for a conversation", async () => {
    syncActiveSidecarPanel({
      action: "open",
      panel: createValidatedSidecarPanel({
        panelId: "close-me",
        title: "Close me",
        content: { type: "markdown", markdown: "## Sidecar" },
      }),
      conversationId: "conversation-1",
      userId: "user-1",
    });

    const response = await POST(new Request("http://localhost:3000/api/sidecar/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: "conversation-1" }),
    }) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      action: "close",
      panel: null,
      stack: {
        panels: [],
        activePanelId: null,
      },
    });
    expect(getActiveSidecarPanelForConversation("conversation-1")).toBeNull();
  });

  it("rejects missing conversation ids", async () => {
    const response = await POST(new Request("http://localhost:3000/api/sidecar/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Error: Sidecar conversation id is required.",
    });
  });

  it("pops the active panel when navigating back", async () => {
    syncActiveSidecarPanel({
      action: "open",
      panel: createValidatedSidecarPanel({
        panelId: "plan-panel",
        title: "Plan",
        content: { type: "markdown", markdown: "# Plan" },
      }),
      conversationId: "conversation-1",
      userId: "user-1",
    });
    syncActiveSidecarPanel({
      action: "open",
      panel: createValidatedSidecarPanel({
        panelId: "detail-panel",
        title: "Detail",
        content: { type: "markdown", markdown: "# Detail" },
      }),
      conversationId: "conversation-1",
      userId: "user-1",
    });

    const response = await POST(new Request("http://localhost:3000/api/sidecar/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: "conversation-1", operation: "back" }),
    }) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      action: "update",
      panel: expect.objectContaining({ panelId: "plan-panel", title: "Plan" }),
      stack: {
        panels: [expect.objectContaining({ panelId: "plan-panel", title: "Plan" })],
        activePanelId: "plan-panel",
      },
    });
    expect(getActiveSidecarPanelForConversation("conversation-1")).toEqual(expect.objectContaining({
      panel: expect.objectContaining({ panelId: "plan-panel" }),
    }));
    expect(getActiveSidecarStackForConversation("conversation-1")).toEqual({
      panels: [expect.objectContaining({ panelId: "plan-panel", title: "Plan" })],
      activePanelId: "plan-panel",
    });
  });

  it("activates an earlier panel when navigating by chip", async () => {
    syncActiveSidecarPanel({
      action: "open",
      panel: createValidatedSidecarPanel({
        panelId: "plan-panel",
        title: "Plan",
        content: { type: "markdown", markdown: "# Plan" },
      }),
      conversationId: "conversation-1",
      userId: "user-1",
    });
    syncActiveSidecarPanel({
      action: "open",
      panel: createValidatedSidecarPanel({
        panelId: "detail-panel",
        title: "Detail",
        content: { type: "markdown", markdown: "# Detail" },
      }),
      conversationId: "conversation-1",
      userId: "user-1",
    });
    syncActiveSidecarPanel({
      action: "open",
      panel: createValidatedSidecarPanel({
        panelId: "notes-panel",
        title: "Notes",
        content: { type: "markdown", markdown: "# Notes" },
      }),
      conversationId: "conversation-1",
      userId: "user-1",
    });

    const response = await POST(new Request("http://localhost:3000/api/sidecar/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: "conversation-1", operation: "activate", panelId: "detail-panel" }),
    }) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      action: "update",
      panel: expect.objectContaining({ panelId: "detail-panel", title: "Detail" }),
      stack: {
        panels: [
          expect.objectContaining({ panelId: "plan-panel", title: "Plan" }),
          expect.objectContaining({ panelId: "detail-panel", title: "Detail" }),
        ],
        activePanelId: "detail-panel",
      },
    });
    expect(getActiveSidecarStackForConversation("conversation-1")).toEqual({
      panels: [
        expect.objectContaining({ panelId: "plan-panel", title: "Plan" }),
        expect.objectContaining({ panelId: "detail-panel", title: "Detail" }),
      ],
      activePanelId: "detail-panel",
    });
  });
});