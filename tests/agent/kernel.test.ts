import { FunctionCallingConfigMode } from "@google/genai";
import { describe, expect, it } from "vitest";
import { buildGoogleToolingConfig, extractOpenAICompatibleUsage, getProviderCapabilityFlags } from "@/lib/agent/kernel";

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