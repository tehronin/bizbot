import { beforeEach, describe, expect, it } from "vitest";
import { registerSidecarInteractionHandler, routeSidecarInteraction, resetSidecarInteractionHandlersForTests } from "@/lib/sidecar/router";
import { getActiveSidecarContextForConversation, resetActiveSidecarPanelsForTests, syncActiveSidecarPanel } from "@/lib/sidecar/state";
import { createValidatedSidecarPanel } from "@/lib/sidecar/validation";

describe("sidecar interaction router", () => {
  beforeEach(() => {
    resetActiveSidecarPanelsForTests();
    resetSidecarInteractionHandlersForTests();
  });

  it("updates generic selection state through the BizBot-owned router", async () => {
    const panel = createValidatedSidecarPanel({
      panelId: "selection-panel",
      title: "Selection demo",
      content: {
        type: "selection",
        title: "Choose an item",
        selectionMode: "multiple",
        items: [
          { id: "alpha", title: "Alpha" },
          { id: "beta", title: "Beta" },
        ],
        actions: [
          { id: "toggle", label: "Toggle", kind: "toggle" },
          { id: "apply", label: "Apply", kind: "apply" },
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

    const result = await routeSidecarInteraction({
      panelId: panel.panelId,
      actionId: "toggle",
      selectedItemIds: ["beta"],
      conversationId: "conversation-1",
      userId: "user-1",
    });

    expect(result).toEqual({
      ok: true,
      action: "update",
      panel: expect.objectContaining({
        panelId: "selection-panel",
        content: expect.objectContaining({
          type: "selection",
          selectedItemIds: ["beta"],
        }),
      }),
      stack: {
        panels: [expect.objectContaining({
          panelId: "selection-panel",
          content: expect.objectContaining({
            type: "selection",
            selectedItemIds: ["beta"],
          }),
        })],
        activePanelId: "selection-panel",
        stackRevision: 2,
      },
      context: null,
    });
  });

  it("rejects malformed selection requests", async () => {
    const panel = createValidatedSidecarPanel({
      panelId: "single-panel",
      title: "Single select",
      content: {
        type: "selection",
        title: "Single select",
        selectionMode: "single",
        items: [{ id: "alpha", title: "Alpha" }, { id: "beta", title: "Beta" }],
        actions: [{ id: "toggle", label: "Toggle", kind: "toggle" }],
        interaction: { routeKey: "sidecar.selection.apply" },
      },
    });

    syncActiveSidecarPanel({
      action: "open",
      panel,
      conversationId: "conversation-1",
      userId: "user-1",
    });

    await expect(routeSidecarInteraction({
      panelId: panel.panelId,
      actionId: "toggle",
      selectedItemIds: ["alpha", "beta"],
      conversationId: "conversation-1",
      userId: "user-1",
    })).rejects.toThrow("Single-select Sidecar panels accept only one selected item.");
  });

  it("increments context revision once when transport and handler patches are merged", async () => {
    registerSidecarInteractionHandler("plan.review.apply", async () => ({
      ok: true,
      action: "update",
      panel: createValidatedSidecarPanel({
        panelId: "selection-panel",
        title: "Selection demo",
        context: {
          contextId: "plan.review",
          writeKeys: ["decision", "summary"],
        },
        content: {
          type: "selection",
          title: "Choose an item",
          selectionMode: "single",
          items: [
            { id: "approved", title: "Approved" },
            { id: "rework", title: "Rework" },
          ],
          actions: [
            { id: "apply", label: "Apply", kind: "apply" },
          ],
          interaction: { routeKey: "plan.review.apply" },
        },
      }),
      resolvedContextPatch: {
        contextId: "plan.review",
        values: {
          summary: "approved by router",
        },
      },
    }));

    const panel = createValidatedSidecarPanel({
      panelId: "selection-panel",
      title: "Selection demo",
      context: {
        contextId: "plan.review",
        writeKeys: ["decision", "summary"],
      },
      content: {
        type: "selection",
        title: "Choose an item",
        selectionMode: "single",
        items: [
          { id: "approved", title: "Approved" },
          { id: "rework", title: "Rework" },
        ],
        actions: [
          { id: "apply", label: "Apply", kind: "apply" },
        ],
        interaction: { routeKey: "plan.review.apply" },
      },
    });

    syncActiveSidecarPanel({
      action: "open",
      panel,
      conversationId: "conversation-1",
      userId: "user-1",
    });

    const result = await routeSidecarInteraction({
      panelId: panel.panelId,
      actionId: "apply",
      selectedItemIds: ["approved"],
      expectedContextRevision: 0,
      contextPatch: {
        contextId: "plan.review",
        values: {
          decision: "approved",
        },
      },
      conversationId: "conversation-1",
      userId: "user-1",
    });

    expect(result.context).toEqual({
      contextId: "plan.review",
      conversationId: "conversation-1",
      rootPanelId: "selection-panel",
      activePanelId: "selection-panel",
      contextLineageId: expect.any(String),
      contextRevision: 1,
      stackRevision: 2,
      values: {
        decision: "approved",
        summary: "approved by router",
      },
    });
    expect(getActiveSidecarContextForConversation("conversation-1")).toEqual(result.context);
  });
});