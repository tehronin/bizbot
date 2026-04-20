import { describe, expect, it } from "vitest";
import { extractBuilderRunTelemetry, summarizeBuilderBudgetProfiles, summarizeBuilderRunTelemetry } from "@/lib/builder/telemetry";

describe("builder telemetry", () => {
  it("extracts mode, blocked reason, duration, and token usage from run metadata", () => {
    const telemetry = extractBuilderRunTelemetry({
      status: "FAILED",
      startedAt: new Date("2026-04-07T00:00:00.000Z"),
      finishedAt: new Date("2026-04-07T00:02:00.000Z"),
      metadata: {
        template: "node-cli",
        mode: "implementation",
        telemetry: {
          provider: "google",
          model: "gemini-3-flash-preview",
          blockedReason: "build failed during verification",
          failureEnvelope: {
            version: 1,
            fingerprint: "builder-failure-1",
            layer: "semantic",
            kind: "repeated_failure",
            retryable: false,
            resumeSafe: false,
            suggestedNextAction: "inspect_stuck_loop",
            operatorSummary: "Builder loop is repeating the same failure.",
            raw: "build failed during verification",
            errorName: null,
            code: null,
            statusCode: null,
          },
          usage: {
            promptTokens: 1000,
            completionTokens: 250,
            totalTokens: 1250,
            cachedPromptTokens: 100,
            requestCount: 2,
          },
        },
      },
    } as never);

    expect(telemetry.durationMs).toBe(120000);
    expect(telemetry.mode).toBe("implementation");
    expect(telemetry.template).toBe("node-cli");
    expect(telemetry.provider).toBe("google");
    expect(telemetry.model).toBe("gemini-3-flash-preview");
    expect(telemetry.blockedReason).toBe("build failed during verification");
    expect(telemetry.failureEnvelope).toEqual(expect.objectContaining({
      kind: "repeated_failure",
      suggestedNextAction: "inspect_stuck_loop",
    }));
    expect(telemetry.totalTokens).toBe(1250);
    expect(telemetry.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("summarizes telemetry across durations, modes, templates, and blocked reasons", () => {
    const summary = summarizeBuilderRunTelemetry([
      {
        status: "SUCCEEDED",
        startedAt: new Date("2026-04-07T00:00:00.000Z"),
        finishedAt: new Date("2026-04-07T00:01:00.000Z"),
        metadata: {
          template: "node-cli",
          mode: "implementation",
          telemetry: {
            provider: "google",
            model: "gemini-3-flash-preview",
            usage: {
              promptTokens: 100,
              completionTokens: 50,
              totalTokens: 150,
              cachedPromptTokens: 0,
              requestCount: 1,
            },
          },
        },
      },
      {
        status: "FAILED",
        startedAt: new Date("2026-04-07T00:02:00.000Z"),
        finishedAt: new Date("2026-04-07T00:05:00.000Z"),
        metadata: {
          template: "next-app",
          mode: "verification",
          telemetry: {
            blockedReason: "build failed during verification",
            usage: {
              promptTokens: 200,
              completionTokens: 100,
              totalTokens: 300,
              cachedPromptTokens: 25,
              requestCount: 2,
            },
          },
        },
      },
    ] as never, undefined, {
      version: 1,
      projectRelativePath: "projects/demo",
      updatedAt: "2026-04-20T00:00:00.000Z",
      planning: {
        lookups: 4,
        hits: 1,
        misses: 2,
        bypasses: 1,
        writes: 2,
        keyChanges: 1,
        lastKey: "key-2",
        lastLookupAt: "2026-04-20T00:00:00.000Z",
        lastWriteAt: "2026-04-20T00:00:00.000Z",
      },
      projection: {
        syncs: 2,
        filesWritten: 5,
        filesSkipped: 15,
        manifestWrites: 1,
        manifestReused: 1,
        lastSyncAt: "2026-04-20T00:00:00.000Z",
      },
    });

    expect(summary.completedRuns).toBe(2);
    expect(summary.runningRuns).toBe(0);
    expect(summary.avgDurationMs).toBe(120000);
    expect(summary.modeCounts.implementation).toBe(1);
    expect(summary.modeCounts.verification).toBe(1);
    expect(summary.templateCounts["node-cli"]).toBe(1);
    expect(summary.templateCounts["next-app"]).toBe(1);
    expect(summary.blockedReasonCounts["build failed during verification"]).toBe(1);
    expect(summary.topBlockedReason).toBe("build failed during verification");
    expect(summary.tokenTotals.totalTokens).toBe(450);
    expect(summary.cache.planning.hitRate).toBe(0.25);
    expect(summary.cache.projection.writeSkipRate).toBe(0.75);
  });

  it("returns explicit default budget profiles with observed telemetry by mode", () => {
    const profiles = summarizeBuilderBudgetProfiles([
      {
        status: "SUCCEEDED",
        startedAt: new Date("2026-04-07T00:00:00.000Z"),
        finishedAt: new Date("2026-04-07T00:03:00.000Z"),
        metadata: {
          template: "node-cli",
          mode: "implementation",
          telemetry: {
            blockedReason: "lint failed",
            usage: {
              promptTokens: 1200,
              completionTokens: 300,
              totalTokens: 1500,
              cachedPromptTokens: 100,
              requestCount: 2,
            },
          },
        },
      },
      {
        status: "FAILED",
        startedAt: new Date("2026-04-07T00:04:00.000Z"),
        finishedAt: new Date("2026-04-07T00:05:00.000Z"),
        metadata: {
          template: "next-app",
          mode: "verification",
          telemetry: {
            blockedReason: "build failed during verification",
            usage: {
              promptTokens: 500,
              completionTokens: 150,
              totalTokens: 650,
              cachedPromptTokens: 0,
              requestCount: 1,
            },
          },
        },
      },
    ] as never);

    expect(profiles).toHaveLength(4);
    expect(profiles.find((profile) => profile.mode === "analysis_only")?.maxIterations).toBe(1);
    expect(profiles.find((profile) => profile.mode === "scaffold")?.maxRequestCount).toBe(3);

    const implementation = profiles.find((profile) => profile.mode === "implementation");
    expect(implementation?.observedRuns).toBe(1);
    expect(implementation?.observedAvgDurationMs).toBe(180000);
    expect(implementation?.observedAvgTotalTokens).toBe(1500);
    expect(implementation?.topBlockedReason).toBe("lint failed");

    const verification = profiles.find((profile) => profile.mode === "verification");
    expect(verification?.observedRuns).toBe(1);
    expect(verification?.topBlockedReason).toBe("build failed during verification");
  });
});