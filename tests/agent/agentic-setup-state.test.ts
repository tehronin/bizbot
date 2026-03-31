import { describe, expect, it } from "vitest";
import { computeAgenticSetupState, type AgenticSetupSession } from "@/lib/agentic-setup";

function createSession(overrides: Partial<AgenticSetupSession> = {}): AgenticSetupSession {
  return {
    version: 1,
    status: "not_started",
    step: "welcome",
    selectedChatProvider: "google",
    selectedEmbeddingProvider: "google",
    confirmedLocalChatProvider: false,
    confirmedLocalEmbeddingProvider: false,
    useCases: {
      knowledge: false,
      social: false,
      localBusiness: false,
      crm: false,
    },
    channels: {
      meta: false,
      twitter: false,
    },
    crmMode: "internal",
    skipped: [],
    updatedAt: null,
    ...overrides,
  };
}

describe("agentic setup state", () => {
  it("does not report ready when only a chat credential exists and the guide was never completed", () => {
    const state = computeAgenticSetupState(createSession(), {
      GOOGLE_AI_API_KEY: "google-key",
    });

    expect(state.tone).toBe("partial");
    expect(state.label).toBe("Review guide");
    expect(state.isFirstRun).toBe(false);
    expect(state.nextRequiredLabel).toBeNull();
    expect(state.completionPercent).toBeLessThan(100);
  });

  it("reports ready only after the guide is completed", () => {
    const state = computeAgenticSetupState(createSession({ status: "completed" }), {
      GOOGLE_AI_API_KEY: "google-key",
    });

    expect(state.tone).toBe("ready");
    expect(state.label).toBe("Setup complete");
    expect(state.isFirstRun).toBe(false);
    expect(state.nextRequiredLabel).toBeNull();
    expect(state.completionPercent).toBe(100);
  });

  it("reports the exact missing required item when setup is incomplete", () => {
    const state = computeAgenticSetupState(createSession({
      status: "in_progress",
      step: "llm",
      useCases: {
        knowledge: true,
        social: false,
        localBusiness: false,
        crm: false,
      },
    }), {});

    expect(state.tone).toBe("partial");
    expect(state.isFirstRun).toBe(false);
    expect(state.nextRequiredLabel).toBe("Chat provider");
  });

  it("marks a blank install as first run", () => {
    const state = computeAgenticSetupState(createSession(), {});

    expect(state.tone).toBe("missing");
    expect(state.isFirstRun).toBe(true);
    expect(state.nextRequiredLabel).toBe("Chat provider");
  });
});