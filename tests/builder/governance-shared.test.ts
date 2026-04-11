import { describe, expect, it } from "vitest";
import { buildBuilderGovernanceCommandPayload, parseBuilderGovernanceCommandPayload } from "@/lib/builder/governance-shared";

describe("builder governance shared helpers", () => {
  it("normalizes governance payloads with a default api source", () => {
    const parsed = parseBuilderGovernanceCommandPayload({
      action: "resolve_mcp_contract_drift",
      runId: "run-1",
      decision: "approve",
      confirmed: true,
      reason: "Accept the reviewed contract drift.",
    });

    expect(parsed).toEqual({
      command: {
        action: "resolve_mcp_contract_drift",
        runId: "run-1",
        decision: "approve",
        confirmed: true,
        reason: "Accept the reviewed contract drift.",
      },
      sourceSurface: "api",
    });
  });

  it("builds dashboard governance payloads with an explicit source", () => {
    expect(buildBuilderGovernanceCommandPayload({
      action: "reconcile_mcp_policy",
      confirmed: true,
      reason: "Promote the reviewed MCP baseline.",
      sourceSurface: "dashboard",
    })).toEqual({
      action: "reconcile_mcp_policy",
      confirmed: true,
      reason: "Promote the reviewed MCP baseline.",
      sourceSurface: "dashboard",
    });
  });
});