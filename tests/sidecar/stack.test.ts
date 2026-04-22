import { describe, expect, it } from "vitest";
import { applySidecarActionToPanels, buildRestorableSidecarStackSnapshot, getRestorableActiveSidecarPanel } from "@/lib/sidecar/stack";
import type { SidecarPanel } from "@/lib/sidecar/types";

function makePanel(panelId: string, title: string, persistence?: SidecarPanel["persistence"]): SidecarPanel {
  return {
    panelId,
    title,
    ...(persistence ? { persistence } : {}),
    content: { type: "markdown", markdown: `# ${title}` },
  };
}

describe("sidecar stack persistence", () => {
  it("dismisses only the active ephemeral overlay on close", () => {
    const next = applySidecarActionToPanels({
      action: "close",
      panel: null,
      panels: [
        makePanel("sticky-panel", "Sticky", "sticky"),
        makePanel("workflow-panel", "Workflow", "workflow"),
        makePanel("ephemeral-panel", "Ephemeral", "ephemeral"),
      ],
    });

    expect(next).toEqual([
      makePanel("sticky-panel", "Sticky", "sticky"),
      makePanel("workflow-panel", "Workflow", "workflow"),
    ]);
  });

  it("dismisses the active workflow branch while preserving sticky context", () => {
    const next = applySidecarActionToPanels({
      action: "close",
      panel: null,
      panels: [
        makePanel("sticky-panel", "Sticky", "sticky"),
        makePanel("workflow-1", "Workflow 1", "workflow"),
        makePanel("workflow-2", "Workflow 2", "workflow"),
      ],
    });

    expect(next).toEqual([
      makePanel("sticky-panel", "Sticky", "sticky"),
    ]);
  });

  it("keeps only one ephemeral overlay when opening a new ephemeral panel", () => {
    const next = applySidecarActionToPanels({
      action: "open",
      panel: makePanel("ephemeral-2", "Ephemeral 2", "ephemeral"),
      panels: [
        makePanel("sticky-panel", "Sticky", "sticky"),
        makePanel("ephemeral-1", "Ephemeral 1", "ephemeral"),
      ],
    });

    expect(next).toEqual([
      makePanel("sticky-panel", "Sticky", "sticky"),
      makePanel("ephemeral-2", "Ephemeral 2", "ephemeral"),
    ]);
  });

  it("excludes ephemeral panels from the restorable bootstrap stack", () => {
    const panels = [
      makePanel("sticky-panel", "Sticky", "sticky"),
      makePanel("workflow-panel", "Workflow", "workflow"),
      makePanel("ephemeral-panel", "Ephemeral", "ephemeral"),
    ];

    expect(buildRestorableSidecarStackSnapshot(panels)).toEqual({
      panels: [
        makePanel("sticky-panel", "Sticky", "sticky"),
        makePanel("workflow-panel", "Workflow", "workflow"),
      ],
      activePanelId: "workflow-panel",
      stackRevision: 0,
    });
    expect(getRestorableActiveSidecarPanel(panels)).toEqual(makePanel("workflow-panel", "Workflow", "workflow"));
  });
});