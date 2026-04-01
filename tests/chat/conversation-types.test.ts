import { describe, expect, it } from "vitest";
import {
  CHAT_PREVIEW_MAX_CHARS,
  buildConversationLabel,
  truncateChatPreview,
} from "@/lib/chat/types";

describe("chat conversation preview helpers", () => {
  it("uses the explicit title when one exists", () => {
    expect(buildConversationLabel({ title: "Operator playbook" })).toBe("Operator playbook");
  });

  it("falls back to New chat when a conversation is empty", () => {
    expect(buildConversationLabel({ title: null, firstUserMessage: null })).toBe("New chat");
  });

  it("truncates long preview snippets to eighty characters", () => {
    const source = "a".repeat(CHAT_PREVIEW_MAX_CHARS + 25);
    const preview = truncateChatPreview(source);

    expect(preview).toHaveLength(CHAT_PREVIEW_MAX_CHARS);
    expect(preview.endsWith("…")).toBe(true);
  });
});