// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SidecarHost from "@/components/layout/SidecarHost";
import { BIZBOT_SIDECAR_EVENT } from "@/lib/sidecar/types";

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
});
