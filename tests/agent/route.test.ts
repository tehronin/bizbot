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

  it("forwards swarm SSE events to the client stream", async () => {
    executorMocks.executeAgentConversation.mockImplementation(async ({ onEvent }) => {
      await onEvent?.({
        type: "swarm_plan",
        runId: "run-3",
        mode: "core_chat_swarm",
        reason: "multi-source synthesis",
        workerCount: 6,
        plannerConfidence: 0.82,
      });
      await onEvent?.({
        type: "swarm_validation",
        runId: "run-3",
        valid: true,
        issues: [],
      });
      await onEvent?.({
        type: "done",
        conversationId: "conversation-3",
        reply: "grounded summary",
      });
      return {
        reply: "grounded summary",
        runId: "run-3",
        conversationId: "conversation-3",
        profile: "content_operator",
        provider: "ollama",
        model: "model-1",
      };
    });

    const response = await POST(new Request("http://localhost:3000/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Summarize sources", stream: true }),
    }) as never);

    const text = await response.text();
    expect(text).toContain("event: swarm_plan");
    expect(text).toContain("event: swarm_validation");
    expect(text).toContain('"workerCount":6');
  });

  it("forwards explicit oracle prediction requests into the executor", async () => {
    executorMocks.executeAgentConversation.mockResolvedValue({
      reply: "oracle reply",
      runId: "run-2",
      conversationId: "conversation-2",
      profile: "research_operator",
      provider: "ollama",
      model: "model-2",
    });

    const response = await POST(new Request("http://localhost:3000/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "oracle predict btc", oraclePrediction: true }),
    }) as never);

    expect(response.status).toBe(200);
    expect(executorMocks.executeAgentConversation).toHaveBeenCalledWith(expect.objectContaining({
      message: "oracle predict btc",
      oraclePrediction: true,
    }));
  });

  it("forwards execution selection and attachments into the executor", async () => {
    executorMocks.executeAgentConversation.mockResolvedValue({
      reply: "ok",
      runId: "run-4",
      conversationId: "conversation-4",
      profile: "content_operator",
      provider: "ollama",
      model: "model-1",
    });

    const response = await POST(new Request("http://localhost:3000/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Summarize this doc",
        mode: "agent",
        pluginId: "content",
        attachments: [{ type: "knowledge-doc", path: "knowledge/brief.md", label: "brief.md" }],
      }),
    }) as never);

    expect(response.status).toBe(200);
    expect(executorMocks.executeAgentConversation).toHaveBeenCalledWith(expect.objectContaining({
      message: "Summarize this doc",
      mode: "agent",
      pluginId: "content",
      attachments: [{ type: "knowledge-doc", path: "knowledge/brief.md", label: "brief.md" }],
    }));
  });

  it("allows resuming a run without requiring a new message", async () => {
    executorMocks.executeAgentConversation.mockResolvedValue({
      reply: "resumed",
      runId: "run-5",
      conversationId: "conversation-5",
      profile: "general_operator",
      provider: "ollama",
      model: "model-1",
    });

    const response = await POST(new Request("http://localhost:3000/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resumeRunId: "run-old" }),
    }) as never);

    expect(response.status).toBe(200);
    expect(executorMocks.executeAgentConversation).toHaveBeenCalledWith(expect.objectContaining({
      message: "Resume agent run run-old",
      resumeRunId: "run-old",
    }));
  });
});
