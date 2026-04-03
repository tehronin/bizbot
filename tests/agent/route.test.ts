import { describe, expect, it, vi } from "vitest";

const executorMocks = vi.hoisted(() => ({
  executeAgentConversation: vi.fn(),
}));

vi.mock("@/lib/agent/executor", () => ({
  executeAgentConversation: executorMocks.executeAgentConversation,
}));

import { POST } from "@/app/api/agent/route";

describe("agent route sidecar stream", () => {
  it("forwards sidecar SSE events to the client stream", async () => {
    executorMocks.executeAgentConversation.mockImplementation(async ({ onEvent }) => {
      await onEvent?.({
        type: "meta",
        runId: "run-1",
        conversationId: "conversation-1",
        profile: "content_operator",
        profileLabel: "Content Operator",
        provider: "ollama",
        model: "model-1",
      });
      await onEvent?.({
        type: "sidecar",
        action: "open",
        panel: {
          panelId: "launch-brief",
          title: "Launch brief",
          content: { type: "markdown", markdown: "# Launch" },
        },
        runId: "run-1",
        conversationId: "conversation-1",
        round: 1,
        toolCallId: "tool-1",
        name: "sidecar_open",
      });
      await onEvent?.({
        type: "done",
        conversationId: "conversation-1",
        reply: "done",
      });
      return {
        reply: "done",
        runId: "run-1",
        conversationId: "conversation-1",
        profile: "content_operator",
        provider: "ollama",
        model: "model-1",
      };
    });

    const response = await POST(new Request("http://localhost:3000/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Open sidecar", stream: true }),
    }) as never);

    expect(response.headers.get("Content-Type")).toContain("text/event-stream");

    const text = await response.text();
    expect(text).toContain("event: sidecar");
    expect(text).toContain('"title":"Launch brief"');
    expect(text).toContain('"name":"sidecar_open"');
  });
});
