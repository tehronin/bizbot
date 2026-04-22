import { describe, expect, it } from "vitest";
import { executeTool, getAllToolDefinitions } from "@/lib/agent/plugins";
import { canProfileUseTool } from "@/lib/agent/profiles";

describe("sidecar core tools", () => {
  it("is exposed as a core tool family through profile policy, including mcp_operator", () => {
    expect(canProfileUseTool("general_operator", "sidecar_open")).toBe(true);
    expect(canProfileUseTool("content_operator", "sidecar_open")).toBe(true);
    expect(canProfileUseTool("platform_operator", "sidecar_open")).toBe(true);
    expect(canProfileUseTool("builder_operator", "sidecar_open")).toBe(true);
    expect(canProfileUseTool("mcp_operator", "sidecar_open")).toBe(true);

    const appTools = getAllToolDefinitions(undefined, { agentProfile: "content_operator" }).map((tool) => tool.name);
    const mcpTools = getAllToolDefinitions(undefined, { agentProfile: "mcp_operator" }).map((tool) => tool.name);

    expect(appTools).toContain("sidecar_open");
    expect(appTools).toContain("sidecar_update");
    expect(appTools).toContain("sidecar_close");
    expect(mcpTools).toContain("sidecar_open");
    expect(mcpTools).toContain("sidecar_update");
    expect(mcpTools).toContain("sidecar_close");
  });

  it("opens, updates, and closes through the shared executor", async () => {
    await expect(executeTool("sidecar_open", {
      title: "Summary",
      context: {
        contextId: "release.review",
        readKeys: ["planId"],
        writeKeys: ["approved"],
      },
      content: {
        type: "json",
        value: {
          score: 9.4,
          status: "ready",
        },
      },
    }, {
      access: { agentProfile: "content_operator" },
    })).resolves.toEqual({
      ok: true,
      action: "open",
      panel: expect.objectContaining({
        panelId: expect.any(String),
        title: "Summary",
        context: {
          contextId: "release.review",
          readKeys: ["planId"],
          writeKeys: ["approved"],
        },
        content: {
          type: "json",
          value: {
            score: 9.4,
            status: "ready",
          },
        },
      }),
    });

    await expect(executeTool("sidecar_update", {
      title: "Preview",
      content: {
        type: "image",
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6L4xwAAAAASUVORK5CYII=",
        alt: "Tiny preview",
      },
    }, {
      access: { agentProfile: "content_operator" },
    })).resolves.toEqual({
      ok: true,
      action: "update",
      panel: expect.objectContaining({
        panelId: expect.any(String),
        title: "Preview",
        content: {
          type: "image",
          url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6L4xwAAAAASUVORK5CYII=",
          alt: "Tiny preview",
        },
      }),
    });

    await expect(executeTool("sidecar_close", {}, {
      access: { agentProfile: "content_operator" },
    })).resolves.toEqual({
      ok: true,
      action: "close",
      panel: null,
    });
  });

  it("rejects unsafe payloads through the shared executor", async () => {
    await expect(executeTool("sidecar_open", {
      title: "Unsafe markdown",
      content: {
        type: "markdown",
        markdown: "<script>alert('xss')</script>",
      },
    }, {
      access: { agentProfile: "content_operator" },
    })).rejects.toThrow("Sidecar markdown does not allow raw HTML.");

    await expect(executeTool("sidecar_open", {
      title: "Unsafe image",
      content: {
        type: "image",
        url: "https://example.com/preview.png",
        alt: "Unsafe image",
      },
    }, {
      access: { agentProfile: "content_operator" },
    })).rejects.toThrow("Sidecar image host 'example.com' is not allowed.");

    await expect(executeTool("sidecar_open", {
      title: "Unknown content type",
      context: {
        contextId: "invalid context id with spaces",
      },
      content: {
        type: "chart",
        value: { points: [1, 2, 3] },
      },
    } as never, {
      access: { agentProfile: "content_operator" },
    })).rejects.toThrow("Tool argument content.type must be one of: markdown, code, json, image, selection, table, key_value, progress, diff.");

    await expect(executeTool("sidecar_open", {
      title: "Malformed json string",
      content: {
        type: "json",
        value: "{broken",
      },
    }, {
      access: { agentProfile: "content_operator" },
    })).rejects.toThrow("Sidecar JSON string payload must be valid JSON.");

    await expect(executeTool("sidecar_open", {
      title: "Oversized data url",
      content: {
        type: "image",
        url: `data:image/png;base64,${"A".repeat(200_001)}`,
        alt: "Huge image",
      },
    }, {
      access: { agentProfile: "content_operator" },
    })).rejects.toThrow("Sidecar image data URL exceeds the maximum allowed size.");
  });
});