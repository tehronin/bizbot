// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SidecarHost from "@/components/layout/SidecarHost";
import { BIZBOT_SIDECAR_EVENT, BIZBOT_SIDECAR_INTERACTION_EVENT } from "@/lib/sidecar/types";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function dispatchSidecar(detail: unknown): void {
  window.dispatchEvent(new CustomEvent(BIZBOT_SIDECAR_EVENT, { detail }));
}

describe("sidecar host", () => {
  it("keeps a chevron rail visible even when no panel is active", () => {
    render(<SidecarHost />);

    expect(screen.getByRole("button", { name: "Expand sidecar" })).toBeTruthy();
  });

  it("opens, updates, and closes the transient panel", async () => {
    render(<SidecarHost />);

    dispatchSidecar({
      action: "open",
      panel: {
        panelId: "launch-brief",
        title: "Launch brief",
        content: { type: "markdown", markdown: "# Launch\n\n- One panel only" },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Launch brief")).toBeTruthy();
      expect(screen.getByText("One panel only")).toBeTruthy();
    });

    dispatchSidecar({
      action: "update",
      panel: {
        panelId: "build-log",
        title: "Build log",
        content: { type: "code", language: "ts", code: "export const ready = true;" },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Build log")).toBeTruthy();
      expect(screen.getByText("export const ready = true;")).toBeTruthy();
    });

    dispatchSidecar({
      action: "update",
      panel: {
        panelId: "payload",
        title: "Payload",
        content: { type: "json", value: { ready: true, count: 2 } },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Payload")).toBeTruthy();
      expect(screen.getByText(/"ready": true/)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidecar" }));
    await waitFor(() => {
      expect(screen.queryByText("Payload")).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Expand sidecar" })).toBeTruthy();
  });

  it("renders safe image payloads", async () => {
    render(<SidecarHost />);

    dispatchSidecar({
      action: "open",
      panel: {
        panelId: "preview-image",
        title: "Preview image",
        content: {
          type: "image",
          url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6L4xwAAAAASUVORK5CYII=",
          alt: "Safe preview",
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Preview image")).toBeTruthy();
      expect(screen.getByAltText("Safe preview")).toBeTruthy();
    });
  });

  it("renders richer sidecar content primitives and resolves context placeholders", async () => {
    render(<SidecarHost />);

    dispatchSidecar({
      action: "open",
      conversationId: "conversation-1",
      context: {
        contextId: "release.summary",
        conversationId: "conversation-1",
        rootPanelId: "table-panel",
        activePanelId: "table-panel",
        stackRevision: 1,
        values: {
          branch: "main",
          status: "green",
          owner: "agent",
          artifact: "dist/main.js",
        },
      },
      panel: {
        panelId: "table-panel",
        title: "Task table",
        context: {
          contextId: "release.summary",
          readKeys: ["branch", "status", "owner", "artifact"],
        },
        content: {
          type: "table",
          columns: ["task", "status"],
          rows: [["branch", "{{branch}}"], ["status", "{{status}}"]],
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("task")).toBeTruthy();
      expect(screen.getByText("main")).toBeTruthy();
      expect(screen.getByText("green")).toBeTruthy();
    });

    dispatchSidecar({
      action: "update",
      panel: {
        panelId: "summary-panel",
        title: "Release summary",
        context: {
          contextId: "release.summary",
          readKeys: ["owner", "status"],
        },
        content: {
          type: "markdown",
          markdown: "## Release owner\n\n{{owner}} is holding status at **{{status}}**.",
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Release owner")).toBeTruthy();
      expect(screen.getByText((content, element) => element?.textContent === "agent is holding status at green.")).toBeTruthy();
    });

    dispatchSidecar({
      action: "update",
      panel: {
        panelId: "code-panel",
        title: "Release snippet",
        context: {
          contextId: "release.summary",
          readKeys: ["artifact"],
        },
        content: {
          type: "code",
          language: "ts",
          code: "export const artifactPath = \"{{artifact}}\";",
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("export const artifactPath = \"dist/main.js\";")).toBeTruthy();
    });

    dispatchSidecar({
      action: "update",
      panel: {
        panelId: "kv-panel",
        title: "Metadata",
        content: {
          type: "key_value",
          entries: [
            { label: "branch", value: "main" },
            { label: "counts", value: { passing: 12 } },
          ],
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("branch")).toBeTruthy();
      expect(screen.getByText("main")).toBeTruthy();
    });

    dispatchSidecar({
      action: "update",
      panel: {
        panelId: "progress-panel",
        title: "Checklist",
        content: {
          type: "progress",
          title: "Ship checklist",
          items: [
            { id: "spec", label: "Write spec", status: "done" },
            { id: "ship", label: "Ship", status: "active", detail: "Awaiting approval" },
          ],
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Ship checklist")).toBeTruthy();
      expect(screen.getByText("Awaiting approval")).toBeTruthy();
    });

    dispatchSidecar({
      action: "update",
      panel: {
        panelId: "diff-panel",
        title: "Patch preview",
        content: {
          type: "diff",
          sections: [
            {
              label: "Config",
              before: "const enabled = false;",
              after: "const enabled = true;",
              language: "ts",
            },
          ],
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Config")).toBeTruthy();
      expect(screen.getByText("const enabled = false;")).toBeTruthy();
      expect(screen.getByText("const enabled = true;")).toBeTruthy();
    });
  });

  it("supports stack navigation with a server-backed back action", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        action: "update",
        panel: {
          panelId: "plan-panel",
          title: "Plan",
          content: { type: "markdown", markdown: "# Plan\n\n- Return to previous" },
        },
        stack: {
          panels: [
            {
              panelId: "plan-panel",
              title: "Plan",
              content: { type: "markdown", markdown: "# Plan\n\n- Return to previous" },
            },
          ],
          activePanelId: "plan-panel",
          stackRevision: 3,
        },
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<SidecarHost />);

    dispatchSidecar({
      action: "open",
      conversationId: "conversation-1",
      stack: {
        panels: [
          {
            panelId: "plan-panel",
            title: "Plan",
            content: { type: "markdown", markdown: "# Plan\n\n- Start here" },
          },
          {
            panelId: "detail-panel",
            title: "Detail",
            content: { type: "markdown", markdown: "# Detail\n\n- Nested panel" },
          },
        ],
        activePanelId: "detail-panel",
        stackRevision: 2,
      },
      panel: {
        panelId: "detail-panel",
        title: "Detail",
        content: { type: "markdown", markdown: "# Detail\n\n- Nested panel" },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Nested panel")).toBeTruthy();
      expect(screen.getAllByText("Plan").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Detail").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: "back" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/sidecar/state", expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ conversationId: "conversation-1", operation: "back", expectedStackRevision: 2 }),
      }));
      expect(screen.getByText("Return to previous")).toBeTruthy();
      expect(screen.queryByText("Nested panel")).toBeNull();
    });
  });

  it("navigates to an earlier stack chip through the server state route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        action: "update",
        panel: {
          panelId: "detail-panel",
          title: "Detail",
          content: { type: "markdown", markdown: "# Detail\n\n- Chip target" },
        },
        stack: {
          panels: [
            {
              panelId: "plan-panel",
              title: "Plan",
              content: { type: "markdown", markdown: "# Plan\n\n- Start here" },
            },
            {
              panelId: "detail-panel",
              title: "Detail",
              content: { type: "markdown", markdown: "# Detail\n\n- Chip target" },
            },
          ],
          activePanelId: "detail-panel",
          stackRevision: 4,
        },
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<SidecarHost />);

    dispatchSidecar({
      action: "open",
      conversationId: "conversation-1",
      stack: {
        panels: [
          {
            panelId: "plan-panel",
            title: "Plan",
            content: { type: "markdown", markdown: "# Plan\n\n- Start here" },
          },
          {
            panelId: "detail-panel",
            title: "Detail",
            content: { type: "markdown", markdown: "# Detail\n\n- Drill in" },
          },
          {
            panelId: "notes-panel",
            title: "Notes",
            content: { type: "markdown", markdown: "# Notes\n\n- Deepest panel" },
          },
        ],
        activePanelId: "notes-panel",
        stackRevision: 3,
      },
      panel: {
        panelId: "notes-panel",
        title: "Notes",
        content: { type: "markdown", markdown: "# Notes\n\n- Deepest panel" },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Deepest panel")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Open Detail panel" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open Detail panel" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/sidecar/state",
        expect.objectContaining({ method: "POST" }),
      );
      expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
        conversationId: "conversation-1",
        operation: "activate",
        expectedStackRevision: 3,
        panelId: "detail-panel",
      });
      expect(screen.getByText("Chip target")).toBeTruthy();
      expect(screen.queryByText("Deepest panel")).toBeNull();
    });
  });

  it("reconciles to the latest server stack when navigation hits a revision conflict", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "Sidecar state changed while you were navigating. Review the latest panel stack and retry.",
        panel: {
          panelId: "late-panel",
          title: "Late panel",
          content: { type: "markdown", markdown: "# Late\n\n- Agent reopened" },
        },
        stack: {
          panels: [
            {
              panelId: "plan-panel",
              title: "Plan",
              content: { type: "markdown", markdown: "# Plan\n\n- Start here" },
            },
            {
              panelId: "late-panel",
              title: "Late panel",
              content: { type: "markdown", markdown: "# Late\n\n- Agent reopened" },
            },
          ],
          activePanelId: "late-panel",
          stackRevision: 3,
        },
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<SidecarHost />);

    dispatchSidecar({
      action: "open",
      conversationId: "conversation-1",
      stack: {
        panels: [
          {
            panelId: "plan-panel",
            title: "Plan",
            content: { type: "markdown", markdown: "# Plan\n\n- Start here" },
          },
          {
            panelId: "detail-panel",
            title: "Detail",
            content: { type: "markdown", markdown: "# Detail\n\n- Nested panel" },
          },
        ],
        activePanelId: "detail-panel",
        stackRevision: 2,
      },
      panel: {
        panelId: "detail-panel",
        title: "Detail",
        content: { type: "markdown", markdown: "# Detail\n\n- Nested panel" },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Nested panel")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "back" }));

    await waitFor(() => {
      expect(screen.getByText("Agent reopened")).toBeTruthy();
      expect(screen.getByText("Sidecar state changed while you were navigating. Review the latest panel stack and retry.")).toBeTruthy();
      expect(screen.queryByText("Nested panel")).toBeNull();
    });
  });

  it("emits structured interaction events for selection cards", async () => {
    const listener = vi.fn();
    window.addEventListener(BIZBOT_SIDECAR_INTERACTION_EVENT, listener as EventListener);
    render(<SidecarHost />);

    dispatchSidecar({
      action: "open",
      panel: {
        panelId: "oracle-choice",
        title: "Oracle personality",
        context: {
          contextId: "oracle.personality.preferences",
          readKeys: ["selectedPersonality"],
          writeKeys: ["selectedPersonality"],
          selectionKey: "selectedPersonality",
        },
        content: {
          type: "selection",
          title: "Choose personality",
          selectionMode: "single",
          items: [
            { id: "balanced", title: "Balanced" },
            { id: "bullish", title: "Bullish" },
          ],
          actions: [
            { id: "oracle_toggle", label: "Choose", kind: "toggle" },
            { id: "oracle_apply", label: "Apply", kind: "apply" },
          ],
          interaction: { routeKey: "oracle.personality.select" },
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Choose personality")).toBeTruthy();
      expect(screen.getByText("Balanced")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Balanced").closest("button") as HTMLButtonElement);

    await waitFor(() => {
      expect(listener).toHaveBeenCalled();
    });

    const event = listener.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({
      panelId: "oracle-choice",
      actionId: "oracle_toggle",
      selectedItemIds: ["balanced"],
      expectedStackRevision: 1,
      contextPatch: {
        contextId: "oracle.personality.preferences",
        values: {
          selectedPersonality: "balanced",
        },
      },
    });

    window.removeEventListener(BIZBOT_SIDECAR_INTERACTION_EVENT, listener as EventListener);
  });

  it("renders selection state from the active context snapshot", async () => {
    render(<SidecarHost />);

    dispatchSidecar({
      action: "open",
      conversationId: "conversation-1",
      context: {
        contextId: "oracle.personality.preferences",
        conversationId: "conversation-1",
        rootPanelId: "oracle-choice",
        activePanelId: "oracle-choice",
        stackRevision: 1,
        values: {
          selectedPersonality: "bullish",
        },
      },
      stack: {
        panels: [
          {
            panelId: "oracle-choice",
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
                { id: "oracle_toggle", label: "Choose", kind: "toggle" },
              ],
              interaction: { routeKey: "oracle.personality.select" },
            },
          },
        ],
        activePanelId: "oracle-choice",
        stackRevision: 1,
      },
      panel: {
        panelId: "oracle-choice",
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
            { id: "oracle_toggle", label: "Choose", kind: "toggle" },
          ],
          interaction: { routeKey: "oracle.personality.select" },
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Current selection: Bullish")).toBeTruthy();
      expect(screen.getByText("selected")).toBeTruthy();
    });
  });

  it("renders key-value entries from the active context snapshot", async () => {
    render(<SidecarHost />);

    dispatchSidecar({
      action: "open",
      conversationId: "conversation-1",
      context: {
        contextId: "oracle.personality.preferences",
        conversationId: "conversation-1",
        rootPanelId: "oracle-summary",
        activePanelId: "oracle-summary",
        stackRevision: 1,
        values: {
          selectedPersonality: "bullish",
        },
      },
      stack: {
        panels: [
          {
            panelId: "oracle-summary",
            title: "Oracle personality saved",
            context: {
              contextId: "oracle.personality.preferences",
              readKeys: ["selectedPersonality"],
            },
            content: {
              type: "key_value",
              entries: [
                { label: "default personality", value: "balanced", contextKey: "selectedPersonality" },
                { label: "stored in", value: "oracle_bot_personality" },
              ],
            },
          },
        ],
        activePanelId: "oracle-summary",
        stackRevision: 1,
      },
      panel: {
        panelId: "oracle-summary",
        title: "Oracle personality saved",
        context: {
          contextId: "oracle.personality.preferences",
          readKeys: ["selectedPersonality"],
        },
        content: {
          type: "key_value",
          entries: [
            { label: "default personality", value: "balanced", contextKey: "selectedPersonality" },
            { label: "stored in", value: "oracle_bot_personality" },
          ],
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("default personality")).toBeTruthy();
      expect(screen.getByText("bullish")).toBeTruthy();
      expect(screen.getByText("oracle_bot_personality")).toBeTruthy();
    });
  });

  it("syncs authoritative sidecar state from the server for the selected conversation", async () => {
    window.localStorage.setItem("bizbot:selected-chat-conversation-id", "conversation-1");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        conversationId: "conversation-1",
        activePanel: {
          panelId: "authoritative-panel",
          title: "Authoritative panel",
          content: { type: "markdown", markdown: "# Server synced\n\n- Visible without a local event" },
        },
        stack: {
          panels: [
            {
              panelId: "authoritative-panel",
              title: "Authoritative panel",
              content: { type: "markdown", markdown: "# Server synced\n\n- Visible without a local event" },
            },
          ],
          activePanelId: "authoritative-panel",
          stackRevision: 3,
        },
        context: null,
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<SidecarHost />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/sidecar/state?conversationId=conversation-1", { cache: "no-store" });
      expect(screen.getByText("Authoritative panel")).toBeTruthy();
      expect(screen.getByText("Visible without a local event")).toBeTruthy();
    });
  });
});
