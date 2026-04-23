import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/sidecar/thinking/route";
import { appendThinkingChunk, resetThinkingSessionsForTests, startThinkingSession } from "@/lib/sidecar/thinking-state";

describe("sidecar thinking route", () => {
  beforeEach(() => {
    resetThinkingSessionsForTests();
  });

  it("returns a null thinking snapshot when no session exists", async () => {
    const response = await GET(new NextRequest("http://localhost:3000/api/sidecar/thinking?conversationId=conversation-1"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({
      conversationId: "conversation-1",
      snapshot: null,
    });
  });

  it("returns the current thinking snapshot for a conversation", async () => {
    startThinkingSession({ conversationId: "conversation-1", sessionId: "session-1", title: "Agent activity" });
    appendThinkingChunk({
      conversationId: "conversation-1",
      kind: "tool_call",
      text: "Fetching authoritative Sidecar state.",
      chunkId: "chunk-1",
      timestamp: "2026-04-23T12:00:00.000Z",
    });

    const response = await GET(new NextRequest("http://localhost:3000/api/sidecar/thinking?conversationId=conversation-1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      conversationId: "conversation-1",
      snapshot: {
        conversationId: "conversation-1",
        sessionId: "session-1",
        status: "streaming",
        title: "Agent activity",
        chunks: [
          {
            id: "chunk-1",
            kind: "tool_call",
            text: "Fetching authoritative Sidecar state.",
            timestamp: "2026-04-23T12:00:00.000Z",
          },
        ],
        updatedAt: expect.any(String),
        revision: 2,
      },
    });
  });

  it("rejects missing conversation ids", async () => {
    const response = await GET(new NextRequest("http://localhost:3000/api/sidecar/thinking"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Error: Sidecar conversation id is required.",
    });
  });
});