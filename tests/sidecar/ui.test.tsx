// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SidecarHost from "@/components/layout/SidecarHost";
import { BIZBOT_SIDECAR_EVENT, BIZBOT_SIDECAR_INTERACTION_EVENT } from "@/lib/sidecar/types";

afterEach(() => {
  cleanup();
});

function dispatchSidecar(detail: unknown): void {
  window.dispatchEvent(new CustomEvent(BIZBOT_SIDECAR_EVENT, { detail }));
}

describe("sidecar host", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "close" }));
    await waitFor(() => {
      expect(screen.queryByText("Payload")).toBeNull();
    });
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

  it("emits structured interaction events for selection cards", async () => {
    const listener = vi.fn();
    window.addEventListener(BIZBOT_SIDECAR_INTERACTION_EVENT, listener as EventListener);
    render(<SidecarHost />);

    dispatchSidecar({
      action: "open",
      panel: {
        panelId: "oracle-choice",
        title: "Oracle personality",
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
    });

    window.removeEventListener(BIZBOT_SIDECAR_INTERACTION_EVENT, listener as EventListener);
  });
});
