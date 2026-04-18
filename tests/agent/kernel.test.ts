import { FunctionCallingConfigMode } from "@google/genai";
import { describe, expect, it } from "vitest";
import { buildGoogleToolingConfig, extractOpenAICompatibleUsage, getActiveProvider, getProviderCapabilityFlags } from "@/lib/agent/kernel";

describe("active provider resolution", () => {
  it("prefers a configured cloud provider when ACTIVE_LLM_PROVIDER is unset", () => {
    const originalActiveProvider = process.env.ACTIVE_LLM_PROVIDER;
    const originalGoogleApiKey = process.env.GOOGLE_AI_API_KEY;
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
    const originalMinimaxKey = process.env.MINIMAX_API_KEY;

    delete process.env.ACTIVE_LLM_PROVIDER;
    process.env.GOOGLE_AI_API_KEY = "google-key";
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MINIMAX_API_KEY;

    expect(getActiveProvider()).toBe("google");

    if (typeof originalActiveProvider === "string") {
      process.env.ACTIVE_LLM_PROVIDER = originalActiveProvider;
    } else {
      delete process.env.ACTIVE_LLM_PROVIDER;
    }
    if (typeof originalGoogleApiKey === "string") {
      process.env.GOOGLE_AI_API_KEY = originalGoogleApiKey;
    } else {
      delete process.env.GOOGLE_AI_API_KEY;
    }
    if (typeof originalOpenAiKey === "string") {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    if (typeof originalAnthropicKey === "string") {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
    if (typeof originalMinimaxKey === "string") {
      process.env.MINIMAX_API_KEY = originalMinimaxKey;
    } else {
      delete process.env.MINIMAX_API_KEY;
    }
  });
});

describe("provider capability flags", () => {
  it("marks Google usage telemetry as verified", () => {
    expect(getProviderCapabilityFlags("google")).toEqual(expect.objectContaining({
      usageReliability: expect.objectContaining({
        supported: true,
        reliability: "verified",
      }),
      supportsToolCalling: true,
      nativeExtras: ["search-grounding", "code-execution"],
    }));
  });

  it("marks MiniMax usage telemetry as unverified until validated", () => {
    expect(getProviderCapabilityFlags("minimax")).toEqual(expect.objectContaining({
      usageReliability: expect.objectContaining({
        supported: true,
        reliability: "unverified",
      }),
    }));
  });

  it("extracts standard OpenAI-compatible usage totals", () => {
    expect(extractOpenAICompatibleUsage({
      usage: {
        prompt_tokens: 120,
        completion_tokens: 35,
        total_tokens: 155,
        prompt_tokens_details: {
          cached_tokens: 22,
        },
      },
    })).toEqual({
      promptTokens: 120,
      completionTokens: 35,
      totalTokens: 155,
      cachedPromptTokens: 22,
    });
  });

  it("falls back to Ollama eval counters when OpenAI usage totals are missing", () => {
    expect(extractOpenAICompatibleUsage({
      prompt_eval_count: 64,
      eval_count: 19,
    })).toEqual({
      promptTokens: 64,
      completionTokens: 19,
      totalTokens: 83,
      cachedPromptTokens: undefined,
    });
  });

  it("disables Gemini native extras when forced function calling is required", () => {
    expect(buildGoogleToolingConfig({
      functionDeclarations: [{
        name: "builder_read_file",
        description: "Read a Builder file.",
        parametersJsonSchema: { type: "object" },
      }],
      options: {
        forceFunctionCall: true,
        enableGoogleCodeExecution: true,
        enableGoogleSearch: true,
      },
    })).toEqual({
      tools: [{
        functionDeclarations: [{
          name: "builder_read_file",
          description: "Read a Builder file.",
          parametersJsonSchema: { type: "object" },
        }],
      }],
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
        },
        includeServerSideToolInvocations: true,
      },
    });
  });
});