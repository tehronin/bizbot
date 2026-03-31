import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAgenticSetupPayload: vi.fn(),
  updateAgenticSetup: vi.fn(),
}));

vi.mock("@/lib/agentic-setup", () => ({
  getAgenticSetupPayload: mocks.getAgenticSetupPayload,
  updateAgenticSetup: mocks.updateAgenticSetup,
}));

import { GET, PATCH } from "@/app/api/agentic-setup/route";

describe("agentic setup route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgenticSetupPayload.mockResolvedValue({
      session: {
        version: 1,
        status: "paused",
        step: "llm",
        selectedChatProvider: "google",
        selectedEmbeddingProvider: "google",
        confirmedLocalChatProvider: false,
        confirmedLocalEmbeddingProvider: false,
        useCases: { knowledge: true, social: false, localBusiness: false, crm: false },
        channels: { meta: false, twitter: false },
        crmMode: "internal",
        skipped: [],
        updatedAt: "2026-03-31T00:00:00.000Z",
      },
      state: {
        tone: "partial",
        label: "Resume setup",
        detail: "Chat provider still needs setup.",
        completionPercent: 50,
        requiredTotal: 2,
        requiredReady: 1,
        checks: [],
      },
      stored: {
        publicEnv: { BIZBOT_WORKSPACE_PATH: "./workspace" },
        secretPresence: { GOOGLE_AI_API_KEY: false },
      },
    });
    mocks.updateAgenticSetup.mockResolvedValue({
      state: { tone: "ready", label: "Setup ready", detail: "Required setup items are configured.", completionPercent: 100 },
    });
  });

  it("returns the current setup payload", async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getAgenticSetupPayload).toHaveBeenCalledTimes(1);
    expect(payload.state.label).toBe("Resume setup");
  });

  it("updates the setup payload through PATCH", async () => {
    const response = await PATCH(new NextRequest("http://localhost/api/agentic-setup", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "resume",
        session: {
          step: "review",
          selectedChatProvider: "google",
        },
        env: {
          GOOGLE_AI_API_KEY: "secret-value",
        },
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.updateAgenticSetup).toHaveBeenCalledWith({
      action: "resume",
      session: {
        step: "review",
        selectedChatProvider: "google",
      },
      env: {
        GOOGLE_AI_API_KEY: "secret-value",
      },
    });
    expect(payload.state.tone).toBe("ready");
  });
});