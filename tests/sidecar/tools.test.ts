import { afterEach, describe, expect, it } from "vitest";
import { getToolAnnotations } from "@/lib/mcp/tool-presentation";
import { syncActiveSidecarPanel, resetActiveSidecarPanelsForTests } from "@/lib/sidecar/state";
import { resetThinkingSessionsForTests } from "@/lib/sidecar/thinking-state";
import { createValidatedSidecarPanel } from "@/lib/sidecar/validation";
import { sidecarTools } from "@/lib/sidecar/tools";

afterEach(() => {
  resetActiveSidecarPanelsForTests();
  resetThinkingSessionsForTests();
});

describe("sidecar tools", () => {
  it("exposes strict schemas and safe annotations", async () => {
    expect(sidecarTools.map((tool) => tool.name)).toEqual([
      "sidecar_open",
      "sidecar_update",
      "sidecar_close",
      "sidecar_get_state",
      "sidecar_thinking_start",
      "sidecar_thinking_append",
      "sidecar_thinking_complete",
      "sidecar_thinking_clear",
      "sidecar_thinking_get_state",
      "sidecar_interact",
      "sidecar_navigate",
    ]);

    expect(sidecarTools[0].parameters.additionalProperties).toBe(false);
    expect(sidecarTools[0].parameters.properties.content?.type).toBe("object");
    expect(sidecarTools[0].parameters.properties.content?.additionalProperties).toBe(false);
    expect(sidecarTools[0].parameters.properties.content?.properties?.type?.enum).toEqual([
      "markdown",
      "code",
      "json",
      "image",
      "selection",
      "table",
      "key_value",
      "progress",
      "diff",
    ]);
    expect(sidecarTools[1].parameters.additionalProperties).toBe(false);
    expect(sidecarTools[2].parameters.additionalProperties).toBe(false);
    expect(sidecarTools[3].parameters.additionalProperties).toBe(false);
    expect(sidecarTools[4].parameters.additionalProperties).toBe(false);
    expect(sidecarTools[5].parameters.additionalProperties).toBe(false);
    expect(sidecarTools[6].parameters.additionalProperties).toBe(false);
    expect(sidecarTools[7].parameters.additionalProperties).toBe(false);
    expect(sidecarTools[8].parameters.additionalProperties).toBe(false);
    expect(sidecarTools[9].parameters.additionalProperties).toBe(false);
    expect(sidecarTools[0].parameters.properties.context).toEqual(expect.objectContaining({
      type: "object",
      required: ["contextId"],
    }));

    expect(getToolAnnotations("sidecar_open")).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(getToolAnnotations("sidecar_get_state")).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(getToolAnnotations("sidecar_thinking_get_state")).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(getToolAnnotations("sidecar_interact")).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(getToolAnnotations("sidecar_navigate")).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("returns validated sidecar actions", async () => {
    await expect(sidecarTools[0].execute({
      title: "Build output",
      content: { type: "json", value: { ok: true } },
      context: {
        contextId: "release.review",
        readKeys: ["planId"],
        writeKeys: ["approved"],
      },
    }, {})).resolves.toEqual({
      ok: true,
      action: "open",
      panel: expect.objectContaining({
        panelId: expect.any(String),
        title: "Build output",
        content: { type: "json", value: { ok: true } },
        context: {
          contextId: "release.review",
          readKeys: ["planId"],
          writeKeys: ["approved"],
        },
      }),
    });

    await expect(sidecarTools[2].execute({}, {})).resolves.toEqual({
      ok: true,
      action: "close",
      panel: null,
    });

    await expect(sidecarTools[3].execute({
      conversationId: "conversation-1",
    }, {})).resolves.toEqual({
      conversationId: "conversation-1",
      activePanel: null,
      stack: { panels: [], activePanelId: null, stackRevision: 0 },
      context: null,
      restorablePanel: null,
      restorableStack: { panels: [], activePanelId: null, stackRevision: 0 },
      restorableContext: null,
    });

    await expect(sidecarTools[8].execute({
      conversationId: "conversation-1",
    }, {})).resolves.toEqual({
      conversationId: "conversation-1",
      snapshot: null,
    });

    await expect(sidecarTools[4].execute({
      conversationId: "conversation-1",
      sessionId: "session-1",
      title: "Agent activity",
    }, {
      agentProfile: "mcp_operator",
    })).resolves.toEqual({
      conversationId: "conversation-1",
      sessionId: "session-1",
      status: "streaming",
      title: "Agent activity",
      chunks: [],
      updatedAt: expect.any(String),
      revision: 1,
    });

    await expect(sidecarTools[5].execute({
      conversationId: "conversation-1",
      kind: "tool_call",
      text: "Fetching authoritative Sidecar state.",
    }, {
      agentProfile: "mcp_operator",
    })).resolves.toEqual(expect.objectContaining({
      conversationId: "conversation-1",
      sessionId: "session-1",
      status: "streaming",
      revision: 2,
      chunks: [expect.objectContaining({ kind: "tool_call", text: "Fetching authoritative Sidecar state." })],
    }));

    await expect(sidecarTools[6].execute({
      conversationId: "conversation-1",
      summary: "Completed successfully.",
    }, {
      agentProfile: "mcp_operator",
    })).resolves.toEqual(expect.objectContaining({
      conversationId: "conversation-1",
      sessionId: "session-1",
      status: "complete",
      summary: "Completed successfully.",
      revision: 3,
    }));

    await expect(sidecarTools[7].execute({
      conversationId: "conversation-1",
    }, {
      agentProfile: "mcp_operator",
    })).resolves.toEqual({
      ok: true,
      conversationId: "conversation-1",
      snapshot: null,
    });

    syncActiveSidecarPanel({
      action: "open",
      panel: createValidatedSidecarPanel({
        panelId: "selection-panel",
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
            { id: "rework", title: "Request rework" },
          ],
          actions: [
            { id: "plan_review_toggle", label: "Choose", kind: "toggle" },
          ],
          interaction: { routeKey: "sidecar.selection.apply" },
        },
      }),
      conversationId: "conversation-1",
      userId: "user-1",
    });

    await expect(sidecarTools[9].execute({
      conversationId: "conversation-1",
      panelId: "selection-panel",
      actionId: "plan_review_toggle",
      selectedItemIds: ["approved"],
      expectedStackRevision: 1,
      contextPatch: {
        contextId: "plan.review",
        values: {
          decision: "approved",
        },
      },
    }, {})).resolves.toEqual({
      ok: true,
      action: "update",
      panel: expect.objectContaining({ panelId: "selection-panel" }),
      stack: {
        panels: [expect.objectContaining({ panelId: "selection-panel" })],
        activePanelId: "selection-panel",
        stackRevision: 2,
      },
      context: {
        contextId: "plan.review",
        conversationId: "conversation-1",
        rootPanelId: "selection-panel",
        activePanelId: "selection-panel",
        contextLineageId: expect.any(String),
        contextRevision: 1,
        stackRevision: 2,
        values: {
          decision: "approved",
        },
      },
    });

    syncActiveSidecarPanel({
      action: "open",
      panel: createValidatedSidecarPanel({
        panelId: "selection-summary",
        title: "Plan summary",
        context: {
          contextId: "plan.review",
          parentPanelId: "selection-panel",
          readKeys: ["decision"],
        },
        content: {
          type: "markdown",
          markdown: "Decision captured.",
        },
      }),
      conversationId: "conversation-1",
      userId: "user-1",
    });

    await expect(sidecarTools[10].execute({
      conversationId: "conversation-1",
      operation: "back",
      expectedStackRevision: 3,
    }, {})).resolves.toEqual({
      ok: true,
      action: "update",
      panel: expect.objectContaining({ panelId: "selection-panel" }),
      stack: {
        panels: [expect.objectContaining({ panelId: "selection-panel" })],
        activePanelId: "selection-panel",
        stackRevision: 4,
      },
      context: {
        contextId: "plan.review",
        conversationId: "conversation-1",
        rootPanelId: "selection-panel",
        activePanelId: "selection-panel",
        contextLineageId: expect.any(String),
        contextRevision: 1,
        stackRevision: 4,
        values: {
          decision: "approved",
        },
      },
    });

    await expect(sidecarTools[0].execute({
      title: "Pipeline progress",
      content: {
        type: "progress",
        title: "Deploy",
        items: [
          { id: "build", label: "Build", status: "done" },
          { id: "ship", label: "Ship", status: "active" },
        ],
      },
    }, {})).resolves.toEqual({
      ok: true,
      action: "open",
      panel: expect.objectContaining({
        title: "Pipeline progress",
        content: {
          type: "progress",
          title: "Deploy",
          items: [
            { id: "build", label: "Build", status: "done" },
            { id: "ship", label: "Ship", status: "active" },
          ],
        },
      }),
    });

    await expect(sidecarTools[0].execute({
      conversationId: "conversation-mcp",
      panelId: "mcp-open-panel",
      title: "MCP open",
      content: { type: "markdown", markdown: "Persist this panel" },
      context: {
        contextId: "mcp.sidecar",
        readKeys: ["status"],
        writeKeys: ["status"],
      },
    }, {
      agentProfile: "mcp_operator",
      userId: "user-1",
    })).resolves.toEqual({
      ok: true,
      action: "open",
      panel: expect.objectContaining({
        panelId: "mcp-open-panel",
        title: "MCP open",
      }),
      stack: {
        panels: [expect.objectContaining({ panelId: "mcp-open-panel" })],
        activePanelId: "mcp-open-panel",
        stackRevision: 1,
      },
      context: {
        contextId: "mcp.sidecar",
        conversationId: "conversation-mcp",
        rootPanelId: "mcp-open-panel",
        activePanelId: "mcp-open-panel",
        contextLineageId: expect.any(String),
        contextRevision: 0,
        stackRevision: 1,
        values: {},
      },
    });

    await expect(sidecarTools[2].execute({
      conversationId: "conversation-mcp",
    }, {
      agentProfile: "mcp_operator",
    })).resolves.toEqual({
      ok: true,
      action: "close",
      panel: null,
      stack: { panels: [], activePanelId: null, stackRevision: 2 },
      context: null,
    });
  });
});
