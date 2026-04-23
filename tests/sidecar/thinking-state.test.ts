import { beforeEach, describe, expect, it } from "vitest";
import { appendThinkingChunk, clearThinkingSession, completeThinkingSession, getThinkingSnapshotForConversation, resetThinkingSessionsForTests, startThinkingSession } from "@/lib/sidecar/thinking-state";

describe("sidecar thinking state", () => {
  beforeEach(() => {
    resetThinkingSessionsForTests();
  });

  it("creates a new thinking session", () => {
    const snapshot = startThinkingSession({
      conversationId: "conversation-1",
      title: "Agent activity",
    });

    expect(snapshot).toEqual({
      conversationId: "conversation-1",
      sessionId: expect.any(String),
      status: "streaming",
      title: "Agent activity",
      chunks: [],
      updatedAt: expect.any(String),
      revision: 1,
    });
  });

  it("appends bounded chunks and preserves only the newest entries", () => {
    startThinkingSession({ conversationId: "conversation-1", sessionId: "session-1" });

    for (let index = 1; index <= 155; index += 1) {
      appendThinkingChunk({
        conversationId: "conversation-1",
        kind: "note",
        text: `chunk ${index}`,
        chunkId: `chunk-${index}`,
      });
    }

    const snapshot = getThinkingSnapshotForConversation("conversation-1");
    expect(snapshot?.revision).toBe(156);
    expect(snapshot?.chunks).toHaveLength(150);
    expect(snapshot?.chunks[0]).toEqual(expect.objectContaining({ id: "chunk-6", text: "chunk 6" }));
    expect(snapshot?.chunks.at(-1)).toEqual(expect.objectContaining({ id: "chunk-155", text: "chunk 155" }));
  });

  it("marks a session complete and clears it", () => {
    startThinkingSession({ conversationId: "conversation-1", sessionId: "session-1" });
    appendThinkingChunk({
      conversationId: "conversation-1",
      kind: "status",
      text: "Planning next action.",
    });

    const completed = completeThinkingSession("conversation-1", "Completed successfully.");
    expect(completed.status).toBe("complete");
    expect(completed.summary).toBe("Completed successfully.");

    clearThinkingSession("conversation-1");
    expect(getThinkingSnapshotForConversation("conversation-1")).toBeNull();
  });
});