import { describe, expect, it } from "vitest";
import { validateSidecarContent, validateSidecarPanel } from "@/lib/sidecar/validation";

describe("sidecar validation", () => {
  it("accepts the four supported content types", () => {
    expect(validateSidecarPanel({
      panelId: "release-notes",
      title: "Release notes",
      content: { type: "markdown", markdown: "# Launch\n\n- Ship Sidecar" },
    })).toEqual({
      panelId: "release-notes",
      title: "Release notes",
      content: { type: "markdown", markdown: "# Launch\n\n- Ship Sidecar" },
    });

    expect(validateSidecarContent({ type: "code", code: "const x = 1;", language: "ts" })).toEqual({
      type: "code",
      code: "const x = 1;",
      language: "ts",
    });

    expect(validateSidecarContent({ type: "json", value: { ok: true, items: [1, 2, 3] } })).toEqual({
      type: "json",
      value: { ok: true, items: [1, 2, 3] },
    });

    expect(validateSidecarContent({
      type: "image",
      url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6L4xwAAAAASUVORK5CYII=",
      alt: "One pixel",
    })).toEqual({
      type: "image",
      url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6L4xwAAAAASUVORK5CYII=",
      alt: "One pixel",
    });

    expect(validateSidecarContent({
      type: "selection",
      title: "Choose one",
      description: "Generic card selection.",
      selectionMode: "multiple",
      items: [
        { id: "alpha", title: "Alpha" },
        { id: "beta", title: "Beta", description: "Second item" },
      ],
      selectedItemIds: ["beta"],
      actions: [
        { id: "toggle", label: "Toggle", kind: "toggle" },
        { id: "apply", label: "Apply", kind: "apply" },
      ],
      interaction: { routeKey: "sidecar.selection.apply" },
    })).toEqual({
      type: "selection",
      title: "Choose one",
      description: "Generic card selection.",
      selectionMode: "multiple",
      items: [
        { id: "alpha", title: "Alpha" },
        { id: "beta", title: "Beta", description: "Second item" },
      ],
      selectedItemIds: ["beta"],
      actions: [
        { id: "toggle", label: "Toggle", kind: "toggle" },
        { id: "apply", label: "Apply", kind: "apply" },
      ],
      interaction: { routeKey: "sidecar.selection.apply" },
    });
  });

  it("rejects raw HTML in markdown", () => {
    expect(() => validateSidecarContent({
      type: "markdown",
      markdown: "<script>alert(1)</script>",
    })).toThrow("Sidecar markdown does not allow raw HTML.");
  });

  it("rejects unsafe image urls", () => {
    expect(() => validateSidecarContent({
      type: "image",
      url: "https://example.com/unsafe.png",
      alt: "Unsafe",
    })).toThrow("Sidecar image host 'example.com' is not allowed.");
  });

  it("rejects invalid code language hints", () => {
    expect(() => validateSidecarContent({
      type: "code",
      code: "print('hi')",
      language: "python<script>",
    })).toThrow("Sidecar code language must be alphanumeric and 32 characters or fewer.");
  });

  it("rejects malformed selection payloads", () => {
    expect(() => validateSidecarContent({
      type: "selection",
      title: "Choose one",
      selectionMode: "single",
      items: [
        { id: "alpha", title: "Alpha" },
        { id: "beta", title: "Beta" },
      ],
      selectedItemIds: ["alpha", "beta"],
      actions: [
        { id: "toggle", label: "Toggle", kind: "toggle" },
      ],
      interaction: { routeKey: "sidecar.selection.apply" },
    })).toThrow("Single-select Sidecar content accepts only one selected item.");
  });
});
