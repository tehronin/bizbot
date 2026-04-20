import { describe, expect, it } from "vitest";
import { getToolResultFailure, normalizeFailure } from "@/lib/failures";

describe("failure envelopes", () => {
  it("classifies timeout failures deterministically", () => {
    const failure = normalizeFailure(new Error("Request timed out while reading runs"), {
      component: "agent_executor",
      operation: "tool_execution",
      toolName: "developer_list_agent_runs",
      layer: "tool",
    });

    expect(failure).toEqual(expect.objectContaining({
      layer: "tool",
      kind: "timeout",
      retryable: true,
      resumeSafe: false,
      suggestedNextAction: "retry_with_backoff",
      raw: "Request timed out while reading runs",
      fingerprint: expect.any(String),
    }));
  });

  it("upgrades tool error payloads with a normalized failure envelope", () => {
    const normalized = getToolResultFailure({ error: "Missing required tool argument: url" }, {
      component: "agent_executor",
      operation: "tool_execution",
      toolName: "browser_navigate",
      layer: "tool",
    });

    expect(normalized.isError).toBe(true);
    expect(normalized.failure).toEqual(expect.objectContaining({
      layer: "validation",
      kind: "bad_input",
      suggestedNextAction: "fix_input",
    }));
    expect(normalized.result).toEqual(expect.objectContaining({
      error: "Missing required tool argument: url",
      failure: expect.objectContaining({
        kind: "bad_input",
      }),
    }));
  });
});