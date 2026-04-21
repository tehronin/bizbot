import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const tempWorkspaceRoot = vi.hoisted(() => `${process.cwd().replace(/\\/g, "/")}/.tmp-vitest-run-journal`);

vi.mock("@/lib/files/workspace", () => ({
  getWorkspacePath: () => tempWorkspaceRoot,
}));

import {
  clearAgentRuns,
  deleteAgentRun,
  deleteUsageLedgerEntry,
  getConversationUsageSummary,
  getAgentRunResumeSnapshot,
  getUsageLedgerSnapshot,
  listAgentRuns,
  listUsageLedgerRuns,
  recordAgentRunResumeSnapshot,
  recordAgentRunToolResult,
  startAgentRun,
  completeAgentRun,
  recordAgentRunRoundUsage,
} from "@/lib/agent/run-journal";
import { normalizeFailure } from "@/lib/failures";

function resetRunsDir(): void {
  fs.rmSync(path.join(tempWorkspaceRoot, ".bizbot"), { recursive: true, force: true });
}

describe("run journal usage ledger", () => {
  beforeEach(() => {
    resetRunsDir();
  });

  afterAll(() => {
    fs.rmSync(tempWorkspaceRoot, { recursive: true, force: true });
  });

  it("aggregates runs by day, provider, and model", () => {
    const runA = startAgentRun({
      conversationId: "conversation-1",
      profile: "general_operator",
      provider: "google",
      model: "gemini-3-flash-preview",
      userMessage: "first",
      availableTools: [],
    });
    const runB = startAgentRun({
      conversationId: "conversation-2",
      profile: "content_operator",
      provider: "google",
      model: "gemini-3-flash-preview",
      userMessage: "second",
      availableTools: [],
    });
    const runC = startAgentRun({
      conversationId: "conversation-3",
      profile: "builder_operator",
      provider: "ollama",
      model: "gemma3",
      userMessage: "third",
      availableTools: [],
    });

    recordAgentRunRoundUsage(runA.runId, {
      round: 1,
      provider: "google",
      model: "gemini-3-flash-preview",
      promptTokens: 100,
      completionTokens: 25,
      totalTokens: 125,
      cachedPromptTokens: 5,
    });
    recordAgentRunRoundUsage(runB.runId, {
      round: 1,
      provider: "google",
      model: "gemini-3-flash-preview",
      promptTokens: 120,
      completionTokens: 20,
      totalTokens: 140,
      cachedPromptTokens: 0,
    });
    recordAgentRunRoundUsage(runB.runId, {
      round: 2,
      provider: "google",
      model: "gemini-3-flash-preview",
      promptTokens: 60,
      completionTokens: 10,
      totalTokens: 70,
      cachedPromptTokens: 2,
    });
    recordAgentRunRoundUsage(runC.runId, {
      round: 1,
      provider: "ollama",
      model: "gemma3",
      promptTokens: 40,
      completionTokens: 10,
      totalTokens: 50,
      cachedPromptTokens: 0,
    });

    completeAgentRun(runA.runId, { status: "completed", roundsCompleted: 1, reply: "ok" });
    completeAgentRun(runB.runId, { status: "failed", roundsCompleted: 1, error: "boom" });
    completeAgentRun(runC.runId, { status: "completed", roundsCompleted: 1, reply: "done" });

    const snapshot = getUsageLedgerSnapshot();

    expect(snapshot.totals.entryCount).toBe(2);
    expect(snapshot.totals.runCount).toBe(3);
    expect(snapshot.totals.requestCount).toBe(4);
    expect(snapshot.totals.totalTokens).toBe(385);
    expect(snapshot.totals.averageTokensPerRequest).toBe(96.25);

    const googleEntry = snapshot.entries.find((entry) => entry.provider === "google");
    expect(googleEntry).toBeDefined();
    expect(googleEntry?.runCount).toBe(2);
    expect(googleEntry?.requestCount).toBe(3);
    expect(googleEntry?.promptTokens).toBe(280);
    expect(googleEntry?.completionTokens).toBe(55);
    expect(googleEntry?.totalTokens).toBe(335);
    expect(googleEntry?.cachedPromptTokens).toBe(7);
    expect(googleEntry?.averageTokensPerRun).toBe(167.5);
    expect(googleEntry?.averageTokensPerRequest).toBeCloseTo(111.666, 2);
    expect(googleEntry?.statusCounts.completed).toBe(1);
    expect(googleEntry?.statusCounts.failed).toBe(1);

    const googleRuns = listUsageLedgerRuns(googleEntry!.id);
    expect(googleRuns).toHaveLength(2);
    expect(googleRuns[0]?.provider).toBe("google");
    expect(googleRuns[0]?.requestCount).toBeGreaterThanOrEqual(1);
  });

  it("deletes a single run or an entire ledger entry", () => {
    const runA = startAgentRun({
      conversationId: "conversation-1",
      profile: "general_operator",
      provider: "google",
      model: "gemini-3-flash-preview",
      userMessage: "first",
      availableTools: [],
    });
    const runB = startAgentRun({
      conversationId: "conversation-2",
      profile: "general_operator",
      provider: "google",
      model: "gemini-3-flash-preview",
      userMessage: "second",
      availableTools: [],
    });

    recordAgentRunRoundUsage(runA.runId, {
      round: 1,
      provider: "google",
      model: "gemini-3-flash-preview",
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cachedPromptTokens: 0,
    });
    recordAgentRunRoundUsage(runB.runId, {
      round: 1,
      provider: "google",
      model: "gemini-3-flash-preview",
      promptTokens: 11,
      completionTokens: 6,
      totalTokens: 17,
      cachedPromptTokens: 0,
    });

    completeAgentRun(runA.runId, { status: "completed", roundsCompleted: 1, reply: "ok" });
    completeAgentRun(runB.runId, { status: "completed", roundsCompleted: 1, reply: "ok" });

    deleteAgentRun(runA.runId);
    expect(listAgentRuns()).toHaveLength(1);

    const snapshot = getUsageLedgerSnapshot();
    const entry = snapshot.entries[0];
    expect(entry?.runCount).toBe(1);

    const deleted = deleteUsageLedgerEntry(entry!.id);
    expect(deleted.deletedCount).toBe(1);
    expect(listAgentRuns()).toHaveLength(0);
    expect(getUsageLedgerSnapshot().entries).toHaveLength(0);
  });

  it("clears all persisted agent runs", () => {
    const runA = startAgentRun({
      conversationId: "conversation-1",
      profile: "general_operator",
      provider: "google",
      model: "gemini-3-flash-preview",
      userMessage: "first",
      availableTools: [],
    });
    const runB = startAgentRun({
      conversationId: "conversation-2",
      profile: "content_operator",
      provider: "openai",
      model: "gpt-4o",
      userMessage: "second",
      availableTools: [],
    });

    completeAgentRun(runA.runId, { status: "completed", roundsCompleted: 0, reply: "ok" });
    completeAgentRun(runB.runId, { status: "failed", roundsCompleted: 0, error: "boom" });

    const cleared = clearAgentRuns();

    expect(cleared.deletedCount).toBe(2);
    expect(cleared.deletedRunIds).toEqual(expect.arrayContaining([runA.runId, runB.runId]));
    expect(listAgentRuns()).toHaveLength(0);
  });

  it("loads legacy run files that do not include usage rounds", () => {
    const runsDir = path.join(tempWorkspaceRoot, ".bizbot", "agent-runs");
    fs.mkdirSync(runsDir, { recursive: true });

    fs.writeFileSync(path.join(runsDir, "legacy-run.json"), JSON.stringify({
      runId: "legacy-run",
      conversationId: "conversation-legacy",
      profile: "general_operator",
      profileLabel: "General",
      profileMission: "Legacy run",
      provider: "google",
      model: "gemini-3-flash-preview",
      status: "completed",
      startedAt: "2026-04-01T10:00:00.000Z",
      updatedAt: "2026-04-01T10:05:00.000Z",
      finishedAt: "2026-04-01T10:05:00.000Z",
      userMessage: "legacy",
      availableTools: [],
      childRunIds: [],
      toolPolicy: {
        allowedPrefixes: [],
        allowedTools: [],
        deniedTools: [],
      },
      roundsCompleted: 1,
      toolCallCount: 0,
      toolEvents: [],
      usage: {
        promptTokens: 120,
        completionTokens: 30,
        totalTokens: 150,
        cachedPromptTokens: 0,
      },
      reply: "ok",
    }, null, 2), "utf8");

    const snapshot = getUsageLedgerSnapshot();

    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.requestCount).toBe(1);
    expect(snapshot.entries[0]?.totalTokens).toBe(150);

    const runs = listUsageLedgerRuns(snapshot.entries[0]!.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.requestCount).toBe(1);
    expect(runs[0]?.averageTokensPerRequest).toBe(150);
  });

  it("aggregates usage totals across all runs in a conversation and keeps latest run metadata", () => {
    const olderRun = startAgentRun({
      conversationId: "conversation-shared",
      profile: "general_operator",
      provider: "google",
      model: "gemini-3-flash-preview",
      userMessage: "first",
      availableTools: [],
    });
    recordAgentRunRoundUsage(olderRun.runId, {
      round: 1,
      provider: "google",
      model: "gemini-3-flash-preview",
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cachedPromptTokens: 3,
    });
    completeAgentRun(olderRun.runId, { status: "completed", roundsCompleted: 1, reply: "done" });

    const newerRun = startAgentRun({
      conversationId: "conversation-shared",
      profile: "content_operator",
      provider: "openai",
      model: "gpt-4o",
      userMessage: "second",
      availableTools: [],
    });
    recordAgentRunRoundUsage(newerRun.runId, {
      round: 1,
      provider: "openai",
      model: "gpt-4o",
      promptTokens: 50,
      completionTokens: 25,
      totalTokens: 75,
      cachedPromptTokens: 0,
    });
    recordAgentRunRoundUsage(newerRun.runId, {
      round: 2,
      provider: "openai",
      model: "gpt-4o",
      promptTokens: 40,
      completionTokens: 15,
      totalTokens: 55,
      cachedPromptTokens: 1,
    });
    completeAgentRun(newerRun.runId, { status: "completed", roundsCompleted: 2, reply: "done" });

    const summary = getConversationUsageSummary("conversation-shared");

    expect(summary.conversationId).toBe("conversation-shared");
    expect(summary.runId).toBe(newerRun.runId);
    expect(summary.profile).toBe("content_operator");
    expect(summary.provider).toBe("openai");
    expect(summary.model).toBe("gpt-4o");
    expect(summary.requestCount).toBe(3);
    expect(summary.promptTokens).toBe(190);
    expect(summary.completionTokens).toBe(60);
    expect(summary.totalTokens).toBe(250);
    expect(summary.cachedPromptTokens).toBe(4);
  });

  it("stores normalized failure envelopes on tool events and failed runs", () => {
    const run = startAgentRun({
      conversationId: "conversation-1",
      profile: "general_operator",
      provider: "google",
      model: "gemini-3-flash-preview",
      userMessage: "inspect failures",
      availableTools: ["developer_list_agent_runs"],
    });

    const failure = normalizeFailure("Request timed out while reading runs", {
      component: "agent_executor",
      operation: "tool_execution",
      toolName: "developer_list_agent_runs",
      layer: "tool",
    });

    recordAgentRunToolResult(run.runId, {
      round: 1,
      toolCallId: "tool-1",
      name: "developer_list_agent_runs",
      result: JSON.stringify({ error: failure.raw, failure }),
      isError: true,
      failure,
    });
    completeAgentRun(run.runId, {
      status: "failed",
      roundsCompleted: 1,
      error: failure.raw,
      failure,
    });

    const stored = listAgentRuns()[0];
    expect(stored?.failure).toEqual(expect.objectContaining({
      kind: "timeout",
      layer: "tool",
      fingerprint: expect.any(String),
    }));
    expect(stored?.toolEvents[0]).toEqual(expect.objectContaining({
      phase: "result",
      isError: true,
      failure: expect.objectContaining({
        kind: "timeout",
        suggestedNextAction: "retry_with_backoff",
      }),
    }));
  });

  it("persists resumable checkpoints and blocks unsafe completed tool steps", () => {
    const safeRun = startAgentRun({
      conversationId: "conversation-safe",
      profile: "general_operator",
      provider: "google",
      model: "gemini-3-flash-preview",
      userMessage: "inspect state",
      availableTools: ["developer_list_agent_runs"],
    });

    recordAgentRunResumeSnapshot(safeRun.runId, {
      lastStableRound: 1,
      pendingRound: 2,
      pendingRoundStatus: "interrupted",
      stableMessages: [
        { role: "system", content: "system" },
        { role: "user", content: "inspect state" },
      ],
      completedToolCalls: [{
        signature: "safe-sig",
        round: 1,
        toolCallId: "tool-1",
        name: "developer_list_agent_runs",
        args: {},
        result: "{}",
        isError: false,
        resumeSafe: true,
      }],
    });

    const safeSnapshot = getAgentRunResumeSnapshot(safeRun.runId);
    expect(safeSnapshot.resumeEligible).toBe(true);
    expect(safeSnapshot.lastStableRound).toBe(1);

    const unsafeRun = startAgentRun({
      conversationId: "conversation-unsafe",
      profile: "general_operator",
      provider: "google",
      model: "gemini-3-flash-preview",
      userMessage: "show sidecar",
      availableTools: ["sidecar_open"],
    });

    recordAgentRunResumeSnapshot(unsafeRun.runId, {
      lastStableRound: 1,
      pendingRound: 2,
      pendingRoundStatus: "interrupted",
      stableMessages: [
        { role: "system", content: "system" },
        { role: "user", content: "show sidecar" },
      ],
      completedToolCalls: [{
        signature: "unsafe-sig",
        round: 1,
        toolCallId: "tool-2",
        name: "sidecar_open",
        args: { title: "Brief" },
        result: "{}",
        isError: false,
        resumeSafe: false,
      }],
    });

    const unsafeSnapshot = getAgentRunResumeSnapshot(unsafeRun.runId);
    expect(unsafeSnapshot.resumeEligible).toBe(false);
    expect(unsafeSnapshot.resumeBlockedReason).toContain("sidecar_open");
  });

  it("fails closed when persisted resume state is malformed", () => {
    const runsDir = path.join(tempWorkspaceRoot, ".bizbot", "agent-runs");
    fs.mkdirSync(runsDir, { recursive: true });

    fs.writeFileSync(path.join(runsDir, "corrupt-run.json"), JSON.stringify({
      runId: "corrupt-run",
      conversationId: "conversation-corrupt",
      profile: "general_operator",
      profileLabel: "General",
      profileMission: "Test",
      provider: "google",
      model: "gemini-3-flash-preview",
      status: "failed",
      startedAt: "2026-04-01T10:00:00.000Z",
      updatedAt: "2026-04-01T10:05:00.000Z",
      finishedAt: "2026-04-01T10:05:00.000Z",
      userMessage: "resume me",
      availableTools: ["developer_list_agent_runs"],
      childRunIds: [],
      toolPolicy: {
        allowedPrefixes: [],
        allowedTools: [],
        deniedTools: [],
      },
      roundsCompleted: 1,
      toolCallCount: 1,
      toolEvents: [],
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedPromptTokens: 0,
        rounds: [],
      },
      snapshot: {
        version: 1,
        lastStableRound: 1,
        pendingRound: 2,
        pendingRoundStatus: "interrupted",
        stableMessages: "not-an-array",
        completedToolCalls: [{ name: "developer_list_agent_runs" }],
      },
      error: "bad state",
    }, null, 2), "utf8");

    const snapshot = getAgentRunResumeSnapshot("corrupt-run");
    expect(snapshot.resumeEligible).toBe(false);
    expect(snapshot.resumeBlockedReason).toBe("Run has no stable checkpointed message state.");
  });
});