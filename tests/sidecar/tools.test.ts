import { describe, expect, it } from "vitest";
import { getToolAnnotations } from "@/lib/mcp/tool-presentation";
import { sidecarTools } from "@/lib/sidecar/tools";

describe("sidecar tools", () => {
  it("exposes strict schemas and safe annotations", async () => {
    expect(sidecarTools.map((tool) => tool.name)).toEqual([
      "sidecar_open",
      "sidecar_update",
      "sidecar_close",
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

    expect(getToolAnnotations("sidecar_open")).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("returns validated sidecar actions", async () => {
    await expect(sidecarTools[0].execute({
      title: "Build output",
      content: { type: "json", value: { ok: true } },
    }, {})).resolves.toEqual({
      ok: true,
      action: "open",
      panel: expect.objectContaining({
        panelId: expect.any(String),
        title: "Build output",
        content: { type: "json", value: { ok: true } },
      }),
    });

    await expect(sidecarTools[2].execute({}, {})).resolves.toEqual({
      ok: true,
      action: "close",
      panel: null,
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
  });
});
