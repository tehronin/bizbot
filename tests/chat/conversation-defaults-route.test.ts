import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const memoryMocks = vi.hoisted(() => ({
  updateConversationExecutionDefaults: vi.fn(),
}));

vi.mock("@/lib/agent/memory", () => ({
  updateConversationExecutionDefaults: memoryMocks.updateConversationExecutionDefaults,
}));

import { POST } from "@/app/api/chat/conversations/[id]/defaults/route";

describe("chat conversation defaults route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates conversation execution defaults", async () => {
    const response = await POST(new NextRequest("http://localhost/api/chat/conversations/conv-1/defaults", {
      method: "POST",
      body: JSON.stringify({ mode: "agent", pluginId: "builder" }),
    }), {
      params: Promise.resolve({ id: "conv-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(memoryMocks.updateConversationExecutionDefaults).toHaveBeenCalledWith("conv-1", {
      mode: "agent",
      pluginId: "builder",
    });
    expect(payload.ok).toBe(true);
  });
});